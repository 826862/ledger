import { api } from '../api.js';
import { esc, money, md, icon } from '../ui.js';

function depositRow(a) {
  return `<a class="list-row" href="#/accounts/${a.id}/edit">
    <div class="icon-box">${icon('bank')}</div>
    <div class="body"><span class="title">${esc(a.name)}</span><span class="meta">存款帳戶</span></div>
    <span class="amount">${money(a.balance)}</span>
  </a>`;
}

function cardRow(a) {
  const cur = a.current_statement;
  const due = a.due_statement;
  const meta = cur ? `本期已刷 ${money(cur.recorded_amount)} · 結帳 ${md(cur.period_end)}` : '';
  return `<div class="stack" style="padding:12px 0;gap:10px">
    <a class="row" href="#/accounts/${a.id}/edit" style="color:inherit">
      <div class="icon-box card">${icon('card')}</div>
      <div class="body" style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px">
        <span class="title" style="font-weight:500">${esc(a.name)}</span>
        <span class="meta small muted">${meta}</span>
      </div>
      <span class="amount orange num" style="font-weight:700">${money(a.balance)}</span>
    </a>
    ${due ? `<div class="note" style="padding:8px 12px">上期帳單 ${money(due.statement_amount ?? due.recorded_amount)} 尚未記錄繳款，截止 ${md(due.due_date)}</div>` : ''}
    <div class="row" style="justify-content:flex-end;gap:8px">
      ${due ? `<a class="pill-btn" href="#/statements/${due.id}">上期帳單</a>` : ''}
      <a class="pill-btn" href="#/accounts/${a.id}/bill">本期帳單</a>
    </div>
  </div>`;
}

export default {
  async render(el, params, query, alive) {
    const list = await api.accounts();
    if (!alive()) return;
    const deposits = list.filter((a) => a.kind === 'deposit');
    const cards = list.filter((a) => a.kind === 'credit_card');
    const depTotal = deposits.reduce((s, a) => s + a.balance, 0);
    const cardTotal = cards.reduce((s, a) => s + a.balance, 0);

    el.innerHTML = `
      <div class="page-head">
        <h1>帳戶</h1>
        <a class="icon-btn" href="#/accounts/new" aria-label="新增帳戶">${icon('plus', 22, 2)}</a>
      </div>

      <div class="net-card">
        <div class="stack" style="gap:4px">
          <span class="label">淨資產（存款 − 信用卡未繳）</span>
          <span class="big-number">NT$ ${money(depTotal - cardTotal)}</span>
        </div>
        <div class="grid-2">
          <div class="stack" style="gap:2px"><span class="label small">存款</span><span class="num" style="font-size:17px;font-weight:700;color:#BFD0FF">${money(depTotal)}</span></div>
          <div class="stack" style="gap:2px"><span class="label small">信用卡未繳</span><span class="num" style="font-size:17px;font-weight:700;color:#FDBA74">${money(cardTotal)}</span></div>
        </div>
      </div>

      <section class="stack">
        <div class="spread"><h2 class="section blue">存款帳戶</h2><span class="num" style="font-weight:700">${money(depTotal)}</span></div>
        ${deposits.length ? `<div class="list">${deposits.map(depositRow).join('')}</div>`
          : `<div class="panel empty">還沒有存款帳戶。<br><a href="#/accounts/new?kind=deposit">新增存款帳戶</a></div>`}
      </section>

      <section class="stack">
        <div class="spread"><h2 class="section orange">信用卡</h2><span class="num orange" style="font-weight:700">未繳 ${money(cardTotal)}</span></div>
        ${cards.length ? `<div class="list">${cards.map(cardRow).join('')}</div>`
          : `<div class="panel empty">還沒有信用卡。<br><a href="#/accounts/new?kind=credit_card">新增信用卡</a></div>`}
      </section>`;
  },
};
