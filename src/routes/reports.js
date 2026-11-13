const express = require('express');
const { query } = require('../db');
const dates = require('../lib/dates');
const { tx } = require('../db');
const autopay = require('../lib/autopay');
const { HttpError, wrap } = require('./util');

const router = express.Router();

function monthStart(m) {
  if (m === undefined) return `${dates.today().slice(0, 7)}-01`;
  if (!/^\d{4}-\d{2}$/.test(m)) throw new HttpError(400, '月份格式不正確');
  return `${m}-01`;
}

function prevMonth(ms) {
  return dates.make(Number(ms.slice(0, 4)), Number(ms.slice(5, 7)) - 1, 1);
}

router.get('/reports/monthly', wrap(async (req, res) => {
  const month = monthStart(req.query.month);
  const prev = prevMonth(month);
  const type = req.query.type === 'income' ? 'income' : 'expense';
  const [cur, last, totals] = await Promise.all([
    query(
      `SELECT category_id, COALESCE(category_name, '未分類') AS category_name,
              COALESCE(category_color, '#8A909C') AS category_color, amount, txn_count, share_pct
       FROM v_monthly_category WHERE month = $1 AND type = $2 ORDER BY amount DESC`,
      [month, type]
    ),
    query(`SELECT category_id, amount FROM v_monthly_category WHERE month = $1 AND type = $2`, [prev, type]),
    query(
      `SELECT month, type, SUM(amount)::BIGINT AS total FROM v_monthly_category
       WHERE month IN ($1, $2) GROUP BY month, type`,
      [month, prev]
    ),
  ]);
  const lastMap = new Map(last.rows.map((r) => [r.category_id, r.amount]));
  const t = (m, ty) => (totals.rows.find((r) => r.month === m && r.type === ty) || { total: 0 }).total;
  const categories = cur.rows.map((r) => ({ ...r, prev_amount: lastMap.get(r.category_id) || 0 }));
  res.json({
    month: month.slice(0, 7),
    type,
    total: categories.reduce((x, r) => x + r.amount, 0),
    expense: t(month, 'expense'),
    income: t(month, 'income'),
    prev_expense: t(prev, 'expense'),
    prev_income: t(prev, 'income'),
    categories,
  });
}));

// 單一類別：本月明細、比上月、近 6 個月
router.get('/reports/category', wrap(async (req, res) => {
  const month = monthStart(req.query.month);
  const categoryId = req.query.category_id === 'none' ? null : Number(req.query.category_id);
  if (categoryId !== null && !Number.isInteger(categoryId)) throw new HttpError(400, '類別不正確');
  const catCond = categoryId === null ? 'i.category_id IS NULL' : 'i.category_id = $2';
  const params = categoryId === null ? [month] : [month, categoryId];
  const [cat, hist, items] = await Promise.all([
    categoryId === null ? { rows: [{ id: null, name: '未分類', color: '#8A909C', kind: 'expense' }] }
      : query('SELECT id, name, color, kind FROM categories WHERE id = $1', [categoryId]),
    query(
      `SELECT date_trunc('month', t.txn_date)::DATE AS month, SUM(i.amount)::BIGINT AS amount
       FROM transaction_items i JOIN transactions t ON t.id = i.transaction_id
       WHERE ${catCond} AND t.type IN ('expense', 'income') AND i.in_report AND NOT i.is_advance
         AND t.txn_date >= ($1::date - INTERVAL '5 months') AND t.txn_date < ($1::date + INTERVAL '1 month')
       GROUP BY 1 ORDER BY 1`,
      params
    ),
    query(
      `SELECT i.id, i.name, i.amount, t.id AS transaction_id, t.title, t.txn_date, a.name AS account_name, p.name AS project_name
       FROM transaction_items i JOIN transactions t ON t.id = i.transaction_id
       JOIN accounts a ON a.id = t.account_id LEFT JOIN projects p ON p.id = i.project_id
       WHERE ${catCond} AND t.type IN ('expense', 'income') AND i.in_report AND NOT i.is_advance
         AND t.txn_date >= $1::date AND t.txn_date < ($1::date + INTERVAL '1 month')
       ORDER BY i.amount DESC, t.txn_date DESC`,
      params
    ),
  ]);
  if (!cat.rows[0]) throw new HttpError(404, '找不到這個類別');
  const months = [];
  for (let k = 5; k >= 0; k--) {
    const m = dates.make(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - k, 1);
    const row = hist.rows.find((r) => r.month === m);
    months.push({ month: m.slice(0, 7), amount: row ? row.amount : 0 });
  }
  const current = months[5].amount;
  res.json({
    category: cat.rows[0],
    month: month.slice(0, 7),
    amount: current,
    prev_amount: months[4].amount,
    average: Math.round(months.reduce((x, r) => x + r.amount, 0) / months.length),
    history: months,
    items: items.rows,
  });
}));

