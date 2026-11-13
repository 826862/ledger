import { api } from '../api.js';
import { esc, money, md, txnRow, groupByDate, dateLabel, todayStr } from '../ui.js';

export default {
  async render(el, params, query, alive) {
    const [d, recent] = await Promise.all([
      api.get('/dashboard'),
      api.get('/transactions?limit=20&until_today=1'),
    ]);
    // 分期的購買紀錄不影響餘額，總覽只顯示真正的金流
    const recentShown = recent.filter((t) => t.affects_balance).slice(0, 12);
    if (!alive()) return;
    const [y, m] = d.today.split('-');
    const cats = d.month_categories;
    const top = cats.slice(0, 3);
    const groups = groupByDate(recentShown);

    el.innerHTML = `
      <div class="page-head">
        <div class="stack" style="gap:2px">
          <span class="muted small">${y} 年 ${Number(m)} 月</span>
          <h1>總覽</h1>
        </div>
        <a href="#/accounts" class="num" style="font-size:14px;font-weight:500;padding:10px 0">淨資產 NT$ ${money(d.net_worth)}</a>
      </div>

      <div class="grid-2">
        <a class="money-card deposit" href="#/accounts">
          <span class="label">存款餘額</span>
          <span class="value">${money(d.deposit_total)}</span>
          <span class="hint">${d.deposit_count} 個帳戶</span>
        </a>
        <a class="money-card card" href="#/accounts">
          <span class="label">信用卡未繳</span>
          <span class="value">${money(d.card_total)}</span>
          <span class="hint">${d.next_due ? `最近繳款日 ${md(d.next_due.due_date)}` : `${d.card_count} 張卡`}</span>
        </a>
      </div>

      <a class="panel stack" href="#/report" style="color:inherit;gap:12px">
        <div class="spread">
          <span class="muted" style="font-size:14px">本月支出</span>
          <span class="blue" style="font-size:13px;font-weight:500">看分類報表 ›</span>
        </div>
        <span class="big-number">NT$ ${money(d.month_expense)}</span>
        ${cats.length ? `
          <div class="stack-bar" aria-hidden="true">
            ${cats.map((c) => `<div style="flex:${c.amount};background:${esc(c.category_color)}"></div>`).join('')}
          </div>
          <div class="legend">
            ${top.map((c) => `<span><i class="dot" style="background:${esc(c.category_color)};width:8px;height:8px"></i>${esc(c.category_name)} ${Math.round(c.share_pct)}%</span>`).join('')}
          </div>` : '<span class="muted small">這個月還沒有支出</span>'}
      </a>

      <div class="stack">
        <div class="spread">
          <h2 class="section">最近交易</h2>
          <a href="#/transactions?month=${todayStr().slice(0, 7)}" style="font-size:14px;padding:8px 0">全部</a>
        </div>
        ${recentShown.length ? `<div class="list">
          ${groups.map((g) => `<div class="list-date">${dateLabel(g.date)}</div>${g.items.map(txnRow).join('')}`).join('')}
        </div>` : `<div class="panel empty">還沒有任何交易。先到「帳戶」新增存款帳戶和信用卡，再按下方的 ＋ 記第一筆。</div>`}
      </div>`;
  },
};
