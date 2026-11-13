import { api } from '../api.js';
import { esc, money, monthLabel, shiftMonth, todayStr, icon, segmented, bindSegmented } from '../ui.js';

const R = 70;
const C = 2 * Math.PI * R;

function donut(cats, total, label) {
  let offset = 0;
  const gap = cats.length > 1 ? 2 : 0;
  const arcs = cats.map((c) => {
    const len = (c.amount / total) * C;
    const arc = `<circle cx="100" cy="100" r="${R}" fill="none" stroke="${esc(c.category_color)}" stroke-width="28"
      stroke-dasharray="${Math.max(len - gap, 0.1).toFixed(2)} ${C.toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}"></circle>`;
    offset += len;
    return arc;
  }).join('');
  const desc = cats.map((c) => `${c.category_name} ${c.share_pct}%`).join('、');
  return `<div class="donut">
    <svg width="200" height="200" viewBox="0 0 200 200" role="img" aria-label="${esc(desc)}">
      <circle cx="100" cy="100" r="${R}" fill="none" stroke="#EEF0F3" stroke-width="28"></circle>
      <g transform="rotate(-90 100 100)">${arcs}</g>
    </svg>
    <div class="center"><span class="muted small">${label}</span><span class="num" style="font-size:22px;font-weight:700">${money(total)}</span></div>
  </div>`;
}

export default {
  async render(el, params, query, alive) {
    const month = /^\d{4}-\d{2}$/.test(query.month || '') ? query.month : todayStr().slice(0, 7);
    const type = query.type === 'income' ? 'income' : 'expense';
    const data = await api.get(`/reports/monthly?month=${month}&type=${type}`);
    if (!alive()) return;
    const cats = data.categories;
    const label = type === 'income' ? '本月收入' : '本月支出';

    el.innerHTML = `
      <div class="page-head">
        <a class="icon-btn" href="#/report?month=${shiftMonth(month, -1)}&type=${type}" aria-label="上個月">${icon('back', 20, 2)}</a>
        <h1 style="font-size:20px">${monthLabel(month)}</h1>
        <a class="icon-btn" href="#/report?month=${shiftMonth(month, 1)}&type=${type}" aria-label="下個月">${icon('next', 20, 2)}</a>
      </div>
      ${segmented('type', [['expense', '支出'], ['income', '收入']], type)}
      ${cats.length ? `
        <div class="panel">${donut(cats, data.total, label)}</div>
        <div class="list">
          ${cats.map((c) => `
            <div class="stack" style="gap:6px;padding:12px 0">
              <div class="row" style="gap:10px">
                <span class="dot" style="background:${esc(c.category_color)}"></span>
                <span style="flex:1;font-weight:500">${esc(c.category_name)} <span class="muted small" style="font-weight:400">${c.txn_count} 筆</span></span>
                <span class="muted num" style="font-size:13px;width:48px;text-align:right">${Math.round(c.share_pct)}%</span>
                <span class="num" style="font-weight:700;width:72px;text-align:right">${money(c.amount)}</span>
              </div>
              <div class="bar-track" aria-hidden="true"><div style="width:${c.share_pct}%;background:${esc(c.category_color)}"></div></div>
            </div>`).join('')}
        </div>` : `<div class="panel empty">${monthLabel(month)}沒有${type === 'income' ? '收入' : '支出'}紀錄</div>`}`;

    bindSegmented(el, 'type', (v) => { location.hash = `#/report?month=${month}&type=${v}`; });
  },
};