// 近 N 個月收支
router.get('/reports/trend', wrap(async (req, res) => {
  const end = monthStart(req.query.end);
  const n = Math.min(Math.max(Number(req.query.months) || 12, 3), 24);
  const start = dates.make(Number(end.slice(0, 4)), Number(end.slice(5, 7)) - (n - 1), 1);
  const { rows } = await query(
    `SELECT month, type, SUM(amount)::BIGINT AS total FROM v_monthly_category
     WHERE month >= $1 AND month <= $2 GROUP BY month, type`,
    [start, end]
  );
  const out = [];
  for (let k = 0; k < n; k++) {
    const m = dates.make(Number(start.slice(0, 4)), Number(start.slice(5, 7)) + k, 1);
    const ex = rows.find((r) => r.month === m && r.type === 'expense');
    const inc = rows.find((r) => r.month === m && r.type === 'income');
    out.push({ month: m.slice(0, 7), expense: ex ? ex.total : 0, income: inc ? inc.total : 0 });
  }
  res.json({ months: out });
}));

// 年度
router.get('/reports/year', wrap(async (req, res) => {
  const year = /^\d{4}$/.test(req.query.year || '') ? Number(req.query.year) : Number(dates.today().slice(0, 4));
  const from = `${year}-01-01`;
  const to = `${year}-12-01`;
  const [monthly, top] = await Promise.all([
    query(`SELECT month, type, SUM(amount)::BIGINT AS total FROM v_monthly_category WHERE month >= $1 AND month <= $2 GROUP BY month, type`, [from, to]),
    query(
      `SELECT COALESCE(category_name, '未分類') AS category_name, COALESCE(category_color, '#8A909C') AS category_color,
              SUM(amount)::BIGINT AS amount
       FROM v_monthly_category WHERE month >= $1 AND month <= $2 AND type = 'expense'
       GROUP BY category_name, category_color ORDER BY amount DESC LIMIT 5`,
      [from, to]
    ),
  ]);
  const months = [];
  for (let m = 1; m <= 12; m++) {
    const key = dates.make(year, m, 1);
    const ex = monthly.rows.find((r) => r.month === key && r.type === 'expense');
    const inc = monthly.rows.find((r) => r.month === key && r.type === 'income');
    months.push({ month: key.slice(0, 7), expense: ex ? ex.total : 0, income: inc ? inc.total : 0 });
  }
  const income = months.reduce((x, r) => x + r.income, 0);
  const expense = months.reduce((x, r) => x + r.expense, 0);
  res.json({ year, income, expense, saved: income - expense, months, top_categories: top.rows });
}));

// 資產變化：每月月底的存款、信用卡、貸款餘額
router.get('/reports/networth', wrap(async (req, res) => {
  const n = Math.min(Math.max(Number(req.query.months) || 12, 3), 36);
  const today = dates.today();
  const endMonth = `${today.slice(0, 7)}-01`;
  const points = [];
  for (let k = n - 1; k >= 0; k--) {
    const m = dates.make(Number(endMonth.slice(0, 4)), Number(endMonth.slice(5, 7)) - k, 1);
    const monthEnd = dates.addDays(dates.make(Number(m.slice(0, 4)), Number(m.slice(5, 7)) + 1, 1), -1);
    points.push({ month: m.slice(0, 7), date: monthEnd < today ? monthEnd : today });
  }
  const { rows } = await query(
    `WITH amt AS (SELECT transaction_id, SUM(amount) AS total FROM transaction_items GROUP BY transaction_id),
     tx AS (
       SELECT t.*, CASE WHEN t.type IN ('expense', 'income') THEN COALESCE(amt.total, 0) ELSE t.amount END AS total
       FROM transactions t LEFT JOIN amt ON amt.transaction_id = t.id
       WHERE t.affects_balance AND t.txn_date <= $2
     ),
     mv AS (
       SELECT account_id, txn_date,
              CASE type WHEN 'income' THEN total WHEN 'expense' THEN -total WHEN 'transfer' THEN -total ELSE total END AS delta
       FROM tx
       UNION ALL
       SELECT to_account_id, txn_date, total FROM tx WHERE type = 'transfer'
     ),
     monthly AS (
       SELECT account_id, date_trunc('month', txn_date)::DATE AS m, SUM(delta) AS s FROM mv GROUP BY 1, 2
     ),
     pts AS (SELECT * FROM unnest($1::date[]) AS d(m))
     SELECT pts.m, ac.kind,
            SUM(CASE ac.kind WHEN 'deposit' THEN ac.opening_balance + COALESCE(c.s, 0)
                             ELSE ac.opening_balance - COALESCE(c.s, 0) END)::BIGINT AS total
     FROM pts CROSS JOIN accounts ac
     LEFT JOIN LATERAL (SELECT SUM(s) AS s FROM monthly WHERE monthly.account_id = ac.id AND monthly.m <= pts.m) c ON TRUE
     WHERE NOT ac.archived
     GROUP BY pts.m, ac.kind`,
    [points.map((p) => `${p.month}-01`), today]
  );
  const out = points.map((p) => {
    const get = (kind) => (rows.find((r) => r.m === `${p.month}-01` && r.kind === kind) || { total: 0 }).total;
    const deposit = get('deposit');
    const card = get('credit_card');
    const loan = get('loan');
    return { month: p.month, deposit, card, loan, net: deposit - card - loan };
  });
  res.json({ points: out });
}));

