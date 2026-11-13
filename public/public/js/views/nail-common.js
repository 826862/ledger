import { esc, money, icon, md } from '../ui.js';

export const STATUS = { booked: '預約成功', deposit: '已付訂金', done: '施做完成' };
export const ITEMS = ['卸甲', '單色', '跳色', '貓眼', '造型', '延甲', '補甲', '基礎保養', '深層保養', '卸甲不續作'];

export function nailTabs(active) {
  return `<nav class="subtabs" aria-label="美甲分頁">
    ${[['home', '#/nail', '總覽'], ['customers', '#/nail/customers', '客戶'], ['purchases', '#/nail/purchases', '進貨'], ['stock', '#/nail/stock', '庫存']]
      .map(([k, h, l]) => `<a href="${h}" ${k === active ? 'aria-current="page"' : ''}>${l}</a>`).join('')}
  </nav>`;
}

export function serviceRow(s, { showDate = false, showName = true } = {}) {
  const what = [s.part, ...(s.items || [])].filter(Boolean).join(' ').replace(/延甲/, s.extension_count ? `延甲 ×${s.extension_count}` : '延甲');
  return `<a class="list-row" href="#/nail/service/${s.id}">
    <span class="num" style="width:${showDate ? 52 : 46}px;font-weight:700;font-size:14px;flex-shrink:0">${showDate ? md(s.service_date) : esc(s.service_time || '—')}</span>
    <div class="body"><span class="title">${showName ? esc(s.customer_name || '未指定客戶') : esc(what || '美甲')}</span>
      <span class="meta">${showName ? `${esc(what || '美甲')} · ` : ''}${money(s.amount)}${showDate && s.service_time ? ` · ${esc(s.service_time)}` : ''}</span></div>
    <span class="status ${s.status}">${STATUS[s.status]}</span>
  </a>`;
}

export function productRow(p, { action = true } = {}) {
  const total = Number(p.initial_qty) + Number(p.purchased_qty);
  const left = Number(p.remaining);
  const low = left <= Number(p.low_threshold);
  const pct = total > 0 ? Math.max(0, Math.min(100, Math.round((left / total) * 100))) : 0;
  const color = low ? '#C2410C' : '#15803D';
  return `<div class="stack" style="gap:6px;padding:11px 0" data-product="${p.id}">
    <div class="row" style="gap:10px">
      <button type="button" class="body" data-edit-product="${p.id}" style="border:0;background:none;padding:0;text-align:left;color:inherit;flex:1;min-width:0;display:flex;flex-direction:column;gap:2px">
        <span style="font-weight:500">${esc(p.name)}</span>
        <span class="small muted">${[p.brand, p.expiry ? `有效至 ${p.expiry}` : ''].filter(Boolean).map(esc).join(' · ') || '　'}</span>
      </button>
      <span class="num" style="font-weight:700;color:${color}">剩 ${Number(left)}</span>
      ${action ? `<button type="button" class="btn ghost small" data-use="${p.id}" style="min-height:36px;padding:0 12px">拿取</button>` : ''}
    </div>
    <div class="progress" aria-hidden="true"><div style="width:${pct}%;background:${color}"></div></div>
    <span class="small muted">共 ${total}（原有 ${Number(p.initial_qty)}＋進貨 ${Number(p.purchased_qty)}）· 已拿取 ${Number(p.used_qty)}</span>
  </div>`;
}

export const setupHint = `<div class="note blue">先到總覽完成美甲設定（收入分類、入帳帳戶、收入袋），施做完成和進貨才能自動記帳。<a href="#/nail">前往設定</a></div>`;

export { icon };
