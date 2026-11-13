import { api, invalidate } from '../api.js';
import { esc, icon, backHead, segmented, bindSegmented, showError, toast, SWATCHES } from '../ui.js';

export default {
  async render(el, params, query, alive) {
    let kind = query.kind === 'income' ? 'income' : 'expense';
    let all = await api.get('/categories');
    if (!alive()) return;

    const reload = async () => {
      invalidate('categories');
      all = await api.get('/categories');
      draw();
    };

    const draw = () => {
      const list = all.filter((c) => c.kind === kind);
      el.innerHTML = `
        ${backHead('分類管理', '#/settings')}
        ${segmented('kind', [['expense', '支出分類'], ['income', '收入分類']], kind)}
        <span class="muted small">用右邊的箭頭調整順序；點分類可以改名、換顏色或封存。</span>
        ${list.length ? `<div class="list" id="list">
          ${list.map((c, i) => `
            <div class="row" style="min-height:56px">
              <button type="button" class="list-row" data-edit="${c.id}" style="flex:1;min-height:56px;padding:0">
                <span class="dot" style="width:12px;height:12px;border-radius:6px;background:${esc(c.color)}"></span>
                <span class="body"><span class="title">${esc(c.name)}</span></span>
              </button>
              <button type="button" class="icon-btn plain" data-move="${i}" data-dir="-1" aria-label="上移 ${esc(c.name)}" ${i === 0 ? 'disabled style="opacity:.25"' : ''}>${icon('up', 20, 2)}</button>
              <button type="button" class="icon-btn plain" data-move="${i}" data-dir="1" aria-label="下移 ${esc(c.name)}" ${i === list.length - 1 ? 'disabled style="opacity:.25"' : ''}>${icon('down', 20, 2)}</button>
            </div>`).join('')}
        </div>` : '<div class="panel empty">還沒有分類</div>'}
        <button type="button" class="btn ghost" id="add">${icon('plus', 18, 2)}新增分類</button>
        <dialog class="sheet" id="sheet">
          <form method="dialog" id="sheet-form">
            <strong id="sheet-title"></strong>
            <input class="input" id="c-name" placeholder="分類名稱" maxlength="20">
            <div class="row" id="c-colors" role="group" aria-label="顏色" style="flex-wrap:wrap;gap:10px">
              ${SWATCHES.map((c) => `<button type="button" class="swatch" data-color="${c}" aria-label="${c}" aria-pressed="false" style="background:${c}"></button>`).join('')}
            </div>
            <div class="grid-2"><button class="btn ghost" value="cancel" formnovalidate>取消</button><button class="btn" value="ok">儲存</button></div>
            <button class="btn danger" value="archive" id="c-archive">封存這個分類</button>
          </form>
        </dialog>`;

      bindSegmented(el, 'kind', (v) => { kind = v; draw(); });

      const sheet = el.querySelector('#sheet');
      let editingId = null;
      let color = SWATCHES[0];
      const setColor = (c) => {
        color = c;
        sheet.querySelectorAll('[data-color]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.color === c)));
      };
      sheet.querySelector('#c-colors').addEventListener('click', (e) => {
        const b = e.target.closest('[data-color]');
        if (b) setColor(b.dataset.color);
      });
      const open = (cat) => {
        editingId = cat ? cat.id : null;
        sheet.querySelector('#sheet-title').textContent = cat ? '編輯分類' : `新增${kind === 'income' ? '收入' : '支出'}分類`;
        sheet.querySelector('#c-name').value = cat ? cat.name : '';
        sheet.querySelector('#c-archive').hidden = !cat;
        setColor(cat ? cat.color : SWATCHES[list.length % SWATCHES.length]);
        sheet.showModal();
      };
      sheet.addEventListener('close', async () => {
        const action = sheet.returnValue;
        if (action === 'cancel' || !action) return;
        try {
          if (action === 'archive') {
            if (!confirm('封存後新記帳時不會再看到這個分類，過去的紀錄會保留。確定封存？')) return;
            await api.put(`/categories/${editingId}`, { archived: true });
            toast('已封存');
          } else {
            const name = sheet.querySelector('#c-name').value.trim();
            if (!name) return showError({ message: '請填寫分類名稱' });
            if (editingId) await api.put(`/categories/${editingId}`, { name, color });
            else await api.post('/categories', { name, kind, color });
            toast('已儲存');
          }
          await reload();
        } catch (err) { showError(err); }
      });

      el.querySelector('#add').addEventListener('click', () => open(null));
      const listEl = el.querySelector('#list');
      if (listEl) listEl.addEventListener('click', async (e) => {
        const edit = e.target.closest('[data-edit]');
        if (edit) return open(list.find((c) => c.id === Number(edit.dataset.edit)));
        const mv = e.target.closest('[data-move]');
        if (!mv || mv.disabled) return;
        const i = Number(mv.dataset.move);
        const j = i + Number(mv.dataset.dir);
        const ids = list.map((c) => c.id);
        [ids[i], ids[j]] = [ids[j], ids[i]];
        try {
          await api.post('/categories/reorder', { ids });
          await reload();
        } catch (err) { showError(err); }
      });
    };
    draw();
  },
};
