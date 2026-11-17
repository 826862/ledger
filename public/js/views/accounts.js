import { api } from '../api.js';
import { esc, money, md, icon, accountBadge, makeSortable, HANDLE, showError } from '../ui.js';
import { invalidate } from '../api.js';

// 隱藏餘額：預設隱藏的帳戶在這次瀏覽中點眼睛才顯示
let revealed = new Set();
const isHidden = (a) => a.hide_balance && !revealed.has(a.id);
const amountText = (a, text, cls = '') => (isHidden(a)
  ? `<span class="amount num masked ${cls}">••••</span>`
  : `<span class="amount num ${cls}">${text}</span>`);
const eyeBtn = (a) => (a.hide_balance
  ? `<button type="button" class="eye-btn" data-eye="${a.id}" aria-label="${isHidden(a) ? '顯示' : '隱藏'}${esc(a.name)}餘額">${icon(isHidden(a) ? 'eyeoff' : 'eye', 18)}</button>`
  : '');

function depositRow(a) {
  return `<div class="row" data-sort-id="${a.id}" style="gap:4px">
    <a class="list-row" href="#/accounts/${a.id}/edit" style="flex:1;min-width:0">
      ${accountBadge(a)}
      <div class="body"><span class="title">${esc(a.name)}</span><span class="meta">${a.is_cash ? '現金' : '存款帳戶'}</span></div>
      ${amountText(a, money(a.balance))}
    </a>${eyeBtn(a)}${HANDLE}
  </div>`;
}

function cardRow(a) {
  const cur = a.current_statement;
  const due = a.due_statement;
  const meta = cur ? `本期已刷 ${money(cur.recorded_amount)} · 結帳 ${md(cur.period_end)}` : '';
  let dueNote = '';
  if (due) {
    const amount = money(due.statement_amount ?? due.recorded_amount);
    if (a.autopay_account_id && due.status === 'reconciled') {
      dueNote = `<div class="note blue" style="padding:8px 12px">上期 ${amount} 已對帳，${md(due.due_date)} 會從${esc(a.autopay_account_name)}自動扣繳</div>`;
    } else if (a.autopay_account_id) {
      dueNote = `<div class="note" style="padding:8px 12px">上期帳單還沒對帳，對帳後才會自動扣繳（截止 ${md(due.due_date)}）</div>`;
    } else {
      dueNote = `<div class="note" style="padding:8px 12px">上期帳單 ${amount} 尚未記錄繳款，截止 ${md(due.due_date)}</div>`;
    }
  }
  return `<div class="stack" style="padding:12px 0;gap:10px" data-sort-id="${a.id}">
    <div class="row" style="gap:4px"><a class="row" href="#/accounts/${a.id}/edit" style="color:inherit;flex:1;min-width:0">
      ${accountBadge(a)}
      <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px">
        <span style="font-weight:500">${esc(a.name)}</span>
        <span class="small muted">${meta}</span>
        ${a.autopay_account_name ? `<span class="small muted">自動扣繳：${esc(a.autopay_account_name)}</span>` : ''}
      </div>
      ${amountText(a, money(a.balance), 'orange')}
    </a>${eyeBtn(a)}${HANDLE}</div>
    ${dueNote}
    <div class="row" style="justify-content:flex-end;gap:8px">
      ${due ? `<a class="pill-btn" href="#/statements/${due.id}">上期帳單</a>` : ''}
      <a class="pill-btn" href="#/accounts/${a.id}/bill">本期帳單</a>
    </div>
  </div>`;
}

function loanRow(a) {
  const meta = [];
  if (a.loan_payment) meta.push(`每月 ${money(a.loan_payment)}`);
  return `<div class="stack" style="padding:12px 0;gap:10px" data-sort-id="${a.id}">
    <div class="row" style="gap:4px"><a class="row" href="#/accounts/${a.id}/edit" style="color:inherit;flex:1;min-width:0">
      ${accountBadge(a)}
      <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px">
        <span style="font-weight:500">${esc(a.name)}</span>
        <span class="small muted">${meta.join(' · ') || '剩餘本金'}</span>
        ${a.autopay_account_name && a.loan_next_date ? `<span class="small muted">下次 ${md(a.loan_next_date)} 從${esc(a.autopay_account_name)}自動扣款</span>` : ''}
      </div>
      ${amountText(a, money(a.balance))}
    </a>${eyeBtn(a)}${HANDLE}</div>
    <div class="row" style="justify-content:flex-end;gap:8px">
      <a class="pill-btn" href="#/accounts/${a.id}/edit" style="color:#334155;border-color:#CBD5E1">更新剩餘本金</a>
      <a class="pill-btn" href="#/accounts/${a.id}/loan-pay" style="color:#334155;border-color:#CBD5E1">記錄繳款</a>
    </div>
  </div>`;
}

