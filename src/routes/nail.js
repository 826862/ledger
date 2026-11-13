const express = require('express');
const { query, tx } = require('../db');
const dates = require('../lib/dates');
const settings = require('../lib/settings');
const { insertItems } = require('./transactions');
const { HttpError, wrap, toInt, requireInt, requireText } = require('./util');

const router = express.Router();
const STATUSES = ['booked', 'deposit', 'done'];
const PARTS = ['手', '足'];

const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v, label) => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new HttpError(400, `${label}不正確`);
  return n;
};

async function nailSettings(client) {
  const cfg = await settings.get(client, 'nail', null);
  if (!cfg) throw new HttpError(400, '請先到美甲頁完成設定（收入分類、入帳帳戶、收入袋）');
  return cfg;
}

// =====================================================================
// 總覽
// =====================================================================

router.get('/nail/overview', wrap(async (req, res) => {
  const today = dates.today();
  const month = `${today.slice(0, 7)}-01`;
  const result = await tx(async (client) => {
    const cfg = await settings.get(client, 'nail', null);
    const { rows: stats } = await client.query(
      `SELECT COALESCE(SUM(amount) FILTER (WHERE status = 'done'), 0)::BIGINT AS income,
              COUNT(*) FILTER (WHERE status = 'done')::INT AS done_count,
              COUNT(DISTINCT customer_id) FILTER (WHERE status = 'done')::INT AS customers
       FROM nail_services WHERE service_date >= $1::date AND service_date < ($1::date + INTERVAL '1 month')`,
      [month]
    );
    const { rows: newCustomers } = await client.query(
      `SELECT COUNT(*)::INT AS n FROM nail_customers c
       WHERE (SELECT MIN(service_date) FROM nail_services s WHERE s.customer_id = c.id AND s.status = 'done')
             >= $1::date
         AND (SELECT MIN(service_date) FROM nail_services s WHERE s.customer_id = c.id AND s.status = 'done')
             < ($1::date + INTERVAL '1 month')`,
      [month]
    );
    const { rows: todayList } = await client.query(
      `SELECT s.*, c.name AS customer_name FROM nail_services s LEFT JOIN nail_customers c ON c.id = s.customer_id
       WHERE s.service_date = $1 ORDER BY s.service_time NULLS LAST, s.id`,
      [today]
    );
    const { rows: upcoming } = await client.query(
      `SELECT s.*, c.name AS customer_name FROM nail_services s LEFT JOIN nail_customers c ON c.id = s.customer_id
       WHERE s.service_date > $1 AND s.status <> 'done' ORDER BY s.service_date, s.service_time NULLS LAST LIMIT 5`,
      [today]
    );
    const { rows: low } = await client.query(
      `SELECT * FROM v_nail_stock WHERE NOT archived AND remaining <= low_threshold ORDER BY remaining, name LIMIT 6`
    );
    let bag = null;
    if (cfg && cfg.bag_account_id) {
      const { rows } = await client.query(
        `SELECT a.name, b.balance FROM accounts a JOIN v_account_balances b ON b.id = a.id WHERE a.id = $1`, [cfg.bag_account_id]
      );
      bag = rows[0] || null;
    }
    return {
      configured: Boolean(cfg),
      rate: cfg ? Number(cfg.rate) || 10 : 10,
      month_income: stats[0].income,
      month_done: stats[0].done_count,
      month_customers: stats[0].customers,
      new_customers: newCustomers[0].n,
      bag_name: bag ? bag.name : null,
      bag_balance: bag ? bag.balance : null,
      today: todayList,
      upcoming,
      low_stock: low,
    };
  });
  res.json(result);
}));

// =====================================================================
// 客戶
// =====================================================================

router.get('/nail/customers', wrap(async (req, res) => {
  const q = text(req.query.q);
  const { rows } = await query(
    `SELECT c.*,
       COUNT(s.id) FILTER (WHERE s.status = 'done')::INT AS visits,
       COALESCE(SUM(s.amount) FILTER (WHERE s.status = 'done'), 0)::BIGINT AS total,
       MAX(s.service_date) FILTER (WHERE s.status = 'done') AS last_visit
     FROM nail_customers c LEFT JOIN nail_services s ON s.customer_id = c.id
     ${q ? 'WHERE c.name ILIKE $1 OR c.phone ILIKE $1' : ''}
     GROUP BY c.id ORDER BY MAX(s.service_date) DESC NULLS LAST, c.name`,
    q ? [`%${q}%`] : []
  );
  res.json(rows);
}));

