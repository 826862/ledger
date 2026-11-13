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
  check: '<path d="M5 12l5 5 9-10"/>',
  sparkle: '<path d="M12 3l1.8 4.6L18.5 9l-4.7 1.6L12 15l-1.8-4.4L5.5 9l4.7-1.4z"/><path d="M18 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  people: '<circle cx="9" cy="8" r="3"/><path d="M3 19c0-3 2.7-5 6-5s6 2 6 5"/><circle cx="17" cy="9" r="2.5"/><path d="M15.5 14.2c2.9.2 5.5 1.9 5.5 4.8"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  box: '<path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  truck: '<path d="M3 6h11v10H3zM14 10h4l3 3v3h-7"/><circle cx="7" cy="18" r="1.6"/><circle cx="17" cy="18" r="1.6"/>',
  image: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 8"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4-4"/>',
  cash: '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/>',
  loan: '<path d="M4 20h16M6 20V10M10 20V10M14 20V10M18 20V10M3 10l9-6 9 6"/>',
  down2: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  up2: '<path d="M12 19V5M6 11l6-6 6 6"/>',
};

export function icon(name, size = 20, stroke = 1.8) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">${PATHS[name] || ''}</svg>`;
}

export const KIND_LABEL = { deposit: '', credit_card: '（信用卡）', loan: '（貸款）' };

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
  const cats = [...new Set(t.items.filter((i) => !i.is_advance).map((i) => i.category_name).filter(Boolean))];
  const iconName = isTransfer ? 'arrows' : isIncome ? 'income' : t.type === 'adjustment' ? 'adjust' : t.installment_id ? 'card' : t.items.length > 1 ? 'cart' : 'list';
  const box = isTransfer ? 'card' : '';
  let meta;
  if (isTransfer) meta = `轉帳 · ${esc(t.account_name)} → ${esc(t.to_account_name)}`;
  else if (t.type === 'adjustment') meta = `餘額校正 · ${esc(t.account_name)}`;
  else if (t.installment_no) meta = `分期第 ${t.installment_no} 期入帳 · ${esc(t.account_name)}`;
  else if (t.installment_id) meta = `分期購買紀錄（不影響餘額） · ${esc(t.account_name)}`;
  else {
    const parts = [];
    const adv = t.items.filter((i) => i.is_advance);
    if (t.type === 'income' && adv.length && adv.length === t.items.length) {
      parts.push('收回代墊');
    } else {
      if (t.items.length > 1) parts.push(`${t.items.length} 個品項`);
      if (cats.length) parts.push(cats.map(esc).join('、'));
      if (adv.length) parts.push(`含代墊 ${money(adv.reduce((x, i) => x + i.amount, 0))}`);
    }
    if (t.project_name) parts.push(`#${esc(t.project_name)}`);
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
    <div class="body"><span style="display:flex;align-items:center;gap:6px;min-width:0"><span class="title">${esc(title)}</span>${t.pending_review ? '<span class="badge review" style="margin:0;flex-shrink:0">待核對</span>' : ''}</span><span class="meta">${meta}</span></div>
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

// ---------------------------------------------------------------------
// 帳戶圖示
// ---------------------------------------------------------------------
const KIND_ICON = { deposit: 'bank', credit_card: 'card', loan: 'loan' };
export const ICON_CHOICES = ['bank', 'card', 'cash', 'wallet', 'loan', 'sparkle', 'folder', 'people'];

function hexToRgba(hex, a) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return `rgba(29,78,216,${a})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export function accountBadge(a, size = 40) {
  const color = a.color || '#1D4ED8';
  const r = Math.round(size * 0.3);
  const base = `width:${size}px;height:${size}px;border-radius:${r}px;flex-shrink:0;display:flex;align-items:center;justify-content:center;overflow:hidden`;
  const type = a.icon_type || 'auto';
  if (type === 'image' && a.icon_image) {
    return `<span style="${base};background:#fff"><img src="${esc(a.icon_image)}" alt="" style="width:100%;height:100%;object-fit:cover"></span>`;
  }
  if (type === 'emoji' && a.icon_value) {
    return `<span style="${base};background:${hexToRgba(color, 0.14)};font-size:${Math.round(size * 0.5)}px" aria-hidden="true">${esc(a.icon_value)}</span>`;
  }
  if (type === 'text') {
    const t = (a.icon_value || a.name || '').slice(0, 2);
    return `<span style="${base};background:${esc(color)};color:#fff;font-size:${Math.round(size * (t.length > 1 ? 0.3 : 0.42))}px;font-weight:700" aria-hidden="true">${esc(t)}</span>`;
  }
  const name = type === 'icon' && a.icon_value ? a.icon_value : a.is_cash ? 'cash' : KIND_ICON[a.kind] || 'bank';
  return `<span style="${base};background:${hexToRgba(color, 0.14)};color:${esc(color)}">${icon(name, Math.round(size * 0.5))}</span>`;
}

// ---------------------------------------------------------------------
// 滾輪選單（年／月）
// ---------------------------------------------------------------------
const ROW_H = 40;

function wheelColumn(values, selectedIndex, label) {
  const col = document.createElement('div');
  col.className = 'wheel-col';
  col.setAttribute('role', 'listbox');
  col.setAttribute('aria-label', label);
  col.tabIndex = 0;
  col.innerHTML = `<div style="height:${ROW_H * 2}px"></div>${values.map((v, i) => `<div class="wheel-item" role="option" data-i="${i}">${esc(v.label)}</div>`).join('')}<div style="height:${ROW_H * 2}px"></div>`;
  const state = { index: selectedIndex };
  const highlight = () => col.querySelectorAll('.wheel-item').forEach((el, i) => {
    el.classList.toggle('on', i === state.index);
    el.setAttribute('aria-selected', String(i === state.index));
  });
  let t;
  col.addEventListener('scroll', () => {
    clearTimeout(t);
    t = setTimeout(() => {
      state.index = Math.max(0, Math.min(values.length - 1, Math.round(col.scrollTop / ROW_H)));
      highlight();
    }, 60);
  });
  col.addEventListener('click', (e) => {
    const it = e.target.closest('.wheel-item');
    if (it) col.scrollTo({ top: Number(it.dataset.i) * ROW_H, behavior: 'smooth' });
  });
  col.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const i = Math.max(0, Math.min(values.length - 1, state.index + (e.key === 'ArrowDown' ? 1 : -1)));
      col.scrollTo({ top: i * ROW_H });
    }
  });
  requestAnimationFrame(() => { col.scrollTop = selectedIndex * ROW_H; highlight(); });
  return { el: col, value: () => values[state.index].value };
}

// 回傳 'YYYY-MM'；mode = 'year' 時回傳 'YYYY'
export function pickPeriod(current, { mode = 'month', title } = {}) {
  return new Promise((resolve) => {
    const now = new Date();
    const thisYear = now.getFullYear();
    const [cy, cm] = String(current).split('-').map(Number);
    const years = [];
    for (let y = thisYear - 6; y <= thisYear + 1; y++) years.push({ value: y, label: `${y} 年` });
    const months = Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: `${i + 1} 月` }));
    const dlg = document.createElement('dialog');
    dlg.className = 'sheet';
    const thisYm = `${thisYear}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const lastYm = shiftMonth(thisYm, -1);
    dlg.innerHTML = `<div class="stack" style="gap:14px">
      <div class="spread" style="align-items:center">
        <button type="button" class="link-btn" data-act="cancel" style="color:var(--muted)">取消</button>
        <strong>${title || (mode === 'year' ? '選擇年份' : '選擇月份')}</strong>
        <button type="button" class="link-btn" data-act="ok" style="font-weight:700">確定</button>
      </div>
      ${mode === 'month' ? `<div class="chips">
        <button type="button" class="chip" data-quick="${thisYm}">本月</button>
        <button type="button" class="chip" data-quick="${lastYm}">上個月</button>
        <button type="button" class="chip" data-quick="${cy - 1}-${String(cm).padStart(2, '0')}">去年同月</button>
      </div>` : ''}
      <div class="wheel"><div class="wheel-band"></div></div>
    </div>`;
    document.body.appendChild(dlg);
    const wheel = dlg.querySelector('.wheel');
    const yi = Math.max(0, years.findIndex((y) => y.value === (cy || thisYear)));
    const yc = wheelColumn(years, yi, '年份');
    wheel.appendChild(yc.el);
    let mc = null;
    if (mode === 'month') {
      mc = wheelColumn(months, (cm || 1) - 1, '月份');
      wheel.appendChild(mc.el);
    }
    const finish = (val) => { dlg.close(); dlg.remove(); resolve(val); };
    dlg.addEventListener('click', (e) => {
      const q = e.target.closest('[data-quick]');
      if (q) return finish(q.dataset.quick);
      const act = e.target.closest('[data-act]');
      if (!act) return;
      if (act.dataset.act === 'cancel') return finish(null);
      const y = yc.value();
      finish(mode === 'year' ? String(y) : `${y}-${String(mc.value()).padStart(2, '0')}`);
    });
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); finish(null); });
    dlg.showModal();
  });
}

