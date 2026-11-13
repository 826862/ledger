import { api, invalidate } from '../api.js';
import { esc, money, md, todayStr, backHead, busy, showError, toast } from '../ui.js';

export default {
  async render(el, params, query, alive) {
    const [data, accounts] = await Promise.all([api.get('/advances'), api.accounts()]);
    if (!alive()) return;
    const deposits = accounts.filter((a) => a.kind === 'deposit');
    const selected = new Set();

    if (!data.people.length) {
      el.innerHTML = `${backHead('代墊待收回', '#/settings')}
        <div class="panel empty">目前沒有待收回的代墊。<br>記帳時在品項按「代墊」並填上對象，就會出現在這裡。</div>`;
      return;
    }

    el.innerHTML = `
      ${backHead('代墊待收回', '#/settings')}
      <div class="panel stack" style="gap:4px">
        <span class="muted small">還有 ${data.people.length} 位沒還</span>
        <span class="big-number" style="color:#6B21A8">NT$ ${money(data.total)}</span>
      </div>
      <span class="muted small">勾選對方還你的項目，再按下方「收回」，選錢進到哪個帳戶。收回的錢不算收入。</span>
      <div id="adv-list" class="stack" style="gap:16px">
      ${data.people.map((p) => `
        <section class="stack">
          <div class="spread" style="align-items:center">
            <h2 class="section" style="font-size:15px">${esc(p.person)}</h2>
            <button type="button" class="link-btn" data-all="${esc(p.person)}">全選 ${money(p.total)}</button>
          </div>
          <div class="list">
            ${p.items.map((i) => `<label class="check-row">
              <input type="checkbox" data-id="${i.id}" data-person="${esc(p.person)}" data-amount="${i.amount}">
              <span class="body"><span>${esc(i.title || i.name || '代墊')}</span>
                <span class="muted small" style="display:block">${md(i.txn_date)} · ${esc(i.account_name)}${i.name && i.name !== '代墊' && i.name !== i.title ? ` · ${esc(i.name)}` : ''}</span></span>
              <span class="num" style="font-weight:700">${money(i.amount)}</span>
            </label>`).join('')}
          </div>
        </section>`).join('')}
      </div>
      <div class="action-bar"><button class="btn" id="settle" disabled>先勾選要收回的項目</button></div>
      <dialog class="sheet" id="sheet">
        <form method="dialog">
          <strong id="sheet-title">收回代墊</strong>
          ${deposits.length ? `
            <label class="muted small" for="acc">錢進到哪個帳戶</label>
            <select class="input" id="acc">${deposits.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join('')}</select>
            <label class="muted small" for="date">日期</label>
            <input class="input" id="date" type="date" value="${todayStr()}">
            <div class="grid-2"><button class="btn ghost" value="cancel" formnovalidate>取消</button><button class="btn" value="ok">確認收回</button></div>`
          : '<span class="muted">要先有存款或現金帳戶。</span><button class="btn ghost" value="cancel">關閉</button>'}
        </form>
      </dialog>`;

    const btn = el.querySelector('#settle');
    const refresh = () => {
      const boxes = [...el.querySelectorAll('input[data-id]')].filter((b) => b.checked);
      selected.clear();
      boxes.forEach((b) => selected.add(Number(b.dataset.id)));
      const sum = boxes.reduce((s, b) => s + Number(b.dataset.amount), 0);
      btn.disabled = !boxes.length;
      btn.textContent = boxes.length ? `收回 ${boxes.length} 筆，共 ${money(sum)}` : '先勾選要收回的項目';
      el.querySelector('#sheet-title').textContent = `收回代墊 ${money(sum)}`;
    };
    el.querySelector('#adv-list').addEventListener('change', (e) => { if (e.target.dataset.id) refresh(); });
    el.querySelectorAll('[data-all]').forEach((b) => b.addEventListener('click', () => {
      const boxes = el.querySelectorAll(`input[data-person="${CSS.escape(b.dataset.all)}"]`);
      const allOn = [...boxes].every((x) => x.checked);
      boxes.forEach((x) => { x.checked = !allOn; });
      refresh();
    }));

    const sheet = el.querySelector('#sheet');
    btn.addEventListener('click', () => sheet.showModal());
    sheet.addEventListener('close', async () => {
      if (sheet.returnValue !== 'ok') return;
      await busy(btn, async () => {
        try {
          const r = await api.post('/advances/settle', {
            item_ids: [...selected],
            account_id: Number(el.querySelector('#acc').value),
            date: el.querySelector('#date').value,
          });
          invalidate('accounts');
          toast(`已收回 ${money(r.amount)}`);
          this.render(el, params, query, alive);
        } catch (err) { showError(err); }
      });
    });
  },
};
