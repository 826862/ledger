const express = require('express');
const { query, tx } = require('../db');
const dates = require('../lib/dates');
const settings = require('../lib/settings');
const recurring = require('../lib/recurring');
const { insertItems, LIST_SQL, LIST_GROUP } = require('./transactions');
const { HttpError, wrap, toInt, requireInt, requireText } = require('./util');

const router = express.Router();
const COLOR_RE = /^#[0-9A-Fa-f]{6}$/;

function monthStart(m) {
  if (m === undefined || m === '') return `${dates.today().slice(0, 7)}-01`;
  if (!/^\d{4}-\d{2}$/.test(m)) throw new HttpError(400, '月份格式不正確');
  return `${m}-01`;
}

// =====================================================================
// 代墊
// =====================================================================

router.get('/advances', wrap(async (req, res) => {
  const { rows } = await query(
    `SELECT i.id, i.name, i.amount, i.advance_person, t.id AS transaction_id, t.txn_date, t.title, a.name AS account_name
     FROM transaction_items i
     JOIN transactions t ON t.id = i.transaction_id
     JOIN accounts a ON a.id = t.account_id
     WHERE i.is_advance AND t.type = 'expense' AND i.advance_settled_on IS NULL
     ORDER BY COALESCE(i.advance_person, ''), t.txn_date, i.id`
  );
  const people = new Map();
  for (const r of rows) {
    const key = r.advance_person || '未指定';
    if (!people.has(key)) people.set(key, { person: key, total: 0, items: [] });
    const p = people.get(key);
    p.total += r.amount;
    p.items.push(r);
  }
  const list = [...people.values()].sort((a, b) => b.total - a.total);
  res.json({ total: rows.reduce((s, r) => s + r.amount, 0), people: list });
}));

// 收回代墊：錢進到指定帳戶，記成一筆不計入報表的收入
router.post('/advances/settle', wrap(async (req, res) => {
  const ids = Array.isArray(req.body.item_ids) ? req.body.item_ids.map(Number).filter(Number.isInteger) : [];
  if (!ids.length) throw new HttpError(400, '請選擇要收回的代墊');
  const accountId = requireInt(req.body.account_id, '收款帳戶');
  const date = dates.isDate(req.body.date) ? req.body.date : dates.today();
  const result = await tx(async (client) => {
    const { rows: acc } = await client.query('SELECT kind FROM accounts WHERE id = $1 AND NOT archived', [accountId]);
    if (!acc[0] || acc[0].kind !== 'deposit') throw new HttpError(400, '請選擇存款或現金帳戶收款');
    const { rows: items } = await client.query(
      `SELECT i.*, t.title AS txn_title FROM transaction_items i JOIN transactions t ON t.id = i.transaction_id
       WHERE i.id = ANY($1::int[]) AND i.is_advance AND i.advance_settled_on IS NULL FOR UPDATE OF i`,
      [ids]
    );
    if (!items.length) throw new HttpError(400, '這些代墊已經收回了');
    const people = [...new Set(items.map((i) => i.advance_person).filter(Boolean))];
    const { rows } = await client.query(
      `INSERT INTO transactions (type, txn_date, account_id, title) VALUES ('income', $1, $2, $3) RETURNING id`,
      [date, accountId, `收回代墊${people.length ? `：${people.join('、')}` : ''}`]
    );
    const settleId = rows[0].id;
    await insertItems(client, settleId, items.map((i, idx) => ({
      name: [i.txn_title, i.name].filter(Boolean).join('｜'),
      unit_price: i.amount,
      quantity: 1,
      category_id: null,
      is_advance: true,
      advance_person: i.advance_person,
      sort_order: idx,
    })));
    await client.query(
      `UPDATE transaction_items SET advance_settled_on = $2, advance_settle_txn_id = $3 WHERE id = ANY($1::int[])`,
      [items.map((i) => i.id), date, settleId]
    );
    return { amount: items.reduce((s, i) => s + i.amount, 0), count: items.length };
  });
  res.json(result);
}));

// =====================================================================
// 預算與固定支出
// =====================================================================