// 左右箭頭＋可點的期間按鈕
export function periodBar(label) {
  return `<div class="period-bar">
    <button type="button" class="icon-btn" data-period="-1" aria-label="上一期">${icon('back', 18, 2)}</button>
    <button type="button" class="period-btn" data-period="pick">${esc(label)}<span aria-hidden="true">▾</span></button>
    <button type="button" class="icon-btn" data-period="1" aria-label="下一期">${icon('next', 18, 2)}</button>
  </div>`;
}

export function bindPeriodBar(root, { value, mode = 'month', go }) {
  root.querySelectorAll('[data-period]').forEach((b) => b.addEventListener('click', async () => {
    const d = b.dataset.period;
    if (d === 'pick') {
      const v = await pickPeriod(value, { mode });
      if (v) go(v);
    } else if (mode === 'year') {
      go(String(Number(value) + Number(d)));
    } else {
      go(shiftMonth(value, Number(d)));
    }
  }));
}

// ---------------------------------------------------------------------
// 拖曳排序：按住右側把手立刻拖；按住整列 0.3 秒也可以拖
// ---------------------------------------------------------------------
export function makeSortable(container, onDrop) {
  let drag = null;
  const rows = () => [...container.querySelectorAll(':scope > [data-sort-id]')];

  const start = (row, e) => {
    const rect = row.getBoundingClientRect();
    const ph = document.createElement('div');
    ph.className = 'sort-placeholder';
    ph.style.height = `${rect.height}px`;
    row.after(ph);
    row.classList.add('sorting');
    row.style.width = `${rect.width}px`;
    row.style.left = `${rect.left}px`;
    row.style.top = `${rect.top}px`;
    drag = { row, ph, offset: e.clientY - rect.top, pointerId: e.pointerId, before: rows().map((r) => r.dataset.sortId).join(',') };
    row.dataset.dragged = '1';
    try { row.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    if (navigator.vibrate) navigator.vibrate(10);
  };

  const move = (e) => {
    if (!drag) return;
    e.preventDefault();
    drag.row.style.top = `${e.clientY - drag.offset}px`;
    const others = rows().filter((r) => r !== drag.row);
    let before = null;
    for (const r of others) {
      const b = r.getBoundingClientRect();
      if (e.clientY < b.top + b.height / 2) { before = r; break; }
    }
    if (before) container.insertBefore(drag.ph, before);
    else container.appendChild(drag.ph);
  };

  const end = () => {
    if (!drag) return;
    const { row, ph } = drag;
    ph.replaceWith(row);
    row.classList.remove('sorting');
    row.style.width = row.style.left = row.style.top = '';
    const changed = drag.before !== rows().map((r) => r.dataset.sortId).join(',');
    drag = null;
    if (changed) onDrop(rows().map((r) => Number(r.dataset.sortId)));
  };

  let holdTimer = null;
  let startPoint = null;
  container.addEventListener('pointerdown', (e) => {
    const row = e.target.closest('[data-sort-id]');
    if (!row || row.parentElement !== container) return;
    if (e.target.closest('[data-handle]')) {
      e.preventDefault();
      start(row, e);
      return;
    }
    startPoint = { x: e.clientX, y: e.clientY };
    holdTimer = setTimeout(() => { holdTimer = null; start(row, e); }, 300);
  });
  container.addEventListener('pointermove', (e) => {
    if (holdTimer && startPoint && Math.hypot(e.clientX - startPoint.x, e.clientY - startPoint.y) > 8) {
      clearTimeout(holdTimer);
      holdTimer = null;
    }
    move(e);
  }, { passive: false });
  const cancelHold = () => { if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; } };
  container.addEventListener('pointerup', () => { cancelHold(); end(); });
  container.addEventListener('pointercancel', () => { cancelHold(); end(); });
  // 拖曳結束時不要觸發點擊
  container.addEventListener('click', (e) => {
    const row = e.target.closest('[data-sort-id]');
    if (row && row.dataset.dragged) { e.preventDefault(); e.stopPropagation(); delete row.dataset.dragged; }
  }, true);
  container.addEventListener('touchmove', (e) => { if (drag) e.preventDefault(); }, { passive: false });
}

export const HANDLE = `<span data-handle class="drag-handle" aria-label="按住拖曳排序" role="button" tabindex="-1">${'<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>'}</span>`;

// 最近用過的顏色
export function recentColors(add) {
  let list = [];
  try { list = JSON.parse(localStorage.getItem('ledger:recentColors') || '[]'); } catch { list = []; }
  if (add) {
    list = [add, ...list.filter((c) => c.toLowerCase() !== add.toLowerCase())].slice(0, 8);
    try { localStorage.setItem('ledger:recentColors', JSON.stringify(list)); } catch { /* ignore */ }
  }
  return list;
}

// 圖片縮成正方形 PNG data URL
export function resizeImage(file, size = 96) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('讀不到這張圖片'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('不支援這種圖片格式'));
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = c.height = size;
        const ctx = c.getContext('2d');
        const s = Math.min(img.width, img.height);
        ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
        resolve(c.toDataURL('image/png'));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
