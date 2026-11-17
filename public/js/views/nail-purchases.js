import { api, invalidate } from '../api.js';
import { esc, money, md, icon, todayStr, backHead, busy, showError, toast } from '../ui.js';
import { nailTabs, setupHint } from './nail-common.js';

export default {
  async render(el, params, query, alive) {
    // 進貨列表
    if (!query.new) {
      const list = await api.get('/nail/purchases');
      if (!alive()) return;
      el.innerHTML = `
        <div class="page-head"><h1>美甲</h1><a class="btn small" href="#/nail/purchases?new=1" style="min-height:40px">${icon('truck', 16, 2)}新增進貨</a></div>
        ${nailTabs('purchases')}
        ${list.length ? `<div class="list">${list.map((p) => `
          <div class="stack" style="gap:6px;padding:12px 0">
            <div class="spread"><span style="font-weight:500">${esc(p.vendor || '進貨')}</span><span class="num" style="font-weight:700">${money(p.total)}</span></div>
            <span class="small muted">${[md(p.purchase_date), p.account_name ? esc(p.account_name) : '只做紀錄（未記支出）', `${p.items.length} 項`].join(' · ')}</span>
            ${p.note ? `<span class="small muted">備註：${esc(p.note)}</span>` : ''}
            <span class="small muted">${p.items.map((i) => `${esc([i.brand, i.name].filter(Boolean).join(' '))} ×${Number(i.quantity)}`).join('、')}</span>
            <button type="button" class="link-btn" data-del="${p.id}" style="align-self:flex-end;color:#B42318;min-height:32px;font-size:12px">刪除</button>
          </div>`).join('')}</div>` : '<div class="panel empty">還沒有進貨紀錄。進貨後庫存會自動增加，也會記一筆美甲材料支出。</div>'}`;
      el.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
        if (!confirm('刪除這筆進貨？庫存會扣回來，對應的支出也會刪除。')) return;
        try { await api.del(`/nail/purchases/${b.dataset.del}`); invalidate('accounts'); toast('已刪除'); this.render(el, params, query, alive); } catch (err) { showError(err); }
      }));
      return;
    }

    // 新增進貨
    const [products, accounts, cfg] = await Promise.all([api.get('/nail/products'), api.accounts(), api.get('/nail')]);
    if (!alive()) return;
    const payAccounts = accounts.filter((a) => a.kind !== 'loan');
    const st = {
      vendor: '', date: todayStr(),
      account_id: cfg.configured ? cfg.settings.bag_account_id : (payAccounts[0] || {}).id,
      items: [{ product_id: '', name: '', brand: '', unit_price: '', quantity: 1 }],
    };
    const total = () => st.items.reduce((x, i) => x + Math.round((Number(i.unit_price) || 0) * (Number(i.quantity) || 0)), 0);

    const draw = () => {
      el.innerHTML = `
        ${backHead('新增進貨', '#/nail/purchases')}
        ${cfg.configured ? '' : setupHint}
        <form id="f" class="stack" style="gap:14px">
          <div class="list">
            <div class="field"><label for="vendor">進貨店家</label><input id="vendor" value="${esc(st.vendor)}" placeholder="例如：美甲材料行"></div>
            <div class="field"><label for="date">日期</label><input id="date" type="date" value="${esc(st.date)}"></div>
            <div class="field"><label for="acc">付款方式</label><select id="acc">${payAccounts.map((a) => `<option value="${a.id}" ${a.id === Number(st.account_id) ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></div>
          </div>
          <div class="spread"><h2 class="section" style="font-size:15px">進貨明細（${st.items.length}）</h2><span class="muted small">選既有商品，或選「新商品」</span></div>
          <div class="list" id="items">
            ${st.items.map((it, i) => `<div class="detail-row" data-i="${i}">
              <select data-k="product_id" aria-label="商品">
                <option value="">＋ 新商品</option>
                ${products.map((p) => `<option value="${p.id}" ${p.id === Number(it.product_id) ? 'selected' : ''}>${esc([p.brand, p.name].filter(Boolean).join(' '))}（剩 ${Number(p.remaining)}）</option>`).join('')}
              </select>
              ${!it.product_id ? `<div class="top" style="grid-template-columns:minmax(0,1fr) 110px">
                <input data-k="name" value="${esc(it.name)}" placeholder="商品名稱" aria-label="商品名稱">
                <input data-k="brand" value="${esc(it.brand)}" placeholder="品牌" aria-label="品牌"></div>` : ''}
              <div class="top" style="grid-template-columns:minmax(0,1fr) 80px 40px">
                <input data-k="unit_price" class="price num" inputmode="numeric" pattern="[0-9]*" value="${esc(it.unit_price)}" placeholder="單價" aria-label="單價">
                <input data-k="quantity" class="num" inputmode="decimal" value="${esc(it.quantity)}" aria-label="數量" style="text-align:center">
                <button type="button" class="icon-btn plain" data-remove="${i}" aria-label="刪除" style="width:40px" ${st.items.length === 1 ? 'disabled' : ''}>${icon('trash', 18)}</button>
              </div>
            </div>`).join('')}
            <button type="button" class="link-btn" id="add" style="min-height:48px">${icon('plus', 18, 2)}新增商品</button>
          </div>
          <div class="panel spread" style="padding:12px 16px;align-items:baseline"><span class="muted" style="font-size:14px">總金額</span><span class="num" style="font-size:22px;font-weight:700" id="total">NT$ ${money(total())}</span></div>
          <span class="muted small">儲存後：庫存自動加上數量；記帳本同時記一筆美甲材料支出，從付款方式扣款。</span>
        </form>
        <div class="action-bar"><button class="btn" type="submit" form="f">儲存進貨</button></div>`;

      const items = el.querySelector('#items');
      items.addEventListener('input', (e) => {
        const row = e.target.closest('[data-i]');
        if (!row || !e.target.dataset.k || e.target.dataset.k === 'product_id') return;
        st.items[Number(row.dataset.i)][e.target.dataset.k] = e.target.value;
        el.querySelector('#total').textContent = `NT$ ${money(total())}`;
      });
      items.addEventListener('change', (e) => {
        if (e.target.dataset.k !== 'product_id') return;
        sync();
        st.items[Number(e.target.closest('[data-i]').dataset.i)].product_id = e.target.value;
        draw();
      });
      items.addEventListener('click', (e) => {
        const rm = e.target.closest('[data-remove]');
        if (rm && st.items.length > 1) { sync(); st.items.splice(Number(rm.dataset.remove), 1); draw(); }
      });
      el.querySelector('#add').addEventListener('click', () => { sync(); st.items.push({ product_id: '', name: '', brand: '', unit_price: '', quantity: 1 }); draw(); });
      el.querySelector('#f').addEventListener('submit', async (e) => {
        e.preventDefault();
        sync();
        await busy(document.querySelector('.action-bar .btn'), async () => {
          try {
            const r = await api.post('/nail/purchases', {
              vendor: st.vendor, purchase_date: st.date, account_id: Number(st.account_id),
              items: st.items.map((i) => ({ product_id: i.product_id ? Number(i.product_id) : null, name: i.name, brand: i.brand, unit_price: Number(i.unit_price) || 0, quantity: Number(i.quantity) })),
            });
            invalidate('accounts');
            toast(`已進貨 ${money(r.total)}，庫存已更新`);
            location.hash = '#/nail/stock';
          } catch (err) { showError(err); }
        });
      });
    };
    const sync = () => {
      const v = (id) => el.querySelector(id).value;
      st.vendor = v('#vendor'); st.date = v('#date'); st.account_id = Number(v('#acc'));
    };
    draw();
  },
};
