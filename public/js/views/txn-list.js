import { api } from '../api.js';
import { money, monthLabel, shiftMonth, todayStr, icon, txnRow, groupByDate, dateLabel } from '../ui.js';

export default {
  async render(el, params, query, alive) {
    const month = /^\d{4}-\d{2}$/.test(query.month || '') ? query.month : todayStr().slice(0, 7);
    const txns = await api.get(`/transactions?month=${month}`);
    if (!alive()) return;
    // 分期的購買紀錄只是參考，不影響餘額，列表裡隱藏；未來才入帳的分期也先不顯示
    const today = todayStr();
    const visible = txns.filter((t) => t.affects_balance && t.txn_date <= today);
    const out = visible.filter((t) => t.type === 'expense').reduce((s, t) => s + t.total, 0);
    const inc = visible.filter((t) => t.type === 'income').reduce((s, t) => s + t.total, 0);
    const groups = groupByDate(visible);

    el.innerHTML = `
      <div class="page-head">
        <a class="icon-btn" href="#/transactions?month=${shiftMonth(month, -1)}" aria-label="上個月">${icon('back', 20, 2)}</a>
        <h1 style="font-size:20px">${monthLabel(month)}</h1>
        <a class="icon-btn" href="#/transactions?month=${shiftMonth(month, 1)}" aria-label="下個月">${icon('next', 20, 2)}</a>
      </div>
      <div class="grid-2">
        <div class="panel stack" style="gap:2px"><span class="muted small">支出</span><span class="num" style="font-size:20px;font-weight:700">${money(out)}</span></div>
        <div class="panel stack" style="gap:2px"><span class="muted small">收入</span><span class="num blue" style="font-size:20px;font-weight:700">${money(inc)}</span></div>
      </div>
      ${visible.length ? `<div class="list">
        ${groups.map((g) => `<div class="list-date">${dateLabel(g.date)}</div>${g.items.map(txnRow).join('')}`).join('')}
      </div>` : '<div class="panel empty">這個月沒有交易</div>'}`;
  },
};