router.get('/nail/customers/:id', wrap(async (req, res) => {
  const id = requireInt(req.params.id, '客戶 id');
  const { rows } = await query(
    `SELECT c.*,
       (SELECT COUNT(*) FROM nail_services s WHERE s.customer_id = c.id AND s.status = 'done')::INT AS visits,
       (SELECT COALESCE(SUM(amount), 0) FROM nail_services s WHERE s.customer_id = c.id AND s.status = 'done')::BIGINT AS total,
       (SELECT MAX(service_date) FROM nail_services s WHERE s.customer_id = c.id AND s.status = 'done') AS last_visit
     FROM nail_customers c WHERE c.id = $1`,
    [id]
  );
  if (!rows[0]) throw new HttpError(404, '找不到這位客戶');
  const { rows: services } = await query(
    'SELECT * FROM nail_services WHERE customer_id = $1 ORDER BY service_date DESC, service_time DESC NULLS LAST, id DESC', [id]
  );
  res.json({ ...rows[0], services });
}));

function readCustomer(b) {
  return {
    name: requireText(b.name, '姓名'),
    phone: text(b.phone),
    birthday: dates.isDate(b.birthday) ? b.birthday : null,
    note: text(b.note),
  };
}

router.post('/nail/customers', wrap(async (req, res) => {
  const c = readCustomer(req.body);
  const { rows } = await query(
    'INSERT INTO nail_customers (name, phone, birthday, note) VALUES ($1, $2, $3, $4) RETURNING *',
    [c.name, c.phone, c.birthday, c.note]
  );
  res.status(201).json(rows[0]);
}));

router.put('/nail/customers/:id', wrap(async (req, res) => {
  const id = requireInt(req.params.id, '客戶 id');
  const c = readCustomer(req.body);
  const { rows } = await query(
    'UPDATE nail_customers SET name = $2, phone = $3, birthday = $4, note = $5 WHERE id = $1 RETURNING *',
    [id, c.name, c.phone, c.birthday, c.note]
  );
  if (!rows[0]) throw new HttpError(404, '找不到這位客戶');
  res.json(rows[0]);
}));

// 刪除客戶：with_services=1 時連同施做紀錄與對應收入一起刪除，否則施做紀錄保留（不再連到客戶）
router.delete('/nail/customers/:id', wrap(async (req, res) => {
  const id = requireInt(req.params.id, '客戶 id');
  const withServices = req.query.with_services === '1';
  const result = await tx(async (client) => {
    let services = 0;
    if (withServices) {
      const { rows } = await client.query('DELETE FROM nail_services WHERE customer_id = $1 RETURNING transaction_id', [id]);
      services = rows.length;
      const txIds = rows.map((r) => r.transaction_id).filter(Boolean);
      if (txIds.length) await client.query('DELETE FROM transactions WHERE id = ANY($1::int[])', [txIds]);
    }
    const r = await client.query('DELETE FROM nail_customers WHERE id = $1', [id]);
    if (!r.rowCount) throw new HttpError(404, '找不到這位客戶');
    return { services };
  });
  res.json(result);
}));

// =====================================================================
// 施做紀錄：施做完成時自動產生美甲收入
// =====================================================================

function readService(b) {
  const status = STATUSES.includes(b.status) ? b.status : 'booked';
  if (!dates.isDate(b.service_date)) throw new HttpError(400, '請選擇施做日期');
  const items = Array.isArray(b.items) ? b.items.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()).slice(0, 20) : [];
  return {
    customer_id: toInt(b.customer_id),
    service_date: b.service_date,
    service_time: /^\d{1,2}:\d{2}$/.test(b.service_time || '') ? b.service_time : null,
    part: PARTS.includes(b.part) ? b.part : null,
    items,
    extension_count: toInt(b.extension_count),
    amount: requireInt(b.amount ?? 0, '施做金額', { min: 0 }),
    deposit: toInt(b.deposit) || 0,
    account_id: toInt(b.account_id),
    status,
    note: text(b.note),
  };
}

