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

// 匯入美甲資料：商品庫存、進貨紀錄、拿取紀錄、10% 收入袋（不會清空記帳資料）
// 進貨只做紀錄，不產生支出（避免和記帳本裡的支出重複）；收入袋紀錄以餘額調整匯入，不算進收支報表
router.post('/import/nail', wrap(async (req, res) => {
  const b = req.body || {};
  if (b.kind !== 'nail') throw new HttpError(400, '這不是美甲資料的匯入檔');
  if (b.replace !== true) throw new HttpError(400, '請勾選確認會取代目前的美甲商品、進貨、拿取資料');
  const products = Array.isArray(b.products) ? b.products : [];
  const purchases = Array.isArray(b.purchases) ? b.purchases : [];
  const usage = Array.isArray(b.usage) ? b.usage : [];
  const bag = Array.isArray(b.bag) ? b.bag : [];
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

  const result = await tx(async (client) => {
    for (const sql of ['DELETE FROM nail_usage', 'DELETE FROM nail_purchase_items', 'DELETE FROM nail_purchases', 'DELETE FROM nail_products']) {
      await client.query(sql);
    }

    // 1. 商品庫存
    const prodId = {};
    for (const p of products) {
      const name = text(p.name);
      if (!name) continue;
      const { rows } = await client.query(
        `INSERT INTO nail_products (name, brand, initial_qty, low_threshold, expiry) VALUES ($1, $2, $3, 1, $4) RETURNING id`,
        [name, text(p.brand) || null, Math.max(0, num(p.initial_qty)), text(p.expiry) || null]
      );
      prodId[p.key || name] = rows[0].id;
    }

    // 2. 拿取紀錄
    let usageCount = 0;
    for (const u of usage) {
      const pid = prodId[u.product];
      if (!pid || !(num(u.quantity) > 0)) continue;
      await client.query(
        'INSERT INTO nail_usage (product_id, use_date, user_name, quantity, note) VALUES ($1, $2, $3, $4, $5)',
        [pid, dates.isDate(u.date) ? u.date : dates.today(), text(u.user) || null, num(u.quantity), text(u.note) || null]
      );
      usageCount++;
    }

    // 3. 進貨紀錄：每個進貨品項建成一個「不追蹤庫存」的商品（不影響庫存清單）
    const archivedId = {};
    const productFor = async (name, brand) => {
      const k = `${brand || ''}|${name}`;
      if (archivedId[k]) return archivedId[k];
      const { rows } = await client.query(
        'INSERT INTO nail_products (name, brand, archived) VALUES ($1, $2, TRUE) RETURNING id', [name, brand || null]
      );
      archivedId[k] = rows[0].id;
      return rows[0].id;
    };
    let itemCount = 0;
    for (const pu of purchases) {
      const items = (pu.items || []).filter((i) => text(i.name));
      const lines = items.filter((i) => num(i.unit_price) >= 0).map((i) => ({ ...i, unit_price: Math.round(num(i.unit_price)), quantity: num(i.quantity) || 1 }));
      const notes = [];
      // 折扣（負數）：折在單價最高、數量 1 的品項上，否則寫在備註
      for (const d of items.filter((i) => num(i.unit_price) < 0)) {
        const off = Math.round(-num(d.unit_price) * (num(d.quantity) || 1));
        const target = lines.filter((l) => l.quantity === 1 && l.unit_price >= off).sort((a, c) => c.unit_price - a.unit_price)[0];
        if (target) target.unit_price -= off; else notes.push(`${text(d.name) || '折扣'} ${off}`);
      }
      lines.forEach((l) => { if (text(l.note)) notes.push(`${text(l.name)}：${text(l.note)}`); });
      const { rows } = await client.query(
        `INSERT INTO nail_purchases (vendor, purchase_date, note) VALUES ($1, $2, $3) RETURNING id`,
        [text(pu.vendor), dates.isDate(pu.date) ? pu.date : dates.today(), notes.join('；') || null]
      );
      for (const l of lines) {
        await client.query(
          'INSERT INTO nail_purchase_items (purchase_id, product_id, unit_price, quantity) VALUES ($1, $2, $3, $4)',
          [rows[0].id, await productFor(text(l.name), text(l.brand)), l.unit_price, l.quantity > 0 ? l.quantity : 1]
        );
        itemCount++;
      }
    }

    // 4. 10% 收入袋
    let bagAccount = null;
    if (bag.length) {
      const bagId = toInt(b.bag_account_id);
      if (bagId) {
        const { rows } = await client.query('SELECT * FROM accounts WHERE id = $1 AND kind = $2 AND NOT archived', [bagId, 'deposit']);
        if (!rows[0]) throw new HttpError(400, '請選擇存款帳戶當作收入袋');
        bagAccount = rows[0];
      } else {
        const name = text(b.bag_account_name) || '美甲 10% 收入袋';
        const { rows: found } = await client.query('SELECT * FROM accounts WHERE name = $1 AND kind = $2 AND NOT archived', [name, 'deposit']);
        bagAccount = found[0] || (await client.query(
          `INSERT INTO accounts (name, kind, opening_balance, color, sort_order, icon_type, icon_value)
           VALUES ($1, 'deposit', 0, '#DB2777', COALESCE((SELECT MAX(sort_order) + 1 FROM accounts), 1), 'emoji', '💅') RETURNING *`,
          [name]
        )).rows[0];
      }
      await client.query(
        `DELETE FROM transactions WHERE account_id = $1 AND type = 'adjustment' AND source = 'import'`, [bagAccount.id]
      );
      for (const r of bag) {
        const amount = Math.round(num(r.amount));
        if (!amount || !dates.isDate(r.date)) continue;
        await client.query(
          `INSERT INTO transactions (type, txn_date, account_id, amount, title, source) VALUES ('adjustment', $1, $2, $3, $4, 'import')`,
          [r.date, bagAccount.id, amount, text(r.title) || '收入袋']
        );
      }
    }
    let bagBalance = null;
    if (bagAccount) {
      const { rows } = await client.query('SELECT balance FROM v_account_balances WHERE id = $1', [bagAccount.id]);
      bagBalance = rows[0] ? rows[0].balance : null;
    }
    return {
      products: Object.keys(prodId).length, usage: usageCount, purchases: purchases.length, purchase_items: itemCount,
      bag_records: bag.length, bag_account: bagAccount ? bagAccount.name : null, bag_balance: bagBalance,
    };
  });
  res.json(result);
}));

module.exports = router;
