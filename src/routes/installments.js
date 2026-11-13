const express = require('express');
const { query, tx } = require('../db');
const statements = require('../lib/statements');
const dates = require('../lib/dates');
const plan = require('../lib/installments');
const { insertItems } = require('./transactions');
const { HttpError, wrap, toInt, requireInt, requireText } = require('./util');

const router = express.Router();

function readBody(body) {
  const interest_type = body.interest_type || 'none';
  if (!['none', 'apr', 'fixed_fee'].includes(interest_type)) throw new HttpError(400, '利息方式不正確');
  const report_mode = body.report_mode === 'spread' ? 'spread' : 'full';
  const apr = interest_type === 'apr' ? Number(body.apr) : null;
  if (interest_type === 'apr' && !(apr >= 0 && apr < 100)) throw new HttpError(400, '年利率不正確');
  return {
    account_id: requireInt(body.account_id, '信用卡'),
    category_id: toInt(body.category_id),
    name: requireText(body.name, '品項名稱'),
    principal: requireInt(body.principal, '分期總額', { min: 1 }),
    periods: requireInt(body.periods, '期數', { min: 1 }),
    interest_type,
    apr,
    fee_per_period: interest_type === 'fixed_fee' ? requireInt(body.fee_per_period, '每期手續費', { min: 0 }) : null,
    purchase_date: dates.isDate(body.purchase_date) ? body.purchase_date : dates.today(),
    first_bill_date: dates.isDate(body.first_bill_date) ? body.first_bill_date : null,
    report_mode,
    paid_periods: Math.max(0, toInt(body.paid_periods) || 0),
    next_bill_date: dates.isDate(body.next_bill_date) ? body.next_bill_date : null,
  };
}

// 試算（不寫入）
router.post('/installments/preview', wrap(async (req, res) => {
  const b = readBody({ ...req.body, account_id: req.body.account_id || 0, name: req.body.name || '試算' });
  const rows = plan.schedule(b);
  res.json({ ...plan.totals(rows), schedule: rows });
}));

