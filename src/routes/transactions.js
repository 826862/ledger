const express = require('express');
const { query, tx } = require('../db');
const statements = require('../lib/statements');
const dates = require('../lib/dates');
const { HttpError, wrap, toInt, requireInt } = require('./util');

const router = express.Router();

const LIST_SQL = `
  SELECT t.*, ta.total,
    a.name AS account_name, a.kind AS account_kind, a2.name AS to_account_name,
    COALESCE(json_agg(json_build_object(
      'id', i.id, 'name', i.name, 'unit_price', i.unit_price, 'quantity', i.quantity,
      'amount', i.amount, 'category_id', i.category_id, 'category_name', c.name,
      'category_color', c.color, 'in_report', i.in_report, 'is_advance', i.is_advance,
      'advance_person', i.advance_person, 'advance_settled_on', i.advance_settled_on,
      'project_id', i.project_id, 'project_name', p.name
    ) ORDER BY i.sort_order, i.id) FILTER (WHERE i.id IS NOT NULL), '[]') AS items,
    string_agg(DISTINCT p.name, '、') AS project_name
  FROM transactions t
  JOIN v_transaction_amounts ta ON ta.id = t.id
  JOIN accounts a ON a.id = t.account_id
  LEFT JOIN accounts a2 ON a2.id = t.to_account_id
  LEFT JOIN transaction_items i ON i.transaction_id = t.id
  LEFT JOIN categories c ON c.id = i.category_id
  LEFT JOIN projects p ON p.id = i.project_id
`;
const LIST_GROUP = 'GROUP BY t.id, ta.total, a.name, a.kind, a2.name';

async function loadAccount(client, id, label = '帳戶') {
  const { rows } = await client.query('SELECT * FROM accounts WHERE id = $1', [id]);
  if (!rows[0]) throw new HttpError(400, `找不到${label}`);
  return rows[0];
}

function readItems(items, type) {
  if (!Array.isArray(items) || !items.length) throw new HttpError(400, '至少要有一個品項');
  return items.map((it, idx) => {
    const isAdvance = type === 'expense' && Boolean(it.is_advance);
    const unit_price = requireInt(it.unit_price, '金額', { min: 0 });
    const quantity = it.quantity === undefined || it.quantity === '' ? 1 : Number(it.quantity);
    if (!(quantity > 0)) throw new HttpError(400, '數量必須大於 0');
    return {
      name: typeof it.name === 'string' ? it.name.trim() : '',
      unit_price,
      quantity,
      category_id: toInt(it.category_id),
      is_advance: isAdvance,
      project_id: toInt(it.project_id),
      advance_person: isAdvance && typeof it.advance_person === 'string' && it.advance_person.trim() ? it.advance_person.trim() : null,
      sort_order: idx,
    };
  });
}

