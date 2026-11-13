const dates = require('./dates');
const settings = require('./settings');
const recurring = require('./recurring');

// 下一個扣款日（嚴格晚於 afterDate）
function nextLoanDate(afterDate, day) {
  const { y, m } = dates.parse(afterDate);
  const thisMonth = dates.make(y, m, day);
  return thisMonth > afterDate ? thisMonth : dates.make(y, m + 1, day);
}

// 記一筆貸款繳款：整筆從存款轉到貸款帳戶（不另外計算利息）
// 實際剩餘本金以銀行為準，用「更新剩餘本金」校正
async function recordLoanPayment(client, { loan, fromId, date, amount, pending }) {
  if (!(amount > 0)) return;
  await client.query(
    `INSERT INTO transactions (type, txn_date, account_id, to_account_id, amount, title, source, pending_review)
     VALUES ('transfer', $1, $2, $3, $4, $5, $6, $7)`,
    [date, fromId, loan.id, amount, `${loan.name} 繳款`, pending ? 'autopay' : 'manual', pending]
  );
}

// 執行到期的自動扣款；在總覽、帳戶列表讀取時呼叫
async function run(client) {
  const { rows: lock } = await client.query('SELECT pg_try_advisory_xact_lock(424242) AS ok');
  if (!lock[0].ok) return;
  const today = dates.today();

  // 信用卡：只扣「已對帳」的帳單，金額就是對帳時勾選的總額
  const { rows: bills } = await client.query(
    `SELECT s.*, a.name AS card_name, a.autopay_account_id
     FROM card_statements s JOIN accounts a ON a.id = s.account_id
     WHERE a.kind = 'credit_card' AND NOT a.archived AND a.autopay_account_id IS NOT NULL
       AND s.status = 'reconciled' AND s.due_date <= $1`,
    [today]
  );
  for (const s of bills) {
    if (s.statement_amount > 0) {
      await client.query(
        `INSERT INTO transactions (type, txn_date, account_id, to_account_id, amount, title, statement_id, source, pending_review)
         VALUES ('transfer', $1, $2, $3, $4, $5, $6, 'autopay', TRUE)`,
        [s.due_date, s.autopay_account_id, s.account_id, s.statement_amount, `${s.card_name} 自動扣繳`, s.id]
      );
    }
    await client.query(`UPDATE card_statements SET status = 'paid' WHERE id = $1`, [s.id]);
  }

  // 貸款：每月固定金額整筆轉入貸款帳戶
  const { rows: loans } = await client.query(
    `SELECT a.*, b.balance
     FROM accounts a JOIN v_account_balances b ON b.id = a.id
     WHERE a.kind = 'loan' AND a.autopay_account_id IS NOT NULL AND a.loan_payment > 0
       AND a.loan_day IS NOT NULL AND a.loan_next_date IS NOT NULL AND a.loan_next_date <= $1`,
    [today]
  );
  for (const loan of loans) {
    let owed = loan.balance;
    let next = loan.loan_next_date;
    let guard = 0;
    while (next <= today && owed > 0 && guard++ < 36) {
      await recordLoanPayment(client, { loan, fromId: loan.autopay_account_id, date: next, amount: loan.loan_payment, pending: true });
      owed -= loan.loan_payment;
      next = nextLoanDate(next, loan.loan_day);
    }
    await client.query('UPDATE accounts SET loan_next_date = $2 WHERE id = $1', [loan.id, owed > 0 ? next : null]);
  }

  // 固定支出：設定自動記帳的，到期自動產生一筆支出（待核對）
  const { rows: subs } = await client.query(
    `SELECT * FROM subscriptions WHERE active AND auto_create AND next_date <= $1`, [today]
  );
  for (const sub of subs) {
    let next = sub.next_date;
    let guard = 0;
    while (next <= today && guard++ < 24) {
      const { rows } = await client.query(
        `INSERT INTO transactions (type, txn_date, account_id, title, source, pending_review, subscription_id)
         VALUES ('expense', $1, $2, $3, 'subscription', TRUE, $4) RETURNING id`,
        [next, sub.account_id, sub.name, sub.id]
      );
      await client.query(
        `INSERT INTO transaction_items (transaction_id, name, unit_price, quantity, category_id)
         VALUES ($1, $2, $3, 1, $4)`,
        [rows[0].id, sub.name, sub.amount, sub.category_id]
      );
      next = recurring.nextDate(next, sub.cycle);
    }
    await client.query('UPDATE subscriptions SET next_date = $2 WHERE id = $1', [sub.id, next]);
  }

  // 美甲 10% 收入袋：每個月結束後，把上個月美甲收入的一定比例轉進收入袋
  const nail = await settings.get(client, 'nail');
  if (nail && nail.bag_account_id && nail.source_account_id && nail.income_category_id && nail.start_month) {
    const rate = Number(nail.rate) || 10;
    const thisMonth = `${today.slice(0, 7)}-01`;
    let month = nail.start_month;
    let guard = 0;
    while (month < thisMonth && guard++ < 36) {
      const { rows: done } = await client.query('SELECT 1 FROM nail_allocations WHERE month = $1', [month]);
      if (!done.length) {
        const { rows: inc } = await client.query(
          `SELECT COALESCE(SUM(i.amount), 0)::BIGINT AS income
           FROM transaction_items i JOIN transactions t ON t.id = i.transaction_id
           WHERE t.type = 'income' AND i.category_id = $1 AND NOT i.is_advance
             AND t.txn_date >= $2::date AND t.txn_date < ($2::date + INTERVAL '1 month')`,
          [nail.income_category_id, month]
        );
        const income = inc[0].income;
        const amount = settings.nailAllocation(income, rate);
        let txnId = null;
        if (amount > 0) {
          const nextMonth = dates.make(Number(month.slice(0, 4)), Number(month.slice(5, 7)) + 1, 1);
          const { rows } = await client.query(
            `INSERT INTO transactions (type, txn_date, account_id, to_account_id, amount, title, source, pending_review)
             VALUES ('transfer', $1, $2, $3, $4, $5, 'autopay', TRUE) RETURNING id`,
            [nextMonth, nail.source_account_id, nail.bag_account_id, amount,
             `美甲 ${rate}% 收入袋（${Number(month.slice(5, 7))} 月）`]
          );
          txnId = rows[0].id;
        }
        await client.query(
          'INSERT INTO nail_allocations (month, income, amount, transaction_id) VALUES ($1, $2, $3, $4)',
          [month, income, amount, txnId]
        );
      }
      month = dates.make(Number(month.slice(0, 4)), Number(month.slice(5, 7)) + 1, 1);
    }
  }
}

module.exports = { run, nextLoanDate, recordLoanPayment };
