const express = require('express');
const { query, tx } = require('../db');
const statements = require('../lib/statements');
const autopay = require('../lib/autopay');
const dates = require('../lib/dates');
const { HttpError, wrap, toInt, requireInt, requireText } = require('./util');

const router = express.Router();

const COLOR_RE = /^#[0-9A-Fa-f]{6}$/;
const KINDS = ['deposit', 'credit_card', 'loan'];

function readAccountBody(body, { creating }) {
  const out = {};
  if (creating || body.name !== undefined) out.name = requireText(body.name, '帳戶名稱');
  if (creating) {
    if (!KINDS.includes(body.kind)) throw new HttpError(400, '帳戶類型不正確');
    out.kind = body.kind;
  }
  if (creating || body.opening_balance !== undefined) out.opening_balance = toInt(body.opening_balance) ?? 0;
  for (const key of ['statement_day', 'due_day', 'loan_day']) {
    if (body[key] !== undefined) {
      const n = toInt(body[key]);
      if (n !== null && (n < 1 || n > 31)) throw new HttpError(400, '日期需介於 1 到 31');
      out[key] = n;
    }
  }
  if (body.credit_limit !== undefined) out.credit_limit = toInt(body.credit_limit);
  if (body.loan_payment !== undefined) out.loan_payment = toInt(body.loan_payment);
  if (body.loan_rate !== undefined) {
    const r = body.loan_rate === null || body.loan_rate === '' ? null : Number(body.loan_rate);
    if (r !== null && !(r >= 0 && r < 100)) throw new HttpError(400, '年利率不正確');
    out.loan_rate = r;
  }
  if (body.autopay_account_id !== undefined) out.autopay_account_id = toInt(body.autopay_account_id);
  if (body.is_cash !== undefined) out.is_cash = Boolean(body.is_cash);
  if (body.hide_balance !== undefined) out.hide_balance = Boolean(body.hide_balance);
  if (body.icon_type !== undefined) {
    if (!['auto', 'text', 'icon', 'emoji', 'image'].includes(body.icon_type)) throw new HttpError(400, '圖示類型不正確');
    out.icon_type = body.icon_type;
  }
  if (body.icon_value !== undefined) out.icon_value = typeof body.icon_value === 'string' ? body.icon_value.trim().slice(0, 16) || null : null;
  if (body.icon_image !== undefined) {
    const img = body.icon_image;
    if (img !== null && (typeof img !== 'string' || !/^data:image\/(png|jpeg|webp);base64,/.test(img) || img.length > 300000)) {
      throw new HttpError(400, '圖片格式不正確或太大');
    }
    out.icon_image = img;
  }
  if (body.color !== undefined) {
    if (!COLOR_RE.test(body.color)) throw new HttpError(400, '顏色格式不正確');
    out.color = body.color;
  }
  if (body.sort_order !== undefined) out.sort_order = toInt(body.sort_order) ?? 0;
  if (body.archived !== undefined) out.archived = Boolean(body.archived);
  return out;
}

async function checkAutopayAccount(client, autopayId, selfId) {
  if (autopayId === null || autopayId === undefined) return;
  if (autopayId === selfId) throw new HttpError(400, '扣款帳戶不能是自己');
  const { rows } = await client.query('SELECT kind FROM accounts WHERE id = $1 AND NOT archived', [autopayId]);
  if (!rows[0] || rows[0].kind !== 'deposit') throw new HttpError(400, '扣款帳戶必須是存款帳戶');
}

async function cardStatus(client, account) {
  const today = dates.today();
  const current = await statements.forDate(client, account, today);
  const currentSummary = await statements.summary(client, current.id);
  const { rows } = await client.query(
    `${statements.SUMMARY_SQL}
     WHERE s.account_id = $1 AND s.period_end < $2 AND s.status <> 'paid'
     GROUP BY s.id, a.name
     HAVING COALESCE(SUM(CASE WHEN t.type = 'expense' THEN ta.total WHEN t.type = 'income' THEN -ta.total ELSE 0 END), 0) > 0
     ORDER BY s.period_end DESC LIMIT 1`,
    [account.id, today]
  );
  return { current_statement: currentSummary, due_statement: rows[0] || null };
}

const SELECT_ACCOUNTS = `
  SELECT a.*, COALESCE(b.balance, a.opening_balance) AS balance, ap.name AS autopay_account_name
  FROM accounts a
  LEFT JOIN v_account_balances b ON b.id = a.id
  LEFT JOIN accounts ap ON ap.id = a.autopay_account_id
`;

async function decorate(client, acc) {
  if (acc.kind === 'credit_card') Object.assign(acc, await cardStatus(client, acc));
  return acc;
}

router.get('/', wrap(async (req, res) => {
  const result = await tx(async (client) => {
    await autopay.run(client);
    const { rows } = await client.query(
      `${SELECT_ACCOUNTS} WHERE NOT a.archived
       ORDER BY CASE a.kind WHEN 'deposit' THEN 0 WHEN 'credit_card' THEN 1 ELSE 2 END, a.sort_order, a.id`
    );
    for (const acc of rows) await decorate(client, acc);
    return rows;
  });
  res.json(result);
}));