// 讓收入交易跟施做紀錄一致
async function syncIncome(client, service) {
  const cfg = await nailSettings(client);
  const wantIncome = service.status === 'done' && service.amount > 0;
  if (!wantIncome) {
    if (service.transaction_id) {
      await client.query('UPDATE nail_services SET transaction_id = NULL WHERE id = $1', [service.id]);
      await client.query('DELETE FROM transactions WHERE id = $1', [service.transaction_id]);
    }
    return;
  }
  const accountId = service.account_id || cfg.source_account_id;
  let name = '';
  if (service.customer_id) {
    const { rows } = await client.query('SELECT name FROM nail_customers WHERE id = $1', [service.customer_id]);
    name = rows[0] ? rows[0].name : '';
  }
  const title = `${name || '客人'} 美甲`;
  const itemName = [service.part, ...(service.items || [])].filter(Boolean).join(' ') || '美甲';
  if (service.transaction_id) {
    await client.query(
      'UPDATE transactions SET txn_date = $2, account_id = $3, title = $4 WHERE id = $1',
      [service.transaction_id, service.service_date, accountId, title]
    );
    await client.query('DELETE FROM transaction_items WHERE transaction_id = $1', [service.transaction_id]);
    await insertItems(client, service.transaction_id, [{ name: itemName, unit_price: service.amount, quantity: 1, category_id: cfg.income_category_id }]);
  } else {
    const { rows } = await client.query(
      `INSERT INTO transactions (type, txn_date, account_id, title) VALUES ('income', $1, $2, $3) RETURNING id`,
      [service.service_date, accountId, title]
    );
    await insertItems(client, rows[0].id, [{ name: itemName, unit_price: service.amount, quantity: 1, category_id: cfg.income_category_id }]);
    await client.query('UPDATE nail_services SET transaction_id = $2 WHERE id = $1', [service.id, rows[0].id]);
  }
}

router.get('/nail/services', wrap(async (req, res) => {
  const params = [];
  const where = [];
  if (req.query.month && /^\d{4}-\d{2}$/.test(req.query.month)) {
    params.push(`${req.query.month}-01`);
    where.push(`s.service_date >= $${params.length}::date AND s.service_date < ($${params.length}::date + INTERVAL '1 month')`);
  }
  const { rows } = await query(
    `SELECT s.*, c.name AS customer_name FROM nail_services s LEFT JOIN nail_customers c ON c.id = s.customer_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY s.service_date DESC, s.service_time DESC NULLS LAST, s.id DESC LIMIT 300`,
    params
  );
  res.json(rows);
}));

router.get('/nail/services/:id', wrap(async (req, res) => {
  const id = requireInt(req.params.id, '施做 id');
  const { rows } = await query(
    `SELECT s.*, c.name AS customer_name FROM nail_services s LEFT JOIN nail_customers c ON c.id = s.customer_id WHERE s.id = $1`, [id]
  );
  if (!rows[0]) throw new HttpError(404, '找不到這筆施做紀錄');
  res.json(rows[0]);
}));

