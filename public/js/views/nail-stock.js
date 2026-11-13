import { api } from '../api.js';
import { esc, md, icon, todayStr, showError, toast } from '../ui.js';
import { nailTabs, productRow } from './nail-common.js';

const LAST_USER = 'ledger:nailUser';

export default {
  async render(el, params, query, alive) {
    const products = await api.get('/nail/products');
    if (!alive()) return;
    const filter = query.f || 'all';
    const brands = [...new Set(products.map((p) => p.brand).filter(Boolean))];
    const lowCount = products.filter((p) => Number(p.remaining) <= Number(p.low_threshold)).length;
    const shown = products.filter((p) => filter === 'all' || (filter === 'low' ? Number(p.remaining) <= Number(p.low_threshold) : p.brand === filter));

    el.innerHTML = `
      <div class="page-head"><h1>美甲</h1>
        <div class="row" style="gap:8px">
          <button type="button" class="icon-btn" id="add-product" aria-label="新增商品">${icon('plus', 20, 2)}</button>
          <a class="btn small" href="#/nail/purchases?new=1" style="min-height:40px">${icon('truck', 16, 2)}進貨</a>
        </div>
      </div>
      ${nailTabs('stock')}
      <div class="chips">
        <a class="chip" href="#/nail/stock" aria-pressed="${filter === 'all'}" style="display:inline-flex;align-items:center">全部</a>
        <a class="chip" href="#/nail/stock?f=low" aria-pressed="${filter === 'low'}" style="display:inline-flex;align-items:center">快用完 ${lowCount}</a>
        ${brands.map((b) => `<a class="chip" href="#/nail/stock?f=${encodeURIComponent(b)}" aria-pressed="${filter === b}" style="display:inline-flex;align-items:center">${esc(b)}</a>`).join('')}
      </div>
      ${shown.length ? `<div class="list" id="list">${shown.map((p) => productRow(p)).join('')}</div>`
        : `<div class="panel empty">${products.length ? '沒有符合的商品' : '還沒有商品。可以先「進貨」，或按右上 ＋ 新增現有庫存。'}</div>`}

      <dialog class="sheet" id="use-sheet">
        <form method="dialog">
          <strong id="use-title">拿取</strong>
          <div class="grid-2">
            <label class="stack" style="gap:4px"><span class="muted small">數量</span><input class="input num" id="u-qty" inputmode="decimal" value="1"></label>
            <label class="stack" style="gap:4px"><span class="muted small">日期</span><input class="input" id="u-date" type="date" value="${todayStr()}"></label>
          </div>
          <input class="input" id="u-user" placeholder="拿取人" value="${esc(localStorage.getItem(LAST_USER) || '')}">
          <input class="input" id="u-note" placeholder="備註（選填）">
          <div id="u-history" class="small muted"></div>
          <div class="grid-2"><button class="btn ghost" value="cancel" formnovalidate>取消</button><button class="btn" value="ok">確認拿取</button></div>
        </form>
      </dialog>

      <dialog class="sheet" id="p-sheet">
        <form method="dialog">
          <strong id="p-title">新增商品</strong>
          <input class="input" id="p-name" placeholder="商品名稱，例如：貓眼凝膠 #12">
          <div class="grid-2">
            <input class="input" id="p-brand" placeholder="品牌">
            <input class="input" id="p-exp" placeholder="有效日期，例如 2027/05">
          </div>
          <div class="grid-2">
            <label class="stack" style="gap:4px"><span class="muted small">現有數量</span><input class="input num" id="p-qty" inputmode="decimal" value="0"></label>
            <label class="stack" style="gap:4px"><span class="muted small">剩多少時提醒</span><input class="input num" id="p-low" inputmode="decimal" value="1"></label>
          </div>
          <span class="muted small">「現有數量」是開始記錄前手上已有的數量；之後進貨會自動加上去。</span>
          <div class="grid-2"><button class="btn ghost" value="cancel" formnovalidate>取消</button><button class="btn" value="ok">儲存</button></div>
          <button class="btn danger" value="archive" id="p-archive">不再追蹤這個商品</button>
        </form>
      </dialog>`;

    // 拿取
    const useSheet = el.querySelector('#use-sheet');
    let useId = null;
    const list = el.querySelector('#list');
    if (list) list.addEventListener('click', async (e) => {
      const use = e.target.closest('[data-use]');
      if (use) {
        useId = Number(use.dataset.use);
        const p = products.find((x) => x.id === useId);
        useSheet.querySelector('#use-title').textContent = `拿取 ${p.name}（剩 ${Number(p.remaining)}）`;
        useSheet.querySelector('#u-history').textContent = '';
        useSheet.showModal();
        try {
          const h = await api.get(`/nail/products/${useId}/usage`);
          useSheet.querySelector('#u-history').innerHTML = h.usage.slice(0, 3).map((u) => `${md(u.use_date)} ${esc(u.user_name || '')} 拿了 ${Number(u.quantity)}`).join('<br>') || '還沒有拿取紀錄';
        } catch { /* 只是參考資訊 */ }
        return;
      }
      const ed = e.target.closest('[data-edit-product]');
      if (ed) openProduct(products.find((x) => x.id === Number(ed.dataset.editProduct)));
    });
    useSheet.addEventListener('close', async () => {
      if (useSheet.returnValue !== 'ok') return;
      const user = useSheet.querySelector('#u-user').value.trim();
      localStorage.setItem(LAST_USER, user);
      try {
        await api.post('/nail/usage', {
          product_id: useId, quantity: Number(useSheet.querySelector('#u-qty').value),
          use_date: useSheet.querySelector('#u-date').value, user_name: user, note: useSheet.querySelector('#u-note').value,
        });
        toast('已記錄拿取');
        this.render(el, params, query, alive);
      } catch (err) { showError(err); }
    });

    // 商品
    const pSheet = el.querySelector('#p-sheet');
    let editingProduct = null;
    const openProduct = (p) => {
      editingProduct = p || null;
      pSheet.querySelector('#p-title').textContent = p ? '編輯商品' : '新增商品';
      pSheet.querySelector('#p-name').value = p ? p.name : '';
      pSheet.querySelector('#p-brand').value = p ? p.brand || '' : '';
      pSheet.querySelector('#p-exp').value = p ? p.expiry || '' : '';
      pSheet.querySelector('#p-qty').value = p ? Number(p.initial_qty) : 0;
      pSheet.querySelector('#p-low').value = p ? Number(p.low_threshold) : 1;
      pSheet.querySelector('#p-archive').hidden = !p;
      pSheet.showModal();
    };
    el.querySelector('#add-product').addEventListener('click', () => openProduct(null));
    pSheet.addEventListener('close', async () => {
      const act = pSheet.returnValue;
      if (!act || act === 'cancel') return;
      try {
        if (act === 'archive') {
          await api.put(`/nail/products/${editingProduct.id}`, { archived: true });
        } else {
          const body = {
            name: pSheet.querySelector('#p-name').value, brand: pSheet.querySelector('#p-brand').value,
            expiry: pSheet.querySelector('#p-exp').value, initial_qty: Number(pSheet.querySelector('#p-qty').value) || 0,
            low_threshold: Number(pSheet.querySelector('#p-low').value) || 0,
          };
          if (editingProduct) await api.put(`/nail/products/${editingProduct.id}`, body);
          else await api.post('/nail/products', body);
        }
        toast('已儲存');
        this.render(el, params, query, alive);
      } catch (err) { showError(err); }
    });
  },
};