// 拖曳排序：依傳入的 id 順序
router.post('/reorder', wrap(async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.map(Number).filter(Number.isInteger) : [];
  if (!ids.length) throw new HttpError(400, '缺少排序資料');
  await tx(async (client) => {
    for (let i = 0; i < ids.length; i++) await client.query('UPDATE accounts SET sort_order = $2 WHERE id = $1', [ids[i], i + 1]);
  });
  res.json({ ok: true });
}));

router.get('/:id', wrap(async (req, res) => {
  const id = requireInt(req.params.id, '帳戶 id');
  const result = await tx(async (client) => {
    const { rows } = await client.query(`${SELECT_ACCOUNTS} WHERE a.id = $1`, [id]);
    if (!rows[0]) throw new HttpError(404, '找不到這個帳戶');
    return decorate(client, rows[0]);
  });
  res.json(result);
}));

router.post('/', wrap(async (req, res) => {
  const a = readAccountBody(req.body, { creating: true });
  if (a.kind === 'credit_card' && (!a.statement_day || !a.due_day)) {
    throw new HttpError(400, '信用卡需要設定結帳日與繳款日');
  }
  if (a.kind === 'loan' && a.autopay_account_id && (!a.loan_day || !(a.loan_payment > 0))) {
    throw new HttpError(400, '自動扣款需要設定每月扣款日與繳款金額');
  }
  const row = await tx(async (client) => {
    await checkAutopayAccount(client, a.autopay_account_id, null);
    const icon = [a.icon_type || 'auto', a.icon_value ?? null, a.icon_image ?? null];
    const nextDate = a.kind === 'loan' && a.loan_day ? autopay.nextLoanDate(dates.today(), a.loan_day) : null;
    const { rows } = await client.query(
      `INSERT INTO accounts (name, kind, opening_balance, statement_day, due_day, credit_limit, color, sort_order,
         autopay_account_id, loan_rate, loan_payment, loan_day, loan_next_date, is_cash, icon_type, icon_value, icon_image, hide_balance)
       VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, '#1D4ED8'), COALESCE($8, 0), $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
       RETURNING *`,
      [a.name, a.kind, a.opening_balance,
       a.kind === 'credit_card' ? a.statement_day : null, a.kind === 'credit_card' ? a.due_day : null,
       a.credit_limit ?? null, a.color ?? null, a.sort_order ?? null,
       a.kind === 'deposit' ? null : a.autopay_account_id ?? null,
       null,
       a.kind === 'loan' ? a.loan_payment ?? null : null,
       a.kind === 'loan' ? a.loan_day ?? null : null,
       nextDate,
       a.kind === 'deposit' ? Boolean(a.is_cash) : false, ...icon, Boolean(a.hide_balance)]
    );
    return rows[0];
  });
  res.status(201).json(row);
}));

router.put('/:id', wrap(async (req, res) => {
  const id = requireInt(req.params.id, '帳戶 id');
  const a = readAccountBody(req.body, { creating: false });
  const row = await tx(async (client) => {
    const { rows: cur } = await client.query('SELECT * FROM accounts WHERE id = $1', [id]);
    if (!cur[0]) throw new HttpError(404, '找不到這個帳戶');
    if (a.autopay_account_id !== undefined) await checkAutopayAccount(client, a.autopay_account_id, id);
    // 貸款改了扣款日或剛開啟自動扣款：重新算下一次扣款日
    if (cur[0].kind === 'loan' && (a.loan_day !== undefined || a.autopay_account_id !== undefined)) {
      const day = a.loan_day !== undefined ? a.loan_day : cur[0].loan_day;
      const dayChanged = a.loan_day !== undefined && a.loan_day !== cur[0].loan_day;
      if (day && (dayChanged || !cur[0].loan_next_date)) {
        a.loan_next_date = autopay.nextLoanDate(dates.today(), day);
      }
    }
    const keys = Object.keys(a);
    if (!keys.length) throw new HttpError(400, '沒有要更新的欄位');
    const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
    const { rows } = await client.query(`UPDATE accounts SET ${sets} WHERE id = $1 RETURNING *`, [id, ...keys.map((k) => a[k])]);
    const updated = rows[0];
    // 信用卡結帳日、繳款日改了：依新的日期重新分期
    if (updated.kind === 'credit_card'
        && (updated.statement_day !== cur[0].statement_day || updated.due_day !== cur[0].due_day)) {
      updated.rebuilt = await statements.rebuild(client, updated, dates.today());
    }
    return updated;
  });
  res.json(row);
}));

