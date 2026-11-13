import { api, invalidate } from '../api.js';
import { esc, money, md, icon, backHead, todayStr, busy, showError, toast } from '../ui.js';

export default {
  async render(el, params, query, alive) {
    const s = await api.get(`/statements/${params.sid}`);
    const [txns, categories] = await Promise.all([
      api.get(`/transactions?statement_id=${s.id}`),
      api.categories(),
    ]);
    if (!alive()) return;
    const back = `#/statements/${s.id}`;
    if (s.status === 'paid') {
      el.innerHTML = `${backHead('對帳', back)}<div class="panel empty">這期已經記錄繳款，不需要再對帳。</div>`;
      return;
    }

    const charges = txns.filter((t) => t.affects_balance && (t.type === 'expense' || t.type === 'income'));
    const fixed = charges.filter((t) => t.installment_id);
    const normal = charges.filter((t) => !t.installment_id);
    const expenseCats = categories.filter((c) => c.kind === 'expense');
    const feeCat = expenseCats.find((c) => c.name === '手續費');
    const signedTotal = (t) => (t.type === 'income' ? -t.total : t.total);

    const st = {
      amount: s.statement_amount ?? '',
      keep: new Set(normal.map((t) => t.id)),
      extras: [],
    };

    const confirmed = () =>
      fixed.reduce((sum, t) => sum + signedTotal(t), 0) +
      normal.filter((t) => st.keep.has(t.id)).reduce((sum, t) => sum + signedTotal(t), 0) +
      st.extras.reduce((sum, x) => sum + x.amount, 0);
    const diff = () => (st.amount === '' ? null : Number(st.amount) - confirmed());

    const summaryHtml = () => {
      const d = diff();
      return `
        <div class="stack" style="gap:2px"><span class="muted small">記錄＋補記</span><span class="num" style="font-size:17px;font-weight:700">${money(confirmed())}</span></div>
        <div class="stack" style="gap:2px"><span class="small ${d ? 'orange' : 'blue'}">${d === null ? '差額' : d === 0 ? '已對上' : d > 0 ? '還差' : '多記了'}</span>
          <span class="num ${d ? 'orange' : 'blue'}" style="font-size:17px;font-weight:700">${d === null ? '—' : money(Math.abs(d))}</span></div>`;
    };

    const extrasHtml = () => st.extras.map((x, i) => {
      const c = expenseCats.find((k) => k.id === x.category_id);
      return `<div class="list-row">
        <div class="body"><span class="title">${esc(x.title || '補記')}</span><span class="meta">${md(x.txn_date)} · ${c ? esc(c.name) : '未分類'} · 補記</span></div>
        <span class="amount">${money(x.amount)}</span>
        <button type="button" class="icon-btn plain" data-rm="${i}" aria-label="移除這筆補記">${icon('trash', 18)}</button>
      </div>`;
    }).join('');

    const refresh = () => {
      el.querySelector('#sum').innerHTML = summaryHtml();
      el.querySelector('#extras').innerHTML = extrasHtml() || '<div class="muted small" style="padding:14px 0">帳單上有、但你沒記到的（例如海外刷卡、自動扣款），在這裡補上。</div>';
      const d = diff();
      const quick = el.querySelector('#quick-fee');
      quick.hidden = !(feeCat && d !== null && d > 0 && d <= 500);
      quick.querySelector('span').textContent = d > 0 ? `剩下的 ${money(d)} 記為「國外交易手續費」` : '';
      const done = el.querySelector('#done');
      done.disabled = d !== 0;
      done.textContent = d === null ? '先輸入銀行帳單金額' : d === 0 ? '完成對帳' : '差額為 0 時可完成對帳';
    };

    el.innerHTML = `
      ${backHead(`對帳｜${esc(s.account_name)}`, back)}
      <span class="muted small" style="text-align:center;margin-top:-10px">${md(s.period_start)} – ${md(s.period_end)} 帳單</span>

      <div class="panel grid-3" style="gap:8px">
        <div class="stack" style="gap:2px">
          <label class="muted small" for="stmt">銀行帳單應繳</label>
          <input id="stmt" class="num" inputmode="numeric" pattern="[0-9]*" value="${esc(st.amount)}" placeholder="輸入金額"
            style="border:0;border-bottom:1.5px solid var(--border);padding:2px 0;font-size:17px;font-weight:700;background:transparent;width:100%">
        </div>
        <div style="display:contents" id="sum">${summaryHtml()}</div>
      </div>

      ${fixed.length ? `<div class="stack">
        <h2 class="section muted" style="font-size:14px">分期（固定入帳）</h2>
        <div class="list">${fixed.map((t) => `<div class="field"><span class="label" style="color:var(--ink)">${esc(t.title)} <span class="muted small">第 ${t.installment_no} 期</span></span><span class="num">${money(t.total)}</span></div>`).join('')}</div>
      </div>` : ''}

      <div class="stack">
        <h2 class="section muted" style="font-size:14px">勾選帳單上有出現的消費</h2>
        ${normal.length ? `<div class="list" id="checks">
          ${normal.map((t) => `<label class="check-row">
            <input type="checkbox" data-id="${t.id}" ${st.keep.has(t.id) ? 'checked' : ''}>
            <span class="body"><span>${esc(t.title || (t.items[0] && t.items[0].name) || '未命名')}</span> <span class="muted small">${md(t.txn_date)}</span>
              <span class="muted small" data-hint="${t.id}" style="display:block;color:var(--orange)" hidden>沒勾的會在完成對帳後移到下一期</span></span>
            <span class="num" style="font-weight:500">${t.type === 'income' ? '−' : ''}${money(t.total)}</span>
          </label>`).join('')}
        </div>` : '<div class="panel empty" style="padding:16px">這期沒有你記的一般消費</div>'}
      </div>

      <div class="stack">
        <div class="spread" style="align-items:center">
          <h2 class="section muted" style="font-size:14px">帳單上有、但你沒記的</h2>
          <button type="button" class="link-btn" id="add-extra" style="font-weight:700">${icon('plus', 16, 2)}補一筆</button>
        </div>
        <div class="list">
          <div id="extras"></div>
          <button type="button" class="link-btn" id="quick-fee" style="min-height:52px;width:100%;justify-content:space-between;color:var(--orange)" hidden><span></span></button>
        </div>
      </div>

      <div class="action-bar"><button class="btn" id="done" disabled>先輸入銀行帳單金額</button></div>

      <dialog class="sheet" id="extra-sheet">
        <form method="dialog">
          <strong>補一筆</strong>
          <input class="input" id="x-title" placeholder="商家或說明，例如：海外網購">
          <div class="grid-2">
            <input class="input num" id="x-amount" inputmode="numeric" pattern="[0-9]*" placeholder="金額">
            <input class="input" id="x-date" type="date" value="${s.period_end <= todayStr() ? s.period_end : todayStr()}">
          </div>
          <select class="input" id="x-cat">${expenseCats.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>
          <div class="grid-2"><button class="btn ghost" value="cancel" formnovalidate>取消</button><button class="btn" value="ok">加入</button></div>
        </form>
      </dialog>`;

    el.querySelector('#stmt').addEventListener('input', (e) => { st.amount = e.target.value.trim(); refresh(); });

    const checks = el.querySelector('#checks');
    if (checks) checks.addEventListener('change', (e) => {
      const id = Number(e.target.dataset.id);
      if (!id) return;
      if (e.target.checked) st.keep.add(id); else st.keep.delete(id);
      el.querySelector(`[data-hint="${id}"]`).hidden = e.target.checked;
      refresh();
    });

    const sheet = el.querySelector('#extra-sheet');
    el.querySelector('#add-extra').addEventListener('click', () => {
      sheet.querySelector('#x-title').value = '';
      sheet.querySelector('#x-amount').value = '';
      sheet.showModal();
    });
    sheet.addEventListener('close', () => {
      if (sheet.returnValue !== 'ok') return;
      const amount = Number(sheet.querySelector('#x-amount').value);
      if (!(amount > 0)) return showError({ message: '請輸入補記金額' });
      st.extras.push({
        title: sheet.querySelector('#x-title').value.trim(),
        amount,
        txn_date: sheet.querySelector('#x-date').value || s.period_end,
        category_id: Number(sheet.querySelector('#x-cat').value) || null,
      });
      refresh();
    });

    el.querySelector('#extras').addEventListener('click', (e) => {
      const rm = e.target.closest('[data-rm]');
      if (!rm) return;
      st.extras.splice(Number(rm.dataset.rm), 1);
      refresh();
    });

    el.querySelector('#quick-fee').addEventListener('click', () => {
      const d = diff();
      if (!(d > 0) || !feeCat) return;
      st.extras.push({ title: '國外交易手續費', amount: d, txn_date: s.period_end <= todayStr() ? s.period_end : todayStr(), category_id: feeCat.id });
      refresh();
    });

    const done = el.querySelector('#done');
    done.addEventListener('click', async () => {
      if (diff() !== 0) return;
      await busy(done, async () => {
        try {
          const r = await api.post(`/statements/${s.id}/reconcile`, {
            statement_amount: Number(st.amount),
            keep_ids: [...st.keep],
            extras: st.extras.map((x) => ({
              title: x.title,
              txn_date: x.txn_date,
              items: [{ name: x.title, unit_price: x.amount, category_id: x.category_id }],
            })),
          });
          invalidate('accounts');
          toast(r.moved ? `對帳完成，${r.moved} 筆移到下一期` : '對帳完成');
          location.hash = back;
        } catch (err) { showError(err); }
      });
    });

    refresh();
  },
};