router.post('/installments', wrap(async (req, res) => {
  const b = readBody(req.body);
  const result = await tx(async (client) => {
    const { rows: acc } = await client.query('SELECT * FROM accounts WHERE id = $1', [b.account_id]);
    const card = acc[0];
    if (!card || card.kind !== 'credit_card') throw new HttpError(400, '分期只能建立在信用卡帳戶');
    if (b.paid_periods >= b.periods) throw new HttpError(400, '已繳期數要小於總期數');
    const paid = b.paid_periods;
    // 已經繳了幾期：下一期（第 paid + 1 期）出現在 next_bill_date 那期帳單，往前推算第 1 期
    const nextBill = paid ? statements.periodEndFor(b.next_bill_date || dates.today(), card.statement_day) : null;
    const billFor = (no) => {
      const { y, m } = dates.parse(nextBill);
      return statements.periodEndFor(dates.make(y, m - (paid + 1 - no), 1), card.statement_day);
    };
    const firstBill = paid ? billFor(1)
      : b.first_bill_date ? statements.periodEndFor(b.first_bill_date, card.statement_day)
      : statements.periodEndFor(b.purchase_date, card.statement_day);

    const { rows: ins } = await client.query(
      `INSERT INTO installments (account_id, category_id, name, principal, periods, interest_type, apr,
         fee_per_period, first_bill_date, report_mode, purchase_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [card.id, b.category_id, b.name, b.principal, b.periods, b.interest_type, b.apr,
       b.fee_per_period, firstBill, b.report_mode, b.purchase_date]
    );
    const inst = ins[0];

    const { rows: interestCat } = await client.query(
      `SELECT id FROM categories WHERE kind = 'expense' AND name = '利息' AND NOT archived LIMIT 1`
    );
    const interestCategoryId = interestCat[0] ? interestCat[0].id : null;

    // 購買紀錄：不影響卡費餘額，報表是否計入看 report_mode
    const { rows: purchase } = await client.query(
      `INSERT INTO transactions (type, txn_date, account_id, title, installment_id, affects_balance, source)
       VALUES ('expense', $1, $2, $3, $4, FALSE, 'installment') RETURNING id`,
      [b.purchase_date, card.id, `${b.name}（分期 ${b.periods} 期）`, inst.id]
    );
    await insertItems(client, purchase[0].id, [{
      name: b.name, unit_price: b.principal, quantity: 1, category_id: b.category_id,
      in_report: b.report_mode === 'full' && !paid, sort_order: 0,
    }]);

    // 每一期：入帳日為該期結帳日，歸在該期帳單
    // 已繳的期數只做紀錄：不影響卡費餘額、不進帳單、不算進報表
    let statement = null;
    for (const p of plan.schedule(b)) {
      const isPaid = p.no <= paid;
      if (!isPaid) {
        statement = statement ? await statements.next(client, card, statement)
          : await statements.getOrCreate(client, card, paid ? nextBill : firstBill);
      }
      const date = isPaid ? billFor(p.no) : statement.period_end;
      const { rows: t } = await client.query(
        `INSERT INTO transactions (type, txn_date, account_id, title, statement_id, installment_id, installment_no, affects_balance, source)
         VALUES ('expense', $1, $2, $3, $4, $5, $6, $7, 'installment') RETURNING id`,
        [date, card.id, `分期｜${b.name}${isPaid ? '（已繳）' : ''}`, isPaid ? null : statement.id, inst.id, p.no, !isPaid]
      );
      const reportThis = !isPaid && (b.report_mode === 'spread' || paid > 0);
      const items = [{ name: '本金', unit_price: p.principal, quantity: 1, category_id: b.category_id,
        in_report: reportThis, sort_order: 0 }];
      if (p.interest > 0) {
        items.push({ name: '利息', unit_price: p.interest, quantity: 1, category_id: interestCategoryId,
          in_report: !isPaid, sort_order: 1 });
      }
      await insertItems(client, t[0].id, items);
    }
    return inst;
  });
  res.status(201).json(result);
}));

router.get('/accounts/:id/installments', wrap(async (req, res) => {
  const id = requireInt(req.params.id, '帳戶 id');
  const today = dates.today();
  const { rows } = await query(
    `SELECT i.*,
       (SELECT COUNT(*) FROM transactions t WHERE t.installment_id = i.id AND t.installment_no IS NOT NULL AND t.txn_date <= $2)::INT AS billed_periods,
       (SELECT COALESCE(SUM(it.amount), 0) FROM transactions t JOIN transaction_items it ON it.transaction_id = t.id
          WHERE t.installment_id = i.id AND t.installment_no IS NOT NULL AND t.txn_date <= $2 AND it.name = '本金')::BIGINT AS principal_billed,
       (SELECT COALESCE(SUM(it.amount), 0) FROM transactions t JOIN transaction_items it ON it.transaction_id = t.id
          WHERE t.installment_id = i.id AND t.installment_no IS NOT NULL AND it.name = '利息')::BIGINT AS total_interest,
       (SELECT MAX(t.txn_date) FROM transactions t WHERE t.installment_id = i.id) AS last_bill_date
     FROM installments i WHERE i.account_id = $1 ORDER BY i.purchase_date DESC, i.id DESC`,
    [id, today]
  );
  res.json(rows);
}));

router.delete('/installments/:id', wrap(async (req, res) => {
  const id = requireInt(req.params.id, '分期 id');
  await tx(async (client) => {
    await client.query('DELETE FROM transactions WHERE installment_id = $1', [id]);
    const r = await client.query('DELETE FROM installments WHERE id = $1', [id]);
    if (!r.rowCount) throw new HttpError(404, '找不到這筆分期');
  });
  res.json({ ok: true });
}));

module.exports = router;
