const express = require('express');
const { query, tx } = require('../db');
const { HttpError, wrap, requireInt, requireText } = require('./util');

const router = express.Router();
const COLOR_RE = /^#[0-9A-Fa-f]{6}$/;

router.get('/', wrap(async (req, res) => {
  const params = [];
  const where = [];
  if (req.query.kind) { params.push(req.query.kind); where.push(`kind = $${params.length}`); }
  if (req.query.include_archived !== '1') where.push('NOT archived');
  const { rows } = await query(
    `SELECT * FROM categories ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY kind, sort_order, id`,
    params
  );
  res.json(rows);
}));

router.post('/', wrap(async (req, res) => {
  const name = requireText(req.body.name, '分類名稱');
  const kind = req.body.kind;
  if (!['expense', 'income'].includes(kind)) throw new HttpError(400, '分類類型不正確');
  const color = COLOR_RE.test(req.body.color || '') ? req.body.color : '#5B6170';
  const { rows } = await query(
    `INSERT INTO categories (name, kind, color, sort_order)
     VALUES ($1, $2, $3, COALESCE((SELECT MAX(sort_order) + 1 FROM categories WHERE kind = $2), 1))
     RETURNING *`,
    [name, kind, color]
  );
  res.status(201).json(rows[0]);
}));

router.put('/:id', wrap(async (req, res) => {
  const id = requireInt(req.params.id, '分類 id');
  const sets = [];
  const params = [id];
  if (req.body.name !== undefined) { params.push(requireText(req.body.name, '分類名稱')); sets.push(`name = $${params.length}`); }
  if (req.body.color !== undefined) {
    if (!COLOR_RE.test(req.body.color)) throw new HttpError(400, '顏色格式不正確');
    params.push(req.body.color); sets.push(`color = $${params.length}`);
  }
  if (req.body.archived !== undefined) { params.push(Boolean(req.body.archived)); sets.push(`archived = $${params.length}`); }
  if (!sets.length) throw new HttpError(400, '沒有要更新的欄位');
  const { rows } = await query(`UPDATE categories SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, params);
  if (!rows[0]) throw new HttpError(404, '找不到這個分類');
  res.json(rows[0]);
}));

// 依傳入的 id 順序重新排序
router.post('/reorder', wrap(async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.map(Number).filter(Number.isInteger) : [];
  if (!ids.length) throw new HttpError(400, '缺少排序資料');
  await tx(async (client) => {
    for (let i = 0; i < ids.length; i++) {
      await client.query('UPDATE categories SET sort_order = $2 WHERE id = $1', [ids[i], i + 1]);
    }
  });
  res.json({ ok: true });
}));

module.exports = router;