// 校正餘額：存款輸入實際餘額；貸款輸入銀行顯示的剩餘本金。自動補一筆校正紀錄（不算支出或收入）
router.post('/:id/adjust', wrap(async (req, res) => {
  const id = requireInt(req.params.id, '帳戶 id');
  const actual = requireInt(req.body.actual_balance, '實際餘額', { min: 0 });
  const { rows } = await query(
    `SELECT a.kind, b.balance FROM accounts a JOIN v_account_balances b ON b.id = a.id WHERE a.id = $1`,
    [id]
  );
  if (!rows[0]) throw new HttpError(404, '找不到這個帳戶');
  if (rows[0].kind === 'credit_card') throw new HttpError(400, '信用卡請用對帳功能校正');
  const isLoan = rows[0].kind === 'loan';
  // 貸款的 balance 是欠款：欠款變少＝資產增加
  const delta = isLoan ? rows[0].balance - actual : actual - rows[0].balance;
  if (delta === 0) return res.json({ adjusted: 0, balance: actual });
  await query(
    `INSERT INTO transactions (type, txn_date, account_id, amount, title, source)
     VALUES ('adjustment', $1, $2, $3, $4, 'manual')`,
    [dates.today(), id, delta, isLoan ? '更新剩餘本金' : '餘額校正']
  );
  res.json({ adjusted: actual - rows[0].balance, balance: actual });
}));

router.get('/:id/usage', wrap(async (req, res) => {
  const id = requireInt(req.params.id, '帳戶 id');
  const { rows } = await query(
    `SELECT (SELECT COUNT(*) FROM transactions WHERE account_id = $1 AND type <> 'transfer')::INT AS transactions,
            (SELECT COUNT(*) FROM transactions WHERE type = 'transfer' AND (account_id = $1 OR to_account_id = $1))::INT AS transfers,
            (SELECT COUNT(*) FROM installments WHERE account_id = $1)::INT AS installments,
            (SELECT COUNT(*) FROM subscriptions WHERE account_id = $1)::INT AS subscriptions`, [id]
  );
  res.json(rows[0]);
}));

// 永久刪除帳戶：連同它的所有交易、轉帳、帳單、分期、固定支出。需要帶上帳戶名稱確認。
router.delete('/:id', wrap(async (req, res) => {
  const id = requireInt(req.params.id, '帳戶 id');
  const result = await tx(async (client) => {
    const { rows } = await client.query('SELECT * FROM accounts WHERE id = $1', [id]);
    if (!rows[0]) throw new HttpError(404, '找不到這個帳戶');
    if ((req.query.confirm || '') !== rows[0].name) throw new HttpError(400, '請輸入正確的帳戶名稱確認刪除');
    const { rows: txns } = await client.query(
      'SELECT id FROM transactions WHERE account_id = $1 OR to_account_id = $1', [id]
    );
    const ids = txns.map((t) => t.id);
    if (ids.length) {
      await client.query(
        'UPDATE transaction_items SET advance_settled_on = NULL, advance_settle_txn_id = NULL WHERE advance_settle_txn_id = ANY($1::int[])', [ids]
      );
      await client.query('DELETE FROM transactions WHERE id = ANY($1::int[])', [ids]);
    }
    await client.query('DELETE FROM installments WHERE account_id = $1', [id]);
    await client.query('DELETE FROM card_statements WHERE account_id = $1', [id]);
    await client.query('DELETE FROM subscriptions WHERE account_id = $1', [id]);
    await client.query('UPDATE nail_services SET account_id = NULL WHERE account_id = $1', [id]);
    await client.query('UPDATE nail_purchases SET account_id = NULL WHERE account_id = $1', [id]);
    await client.query('UPDATE accounts SET autopay_account_id = NULL WHERE autopay_account_id = $1', [id]);
    await client.query(
      `DELETE FROM app_settings WHERE key = 'nail'
         AND ((value->>'bag_account_id')::int = $1 OR (value->>'source_account_id')::int = $1)`, [id]
    );
    await client.query('DELETE FROM accounts WHERE id = $1', [id]);
    return { transactions: ids.length };
  });
  res.json(result);
}));

// 手動記錄貸款繳款：整筆從存款轉到貸款帳戶
router.post('/:id/loan-payment', wrap(async (req, res) => {
  const id = requireInt(req.params.id, '帳戶 id');
  const fromId = requireInt(req.body.from_account_id, '付款帳戶');
  const amount = requireInt(req.body.amount, '繳款金額', { min: 1 });
  const date = dates.isDate(req.body.date) ? req.body.date : dates.today();
  const result = await tx(async (client) => {
    const { rows } = await client.query('SELECT * FROM accounts WHERE id = $1', [id]);
    const loan = rows[0];
    if (!loan || loan.kind !== 'loan') throw new HttpError(404, '找不到這個貸款帳戶');
    await checkAutopayAccount(client, fromId, id);
    await autopay.recordLoanPayment(client, { loan, fromId, date, amount, pending: false });
    // 這期已經手動繳了，自動扣款往後一期，避免重複扣款
    if (loan.loan_day && loan.loan_next_date) {
      let next = loan.loan_next_date;
      const sameMonth = (d) => d.slice(0, 7) === date.slice(0, 7);
      while (next <= date || sameMonth(next)) next = autopay.nextLoanDate(next, loan.loan_day);
      await client.query('UPDATE accounts SET loan_next_date = $2 WHERE id = $1', [id, next]);
    }
    return { amount };
  });
  res.json(result);
}));

module.exports = router;
