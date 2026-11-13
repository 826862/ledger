import { api } from '../api.js';
import { esc, money, md, icon, backHead, todayStr, showError, toast, SWATCHES } from '../ui.js';

export default {
  async render(el, params, query, alive) {
    const list = await api.get('/projects?include_archived=1');
    if (!alive()) return;
    const active = list.filter((p) => !p.archived);
    const archived = list.filter((p) => p.archived);

    const card = (p) => `<a class="list-row" href="#/projects/${p.id}">
      <span class="dot" style="width:12px;height:12px;border-radius:6px;background:${esc(p.color)}"></span>
      <div class="body">
        <span class="title">${esc(p.name)}</span>
        <span class="meta">${p.start_date ? `${md(p.start_date)}${p.end_date ? ` – ${md(p.end_date)}` : ' 起'} · ` : ''}${p.txn_count} 筆${p.income ? ` · 收入 ${money(p.income)}` : ''}</span>
      </div>
      <span class="amount">${money(p.expense)}</span>
    </a>`;

    el.innerHTML = `
      ${backHead('專項', '#/settings', `<button type="button" class="icon-btn" id="add" aria-label="新增專項">${icon('plus', 22, 2)}</button>`)}
      <span class="muted small">記帳時選擇專項，這裡就會統計每個專項花了多少、賺了多少（不含代墊）。</span>
      ${active.length ? `<div class="list">${active.map(card).join('')}</div>`
        : '<div class="panel empty">還沒有專項。例如建立「日本行」，在日本的每筆消費都選這個專項，就能看到整趟花了多少。</div>'}
      ${archived.length ? `<h2 class="section muted" style="font-size:14px">已結束</h2><div class="list">${archived.map(card).join('')}</div>` : ''}
      <dialog class="sheet" id="sheet">
        <form method="dialog">
          <strong>新增專項</strong>
          <input class="input" id="p-name" placeholder="專項名稱，例如：日本行" maxlength="40">
          <div class="grid-2">
            <label class="stack" style="gap:4px"><span class="muted small">開始日期（選填）</span><input class="input" id="p-start" type="date" value="${todayStr()}"></label>
            <label class="stack" style="gap:4px"><span class="muted small">結束日期（選填）</span><input class="input" id="p-end" type="date"></label>
          </div>
          <div class="row" id="p-colors" role="group" aria-label="顏色" style="flex-wrap:wrap;gap:10px">
            ${SWATCHES.map((c, i) => `<button type="button" class="swatch" data-color="${c}" aria-label="${c}" aria-pressed="${i === 1}" style="background:${c}"></button>`).join('')}
          </div>
          <div class="grid-2"><button class="btn ghost" value="cancel" formnovalidate>取消</button><button class="btn" value="ok">建立</button></div>
        </form>
      </dialog>`;

    const sheet = el.querySelector('#sheet');
    let color = SWATCHES[1];
    sheet.querySelector('#p-colors').addEventListener('click', (e) => {
      const b = e.target.closest('[data-color]');
      if (!b) return;
      color = b.dataset.color;
      sheet.querySelectorAll('[data-color]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    });
    el.querySelector('#add').addEventListener('click', () => sheet.showModal());
    sheet.addEventListener('close', async () => {
      if (sheet.returnValue !== 'ok') return;
      try {
        const p = await api.post('/projects', {
          name: sheet.querySelector('#p-name').value,
          start_date: sheet.querySelector('#p-start').value || null,
          end_date: sheet.querySelector('#p-end').value || null,
          color,
        });
        toast('已建立專項');
        location.hash = `#/projects/${p.id}`;
      } catch (err) { showError(err); }
    });
  },
};
