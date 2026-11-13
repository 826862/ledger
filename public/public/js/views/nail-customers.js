import { api } from '../api.js';
import { esc, money, md, icon, backHead, showError, toast } from '../ui.js';
import { nailTabs, serviceRow } from './nail-common.js';

function customerSheet(c) {
  return `<dialog class="sheet" id="c-sheet">
    <form method="dialog">
      <strong>${c ? '編輯客戶' : '新增客戶'}</strong>
      <input class="input" id="c-name" placeholder="姓名" value="${esc(c ? c.name : '')}" maxlength="40">
      <input class="input" id="c-phone" placeholder="電話（選填）" inputmode="tel" value="${esc(c ? c.phone || '' : '')}">
      <label class="stack" style="gap:4px"><span class="muted small">生日（選填）</span><input class="input" id="c-bday" type="date" value="${esc(c ? c.birthday || '' : '')}"></label>
      <input class="input" id="c-note" placeholder="備註，例如：喜歡短方圓" value="${esc(c ? c.note || '' : '')}">
      <div class="grid-2"><button class="btn ghost" value="cancel" formnovalidate>取消</button><button class="btn" value="ok">儲存</button></div>
    </form>
  </dialog>`;
}
const readCustomer = (sheet) => ({
  name: sheet.querySelector('#c-name').value,
  phone: sheet.querySelector('#c-phone').value,
  birthday: sheet.querySelector('#c-bday').value || null,
  note: sheet.querySelector('#c-note').value,
});

