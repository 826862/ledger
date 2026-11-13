import { api, invalidate } from '../api.js';
import { esc, money, md, backHead, showError, toast } from '../ui.js';

export default {
  async render(el, params, query, alive) {
    const list = await api.get('/transactions?pending_review=1');
    if (!alive()) return;

    if (!list.length) {
      el.innerHTML = `${backHead('核對自動扣款', '#/')}<div class="panel empty">沒有待核對的自動扣款。</div>`;
      return;
    }

    el.innerHTML = `
      ${backHead('核對自動扣款', '#/')}
      <span class="muted small">對照銀行 App 的扣款明細。金額正確就按「正確」；不對的話改成實際扣款金額再按「正確」。</span>
      <div class="list" id="list">
        ${list.map((t) => {
          const from = t.type === 'transfer' ? `${esc(t.account_name)} → ${esc(t.to_account_name)}` : `${esc(t.account_name)} · 支出`;
          return `<div class="stack" style="gap:8px;padding:14px 0" data-id="${t.id}">
            <div class="spread"><span style="font-weight:500">${esc(t.title)}</span><span class="muted small">${md(t.txn_date)}</span></div>
            <span class="muted small">${from}</span>
            <div class="row" style="gap:8px">
              <label class="sr" for="amt-${t.id}" style="position:absolute;left:-9999px">實際扣款金額</label>
              <input id="amt-${t.id}" class="input num" inputmode="numeric" pattern="[0-9]*" value="${t.total}" style="flex:1;min-height:44px">
              <button type="button" class="btn small" data-confirm="${t.id}">正確</button>
            </div>
          </div>`;
        }).join('')}
      </div>
      <div class="action-bar"><button class="btn" id="all">全部正確（${list.length} 筆，共 ${money(list.reduce((s, t) => s + t.total, 0))}）</button></div>`;

    const confirmOne = async (id) => {
      const t = list.find((x) => x.id === id);
      const amount = Number(el.querySelector(`#amt-${id}`).value);
      await api.post(`/transactions/${id}/confirm`, amount && amount !== t.total ? { amount } : {});
    };

    el.querySelector('#list').addEventListener('click', async (e) => {
      const b = e.target.closest('[data-confirm]');
      if (!b) return;
      b.disabled = true;
      try {
        await confirmOne(Number(b.dataset.confirm));
        invalidate('accounts');
        toast('已核對');
        this.render(el, params, query, alive);
      } catch (err) { b.disabled = false; showError(err); }
    });

    el.querySelector('#all').addEventListener('click', async (e) => {
      e.target.disabled = true;
      try {
        for (const t of list) await confirmOne(t.id);
        invalidate('accounts');
        toast('全部核對完成');
        location.hash = '#/';
      } catch (err) { e.target.disabled = false; showError(err); }
    });
  },
};
