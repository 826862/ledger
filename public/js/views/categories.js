import { api, invalidate } from '../api.js';
import { esc, icon, backHead, segmented, bindSegmented, showError, toast, recentColors, makeSortable, HANDLE } from '../ui.js';

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
        <span class="muted small">按住任一列（或右側把手）上下拖曳排序，放開就儲存；點一下可以改名、換顏色或封存。</span>
        ${list.length ? `<div class="list" id="list">
          ${list.map((c) => `
            <div class="row" style="min-height:56px;gap:4px" data-sort-id="${c.id}">
              <button type="button" class="list-row" data-edit="${c.id}" style="flex:1;min-height:56px;padding:0">
                <span style="width:30px;height:30px;border-radius:9px;background:${esc(c.color)};flex-shrink:0"></span>
                <span class="body"><span class="title">${esc(c.name)}</span></span>
              </button>
              ${HANDLE}
            </div>`).join('')}
        </div>` : '<div class="panel empty">還沒有分類</div>'}
        <button type="button" class="btn ghost" id="add">${icon('plus', 18, 2)}新增分類</button>
        <dialog class="sheet" id="sheet">
          <form method="dialog" id="sheet-form">
            <strong id="sheet-title"></strong>
            <input class="input" id="c-name" placeholder="分類名稱" maxlength="20">
            <div class="row" style="gap:12px;flex-wrap:wrap">
              <input type="color" id="c-color" style="width:48px;height:48px;border:0;padding:0;background:none;cursor:pointer" aria-label="選擇顏色（色環）">
              <input id="c-hex" class="input num" style="width:110px;min-height:40px" aria-label="色碼">
              <div class="row" id="c-colors" role="group" aria-label="最近用過的顏色" style="flex-wrap:wrap;gap:8px;width:100%"></div>
            </div>
            <div class="grid-2"><button class="btn ghost" value="cancel" formnovalidate>取消</button><button class="btn" value="ok">儲存</button></div>
            <div class="grid-2"><button class="btn danger" value="archive" id="c-archive">封存</button><button class="btn danger" value="delete" id="c-delete">刪除</button></div>
          </form>
        </dialog>`;

      bindSegmented(el, 'kind', (v) => { kind = v; draw(); });

      const sheet = el.querySelector('#sheet');
      let editingId = null;
      const PALETTE = ['#1E3A8A', '#2563EB', '#93C5FD', '#0F766E', '#9A3412', '#EA580C', '#FDBA74', '#5B6170'];
      let color = PALETTE[0];
      const setColor = (c) => {
        if (!/^#[0-9a-fA-F]{6}$/.test(c)) return;
        color = c;
        sheet.querySelector('#c-color').value = c;
        sheet.querySelector('#c-hex').value = c;
        sheet.querySelectorAll('[data-color]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.color.toLowerCase() === c.toLowerCase())));
      };
      sheet.querySelector('#c-colors').innerHTML = [...new Set([...recentColors(), ...PALETTE])].slice(0, 8)
        .map((c) => `<button type="button" class="swatch" data-color="${c}" aria-label="${c}" aria-pressed="false" style="background:${c};width:32px;height:32px;border-width:2px"></button>`).join('');
      sheet.querySelector('#c-color').addEventListener('input', (e) => setColor(e.target.value));
      sheet.querySelector('#c-hex').addEventListener('input', (e) => setColor(e.target.value.trim()));
      sheet.querySelector('#c-colors').addEventListener('click', (e) => {
        const b = e.target.closest('[data-color]');
        if (b) setColor(b.dataset.color);
      });
      const open = (cat) => {
        editingId = cat ? cat.id : null;
        sheet.querySelector('#sheet-title').textContent = cat ? '編輯分類' : `新增${kind === 'income' ? '收入' : '支出'}分類`;
        sheet.querySelector('#c-name').value = cat ? cat.name : '';
        sheet.querySelector('#c-archive').parentElement.hidden = !cat;
        setColor(cat ? cat.color : PALETTE[list.length % PALETTE.length]);
        sheet.showModal();
      };
      sheet.addEventListener('close', async () => {
        const action = sheet.returnValue;
        if (action === 'cancel' || !action) return;
        try {
          if (action === 'delete') {
            const cat = list.find((c) => c.id === editingId);
            const choice = await deleteCategoryDialog(cat, list.filter((c) => c.id !== editingId));
            if (!choice) return;
            if (choice.archive) {
              await api.put(`/categories/${editingId}`, { archived: true });
              toast('已封存');
            } else {
              const r = await api.del(`/categories/${editingId}${choice.moveTo ? `?move_to=${choice.moveTo}` : ''}`);
              toast(r.moved ? `已刪除，${r.moved} 筆明細${choice.moveTo ? '已移過去' : '改成未分類'}` : '已刪除');
            }
          } else if (action === 'archive') {
            if (!confirm('封存後新記帳時不會再看到這個分類，過去的紀錄會保留。確定封存？')) return;
            await api.put(`/categories/${editingId}`, { archived: true });
            toast('已封存');
          } else {
            const name = sheet.querySelector('#c-name').value.trim();
            if (!name) return showError({ message: '請填寫分類名稱' });
            recentColors(color);
            if (editingId) await api.put(`/categories/${editingId}`, { name, color });
            else await api.post('/categories', { name, kind, color });
            toast('已儲存');
          }
          await reload();
        } catch (err) { showError(err); }
      });

      el.querySelector('#add').addEventListener('click', () => open(null));
      const listEl = el.querySelector('#list');
      if (listEl) {
        listEl.addEventListener('click', (e) => {
          const edit = e.target.closest('[data-edit]');
          if (edit) open(list.find((c) => c.id === Number(edit.dataset.edit)));
        });
        makeSortable(listEl, async (ids) => {
          try {
            await api.post('/categories/reorder', { ids });
            invalidate('categories');
            all = await api.get('/categories');
          } catch (err) { showError(err); }
        });
      }
    };
    draw();
  },
};

// 刪除分類：有明細時選擇移到其他分類或改成未分類；也可以改成封存
async function deleteCategoryDialog(cat, others) {
  const usage = await api.get(`/categories/${cat.id}/usage`);
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'sheet';
    const n = usage.items;
    dlg.innerHTML = `<div class="stack" style="gap:12px">
      <strong style="font-size:17px">刪除分類「${esc(cat.name)}」？</strong>
      ${n ? `<span class="muted small">這個分類底下有 ${n} 筆明細，要怎麼處理？</span>
        <label class="panel row" style="gap:10px;padding:12px 14px;align-items:flex-start"><input type="radio" name="m" value="move" checked style="width:20px;height:20px">
          <span class="stack" style="gap:6px;flex:1"><span style="font-weight:500">移到其他分類</span>
          <select class="input" id="to">${others.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></span></label>
        <label class="panel row" style="gap:10px;padding:12px 14px;align-items:flex-start"><input type="radio" name="m" value="none" style="width:20px;height:20px">
          <span class="stack" style="gap:2px"><span style="font-weight:500">改成「未分類」</span><span class="muted small">交易保留，報表會顯示在未分類</span></span></label>
        <span class="muted small">只想先不用、不想動到舊資料的話，可以改用「封存」。</span>`
        : '<span class="muted small">這個分類沒有任何紀錄，可以直接刪除。</span>'}
      <button type="button" class="btn danger-solid" data-a="delete">刪除</button>
      ${n ? '<button type="button" class="btn ghost" data-a="archive">改成封存</button>' : ''}
      <button type="button" class="btn ghost" data-a="cancel">取消</button>
    </div>`;
    document.body.appendChild(dlg);
    const done = (v) => { dlg.close(); dlg.remove(); resolve(v); };
    dlg.addEventListener('click', (e) => {
      const b = e.target.closest('[data-a]');
      if (!b) return;
      if (b.dataset.a === 'cancel') return done(null);
      if (b.dataset.a === 'archive') return done({ archive: true });
      const mode = n ? dlg.querySelector('input[name="m"]:checked').value : 'none';
      done({ moveTo: mode === 'move' ? Number(dlg.querySelector('#to').value) : null });
    });
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); done(null); });
    dlg.showModal();
  });
}