router.get('/budget', wrap(async (req, res) => {
  const month = monthStart(req.query.month);
  const [cats, spentRows, subs, loans, paidSubs, paidLoans] = await Promise.all([
    query(
      `SELECT c.id, c.name, c.color, b.amount AS default_amount, o.amount AS month_amount
       FROM categories c
       LEFT JOIN budgets b ON b.category_id = c.id
       LEFT JOIN budget_overrides o ON o.category_id = c.id AND o.month = $1
       WHERE c.kind = 'expense' AND NOT c.archived
       ORDER BY c.sort_order, c.id`,
      [month]
    ),
    query(`SELECT category_id, amount FROM v_monthly_category WHERE month = $1 AND type = 'expense'`, [month]),
    query(
      `SELECT s.*, a.name AS account_name, c.name AS category_name
       FROM subscriptions s JOIN accounts a ON a.id = s.account_id LEFT JOIN categories c ON c.id = s.category_id
       WHERE s.active ORDER BY s.sort_order, s.next_date, s.id`
    ),
    query(
      `SELECT a.id, a.name, a.loan_payment, a.loan_day, ap.name AS account_name
       FROM accounts a LEFT JOIN accounts ap ON ap.id = a.autopay_account_id
       WHERE a.kind = 'loan' AND NOT a.archived AND a.loan_payment > 0`
    ),
    query(
      `SELECT DISTINCT subscription_id FROM transactions
       WHERE subscription_id IS NOT NULL AND txn_date >= $1::date AND txn_date < ($1::date + INTERVAL '1 month')`,
      [month]
    ),
    query(
      `SELECT DISTINCT to_account_id FROM transactions
       WHERE type = 'transfer' AND txn_date >= $1::date AND txn_date < ($1::date + INTERVAL '1 month')
         AND to_account_id IN (SELECT id FROM accounts WHERE kind = 'loan')`,
      [month]
    ),
  ]);

  const spent = new Map(spentRows.rows.map((r) => [r.category_id, r.amount]));
  const categories = cats.rows.map((c) => {
    const budget = c.month_amount ?? c.default_amount;
    const used = spent.get(c.id) || 0;
    return {
      category_id: c.id, name: c.name, color: c.color,
      budget, default_amount: c.default_amount, overridden: c.month_amount !== null,
      spent: used, remaining: budget === null ? null : budget - used,
    };
  });
  const uncategorized = spent.get(null) || 0;

  const paidSubIds = new Set(paidSubs.rows.map((r) => r.subscription_id));
  const paidLoanIds = new Set(paidLoans.rows.map((r) => r.to_account_id));
  const fixed = [];
  for (const s of subs.rows) {
    const due = recurring.dueInMonth(s, month);
    if (!due) continue;
    fixed.push({
      kind: 'subscription', id: s.id, name: s.name, amount: s.amount, due_date: due, cycle: s.cycle,
      account_name: s.account_name, category_name: s.category_name, auto_create: s.auto_create,
      paid: paidSubIds.has(s.id),
    });
  }
  for (const l of loans.rows) {
    fixed.push({
      kind: 'loan', id: l.id, name: l.name, amount: l.loan_payment,
      due_date: l.loan_day ? dates.make(Number(month.slice(0, 4)), Number(month.slice(5, 7)), l.loan_day) : null,
      account_name: l.account_name, auto_create: Boolean(l.account_name), paid: paidLoanIds.has(l.id),
    });
  }
  fixed.sort((a, b) => (a.due_date || '9').localeCompare(b.due_date || '9'));

  const budgeted = categories.filter((c) => c.budget !== null);
  const totalBudget = budgeted.reduce((s, c) => s + c.budget, 0);
  const totalSpent = spentRows.rows.reduce((s, r) => s + r.amount, 0);
  const budgetedSpent = budgeted.reduce((s, c) => s + c.spent, 0);
  res.json({
    month: month.slice(0, 7),
    total_budget: totalBudget,
    budgeted_spent: budgetedSpent,
    total_spent: totalSpent,
    remaining: totalBudget - budgetedSpent,
    uncategorized,
    categories,
    fixed,
    fixed_total: fixed.reduce((s, f) => s + f.amount, 0),
    fixed_unpaid: fixed.filter((f) => !f.paid).reduce((s, f) => s + f.amount, 0),
  });
}));

