// 日期一律用 'YYYY-MM-DD' 字串處理，避免時區問題

function pad(n) {
  return String(n).padStart(2, '0');
}

function parse(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return { y, m, d };
}

function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

// 產生日期，日超過當月天數時取月底（例如 31 日在 2 月 → 28/29 日）
function make(y, m, d) {
  while (m > 12) { m -= 12; y += 1; }
  while (m < 1) { m += 12; y -= 1; }
  return `${y}-${pad(m)}-${pad(Math.min(d, daysInMonth(y, m)))}`;
}

function addDays(dateStr, n) {
  const { y, m, d } = parse(dateStr);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

// 台灣時間的今天
function today() {
  const t = new Date(Date.now() + 8 * 3600000);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

function isDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

module.exports = { parse, make, addDays, today, isDate, daysInMonth };
