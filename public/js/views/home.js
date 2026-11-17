import { api } from '../api.js';
import { esc, money, icon } from '../ui.js';

export default {
  async render(el, params, query, alive) {
    const [d, accounts] = await Promise.all([api.get('/dashboard'), api.accounts()]);
    if (!alive()) return;
    const [y, m] = d.today.split('-');
    const cats = d.month_categories;
    const top = cats.slice(0, 3);

    const cards = accounts.filter((a) => a.kind === 'credit_card');
    const loans = accounts.filter((a) => a.kind === 'loan');
    const cardHref = d.next_due ? `#/statements/${d.next_due.id}` : cards.length === 1 ? `#/accounts/${cards[0].id}/bill` : '#/accounts';
    const loanHref = loans.length === 1 ? `#/accounts/${loans[0].id}/loan-pay` : '#/accounts';

    el.innerHTML = `
      <div class="page-head">
        <div class="stack" style="gap:2px">
          <span class="muted small">${y} 年 ${Number(m)} 月</span>
          <h1>總覽</h1>
        </div>
      </div>

      ${d.pending_review ? `<a class="banner" href="#/review"><span>${d.pending_review} 筆自動扣款待核對</span><span>前往 ›</span></a>` : ''}

      ${cards.filter((c) => c.due_statement).map((c) => `<a class="banner" href="#/statements/${c.due_statement.id}"><span>${esc(c.name)} 上期帳單還沒繳 NT$ ${money(c.due_statement.statement_amount ?? c.due_statement.recorded_amount)}</span><span>前往 ›</span></a>`).join('')}

      <nav class="quick" aria-label="快速動作">
        <a href="#/add?type=transfer&preset=withdraw"><span class="icon-box">${icon('down2')}</span>提領現金</a>
        <a href="#/add?type=transfer&preset=deposit"><span class="icon-box">${icon('up2')}</span>存入現金</a>
        <a href="${cardHref}"><span class="icon-box card">${icon('card')}</span>繳卡費</a>
        <a href="${loanHref}"><span class="icon-box loan">${icon('loan')}</span>繳學貸</a>
      </nav>

      ${d.budget_total !== null || d.advances_total ? `<div class="grid-2">
        ${d.budget_total !== null ? `<a class="panel stack" href="#/budget" style="color:inherit;gap:4px;padding:14px">
          <span class="muted small">本月預算剩餘</span>
          <span class="num" style="font-size:20px;font-weight:700;color:${d.budget_total - d.budget_spent < 0 ? '#B42318' : 'var(--ink)'}">${d.budget_total - d.budget_spent < 0 ? '−' : ''}${money(Math.abs(d.budget_total - d.budget_spent))}</span>
          <span class="muted small">預算 ${money(d.budget_total)}</span>
        </a>` : '<a class="panel stack" href="#/budget" style="color:inherit;gap:4px;padding:14px"><span class="muted small">預算</span><span class="blue" style="font-weight:500">設定每月預算 ›</span></a>'}
        ${d.advances_total ? `<a class="panel stack" href="#/advances" style="color:inherit;gap:4px;padding:14px">
          <span class="muted small">代墊待收回</span>
          <span class="num" style="font-size:20px;font-weight:700;color:#6B21A8">${money(d.advances_total)}</span>
          <span class="muted small">${d.advances_people} 位</span>
        </a>` : ''}
      </div>` : ''}

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

      <span class="muted small" style="text-align:center">存款、信用卡餘額在「帳戶」；每筆交易在「明細」</span>
`;
  },
};