export default {
  async render(el, params, query, alive) {
    const list = await api.accounts();
    if (!alive()) return;
    const deposits = list.filter((a) => a.kind === 'deposit');
    const cards = list.filter((a) => a.kind === 'credit_card');
    const loans = list.filter((a) => a.kind === 'loan');
    const depTotal = deposits.reduce((s, a) => s + a.balance, 0);
    const cardTotal = cards.reduce((s, a) => s + a.balance, 0);
    const loanTotal = loans.reduce((s, a) => s + a.balance, 0);

    revealed = new Set();
    const draw = () => {
      const anyHidden = list.some(isHidden);
      const secHidden = (arr) => arr.some(isHidden);
      const mask = (hidden, text) => (hidden ? '<span class="masked">••••</span>' : text);
      el.innerHTML = `
      <div class="page-head">
        <h1>帳戶</h1>
        <div class="row" style="gap:8px">
          ${list.some((a) => a.hide_balance) ? `<button type="button" class="btn ghost small" id="toggle-all" style="min-height:40px">${icon(anyHidden ? 'eye' : 'eyeoff', 16)}${anyHidden ? '全部顯示' : '全部隱藏'}</button>` : ''}
          <a class="icon-btn" href="#/accounts/new" aria-label="新增帳戶">${icon('plus', 22, 2)}</a>
        </div>
      </div>

      <div class="net-card">
        <div class="stack" style="gap:4px">
          <span class="label">淨資產（存款 − 信用卡未繳${loans.length ? ' − 貸款' : ''}）</span>
          <span class="big-number">${anyHidden ? '<span style="letter-spacing:3px;opacity:.7">••••••</span>' : `NT$ ${money(depTotal - cardTotal - loanTotal)}`}</span>
          ${anyHidden ? '<span class="label small">有隱藏的帳戶時，總額也一起隱藏</span>' : ''}
        </div>
        <div class="${loans.length ? 'grid-3' : 'grid-2'}">
          <div class="stack" style="gap:2px"><span class="label small">存款</span><span class="num" style="font-size:17px;font-weight:700;color:#BFD0FF">${mask(secHidden(deposits), money(depTotal))}</span></div>
          <div class="stack" style="gap:2px"><span class="label small">信用卡未繳</span><span class="num" style="font-size:17px;font-weight:700;color:#FDBA74">${mask(secHidden(cards), money(cardTotal))}</span></div>
          ${loans.length ? `<div class="stack" style="gap:2px"><span class="label small">貸款</span><span class="num" style="font-size:17px;font-weight:700;color:#E2E8F0">${mask(secHidden(loans), money(loanTotal))}</span></div>` : ''}
        </div>
      </div>

      <section class="stack">
        <div class="spread"><h2 class="section blue">存款帳戶</h2><span class="num" style="font-weight:700">${mask(secHidden(deposits), money(depTotal))}</span></div>
        ${deposits.length ? `<div class="list" data-sortable>${deposits.map(depositRow).join('')}</div>`
          : `<div class="panel empty">還沒有存款帳戶。<br><a href="#/accounts/new?kind=deposit">新增存款帳戶</a></div>`}
      </section>

      <section class="stack">
        <div class="spread"><h2 class="section orange">信用卡</h2><span class="num orange" style="font-weight:700">未繳 ${mask(secHidden(cards), money(cardTotal))}</span></div>
        ${cards.length ? `<div class="list" data-sortable>${cards.map(cardRow).join('')}</div>`
          : `<div class="panel empty">還沒有信用卡。<br><a href="#/accounts/new?kind=credit_card">新增信用卡</a></div>`}
      </section>

      <section class="stack">
        <div class="spread"><h2 class="section" style="color:#334155">貸款</h2>${loans.length ? `<span class="num" style="font-weight:700">剩餘 ${mask(secHidden(loans), money(loanTotal))}</span>` : ''}</div>
        ${loans.length ? `<div class="list" data-sortable>${loans.map(loanRow).join('')}</div>`
          : `<div class="panel empty">學貸、車貸等貸款可以在這裡追蹤剩餘本金。<br><a href="#/accounts/new?kind=loan">新增貸款</a></div>`}
      </section>`;

      el.querySelectorAll('[data-sortable]').forEach((l) => makeSortable(l, async () => {
        const ids = [...el.querySelectorAll('[data-sortable] > [data-sort-id]')].map((r) => Number(r.dataset.sortId));
        try {
          await api.post('/accounts/reorder', { ids });
          invalidate('accounts');
        } catch (err) { showError(err); }
      }));
      el.querySelectorAll('[data-eye]').forEach((b) => b.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id = Number(b.dataset.eye);
        if (revealed.has(id)) revealed.delete(id); else revealed.add(id);
        draw();
      }));
      const all = el.querySelector('#toggle-all');
      if (all) all.addEventListener('click', () => {
        if (list.some(isHidden)) list.forEach((a) => { if (a.hide_balance) revealed.add(a.id); });
        else revealed.clear();
        draw();
      });
    };
    draw();
  },
};