export default {
  async render(el, params, query, alive) {
    // 客戶詳情
    if (params.cid) {
      const c = await api.get(`/nail/customers/${params.cid}`);
      if (!alive()) return;
      el.innerHTML = `
        ${backHead('客戶', '#/nail/customers', `<button type="button" class="icon-btn" id="edit" aria-label="編輯客戶">${icon('sliders', 20)}</button>`)}
        <div class="panel stack" style="gap:12px">
          <div class="row">
            <span style="width:48px;height:48px;border-radius:24px;background:#FCE7F3;color:#BE185D;display:flex;align-items:center;justify-content:center;font-weight:700;flex-shrink:0">${esc(c.name.slice(0, 1))}</span>
            <div class="stack" style="gap:2px;flex:1;min-width:0"><span style="font-size:17px;font-weight:700">${esc(c.name)}</span>
              <span class="muted small">${[c.phone, c.birthday ? `生日 ${md(c.birthday)}` : ''].filter(Boolean).map(esc).join(' · ') || '　'}</span></div>
          </div>
          <div class="grid-3" style="text-align:center">
            <div><div class="num" style="font-size:18px;font-weight:700">${c.visits}</div><div class="muted small">來店次數</div></div>
            <div><div class="num" style="font-size:18px;font-weight:700">${money(c.total)}</div><div class="muted small">累計消費</div></div>
            <div><div class="num" style="font-size:18px;font-weight:700">${c.last_visit ? md(c.last_visit) : '—'}</div><div class="muted small">上次來店</div></div>
          </div>
          ${c.note ? `<span class="small muted" style="background:var(--bg);border-radius:8px;padding:8px 10px">備註：${esc(c.note)}</span>` : ''}
        </div>
        <a class="btn" href="#/nail/service/new?customer=${c.id}">${icon('plus', 18, 2)}幫${esc(c.name)}新增預約</a>
        <h2 class="section" style="font-size:15px">施做紀錄</h2>
        ${c.services.length ? `<div class="list">${c.services.map((s) => serviceRow(s, { showDate: true, showName: false })).join('')}</div>` : '<div class="panel empty" style="padding:14px">還沒有施做紀錄</div>'}
        <button type="button" class="btn danger" id="del-customer">刪除這位客戶</button>
        ${customerSheet(c)}`;
      el.querySelector('#del-customer').addEventListener('click', async () => {
        const n = c.services.length;
        const choice = await new Promise((resolve) => {
          const dlg = document.createElement('dialog');
          dlg.className = 'sheet';
          dlg.innerHTML = `<div class="stack" style="gap:12px"><strong style="font-size:17px">刪除客戶「${esc(c.name)}」？</strong>
            ${n ? `<span class="muted small">這位客戶有 ${n} 筆施做紀錄。</span>
              <label class="panel row" style="gap:10px;padding:12px 14px;align-items:flex-start"><input type="radio" name="m" value="keep" checked style="width:20px;height:20px">
                <span class="stack" style="gap:2px"><span style="font-weight:500">保留施做紀錄和收入</span><span class="muted small">紀錄會變成「未指定客戶」</span></span></label>
              <label class="panel row" style="gap:10px;padding:12px 14px;align-items:flex-start"><input type="radio" name="m" value="all" style="width:20px;height:20px">
                <span class="stack" style="gap:2px"><span style="font-weight:500;color:#B42318">連同施做紀錄和收入一起刪除</span><span class="muted small">記帳本裡對應的美甲收入也會刪除</span></span></label>` : ''}
            <button type="button" class="btn danger-solid" data-a="go">刪除</button><button type="button" class="btn ghost" data-a="cancel">取消</button></div>`;
          document.body.appendChild(dlg);
          const done = (v) => { dlg.close(); dlg.remove(); resolve(v); };
          dlg.addEventListener('click', (e) => {
            const b = e.target.closest('[data-a]');
            if (!b) return;
            if (b.dataset.a === 'cancel') return done(null);
            const m = dlg.querySelector('input[name="m"]:checked');
            done(m ? m.value : 'keep');
          });
          dlg.addEventListener('cancel', (e) => { e.preventDefault(); done(null); });
          dlg.showModal();
        });
        if (!choice) return;
        try {
          await api.del(`/nail/customers/${c.id}${choice === 'all' ? '?with_services=1' : ''}`);
          toast('已刪除客戶');
          location.hash = '#/nail/customers';
        } catch (err) { showError(err); }
      });
      const sheet = el.querySelector('#c-sheet');
      el.querySelector('#edit').addEventListener('click', () => sheet.showModal());
      sheet.addEventListener('close', async () => {
        if (sheet.returnValue !== 'ok') return;
        try { await api.put(`/nail/customers/${c.id}`, readCustomer(sheet)); toast('已儲存'); this.render(el, params, query, alive); } catch (err) { showError(err); }
      });
      return;
    }

    // 客戶列表
    const q = query.q || '';
    const list = await api.get(`/nail/customers${q ? `?q=${encodeURIComponent(q)}` : ''}`);
    if (!alive()) return;
    el.innerHTML = `
      <div class="page-head"><h1>美甲</h1><button type="button" class="btn small" id="add" style="min-height:40px">${icon('plus', 16, 2.2)}新增客戶</button></div>
      ${nailTabs('customers')}
      <form id="search" role="search"><input class="input" id="q" type="search" value="${esc(q)}" placeholder="搜尋姓名或電話" aria-label="搜尋客戶"></form>
      ${list.length ? `<div class="list">${list.map((c) => `
        <a class="list-row" href="#/nail/customers/${c.id}">
          <span style="width:40px;height:40px;border-radius:20px;background:#FCE7F3;color:#BE185D;display:flex;align-items:center;justify-content:center;font-weight:700;flex-shrink:0">${esc(c.name.slice(0, 1))}</span>
          <div class="body"><span class="title">${esc(c.name)}</span><span class="meta">${[c.phone, `來店 ${c.visits} 次`, c.last_visit ? `上次 ${md(c.last_visit)}` : ''].filter(Boolean).map(esc).join(' · ')}</span></div>
          <span class="amount">${money(c.total)}</span>
        </a>`).join('')}</div>` : `<div class="panel empty">${q ? '找不到符合的客戶' : '還沒有客戶。新增預約時也可以直接建立新客戶。'}</div>`}
      ${customerSheet(null)}`;
    el.querySelector('#search').addEventListener('submit', (e) => {
      e.preventDefault();
      const v = el.querySelector('#q').value.trim();
      location.hash = v ? `#/nail/customers?q=${encodeURIComponent(v)}` : '#/nail/customers';
    });
    const sheet = el.querySelector('#c-sheet');
    el.querySelector('#add').addEventListener('click', () => sheet.showModal());
    sheet.addEventListener('close', async () => {
      if (sheet.returnValue !== 'ok') return;
      try { const c = await api.post('/nail/customers', readCustomer(sheet)); toast('已新增客戶'); location.hash = `#/nail/customers/${c.id}`; } catch (err) { showError(err); }
    });
  },
};
