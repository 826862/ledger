const express = require('express');
const { query, tx } = require('../db');
const statements = require('../lib/statements');
const dates = require('../lib/dates');
const { insertItems } = require('./transactions');
const { HttpError, wrap, toInt, requireInt } = require('./util');

const router = express.Router();

async function loadCard(client, id) {
  const { rows } = await client.query('SELECT * FROM accounts WHERE id = $1', [id]);
  if (!rows[0] || rows[0].kind !== 'credit_card') throw new HttpError(404, '找不到這張信用卡');
  return rows[0];
}

// 某張卡的帳單列表
router.get('/accounts/:id/statements', wrap(async (req, res) => {
  const id = requireInt(req.params.id, '帳戶 id');
  const { rows } = await query(
    `${statements.SUMMARY_SQL} WHERE s.account_id = $1 GROUP BY s.id, a.name ORDER BY s.period_end DESC LIMIT 24`,
    [id]
  );
  res.json(rows);
}));

// 取得某一天所屬的帳單（不存在就建立），用來從帳戶頁跳到「本期帳單」
router.get('/accounts/:id/statements/for-date', wrap(async (req, res) => {
  const id = requireInt(req.params.id, '帳戶 id');
  const date = dates.isDate(req.query.date) ? req.query.date : dates.today();
  const s = await tx(async (client) => statements.forDate(client, await loadCard(client, id), date));
  res.json({ id: s.id });
}));

router.get('/statements/:id', wrap(async (req, res) => {
  const id = requireInt(req.params.id, '帳單 id');
  const result = await tx(async (client) => {
    const s = await statements.summary(client, id);
    if (!s) throw new HttpError(404, '找不到這期帳單');
    const card = await loadCard(client, s.account_id);
    const prev = await statements.forDate(client, card, dates.addDays(s.period_start, -1));
    const next = await statements.next(client, card, s);
    let autopayName = null;
    if (card.autopay_account_id) {
      const { rows } = await client.query('SELECT name FROM accounts WHERE id = $1', [card.autopay_account_id]);
      autopayName = rows[0] ? rows[0].name : null;
    }
    return { ...s, prev_id: prev.id, next_id: next.id, autopay_account_name: autopayName };
  });
  res.json(result);
}));

// 對帳
// body: { keep_ids: [交易 id], extras: [{ title, txn_date, items }], bank_amount? }
// 沒勾到的一般消費移到下一期；分期交易固定保留；補記的交易直接歸在這期
// 對帳後的應繳金額 = 勾選＋補記＋分期的總和，自動扣繳就扣這個金額
router.post('/statements/:id/reconcile', wrap(async (req, res) => {
  const id = requireInt(req.params.id, '帳單 id');
  const bankAmount = toInt(req.body.bank_amount);
  const keep = new Set((req.body.keep_ids || []).map(Number));
  const extras = Array.isArray(req.body.extras) ? req.body.extras : [];

  const result = await tx(async (client) => {
    const { rows: srows } = await client.query('SELECT * FROM card_statements WHERE id = $1 FOR UPDATE', [id]);
    const s = srows[0];
    if (!s) throw new HttpError(404, '找不到這期帳單');
    if (s.status === 'paid') throw new HttpError(400, '這期已經繳款，不能再對帳');
    const card = await loadCard(client, s.account_id);

    const { rows: txns } = await client.query(
      `SELECT id FROM transactions
       WHERE statement_id = $1 AND affects_balance AND installment_id IS NULL AND type IN ('expense', 'income')`,
      [id]
    );
    const toMove = txns.filter((t) => !keep.has(t.id)).map((t) => t.id);
    let moved = 0;
    if (toMove.length) {
      const nextStatement = await statements.next(client, card, s);
      const r = await client.query('UPDATE transactions SET statement_id = $2 WHERE id = ANY($1::int[])', [toMove, nextStatement.id]);
      moved = r.rowCount;
    }

    for (const ex of extras) {
      if (!Array.isArray(ex.items) || !ex.items.length) continue;
      const fallback = s.period_end < dates.today() ? s.period_end : dates.today();
      const txnDate = dates.isDate(ex.txn_date) ? ex.txn_date : fallback;
      const { rows } = await client.query(
        `INSERT INTO transactions (type, txn_date, account_id, title, statement_id, source)
         VALUES ('expense', $1, $2, $3, $4, 'reconcile') RETURNING id`,
        [txnDate, card.id, typeof ex.title === 'string' ? ex.title.trim() : '', id]
      );
      await insertItems(client, rows[0].id, ex.items.map((it, idx) => ({
        name: typeof it.name === 'string' ? it.name.trim() : '',
        unit_price: requireInt(it.unit_price, '補記金額', { min: 0 }),
        quantity: 1,
        category_id: toInt(it.category_id),
        sort_order: idx,
      })));
    }

    const after = await statements.summary(client, id);
    await client.query(
      `UPDATE card_statements SET statement_amount = $2, status = 'reconciled', reconciled_at = now() WHERE id = $1`,
      [id, after.recorded_amount]
    );
    return {
      moved,
      amount: after.recorded_amount,
      difference: bankAmount === null ? null : bankAmount - after.recorded_amount,
      autopay: Boolean(card.autopay_account_id),
    };
  });
  res.json(result);
}));

// 記錄繳款：從存款帳戶轉帳到信用卡
router.post('/statements/:id/pay', wrap(async (req, res) => {
  const id = requireInt(req.params.id, '帳單 id');
  const fromId = requireInt(req.body.from_account_id, '付款帳戶');
  const result = await tx(async (client) => {
    const s = await statements.summary(client, id);
    if (!s) throw new HttpError(404, '找不到這期帳單');
    if (s.status === 'paid') throw new HttpError(400, '這期已經記錄過繳款');
    const { rows: from } = await client.query('SELECT * FROM accounts WHERE id = $1', [fromId]);
    if (!from[0] || from[0].kind !== 'deposit') throw new HttpError(400, '請選擇存款帳戶付款');
    const amount = toInt(req.body.amount) ?? s.statement_amount ?? s.recorded_amount;
    if (!(amount > 0)) throw new HttpError(400, '繳款金額必須大於 0');
    const date = dates.isDate(req.body.date) ? req.body.date : dates.today();
    await client.query(
      `INSERT INTO transactions (type, txn_date, account_id, to_account_id, amount, title, statement_id)
       VALUES ('transfer', $1, $2, $3, $4, $5, $6)`,
      [date, fromId, s.account_id, amount, `${s.account_name} 繳款`, id]
    );
    await client.query(`UPDATE card_statements SET status = 'paid' WHERE id = $1`, [id]);
    return { amount };
  });
  res.json(result);
}));

module.exports = router;