// 設定分類預算：不帶 month 是每月沿用的預設；帶 month 只改那個月
router.put('/budget', wrap(async (req, res) => {
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  const month = req.body.month ? monthStart(req.body.month) : null;
  await tx(async (client) => {
    for (const it of items) {
      const categoryId = requireInt(it.category_id, '分類');
      const amount = it.amount === null || it.amount === '' || it.amount === undefined ? null : requireInt(it.amount, '預算', { min: 0 });
      if (month) {
        if (amount === null) await client.query('DELETE FROM budget_overrides WHERE category_id = $1 AND month = $2', [categoryId, month]);
        else await client.query(
          `INSERT INTO budget_overrides (category_id, month, amount) VALUES ($1, $2, $3)
           ON CONFLICT (category_id, month) DO UPDATE SET amount = EXCLUDED.amount`,
          [categoryId, month, amount]
        );
      } else if (amount === null) {
        await client.query('DELETE FROM budgets WHERE category_id = $1', [categoryId]);
      } else {
        await client.query(
          `INSERT INTO budgets (category_id, amount) VALUES ($1, $2)
           ON CONFLICT (category_id) DO UPDATE SET amount = EXCLUDED.amount`,
          [categoryId, amount]
        );
      }
    }
  });
  res.json({ ok: true });
}));

function readSubscription(body) {
  const cycle = ['monthly', 'bimonthly', 'yearly'].includes(body.cycle) ? body.cycle : 'monthly';
  if (!dates.isDate(body.next_date)) throw new HttpError(400, '請選擇下次扣款日');
  return {
    name: requireText(body.name, '名稱'),
    amount: requireInt(body.amount, '金額', { min: 1 }),
    cycle,
    next_date: body.next_date,
    account_id: requireInt(body.account_id, '付款帳戶'),
    category_id: toInt(body.category_id),
    auto_create: Boolean(body.auto_create),
    note: typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null,
  };
}

router.get('/subscriptions', wrap(async (req, res) => {
  const { rows } = await query('SELECT * FROM subscriptions WHERE active ORDER BY sort_order, next_date, id');
  res.json(rows);
}));

