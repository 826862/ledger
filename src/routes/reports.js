const express = require('express');
const { query } = require('../db');
const dates = require('../lib/dates');
const { HttpError, wrap } = require('./util');

const router = express.Router();

function monthStart(m) {
  if (m === undefined) return `${dates.today().slice(0, 7)}-01`;
  if (!/^\d{4}-\d{2}$/.test(m)) throw new HttpError(400, '月份格式不正確');
  return `${m}-01`;
}

router.get('/reports/monthly', wrap(async (req, res) => {
  const month = monthStart(req.query.month);
  const type = req.query.type === 'income' ? 'income' : 'expense';
  const { rows } = await query(
    `SELECT category_id, COALESCE(category_name, '未分類') AS category_name,
            COALESCE(category_color, '#8A909C') AS category_color, amount, txn_count, share_pct
     FROM v_monthly_category WHERE month = $1 AND type = $2 ORDER BY amount DESC`,
    [month, type]
  );
  const total = rows.reduce((s, r) => s + r.amount, 0);
  res.json({ month: month.slice(0, 7), type, total, categories: rows });
}));

router.get('/dashboard', wrap(async (req, res) => {
  const today = dates.today();
  const month = `${today.slice(0, 7)}-01`;
  const [balances, monthRows, nextDue] = await Promise.all([
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
  ]);
  const byKind = Object.fromEntries(balances.rows.map((r) => [r.kind, r]));
  const deposit = byKind.deposit || { total: 0, count: 0 };
  const card = byKind.credit_card || { total: 0, count: 0 };
  res.json({
    today,
    deposit_total: deposit.total,
    deposit_count: deposit.count,
    card_total: card.total,
    card_count: card.count,
    net_worth: deposit.total - card.total,
    month_expense: monthRows.rows.reduce((s, r) => s + r.amount, 0),
    month_categories: monthRows.rows,
    next_due: nextDue.rows[0] || null,
  });
}));

module.exports = router;
