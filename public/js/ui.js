// 共用小工具

export function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function money(n) {
  return Math.round(Number(n) || 0).toLocaleString('zh-TW');
}

export function signed(n) {
  const v = Math.round(Number(n) || 0);
  return `${v < 0 ? '−' : v > 0 ? '+' : ''}${money(Math.abs(v))}`;
}

export function todayStr() {
  const t = new Date();
  const p = (x) => String(x).padStart(2, '0');
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`;
}

export function md(dateStr) {
  if (!dateStr) return '';
  const [, m, d] = dateStr.split('-');
  return `${Number(m)}/${Number(d)}`;
}

export function monthLabel(ym) {
  const [y, m] = ym.split('-');
  return `${y} 年 ${Number(m)} 月`;
}

export function shiftMonth(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function daysUntil(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const target = new Date(y, m - 1, d);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target - today) / 86400000);
}

let toastTimer;
export function toast(message, { error = false } = {}) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.classList.toggle('error', error);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

export function showError(err) {
  if (err && err.status === 401) return;
  toast(err && err.message ? err.message : '發生錯誤', { error: true });
}

// 讓按鈕在送出期間不能重複按
export async function busy(button, fn) {
  if (!button) return fn();
  const label = button.innerHTML;
  button.disabled = true;
  try {
    return await fn();
  } finally {
    button.disabled = false;
    button.innerHTML = label;
  }
}

// 線條 icon
const PATHS = {
  home: '<path d="M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z"/>',
  wallet: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M16 14.5h2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  pie: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5V12h8.5"/>',
  sliders: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  next: '<path d="M9 5l7 7-7 7"/>',
  bank: '<path d="M3 10l9-6 9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18"/>',
  card: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h3"/>',
  cart: '<path d="M3 4h2l2.4 11h11.2L21 8H7"/><circle cx="10" cy="19.5" r="1.3"/><circle cx="17" cy="19.5" r="1.3"/>',
  arrows: '<path d="M4 12h16M14 6l6 6-6 6"/>',
  income: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  up: '<path d="M6 15l6-6 6 6"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  adjust: '<path d="M12 3v18M5 8h14M7 16h10"/>',
};

export function icon(name, size = 20, stroke = 1.8) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">${PATHS[name] || ''}</svg>`;
}

export const SWATCHES = ['#1E3A8A', '#2563EB', '#93C5FD', '#0F766E', '#9A3412', '#EA580C', '#FDBA74', '#5B6170'];

export function backHead(title, backHref, extra = '') {
  return `<div class="page-head center">
    <a class="icon-btn plain" href="${backHref}" aria-label="返回">${icon('back', 22, 2)}</a>
    <h1>${title}</h1>
    ${extra || '<span style="width:44px"></span>'}
  </div>`;
}

export function segmented(name, options, value, extraClass = '') {
  return `<div class="segmented ${extraClass}" role="group" data-seg="${name}">
    ${options.map(([v, label]) => `<button type="button" data-value="${esc(v)}" aria-pressed="${v === value}">${esc(label)}</button>`).join('')}
  </div>`;
}

export function bindSegmented(root, name, onChange) {
  const seg = root.querySelector(`[data-seg="${name}"]`);
  if (!seg) return;
  seg.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-value]');
    if (!b) return;
    seg.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    onChange(b.dataset.value);
  });
}

// 交易列表的一列
export function txnRow(t) {
  const isTransfer = t.type === 'transfer';
  const isIncome = t.type === 'income';
  const cats = [...new Set(t.items.map((i) => i.category_name).filter(Boolean))];
  const iconName = isTransfer ? 'arrows' : isIncome ? 'income' : t.type === 'adjustment' ? 'adjust' : t.installment_id ? 'card' : t.items.length > 1 ? 'cart' : 'list';
  const box = isTransfer ? 'card' : '';
  let meta;
  if (isTransfer) meta = `轉帳 · ${esc(t.account_name)} → ${esc(t.to_account_name)}`;
  else if (t.type === 'adjustment') meta = `餘額校正 · ${esc(t.account_name)}`;
  else if (t.installment_no) meta = `分期第 ${t.installment_no} 期入帳 · ${esc(t.account_name)}`;
  else if (t.installment_id) meta = `分期購買紀錄（不影響餘額） · ${esc(t.account_name)}`;
  else {
    const parts = [];
    if (t.items.length > 1) parts.push(`${t.items.length} 個品項`);
    if (cats.length) parts.push(cats.map(esc).join('、'));
    parts.push(esc(t.account_name));
    meta = parts.join(' · ');
  }
  const amount = isTransfer ? money(t.total) : t.type === 'adjustment' ? signed(t.total) : isIncome ? `+${money(t.total)}` : `−${money(t.total)}`;
  const color = isIncome ? 'blue' : isTransfer ? 'muted' : '';
  const title = t.title || (t.items[0] && t.items[0].name) || (isTransfer ? '轉帳' : '未命名');
  const href = t.installment_id || t.type === 'adjustment' ? '' : `href="#/txn/${t.id}"`;
  const tag = href ? 'a' : 'div';
  return `<${tag} class="list-row" ${href}>
    <div class="icon-box ${box}">${icon(iconName)}</div>
    <div class="body"><span class="title">${esc(title)}</span><span class="meta">${meta}</span></div>
    <span class="amount ${color}">${amount}</span>
  </${tag}>`;
}

// 依日期分組
export function groupByDate(txns) {
  const groups = [];
  for (const t of txns) {
    let g = groups[groups.length - 1];
    if (!g || g.date !== t.txn_date) { g = { date: t.txn_date, items: [] }; groups.push(g); }
    g.items.push(t);
  }
  return groups;
}

export function dateLabel(dateStr) {
  const diff = daysUntil(dateStr);
  if (diff === 0) return `今天 ${md(dateStr)}`;
  if (diff === -1) return `昨天 ${md(dateStr)}`;
  return md(dateStr);
}