router.post('/subscriptions', wrap(async (req, res) => {
  const s = readSubscription(req.body);
  const { rows } = await query(
    `INSERT INTO subscriptions (name, amount, cycle, next_date, account_id, category_id, auto_create, note)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [s.name, s.amount, s.cycle, s.next_date, s.account_id, s.category_id, s.auto_create, s.note]
  );
  res.status(201).json(rows[0]);
}));

router.post('/subscriptions/reorder', wrap(async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.map(Number).filter(Number.isInteger) : [];
  await tx(async (client) => {
    for (let i = 0; i < ids.length; i++) await client.query('UPDATE subscriptions SET sort_order = $2 WHERE id = $1', [ids[i], i + 1]);
  });
  res.json({ ok: true });
}));

router.put('/subscriptions/:id', wrap(async (req, res) => {
  const id = requireInt(req.params.id, '固定支出 id');
  if (req.body.active === false) {
    await query('UPDATE subscriptions SET active = FALSE WHERE id = $1', [id]);
    return res.json({ ok: true });
  }
  const s = readSubscription(req.body);
  const { rows } = await query(
    `UPDATE subscriptions SET name = $2, amount = $3, cycle = $4, next_date = $5, account_id = $6,
       category_id = $7, auto_create = $8, note = $9 WHERE id = $1 RETURNING *`,
    [id, s.name, s.amount, s.cycle, s.next_date, s.account_id, s.category_id, s.auto_create, s.note]
  );
  if (!rows[0]) throw new HttpError(404, '找不到這筆固定支出');
  res.json(rows[0]);
}));

// 手動記一筆固定支出，並把下次扣款日往後推
router.post('/subscriptions/:id/pay', wrap(async (req, res) => {
  const id = requireInt(req.params.id, '固定支出 id');
  const date = dates.isDate(req.body.date) ? req.body.date : dates.today();
  await tx(async (client) => {
    const { rows } = await client.query('SELECT * FROM subscriptions WHERE id = $1 FOR UPDATE', [id]);
    const s = rows[0];
    if (!s) throw new HttpError(404, '找不到這筆固定支出');
    const amount = toInt(req.body.amount) || s.amount;
    const { rows: t } = await client.query(
      `INSERT INTO transactions (type, txn_date, account_id, title, source, subscription_id)
       VALUES ('expense', $1, $2, $3, 'subscription', $4) RETURNING id`,
      [date, s.account_id, s.name, s.id]
    );
    await insertItems(client, t[0].id, [{ name: s.name, unit_price: amount, quantity: 1, category_id: s.category_id }]);
    let next = s.next_date;
    while (next <= date) next = recurring.nextDate(next, s.cycle);
    await client.query('UPDATE subscriptions SET next_date = $2 WHERE id = $1', [id, next]);
  });
  res.json({ ok: true });
}));

// =====================================================================
// 專案
// =====================================================================

const PROJECT_TOTALS = `
  SELECT p.*,
    COALESCE(SUM(i.amount) FILTER (WHERE t.type = 'expense'), 0)::BIGINT AS expense,
    COALESCE(SUM(i.amount) FILTER (WHERE t.type = 'income'), 0)::BIGINT AS income,
    COUNT(DISTINCT t.id)::INT AS txn_count,
    MIN(t.txn_date) AS first_date,
    MAX(t.txn_date) AS last_date
  FROM projects p
  LEFT JOIN transaction_items i ON i.project_id = p.id AND i.in_report AND NOT i.is_advance
  LEFT JOIN transactions t ON t.id = i.transaction_id AND t.type IN ('expense', 'income')
`;

router.get('/projects', wrap(async (req, res) => {
  const all = req.query.include_archived === '1';
  const { rows } = await query(
    `${PROJECT_TOTALS} ${all ? '' : 'WHERE NOT p.archived'} GROUP BY p.id ORDER BY p.archived, p.created_at DESC, p.id DESC`
  );
  res.json(rows);
}));

router.get('/projects/:id', wrap(async (req, res) => {
  const id = requireInt(req.params.id, '專案 id');
  const { rows } = await query(`${PROJECT_TOTALS} WHERE p.id = $1 GROUP BY p.id`, [id]);
  if (!rows[0]) throw new HttpError(404, '找不到這個專案');
  const [byCat, txns] = await Promise.all([
    query(
      `SELECT t.type, i.category_id, COALESCE(c.name, '未分類') AS category_name, COALESCE(c.color, '#8A909C') AS category_color,
              SUM(i.amount)::BIGINT AS amount
       FROM transactions t JOIN transaction_items i ON i.transaction_id = t.id
       LEFT JOIN categories c ON c.id = i.category_id
       WHERE i.project_id = $1 AND t.type IN ('expense', 'income') AND i.in_report AND NOT i.is_advance
       GROUP BY t.type, i.category_id, c.name, c.color ORDER BY amount DESC`,
      [id]
    ),
    query(`${LIST_SQL} WHERE EXISTS (SELECT 1 FROM transaction_items x WHERE x.transaction_id = t.id AND x.project_id = $1)
           ${LIST_GROUP} ORDER BY t.txn_date DESC, t.id DESC LIMIT 500`, [id]),
  ]);
  res.json({ ...rows[0], categories: byCat.rows, transactions: txns.rows });
}));

function readProject(body) {
  return {
    name: requireText(body.name, '專案名稱'),
    start_date: dates.isDate(body.start_date) ? body.start_date : null,
    end_date: dates.isDate(body.end_date) ? body.end_date : null,
    note: typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null,
    color: COLOR_RE.test(body.color || '') ? body.color : '#1D4ED8',
  };
}

router.post('/projects', wrap(async (req, res) => {
  const p = readProject(req.body);
  const { rows } = await query(
    `INSERT INTO projects (name, start_date, end_date, note, color) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [p.name, p.start_date, p.end_date, p.note, p.color]
  );
  res.status(201).json(rows[0]);
}));

router.put('/projects/:id', wrap(async (req, res) => {
  const id = requireInt(req.params.id, '專案 id');
  if (req.body.archived !== undefined && Object.keys(req.body).length === 1) {
    await query('UPDATE projects SET archived = $2 WHERE id = $1', [id, Boolean(req.body.archived)]);
    return res.json({ ok: true });
  }
  const p = readProject(req.body);
  const { rows } = await query(
    `UPDATE projects SET name = $2, start_date = $3, end_date = $4, note = $5, color = $6 WHERE id = $1 RETURNING *`,
    [id, p.name, p.start_date, p.end_date, p.note, p.color]
  );
  if (!rows[0]) throw new HttpError(404, '找不到這個專案');
  res.json(rows[0]);
}));

