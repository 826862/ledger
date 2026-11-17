const dates = require('./dates');

// 某一天的消費會落在哪一期帳單（回傳該期結帳日）
function periodEndFor(dateStr, statementDay) {
  const { y, m, d } = dates.parse(dateStr);
  const thisMonth = dates.make(y, m, statementDay);
  return dateStr <= thisMonth ? thisMonth : dates.make(y, m + 1, statementDay);
}

function boundsFor(periodEnd, statementDay, dueDay) {
  const { y, m } = dates.parse(periodEnd);
  const prevEnd = dates.make(y, m - 1, statementDay);
  const periodStart = dates.addDays(prevEnd, 1);
  // 繳款日在結帳日之後的同月，否則就是下個月
  const dueDate = dueDay > statementDay ? dates.make(y, m, dueDay) : dates.make(y, m + 1, dueDay);
  return { periodStart, periodEnd, dueDate };
}

async function getOrCreate(client, account, periodEnd) {
  const b = boundsFor(periodEnd, account.statement_day, account.due_day);
  const { rows } = await client.query(
    `INSERT INTO card_statements (account_id, period_start, period_end, due_date)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (account_id, period_end) DO UPDATE SET account_id = EXCLUDED.account_id
     RETURNING *`,
    [account.id, b.periodStart, b.periodEnd, b.dueDate]
  );
  return rows[0];
}

async function forDate(client, account, dateStr) {
  return getOrCreate(client, account, periodEndFor(dateStr, account.statement_day));
}

async function next(client, account, statement) {
  return forDate(client, account, dates.addDays(statement.period_end, 1));
}

// 帳單摘要 SQL（系統記錄金額 vs 銀行帳單）
const SUMMARY_SQL = `
  SELECT s.*, a.name AS account_name,
    COALESCE(SUM(CASE WHEN t.type = 'expense' THEN ta.total
                      WHEN t.type = 'income'  THEN -ta.total ELSE 0 END), 0)::BIGINT AS recorded_amount,
    COALESCE(SUM(CASE WHEN t.type = 'expense' AND t.installment_id IS NOT NULL THEN ta.total ELSE 0 END), 0)::BIGINT AS installment_amount,
    COUNT(t.id) FILTER (WHERE t.type IN ('expense', 'income') AND t.installment_id IS NULL)::INT AS normal_count
  FROM card_statements s
  JOIN accounts a ON a.id = s.account_id
  LEFT JOIN transactions t ON t.statement_id = s.id AND t.affects_balance
  LEFT JOIN v_transaction_amounts ta ON ta.id = t.id
`;

async function summary(client, statementId) {
  const { rows } = await client.query(`${SUMMARY_SQL} WHERE s.id = $1 GROUP BY s.id, a.name`, [statementId]);
  return rows[0] || null;
}

// 結帳日或繳款日改了之後，重新把刷卡歸到新的期別
// 還沒對帳過的卡：全部重排，繳款日已過的標成已繳款；已經對帳過的卡：只重排還沒對帳的期別
async function rebuild(client, account, today) {
  const { rows: rec } = await client.query(
    'SELECT 1 FROM card_statements WHERE account_id = $1 AND reconciled_at IS NOT NULL LIMIT 1', [account.id]
  );
  const full = !rec.length;
  const { rows: txns } = await client.query(
    `SELECT t.id, t.txn_date FROM transactions t
     LEFT JOIN card_statements s ON s.id = t.statement_id
     WHERE t.account_id = $1 AND t.type IN ('expense', 'income') AND t.affects_balance
       AND ($2 OR t.statement_id IS NULL OR s.status = 'open')`,
    [account.id, full]
  );
  if (full) {
    await client.query('UPDATE transactions SET statement_id = NULL WHERE statement_id IN (SELECT id FROM card_statements WHERE account_id = $1)', [account.id]);
    await client.query('DELETE FROM card_statements WHERE account_id = $1', [account.id]);
  } else {
    await client.query('UPDATE transactions SET statement_id = NULL WHERE id = ANY($1::int[])', [txns.map((t) => t.id)]);
  }
  for (const t of txns) {
    const s = await forDate(client, account, t.txn_date);
    await client.query('UPDATE transactions SET statement_id = $2 WHERE id = $1', [t.id, s.id]);
  }
  // 已經沒有任何交易的未對帳期別刪掉
  await client.query(
    `DELETE FROM card_statements s WHERE s.account_id = $1 AND s.status = 'open' AND s.reconciled_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM transactions t WHERE t.statement_id = s.id)`,
    [account.id]
  );
  if (full) await settleByPayments(client, account, today);
  return txns.length;
}

// 依繳款紀錄判斷哪些已結帳的帳單繳過了：
// 每筆轉入這張卡的繳款，對應到「繳款日之前最近一次結帳」的那期；
// 最後一期有對應繳款的帳單，以及它之前的所有帳單，都視為已繳；之後已結帳的帳單維持未繳。
async function settleByPayments(client, account, today) {
  const { rows: payments } = await client.query(
    `SELECT txn_date FROM transactions
     WHERE type = 'transfer' AND to_account_id = $1 AND affects_balance AND txn_date <= $2
     ORDER BY txn_date`,
    [account.id, today]
  );
  const { rows: list } = await client.query(
    `SELECT id, period_end, status, reconciled_at FROM card_statements
     WHERE account_id = $1 AND period_end < $2 ORDER BY period_end`,
    [account.id, today]
  );
  let lastPaidEnd = null;
  for (const p of payments) {
    const matched = list.filter((st) => st.period_end < p.txn_date && dates.addDays(st.period_end, 45) >= p.txn_date);
    if (matched.length) {
      const end = matched[matched.length - 1].period_end;
      if (!lastPaidEnd || end > lastPaidEnd) lastPaidEnd = end;
    }
  }
  const result = { paid: [], open: [] };
  for (const st of list) {
    const settled = lastPaidEnd !== null && st.period_end <= lastPaidEnd;
    const status = settled ? 'paid' : st.reconciled_at ? 'reconciled' : 'open';
    if (status !== st.status) await client.query('UPDATE card_statements SET status = $2 WHERE id = $1', [st.id, status]);
    (settled ? result.paid : result.open).push(st.id);
  }
  return result;
}

module.exports = { periodEndFor, boundsFor, getOrCreate, forDate, next, summary, rebuild, settleByPayments, SUMMARY_SQL };
