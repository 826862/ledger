const express = require('express');
const { tx } = require('../db');
const dates = require('../lib/dates');
const statements = require('../lib/statements');
const { insertItems } = require('./transactions');
const { HttpError, wrap, toInt } = require('./util');

const router = express.Router();
const KINDS = ['deposit', 'credit_card', 'loan'];
const text = (v) => (typeof v === 'string' ? v.trim() : '');

// 匯入整份資料（例如從 Notion 轉出的 JSON）。wipe = true 時先清空現有資料（分類保留）。
router.post('/import', wrap(async (req, res) => {
  const b = req.body || {};
  const accounts = Array.isArray(b.accounts) ? b.accounts : [];
  const txns = Array.isArray(b.transactions) ? b.transactions : [];
  if (!accounts.length) throw new HttpError(400, '匯入檔裡沒有帳戶');
  if (b.wipe !== true) throw new HttpError(400, '目前只支援清空後匯入，請勾選確認');

  const result = await tx(async (client) => {
    // 1. 清空
    for (const sql of [
      'DELETE FROM nail_usage', 'DELETE FROM nail_purchase_items', 'DELETE FROM nail_purchases',
      'DELETE FROM nail_products', 'DELETE FROM nail_services', 'DELETE FROM nail_customers',
      'DELETE FROM nail_allocations', "DELETE FROM app_settings WHERE key = 'nail'",
      'DELETE FROM budget_overrides', 'DELETE FROM budgets', 'DELETE FROM transaction_items',
      'DELETE FROM transactions', 'DELETE FROM installments', 'DELETE FROM card_statements',
      'DELETE FROM subscriptions', 'DELETE FROM projects', 'UPDATE accounts SET autopay_account_id = NULL',
      'DELETE FROM accounts',
    ]) await client.query(sql);

    // 2. 分類：缺的補上
    const catId = {};
    for (const kind of ['expense', 'income']) {
      const names = new Set((b.categories && b.categories[kind]) || []);
      txns.forEach((t) => (t.items || []).forEach((i) => {
        if (i.category && (t.type === kind)) names.add(i.category);
      }));
      for (const name of names) {
        const n = text(name);
        if (!n) continue;
        const { rows } = await client.query(
          `INSERT INTO categories (name, kind, sort_order)
           VALUES ($1, $2, COALESCE((SELECT MAX(sort_order) + 1 FROM categories WHERE kind = $2), 1))
           ON CONFLICT (kind, name) DO UPDATE SET archived = FALSE RETURNING id`,
          [n, kind]
        );
        catId[`${kind}:${n}`] = rows[0].id;
      }
    }

    // 3. 帳戶
    const accId = {};
    const accRow = {};
    let order = 0;
    for (const a of accounts) {
      const name = text(a.name);
      if (!name || !KINDS.includes(a.kind)) throw new HttpError(400, `帳戶「${name || '?'}」資料不完整`);
      const sd = a.kind === 'credit_card' ? toInt(a.statement_day) : null;
      const dd = a.kind === 'credit_card' ? toInt(a.due_day) : null;
      if (a.kind === 'credit_card' && (!(sd >= 1 && sd <= 31) || !(dd >= 1 && dd <= 31))) {
        throw new HttpError(400, `請設定「${name}」的結帳日和繳款日`);
      }
      const { rows } = await client.query(
        `INSERT INTO accounts (name, kind, opening_balance, statement_day, due_day, color, sort_order, is_cash)
         VALUES ($1, $2, $3, $4, $5, COALESCE($6, '#1D4ED8'), $7, $8) RETURNING *`,
        [name, a.kind, toInt(a.opening_balance) || 0, sd, dd, /^#[0-9A-Fa-f]{6}$/.test(a.color || '') ? a.color : null,
         ++order, a.kind === 'deposit' && Boolean(a.is_cash)]
      );
      accId[a.key || name] = rows[0].id;
      accRow[rows[0].id] = rows[0];
    }

    // 4. 專項
    const projId = {};
    const projNames = new Set(b.projects || []);
    txns.forEach((t) => (t.items || []).forEach((i) => { if (i.project) projNames.add(i.project); }));
    for (const p of projNames) {
      const n = text(p);
      if (!n || projId[n]) continue;
      const { rows } = await client.query('INSERT INTO projects (name) VALUES ($1) RETURNING id', [n]);
      projId[n] = rows[0].id;
    }

    // 5. 交易
    let count = 0;
    for (const t of txns) {
      if (!['expense', 'income', 'transfer'].includes(t.type) || !dates.isDate(t.date)) continue;
      const accountId = accId[t.account];
      if (!accountId) throw new HttpError(400, `找不到帳戶：${t.account}`);
      if (t.type === 'transfer') {
        const toId = accId[t.to_account];
        if (!toId) throw new HttpError(400, `找不到帳戶：${t.to_account}`);
        await client.query(
          `INSERT INTO transactions (type, txn_date, account_id, to_account_id, amount, title, source)
           VALUES ('transfer', $1, $2, $3, $4, $5, 'import')`,
          [t.date, accountId, toId, toInt(t.amount), text(t.title)]
        );
        count++;
        continue;
      }
      const acc = accRow[accountId];
      let statementId = null;
      if (acc.kind === 'credit_card') statementId = (await statements.forDate(client, acc, t.date)).id;
      const { rows } = await client.query(
        `INSERT INTO transactions (type, txn_date, account_id, title, statement_id, source)
         VALUES ($1, $2, $3, $4, $5, 'import') RETURNING id`,
        [t.type, t.date, accountId, text(t.title), statementId]
      );
      await insertItems(client, rows[0].id, (t.items || []).map((i, idx) => ({
        name: text(i.name),
        unit_price: toInt(i.amount) || 0,
        quantity: 1,
        category_id: i.category ? catId[`${t.type}:${text(i.category)}`] || null : null,
        project_id: i.project ? projId[text(i.project)] || null : null,
        is_advance: Boolean(i.is_advance),
        advance_person: text(i.advance_person) || null,
        sort_order: idx,
      })));
      if (t.type === 'expense' && (t.items || []).some((i) => i.is_advance && i.advance_settled)) {
        await client.query(
          'UPDATE transaction_items SET advance_settled_on = $2 WHERE transaction_id = $1 AND is_advance', [rows[0].id, t.date]
        );
      }
      count++;
    }

    // 6. 依實際繳款金額判斷哪些帳單已經繳清（先繳最舊的），沒繳清的維持未繳
    for (const acc of Object.values(accRow)) {
      if (acc.kind === 'credit_card') await statements.settleByPayments(client, acc, dates.today());
    }
    const { rows: bal } = await client.query('SELECT name, kind, balance FROM v_account_balances ORDER BY id');
    return { transactions: count, accounts: bal };
  });
  res.json(result);
}));

module.exports = router;
