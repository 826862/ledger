class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function toInt(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

function requireInt(v, label, { min = null } = {}) {
  const n = toInt(v);
  if (n === null) throw new HttpError(400, `${label} 必須是整數`);
  if (min !== null && n < min) throw new HttpError(400, `${label} 不能小於 ${min}`);
  return n;
}

function requireText(v, label) {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) throw new HttpError(400, `請填寫${label}`);
  return s;
}

module.exports = { HttpError, wrap, toInt, requireInt, requireText };