router.get('/dashboard', wrap(async (req, res) => {
  const today = dates.today();
  const month = `${today.slice(0, 7)}-01`;
  await tx((client) => autopay.run(client));
  const [balances, monthRows, nextDue, pending, loans, advances, budget] = await Promise.all([
    query(`SELECT kind, COALESCE(SUM(balance), 0)::BIGINT AS total, COUNT(*)::INT AS count
           FROM v_account_balances GROUP BY kind`),
    query(`SELECT COALESCE(category_name, '未分類') AS category_name,
                  COALESCE(category_color, '#8A909C') AS category_color, amount, share_pct
           FROM v_monthly_category WHERE month = $1 AND type = 'expense' ORDER BY amount DESC`, [month]),
    query(`SELECT s.id, s.due_date, a.name AS account_name
           FROM card_statements s JOIN accounts a ON a.id = s.account_id
           WHERE s.status <> 'paid' AND s.due_date >= $1
             AND EXISTS (SELECT 1 FROM transactions t WHERE t.statement_id = s.id AND t.affects_balance AND t.type = 'expense')
           ORDER BY s.due_date LIMIT 1`, [today]),
    query(`SELECT COUNT(*)::INT AS n FROM transactions WHERE pending_review`),
    query(`SELECT a.id, a.name, b.balance, a.loan_next_date, a.loan_payment
           FROM accounts a JOIN v_account_balances b ON b.id = a.id
           WHERE a.kind = 'loan' ORDER BY a.sort_order, a.id`),
    query(`SELECT COALESCE(SUM(i.amount), 0)::BIGINT AS total, COUNT(DISTINCT COALESCE(i.advance_person, ''))::INT AS people
           FROM transaction_items i JOIN transactions t ON t.id = i.transaction_id
           WHERE i.is_advance AND t.type = 'expense' AND i.advance_settled_on IS NULL`),
    query(`SELECT COALESCE(SUM(COALESCE(o.amount, b.amount)), 0)::BIGINT AS budget,
                  COALESCE(SUM(m.amount) FILTER (WHERE COALESCE(o.amount, b.amount) IS NOT NULL), 0)::BIGINT AS spent,
                  COUNT(*) FILTER (WHERE COALESCE(o.amount, b.amount) IS NOT NULL)::INT AS count
           FROM categories c
           LEFT JOIN budgets b ON b.category_id = c.id
           LEFT JOIN budget_overrides o ON o.category_id = c.id AND o.month = $1
           LEFT JOIN v_monthly_category m ON m.category_id = c.id AND m.month = $1 AND m.type = 'expense'
           WHERE c.kind = 'expense' AND NOT c.archived`, [month]),
  ]);
  const byKind = Object.fromEntries(balances.rows.map((r) => [r.kind, r]));
  const deposit = byKind.deposit || { total: 0, count: 0 };
  const card = byKind.credit_card || { total: 0, count: 0 };
  const loan = byKind.loan || { total: 0, count: 0 };
  res.json({
    today,
    deposit_total: deposit.total,
    deposit_count: deposit.count,
    card_total: card.total,
    card_count: card.count,
    loan_total: loan.total,
    loans: loans.rows,
    net_worth: deposit.total - card.total - loan.total,
    pending_review: pending.rows[0].n,
    advances_total: advances.rows[0].total,
    advances_people: advances.rows[0].people,
    budget_total: budget.rows[0].count ? budget.rows[0].budget : null,
    budget_spent: budget.rows[0].spent,
    month_expense: monthRows.rows.reduce((s, r) => s + r.amount, 0),
    month_categories: monthRows.rows,
    next_due: nextDue.rows[0] || null,
  });
}));

module.exports = router;
