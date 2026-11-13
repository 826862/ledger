const express = require('express');
const ExcelJS = require('exceljs');
const { query } = require('../db');
const dates = require('../lib/dates');
const { HttpError, wrap } = require('./util');

const router = express.Router();
const TYPE = { expense: '支出', income: '收入', transfer: '轉帳', adjustment: '校正' };
const STATUS = { booked: '預約成功', deposit: '已付訂金', done: '施做完成' };

function csvCell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function itemRows(from, to) {
  const { rows } = await query(
    `SELECT t.txn_date, t.type, t.title, a.name AS account, a2.name AS to_account,
            i.name AS item, c.name AS category, p.name AS project, i.unit_price, i.quantity,
            COALESCE(i.amount, t.amount) AS amount, i.is_advance, i.advance_person, t.note
     FROM transactions t
     JOIN accounts a ON a.id = t.account_id
     LEFT JOIN accounts a2 ON a2.id = t.to_account_id
     LEFT JOIN transaction_items i ON i.transaction_id = t.id
     LEFT JOIN categories c ON c.id = i.category_id
     LEFT JOIN projects p ON p.id = i.project_id
     WHERE t.affects_balance AND t.txn_date >= $1 AND t.txn_date <= $2
     ORDER BY t.txn_date, t.id, i.sort_order, i.id`,
    [from, to]
  );
  return rows.map((r) => ({
    日期: r.txn_date, 類型: TYPE[r.type] || r.type, 標題: r.title, 帳戶: r.account, 轉入帳戶: r.to_account || '',
    明細: r.item || '', 類別: r.category || '', 專項: r.project || '', 單價: r.unit_price ?? '', 數量: r.quantity ?? '',
    金額: r.amount, 代墊: r.is_advance ? '是' : '', 代墊對象: r.advance_person || '', 備註: r.note || '',
  }));
}

router.get('/export', wrap(async (req, res) => {
  const from = dates.isDate(req.query.from) ? req.query.from : null;
  const to = dates.isDate(req.query.to) ? req.query.to : null;
  if (!from || !to || from > to) throw new HttpError(400, '匯出區間不正確');
  const format = req.query.format === 'csv' ? 'csv' : 'xlsx';
  const parts = new Set(String(req.query.parts || 'txns').split(','));
  const name = `記帳本_${from}_${to}`;

  const txns = await itemRows(from, to);
  if (format === 'csv') {
    const headers = Object.keys(txns[0] || { 日期: '', 類型: '', 標題: '', 帳戶: '', 轉入帳戶: '', 明細: '', 類別: '', 專項: '', 單價: '', 數量: '', 金額: '', 代墊: '', 代墊對象: '', 備註: '' });
    const body = [headers.join(','), ...txns.map((r) => headers.map((h) => csvCell(r[h])).join(','))].join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}.csv`);
    return res.send('\uFEFF' + body);
  }

  const wb = new ExcelJS.Workbook();
  const addSheet = (title, rows, widths = {}) => {
    const ws = wb.addWorksheet(title);
    const headers = Object.keys(rows[0] || { 說明: '' });
    ws.columns = headers.map((h) => ({ header: h, key: h, width: widths[h] || Math.max(10, h.length * 2 + 4) }));
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    if (rows.length) ws.addRows(rows); else ws.addRow({ [headers[0]]: '這段期間沒有資料' });
    return ws;
  };

  if (parts.has('txns')) addSheet('交易明細', txns, { 標題: 20, 明細: 20, 備註: 20 });

  if (parts.has('cats')) {
    const { rows } = await query(
      `SELECT to_char(month, 'YYYY-MM') AS month, type, COALESCE(category_name, '未分類') AS category, amount, txn_count, share_pct
       FROM v_monthly_category WHERE month >= date_trunc('month', $1::date) AND month <= $2::date
       ORDER BY month, type, amount DESC`,
      [from, to]
    );
    addSheet('類別統計', rows.map((r) => ({ 月份: r.month, 類型: TYPE[r.type], 類別: r.category, 金額: r.amount, 筆數: r.txn_count, 佔比: `${r.share_pct}%` })));
  }

  if (parts.has('budget')) {
    const { rows } = await query(
      `SELECT to_char(m.month, 'YYYY-MM') AS month, c.name, COALESCE(o.amount, b.amount) AS budget, COALESCE(v.amount, 0) AS spent
       FROM generate_series(date_trunc('month', $1::date), $2::date, INTERVAL '1 month') AS m(month)
       CROSS JOIN categories c
       LEFT JOIN budgets b ON b.category_id = c.id
       LEFT JOIN budget_overrides o ON o.category_id = c.id AND o.month = m.month::date
       LEFT JOIN v_monthly_category v ON v.category_id = c.id AND v.month = m.month::date AND v.type = 'expense'
       WHERE c.kind = 'expense' AND COALESCE(o.amount, b.amount) IS NOT NULL
       ORDER BY m.month, c.sort_order`,
      [from, to]
    );
    addSheet('預算', rows.map((r) => ({ 月份: r.month, 類別: r.name, 預算: r.budget, 已花: r.spent, 剩餘: r.budget - r.spent })));
  }

  if (parts.has('advances')) {
    const { rows } = await query(
      `SELECT t.txn_date, t.title, i.advance_person, i.amount, i.advance_settled_on
       FROM transaction_items i JOIN transactions t ON t.id = i.transaction_id
       WHERE i.is_advance AND t.type = 'expense' AND t.txn_date >= $1 AND t.txn_date <= $2 ORDER BY t.txn_date`,
      [from, to]
    );
    addSheet('代墊', rows.map((r) => ({ 日期: r.txn_date, 消費: r.title, 對象: r.advance_person || '', 金額: r.amount, 收回日期: r.advance_settled_on || '未收回' })));
  }

  if (parts.has('nail')) {
    const { rows: svc } = await query(
      `SELECT s.service_date, s.service_time, c.name, s.part, s.items, s.amount, s.status
       FROM nail_services s LEFT JOIN nail_customers c ON c.id = s.customer_id
       WHERE s.service_date >= $1 AND s.service_date <= $2 ORDER BY s.service_date, s.service_time`,
      [from, to]
    );
    addSheet('美甲施做', svc.map((r) => ({ 日期: r.service_date, 時間: r.service_time || '', 客戶: r.name || '', 部位: r.part || '', 項目: (r.items || []).join('、'), 金額: r.amount, 狀態: STATUS[r.status] })));
    const { rows: pur } = await query(
      `SELECT p.purchase_date, p.vendor, pr.brand, pr.name, pi.unit_price, pi.quantity
       FROM nail_purchase_items pi JOIN nail_purchases p ON p.id = pi.purchase_id JOIN nail_products pr ON pr.id = pi.product_id
       WHERE p.purchase_date >= $1 AND p.purchase_date <= $2 ORDER BY p.purchase_date`,
      [from, to]
    );
    addSheet('美甲進貨', pur.map((r) => ({ 日期: r.purchase_date, 店家: r.vendor, 品牌: r.brand || '', 商品: r.name, 單價: r.unit_price, 數量: r.quantity, 小計: Math.round(r.unit_price * r.quantity) })));
  }

  if (!wb.worksheets.length) addSheet('交易明細', txns);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}.xlsx`);
  await wb.xlsx.write(res);
  res.end();
}));

module.exports = router;