async function insertItems(client, transactionId, items) {
  for (const it of items) {
    await client.query(
      `INSERT INTO transaction_items (transaction_id, name, unit_price, quantity, category_id, in_report, sort_order,
         is_advance, advance_person, project_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [transactionId, it.name, it.unit_price, it.quantity, it.category_id, it.in_report ?? true, it.sort_order ?? 0,
       Boolean(it.is_advance), it.advance_person ?? null, it.project_id ?? null]
    );
  }
}

// 驗證並整理交易內容；信用卡消費自動歸到對應的帳單期別
async function prepare(client, body) {
  const type = body.type;
  if (!['expense', 'income', 'transfer'].includes(type)) throw new HttpError(400, '交易類型不正確');
  if (!dates.isDate(body.txn_date)) throw new HttpError(400, '日期格式不正確');
  const account = await loadAccount(client, requireInt(body.account_id, '帳戶'));
  const t = {
    type,
    txn_date: body.txn_date,
    account_id: account.id,
    to_account_id: null,
    amount: null,
    title: typeof body.title === 'string' ? body.title.trim() : '',
    note: typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null,
    project_id: null, // 專項改掛在明細上
    subscription_id: toInt(body.subscription_id),
    statement_id: null,
    items: [],
  };
  if (type === 'transfer') {
    const to = await loadAccount(client, requireInt(body.to_account_id, '轉入帳戶'), '轉入帳戶');
    if (to.id === account.id) throw new HttpError(400, '轉出與轉入帳戶不能相同');
    t.to_account_id = to.id;
    t.amount = requireInt(body.amount, '金額', { min: 1 });
  } else {
    t.items = readItems(body.items, type);
    if (account.kind === 'credit_card') {
      t.statement_id = (await statements.forDate(client, account, t.txn_date)).id;
    }
  }
  return t;
}

router.get('/', wrap(async (req, res) => {
  const params = [];
  const where = [];
  if (req.query.month) {
    if (!/^\d{4}-\d{2}$/.test(req.query.month)) throw new HttpError(400, '月份格式不正確');
    params.push(`${req.query.month}-01`);
    where.push(`t.txn_date >= $${params.length}::date AND t.txn_date < ($${params.length}::date + INTERVAL '1 month')`);
  }
  if (req.query.account_id) {
    params.push(requireInt(req.query.account_id, '帳戶'));
    where.push(`(t.account_id = $${params.length} OR t.to_account_id = $${params.length})`);
  }
  if (req.query.statement_id) {
    params.push(requireInt(req.query.statement_id, '帳單'));
    where.push(`t.statement_id = $${params.length}`);
  }
  if (req.query.pending_review === '1') where.push('t.pending_review');
  if (req.query.project_id) {
    params.push(requireInt(req.query.project_id, '專案'));
    where.push(`EXISTS (SELECT 1 FROM transaction_items x WHERE x.transaction_id = t.id AND x.project_id = $${params.length})`);
  }
  if (req.query.until_today === '1') {
    params.push(dates.today());
    where.push(`t.txn_date <= $${params.length}`);
  }
  const limit = Math.min(toInt(req.query.limit) || 300, 1000);
  const { rows } = await query(
    `${LIST_SQL} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ${LIST_GROUP}
     ORDER BY t.txn_date DESC, t.id DESC LIMIT ${limit}`,
    params
  );
  res.json(rows);
}));

router.get('/:id', wrap(async (req, res) => {
  const id = requireInt(req.params.id, '交易 id');
  const { rows } = await query(`${LIST_SQL} WHERE t.id = $1 ${LIST_GROUP}`, [id]);
  if (!rows[0]) throw new HttpError(404, '找不到這筆交易');
  res.json(rows[0]);
}));

router.post('/', wrap(async (req, res) => {
  const id = await tx(async (client) => {
    const t = await prepare(client, req.body);
    const { rows } = await client.query(
      `INSERT INTO transactions (type, txn_date, account_id, to_account_id, amount, title, note, project_id, statement_id, source, subscription_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
      [t.type, t.txn_date, t.account_id, t.to_account_id, t.amount, t.title, t.note, t.project_id,
       t.statement_id, req.body.source === 'reconcile' ? 'reconcile' : 'manual', t.subscription_id]
    );
    await insertItems(client, rows[0].id, t.items);
    return rows[0].id;
  });
  const { rows } = await query(`${LIST_SQL} WHERE t.id = $1 ${LIST_GROUP}`, [id]);
  res.status(201).json(rows[0]);
}));