router.post('/nail/services', wrap(async (req, res) => {
  const s = readService(req.body);
  const row = await tx(async (client) => {
    if (!s.customer_id && text(req.body.new_customer_name)) {
      const { rows } = await client.query('INSERT INTO nail_customers (name) VALUES ($1) RETURNING id', [text(req.body.new_customer_name)]);
      s.customer_id = rows[0].id;
    }
    const { rows } = await client.query(
      `INSERT INTO nail_services (customer_id, service_date, service_time, part, items, extension_count, amount, deposit, account_id, status, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [s.customer_id, s.service_date, s.service_time, s.part, s.items, s.extension_count, s.amount, s.deposit, s.account_id, s.status, s.note]
    );
    await syncIncome(client, rows[0]);
    const { rows: fresh } = await client.query('SELECT * FROM nail_services WHERE id = $1', [rows[0].id]);
    return fresh[0];
  });
  res.status(201).json(row);
}));

router.put('/nail/services/:id', wrap(async (req, res) => {
  const id = requireInt(req.params.id, '施做 id');
  const s = readService(req.body);
  const row = await tx(async (client) => {
    if (!s.customer_id && text(req.body.new_customer_name)) {
      const { rows } = await client.query('INSERT INTO nail_customers (name) VALUES ($1) RETURNING id', [text(req.body.new_customer_name)]);
      s.customer_id = rows[0].id;
    }
    const { rows } = await client.query(
      `UPDATE nail_services SET customer_id = $2, service_date = $3, service_time = $4, part = $5, items = $6,
         extension_count = $7, amount = $8, deposit = $9, account_id = $10, status = $11, note = $12
       WHERE id = $1 RETURNING *`,
      [id, s.customer_id, s.service_date, s.service_time, s.part, s.items, s.extension_count, s.amount, s.deposit, s.account_id, s.status, s.note]
    );
    if (!rows[0]) throw new HttpError(404, '找不到這筆施做紀錄');
    await syncIncome(client, rows[0]);
    const { rows: fresh } = await client.query('SELECT * FROM nail_services WHERE id = $1', [id]);
    return fresh[0];
  });
  res.json(row);
}));

router.delete('/nail/services/:id', wrap(async (req, res) => {
  const id = requireInt(req.params.id, '施做 id');
  await tx(async (client) => {
    const { rows } = await client.query('DELETE FROM nail_services WHERE id = $1 RETURNING transaction_id', [id]);
    if (!rows[0]) throw new HttpError(404, '找不到這筆施做紀錄');
    if (rows[0].transaction_id) await client.query('DELETE FROM transactions WHERE id = $1', [rows[0].transaction_id]);
  });
  res.json({ ok: true });
}));

// =====================================================================
// 商品與庫存
// =====================================================================

router.get('/nail/products', wrap(async (req, res) => {
  const { rows } = await query(
    `SELECT * FROM v_nail_stock WHERE ${req.query.include_archived === '1' ? 'TRUE' : 'NOT archived'}
     ORDER BY (remaining <= low_threshold) DESC, brand NULLS LAST, name`
  );
  res.json(rows);
}));

function readProduct(b) {
  return {
    name: requireText(b.name, '商品名稱'),
    brand: text(b.brand),
    initial_qty: num(b.initial_qty, '原始數量') ?? 0,
    low_threshold: num(b.low_threshold, '提醒數量') ?? 1,
    expiry: text(b.expiry),
  };
}

router.post('/nail/products', wrap(async (req, res) => {
  const p = readProduct(req.body);
  const { rows } = await query(
    `INSERT INTO nail_products (name, brand, initial_qty, low_threshold, expiry) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [p.name, p.brand, p.initial_qty, p.low_threshold, p.expiry]
  );
  res.status(201).json(rows[0]);
}));

router.put('/nail/products/:id', wrap(async (req, res) => {
  const id = requireInt(req.params.id, '商品 id');
  if (req.body.archived !== undefined && Object.keys(req.body).length === 1) {
    await query('UPDATE nail_products SET archived = $2 WHERE id = $1', [id, Boolean(req.body.archived)]);
    return res.json({ ok: true });
  }
  const p = readProduct(req.body);
  const { rows } = await query(
    `UPDATE nail_products SET name = $2, brand = $3, initial_qty = $4, low_threshold = $5, expiry = $6 WHERE id = $1 RETURNING *`,
    [id, p.name, p.brand, p.initial_qty, p.low_threshold, p.expiry]
  );
  if (!rows[0]) throw new HttpError(404, '找不到這個商品');
  res.json(rows[0]);
}));

// 刪除商品：有進貨紀錄的商品不能刪，請改用「不再追蹤」
router.delete('/nail/products/:id', wrap(async (req, res) => {
  const id = requireInt(req.params.id, '商品 id');
  const { rows } = await query('SELECT 1 FROM nail_purchase_items WHERE product_id = $1 LIMIT 1', [id]);
  if (rows.length) throw new HttpError(400, '這個商品有進貨紀錄，不能刪除，可以改用「不再追蹤」');
  const r = await query('DELETE FROM nail_products WHERE id = $1', [id]);
  if (!r.rowCount) throw new HttpError(404, '找不到這個商品');
  res.json({ ok: true });
}));

router.get('/nail/products/:id/usage', wrap(async (req, res) => {
  const id = requireInt(req.params.id, '商品 id');
  const [usage, purchases] = await Promise.all([
    query('SELECT * FROM nail_usage WHERE product_id = $1 ORDER BY use_date DESC, id DESC LIMIT 100', [id]),
    query(
      `SELECT pi.*, p.purchase_date, p.vendor FROM nail_purchase_items pi JOIN nail_purchases p ON p.id = pi.purchase_id
       WHERE pi.product_id = $1 ORDER BY p.purchase_date DESC, pi.id DESC LIMIT 100`, [id]
    ),
  ]);
  res.json({ usage: usage.rows, purchases: purchases.rows });
}));

// 拿取
router.post('/nail/usage', wrap(async (req, res) => {
  const productId = requireInt(req.body.product_id, '商品');
  const qty = num(req.body.quantity, '數量');
  if (!(qty > 0)) throw new HttpError(400, '數量必須大於 0');
  const { rows } = await query(
    `INSERT INTO nail_usage (product_id, use_date, user_name, quantity, note) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [productId, dates.isDate(req.body.use_date) ? req.body.use_date : dates.today(), text(req.body.user_name), qty, text(req.body.note)]
  );
  res.status(201).json(rows[0]);
}));

router.delete('/nail/usage/:id', wrap(async (req, res) => {
  await query('DELETE FROM nail_usage WHERE id = $1', [requireInt(req.params.id, '紀錄 id')]);
  res.json({ ok: true });
}));

// =====================================================================
// 進貨：庫存增加，並記一筆美甲材料支出
// =====================================================================

router.get('/nail/purchases', wrap(async (req, res) => {
  const { rows } = await query(
    `SELECT p.*, a.name AS account_name,
       COALESCE(json_agg(json_build_object('product_id', pi.product_id, 'name', pr.name, 'brand', pr.brand,
         'unit_price', pi.unit_price, 'quantity', pi.quantity) ORDER BY pi.id) FILTER (WHERE pi.id IS NOT NULL), '[]') AS items,
       COALESCE(SUM(pi.unit_price * pi.quantity), 0)::BIGINT AS total
     FROM nail_purchases p
     LEFT JOIN accounts a ON a.id = p.account_id
     LEFT JOIN nail_purchase_items pi ON pi.purchase_id = p.id
     LEFT JOIN nail_products pr ON pr.id = pi.product_id
     GROUP BY p.id, a.name ORDER BY p.purchase_date DESC, p.id DESC LIMIT 100`
  );
  res.json(rows);
}));

router.post('/nail/purchases', wrap(async (req, res) => {
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  if (!items.length) throw new HttpError(400, '至少要有一個商品');
  const date = dates.isDate(req.body.purchase_date) ? req.body.purchase_date : dates.today();
  const result = await tx(async (client) => {
    const cfg = await nailSettings(client);
    const accountId = toInt(req.body.account_id) || cfg.bag_account_id;
    const vendor = text(req.body.vendor) || '';
    const lines = [];
    for (const it of items) {
      let productId = toInt(it.product_id);
      if (!productId) {
        const name = requireText(it.name, '商品名稱');
        const { rows } = await client.query(
          'INSERT INTO nail_products (name, brand) VALUES ($1, $2) RETURNING id', [name, text(it.brand)]
        );
        productId = rows[0].id;
      }
      const { rows: pr } = await client.query('SELECT name, brand FROM nail_products WHERE id = $1', [productId]);
      if (!pr[0]) throw new HttpError(400, '找不到商品');
      const quantity = num(it.quantity, '數量');
      if (!(quantity > 0)) throw new HttpError(400, '數量必須大於 0');
      lines.push({ productId, name: pr[0].name, brand: pr[0].brand, unit_price: requireInt(it.unit_price, '單價', { min: 0 }), quantity });
    }
    const { rows: tr } = await client.query(
      `INSERT INTO transactions (type, txn_date, account_id, title) VALUES ('expense', $1, $2, $3) RETURNING id`,
      [date, accountId, vendor ? `美甲進貨｜${vendor}` : '美甲進貨']
    );
    await insertItems(client, tr[0].id, lines.map((l, idx) => ({
      name: [l.brand, l.name].filter(Boolean).join(' '),
      unit_price: l.unit_price,
      quantity: l.quantity,
      category_id: cfg.tool_category_id || null,
      sort_order: idx,
    })));
    // 信用卡付款時，歸到帳單期別
    const { rows: acc } = await client.query('SELECT * FROM accounts WHERE id = $1', [accountId]);
    if (acc[0] && acc[0].kind === 'credit_card') {
      const statements = require('../lib/statements');
      const st = await statements.forDate(client, acc[0], date);
      await client.query('UPDATE transactions SET statement_id = $2 WHERE id = $1', [tr[0].id, st.id]);
    }
    const { rows: p } = await client.query(
      `INSERT INTO nail_purchases (vendor, purchase_date, account_id, transaction_id, note) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [vendor, date, accountId, tr[0].id, text(req.body.note)]
    );
    for (const l of lines) {
      await client.query(
        'INSERT INTO nail_purchase_items (purchase_id, product_id, unit_price, quantity) VALUES ($1, $2, $3, $4)',
        [p[0].id, l.productId, l.unit_price, l.quantity]
      );
    }
    return { id: p[0].id, total: lines.reduce((s, l) => s + Math.round(l.unit_price * l.quantity), 0) };
  });
  res.status(201).json(result);
}));

router.delete('/nail/purchases/:id', wrap(async (req, res) => {
  const id = requireInt(req.params.id, '進貨 id');
  await tx(async (client) => {
    const { rows } = await client.query('DELETE FROM nail_purchases WHERE id = $1 RETURNING transaction_id', [id]);
    if (!rows[0]) throw new HttpError(404, '找不到這筆進貨');
    if (rows[0].transaction_id) await client.query('DELETE FROM transactions WHERE id = $1', [rows[0].transaction_id]);
  });
  res.json({ ok: true });
}));

module.exports = router;
