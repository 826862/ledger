import { api } from '../api.js';
import { esc, money, md, monthLabel, todayStr, backHead, periodBar, bindPeriodBar } from '../ui.js';

export default {
  async render(el, params, query, alive) {
    const month = /^\d{4}-\d{2}$/.test(query.month || '') ? query.month : todayStr().slice(0, 7);
    const d = await api.get(`/reports/category?month=${month}&category_id=${params.cid}`);
    if (!alive()) return;
    const diff = d.amount - d.prev_amount;
    const max = Math.max(1, ...d.history.map((h) => h.amount));
    el.innerHTML = `
      ${backHead(esc(d.category.name), `#/report?tab=month&month=${month}${d.category.kind === 'income' ? '&type=income' : ''}`)}
      ${periodBar(monthLabel(month))}
      <div class="grid-3">
        <div class="panel stack" style="gap:2px;padding:10px 12px"><span class="muted small">本月</span><span class="num" style="font-size:17px;font-weight:700">${money(d.amount)}</span></div>
        <div class="panel stack" style="gap:2px;padding:10px 12px"><span class="muted small">比上月</span><span class="num ${diff > 0 ? 'up' : diff < 0 ? 'down' : ''}" style="font-size:17px;font-weight:700">${diff === 0 ? '持平' : `${diff > 0 ? '▲' : '▼'} ${money(Math.abs(diff))}`}</span></div>
        <div class="panel stack" style="gap:2px;padding:10px 12px"><span class="muted small">6 個月平均</span><span class="num" style="font-size:17px;font-weight:700">${money(d.average)}</span></div>
      </div>
      <div class="panel stack" style="gap:8px"><span class="muted small">近 6 個月</span>
        <div class="row" style="align-items:flex-end;gap:8px;height:110px">
          ${d.history.map((h) => `<a href="#/report/category/${params.cid}?month=${h.month}" style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:4px;height:100%;color:inherit">
            <span class="num" style="font-size:10px;color:var(--muted)">${money(h.amount)}</span>
            <div style="width:100%;max-width:28px;height:${Math.max(3, Math.round((h.amount / max) * 70))}px;background:${h.month === month ? esc(d.category.color) : '#D6D9DF'};border-radius:5px 5px 2px 2px"></div>
            <span class="small muted">${Number(h.month.slice(5))}月</span></a>`).join('')}
        </div>
      </div>
      <h2 class="section" style="font-size:15px">本月明細（${d.items.length}）</h2>
      ${d.items.length ? `<div class="list">${d.items.map((i) => `
        <a class="list-row" href="#/txn/${i.transaction_id}">
          <div class="body"><span class="title">${esc(i.title || i.name || '未命名')}${i.name && i.name !== i.title ? ` <span class="muted small">${esc(i.name)}</span>` : ''}</span>
            <span class="meta">${md(i.txn_date)} · ${esc(i.account_name)}${i.project_name ? ` · #${esc(i.project_name)}` : ''}</span></div>
          <span class="amount">${money(i.amount)}</span>
        </a>`).join('')}</div>` : '<div class="panel empty" style="padding:16px">這個月沒有這個類別的紀錄</div>'}
      <span class="muted small">金額只算你自己的部分，不含代墊。</span>`;
    bindPeriodBar(el, { value: month, go: (m) => { location.hash = `#/report/category/${params.cid}?month=${m}`; } });
  },
};
