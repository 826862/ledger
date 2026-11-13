const express = require('express');
const { query, tx } = require('../db');
const statements = require('../lib/statements');
const dates = require('../lib/dates');
const { HttpError, wrap, toInt, requireInt, requireText } = require('./util');

const router = express.Router();

const COLOR_RE = /^#[0-9A-Fa-f]{6}$/;

function readAccountBody(body, { creating }) {
  const out = {};
  if (creating || body.name !== undefined) out.name = requireText(body.name, '帳戶名稱');
  if (creating) {
    if (!['deposit', 'credit_card'].includes(body.kind)) throw new HttpError(400, '帳戶類型不正確');
    out.kind = body.kind;
  }
  if (creating || body.opening_balance !== undefined) out.opening_balance = toInt(body.opening_balance) ?? 0;
  for (const key of ['statement_day', 'due_day']) {
    if (body[key] !== undefined) {
      const n = toInt(body[key]);
      if (n !== null && (n < 1 || n > 31)) throw new HttpError(400, '日期需介於 1 到 31');
      out[key] = n;
    }
  }
  if (body.credit_limit !== undefined) out.credit_limit = toInt(body.credit_limit);
  if (body.color !== undefined) {
    if (!COLOR_RE.test(body.color)) throw new HttpError(400, '顏色格式不正確');
    out.color = body.color;
  }
  if (body.sort_order !== undefined) out.sort_order = toInt(body.sort_order) ?? 0;
  if (body.archived !== undefined) out.archived = Boolean(body.archived);
  return out;
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

router.get('/', wrap(async (req, res) => {
  const result = await tx(async (client) => {
    const { rows } = await client.query(
      `SELECT a.*, b.balance
       FROM accounts a JOIN v_account_balances b ON b.id = a.id
       WHERE NOT a.archived
       ORDER BY a.kind DESC, a.sort_order, a.id`
    );
    for (const acc of rows) {
      if (acc.kind === 'credit_card') Object.assign(acc, await cardStatus(client, acc));
    }
    return rows;
  });
  res.json(result);
}));

router.get('/:id', wrap(async (req, res) => {
  const id = requireInt(req.params.id, '帳戶 id');
  const result = await tx(async (client) => {
    const { rows } = await client.query(
      `SELECT a.*, COALESCE(b.balance, a.opening_balance) AS balance
       FROM accounts a LEFT JOIN v_account_balances b ON b.id = a.id WHERE a.id = $1`,
      [id]
    );
    if (!rows[0]) throw new HttpError(404, '找不到這個帳戶');
    const acc = rows[0];
    if (acc.kind === 'credit_card') Object.assign(acc, await cardStatus(client, acc));
    return acc;
  });
  res.json(result);
}));

router.post('/', wrap(async (req, res) => {
  const a = readAccountBody(req.body, { creating: true });
  if (a.kind === 'credit_card' && (!a.statement_day || !a.due_day)) {
    throw new HttpError(400, '信用卡需要設定結帳日與繳款日');
  }
  const { rows } = await query(
    `INSERT INTO accounts (name, kind, opening_balance, statement_day, due_day, credit_limit, color, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, '#1D4ED8'), COALESCE($8, 0)) RETURNING *`,
    [a.name, a.kind, a.opening_balance, a.statement_day ?? null, a.due_day ?? null,
     a.credit_limit ?? null, a.color ?? null, a.sort_order ?? null]
  );
  res.status(201).json(rows[0]);
}));

router.put('/:id', wrap(async (req, res) => {
  const id = requireInt(req.params.id, '帳戶 id');
  const a = readAccountBody(req.body, { creating: false });
  const keys = Object.keys(a);
  if (!keys.length) throw new HttpError(400, '沒有要更新的欄位');
  const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  const { rows } = await query(`UPDATE accounts SET ${sets} WHERE id = $1 RETURNING *`, [id, ...keys.map((k) => a[k])]);
  if (!rows[0]) throw new HttpError(404, '找不到這個帳戶');
  res.json(rows[0]);
}));

// 校正存款餘額：輸入實際餘額，自動補一筆校正交易
router.post('/:id/adjust', wrap(async (req, res) => {
  const id = requireInt(req.params.id, '帳戶 id');
  const actual = requireInt(req.body.actual_balance, '實際餘額');
  const { rows } = await query(
    `SELECT a.kind, b.balance FROM accounts a JOIN v_account_balances b ON b.id = a.id WHERE a.id = $1`,
    [id]
  );
  if (!rows[0]) throw new HttpError(404, '找不到這個帳戶');
  if (rows[0].kind !== 'deposit') throw new HttpError(400, '信用卡請用對帳功能校正');
  const delta = actual - rows[0].balance;
  if (delta === 0) return res.json({ adjusted: 0 });
  await query(
    `INSERT INTO transactions (type, txn_date, account_id, amount, title, source)
     VALUES ('adjustment', $1, $2, $3, '餘額校正', 'manual')`,
    [dates.today(), id, delta]
  );
  res.json({ adjusted: delta });
}));

module.exports = router;