// =====================================================================
// 美甲
// =====================================================================

router.get('/nail', wrap(async (req, res) => {
  const month = monthStart(req.query.month);
  const result = await tx(async (client) => {
    const cfg = await settings.get(client, 'nail', null);
    if (!cfg) return { month: month.slice(0, 7), configured: false };
    const rate = Number(cfg.rate) || 10;
    // 同一個 client 的查詢要依序執行
    const income = await client.query(
      `${LIST_SQL} WHERE t.type = 'income' AND t.txn_date >= $1::date AND t.txn_date < ($1::date + INTERVAL '1 month')
         AND EXISTS (SELECT 1 FROM transaction_items x WHERE x.transaction_id = t.id AND x.category_id = $2)
       ${LIST_GROUP} ORDER BY t.txn_date DESC, t.id DESC`,
      [month, cfg.income_category_id]
    );
    const tools = await client.query(
      `${LIST_SQL} WHERE (t.account_id = $2 OR t.to_account_id = $2)
         AND t.txn_date >= $1::date AND t.txn_date < ($1::date + INTERVAL '1 month')
       ${LIST_GROUP} ORDER BY t.txn_date DESC, t.id DESC`,
      [month, cfg.bag_account_id]
    );
    const bag = await client.query(
      `SELECT a.name, b.balance FROM accounts a JOIN v_account_balances b ON b.id = a.id WHERE a.id = $1`, [cfg.bag_account_id]
    );
    const allocation = await client.query('SELECT * FROM nail_allocations WHERE month = $1', [month]);
    const history = await client.query(
      `SELECT date_trunc('month', t.txn_date)::DATE AS month, SUM(i.amount)::BIGINT AS income
       FROM transactions t JOIN transaction_items i ON i.transaction_id = t.id
       WHERE t.type = 'income' AND i.category_id = $1 AND NOT i.is_advance
         AND t.txn_date >= ($2::date - INTERVAL '5 months') AND t.txn_date < ($2::date + INTERVAL '1 month')
       GROUP BY 1 ORDER BY 1`,
      [cfg.income_category_id, month]
    );
    const incomeTotal = income.rows.reduce(
      (s, t) => s + t.items.filter((i) => i.category_id === cfg.income_category_id && !i.is_advance).reduce((x, i) => x + i.amount, 0), 0
    );
    return {
      month: month.slice(0, 7),
      configured: true,
      settings: cfg,
      rate,
      income_total: incomeTotal,
      income_count: income.rows.length,
      allocation_estimate: Math.round((incomeTotal * rate) / 100),
      allocation: allocation.rows[0] || null,
      bag_name: bag.rows[0] ? bag.rows[0].name : null,
      bag_balance: bag.rows[0] ? bag.rows[0].balance : null,
      incomes: income.rows,
      bag_transactions: tools.rows,
      history: history.rows,
    };
  });
  res.json(result);
}));

router.put('/nail/settings', wrap(async (req, res) => {
  const b = req.body;
  const cfg = {
    income_category_id: requireInt(b.income_category_id, '美甲收入分類'),
    tool_category_id: toInt(b.tool_category_id),
    source_account_id: requireInt(b.source_account_id, '美甲收入入帳帳戶'),
    bag_account_id: requireInt(b.bag_account_id, '收入袋帳戶'),
    rate: Number(b.rate) > 0 && Number(b.rate) <= 100 ? Number(b.rate) : 10,
  };
  if (cfg.source_account_id === cfg.bag_account_id) throw new HttpError(400, '入帳帳戶和收入袋不能是同一個帳戶');
  await tx(async (client) => {
    const { rows } = await client.query(
      `SELECT id, kind FROM accounts WHERE id = ANY($1::int[]) AND NOT archived`, [[cfg.source_account_id, cfg.bag_account_id]]
    );
    if (rows.length !== 2 || rows.some((r) => r.kind !== 'deposit')) throw new HttpError(400, '入帳帳戶和收入袋都必須是存款或現金帳戶');
    const old = await settings.get(client, 'nail', null);
    // 從設定的這個月開始，每月結束後自動撥款；之前的月份不追溯
    cfg.start_month = old && old.start_month ? old.start_month : `${dates.today().slice(0, 7)}-01`;
    await settings.set(client, 'nail', cfg);
  });
  res.json({ ok: true });
}));

module.exports = router;