router.put('/:id', wrap(async (req, res) => {
  const id = requireInt(req.params.id, '交易 id');
  await tx(async (client) => {
    const { rows: existing } = await client.query('SELECT * FROM transactions WHERE id = $1 FOR UPDATE', [id]);
    const old = existing[0];
    if (!old) throw new HttpError(404, '找不到這筆交易');
    if (old.installment_id) throw new HttpError(400, '分期產生的交易請到分期管理刪除後重建');
    if (old.type === 'adjustment') throw new HttpError(400, '校正紀錄不能編輯，請刪除後重新校正');
    const { rows: settled } = await client.query(
      'SELECT 1 FROM transaction_items WHERE transaction_id = $1 AND advance_settled_on IS NOT NULL LIMIT 1', [id]
    );
    if (settled.length) throw new HttpError(400, '這筆有已收回的代墊，請先到代墊頁刪除那筆收回紀錄再修改');
    const t = await prepare(client, req.body);
    // 同一帳戶、同一天就保留原本的帳單期別（可能已經在對帳時移過）
    if (old.statement_id && old.account_id === t.account_id && old.txn_date === t.txn_date) {
      t.statement_id = old.statement_id;
    }
    await client.query(
      `UPDATE transactions SET type = $2, txn_date = $3, account_id = $4, to_account_id = $5, amount = $6,
         title = $7, note = $8, project_id = $9, statement_id = $10, pending_review = FALSE
       WHERE id = $1`,
      [id, t.type, t.txn_date, t.account_id, t.to_account_id, t.amount, t.title, t.note, t.project_id, t.statement_id]
    );
    await client.query('DELETE FROM transaction_items WHERE transaction_id = $1', [id]);
    await insertItems(client, id, t.items);
  });
  const { rows } = await query(`${LIST_SQL} WHERE t.id = $1 ${LIST_GROUP}`, [id]);
  res.json(rows[0]);
}));

// 核對自動扣款：金額正確就確認，不對可以帶入實際扣款金額
router.post('/:id/confirm', wrap(async (req, res) => {
  const id = requireInt(req.params.id, '交易 id');
  await tx(async (client) => {
    const { rows } = await client.query('SELECT * FROM transactions WHERE id = $1 FOR UPDATE', [id]);
    const t = rows[0];
    if (!t) throw new HttpError(404, '找不到這筆交易');
    const amount = toInt(req.body.amount);
    if (amount !== null) {
      if (amount < 1) throw new HttpError(400, '金額必須大於 0');
      if (t.type === 'transfer') {
        await client.query('UPDATE transactions SET amount = $2 WHERE id = $1', [id, amount]);
      } else if (t.type === 'expense') {
        const { rows: items } = await client.query('SELECT id FROM transaction_items WHERE transaction_id = $1', [id]);
        if (items.length !== 1) throw new HttpError(400, '這筆有多個品項，請用編輯修改金額');
        await client.query('UPDATE transaction_items SET unit_price = $2, quantity = 1 WHERE id = $1', [items[0].id, amount]);
      }
    }
    await client.query('UPDATE transactions SET pending_review = FALSE WHERE id = $1', [id]);
  });
  res.json({ ok: true });
}));

router.delete('/:id', wrap(async (req, res) => {
  const id = requireInt(req.params.id, '交易 id');
  await tx(async (client) => {
    const { rows } = await client.query('SELECT installment_id, type, statement_id FROM transactions WHERE id = $1', [id]);
    if (!rows[0]) throw new HttpError(404, '找不到這筆交易');
    if (rows[0].installment_id) throw new HttpError(400, '這筆是分期產生的，請到該卡的分期列表刪除整筆分期');
    // 刪掉的是代墊收回紀錄：原本的代墊恢復成待收回
    await client.query(
      'UPDATE transaction_items SET advance_settled_on = NULL, advance_settle_txn_id = NULL WHERE advance_settle_txn_id = $1', [id]
    );
    await client.query('DELETE FROM transactions WHERE id = $1', [id]);
    // 刪掉的是信用卡繳款：帳單恢復成未繳
    if (rows[0].type === 'transfer' && rows[0].statement_id) {
      await client.query(
        `UPDATE card_statements SET status = CASE WHEN reconciled_at IS NOT NULL THEN 'reconciled' ELSE 'open' END
         WHERE id = $1 AND status = 'paid'`,
        [rows[0].statement_id]
      );
    }
  });
  res.json({ ok: true });
}));

module.exports = { router, insertItems, LIST_SQL, LIST_GROUP };
