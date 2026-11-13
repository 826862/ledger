import { api, invalidate } from '../api.js';
import { esc, money, todayStr, backHead, segmented, bindSegmented, busy, showError, toast } from '../ui.js';
import { ITEMS, setupHint } from './nail-common.js';

export default {
  async render(el, params, query, alive) {
    const editing = Boolean(params.sid);
    const [customers, accounts, cfg, existing] = await Promise.all([
      api.get('/nail/customers'),
      api.accounts(),
      api.get('/nail'),
      editing ? api.get(`/nail/services/${params.sid}`) : null,
    ]);
    if (!alive()) return;
    const deposits = accounts.filter((a) => a.kind === 'deposit');
    const s = existing ? { ...existing, items: existing.items || [] } : {
      customer_id: query.customer ? Number(query.customer) : '',
      service_date: todayStr(), service_time: '', part: '手', items: [], extension_count: '', amount: '', deposit: '',
      account_id: cfg.configured ? cfg.settings.source_account_id : (deposits[0] || {}).id, status: 'booked', note: '',
    };
    let newName = '';
    const back = existing && existing.customer_id ? `#/nail/customers/${existing.customer_id}` : query.customer ? `#/nail/customers/${query.customer}` : '#/nail';

    const draw = () => {
      el.innerHTML = `
        ${backHead(editing ? '施做紀錄' : '新增預約', back)}
        ${cfg.configured ? '' : setupHint}
        <form id="f" class="stack" style="gap:14px">
          <div class="list">
            <div class="field"><label for="cust">客戶</label><select id="cust">
              <option value="">＋ 新客戶</option>
              ${customers.map((c) => `<option value="${c.id}" ${c.id === Number(s.customer_id) ? 'selected' : ''}>${esc(c.name)}${c.phone ? `（${esc(c.phone.slice(-3))}）` : ''}</option>`).join('')}
            </select></div>
            ${!s.customer_id ? `<div class="field"><label for="newname">新客戶姓名</label><input id="newname" value="${esc(newName)}" placeholder="例如：林小姐"></div>` : ''}
            <div class="field"><label for="date">日期</label><input id="date" type="date" value="${esc(s.service_date)}"></div>
            <div class="field"><label for="time">時間</label><input id="time" type="time" value="${esc(s.service_time || '')}"></div>
          </div>
          <div class="stack"><span class="muted small">部位</span>${segmented('part', [['手', '手'], ['足', '足']], s.part || '手')}</div>
          <div class="stack"><span class="muted small">項目（可複選）</span>
            <div class="chips" id="items">${ITEMS.map((t) => `<button type="button" class="chip" data-item="${t}" aria-pressed="${s.items.includes(t)}">${t}</button>`).join('')}</div>
          </div>
          <div class="list">
            ${s.items.includes('延甲') ? `<div class="field"><label for="ext">延甲數量</label><input id="ext" class="num" inputmode="numeric" pattern="[0-9]*" value="${esc(s.extension_count ?? '')}" placeholder="0"></div>` : ''}
            <div class="field"><label for="amount">施做金額</label><input id="amount" class="num" inputmode="numeric" pattern="[0-9]*" value="${esc(s.amount)}" placeholder="0" style="font-weight:700;color:var(--blue)"></div>
            <div class="field"><label for="deposit">訂金（選填）</label><input id="deposit" class="num" inputmode="numeric" pattern="[0-9]*" value="${esc(s.deposit || '')}" placeholder="0"></div>
            <div class="field"><label for="acc">收款帳戶</label><select id="acc">${deposits.map((a) => `<option value="${a.id}" ${a.id === Number(s.account_id) ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></div>
            <div class="field"><label for="note">備註</label><input id="note" value="${esc(s.note || '')}" placeholder="選填"></div>
          </div>
          <div class="stack"><span class="muted small">狀態</span>${segmented('status', [['booked', '預約成功'], ['deposit', '已付訂金'], ['done', '施做完成']], s.status)}</div>
          <div class="note blue">${s.status === 'done'
            ? `儲存後，${money(Number(s.amount) || 0)} 會自動記成一筆美甲收入；之後改回其他狀態，收入會一併移除。`
            : '改成「施做完成」時，施做金額會自動記成一筆美甲收入。'}</div>
          ${editing ? '<button type="button" class="btn danger" id="del">刪除這筆施做紀錄</button>' : ''}
        </form>
        <div class="action-bar"><button class="btn" type="submit" form="f">儲存</button></div>`;

      bindSegmented(el, 'part', (v) => { s.part = v; });
      bindSegmented(el, 'status', (v) => { sync(); s.status = v; draw(); });
      el.querySelector('#cust').addEventListener('change', (e) => { sync(); s.customer_id = e.target.value ? Number(e.target.value) : ''; draw(); });
      el.querySelector('#items').addEventListener('click', (e) => {
        const b = e.target.closest('[data-item]');
        if (!b) return;
        sync();
        const t = b.dataset.item;
        s.items = s.items.includes(t) ? s.items.filter((x) => x !== t) : [...s.items, t];
        draw();
      });
      el.querySelector('#f').addEventListener('submit', async (e) => {
        e.preventDefault();
        sync();
        if (!s.customer_id && !newName.trim()) return showError({ message: '請選擇客戶或輸入新客戶姓名' });
        const body = {
          customer_id: s.customer_id || null, new_customer_name: s.customer_id ? null : newName,
          service_date: s.service_date, service_time: s.service_time, part: s.part, items: s.items,
          extension_count: s.items.includes('延甲') ? Number(s.extension_count) || null : null,
          amount: Number(s.amount) || 0, deposit: Number(s.deposit) || 0, account_id: Number(s.account_id) || null,
          status: s.status, note: s.note,
        };
        await busy(document.querySelector('.action-bar .btn'), async () => {
          try {
            const r = editing ? await api.put(`/nail/services/${params.sid}`, body) : await api.post('/nail/services', body);
            invalidate('accounts');
            toast(s.status === 'done' ? '已儲存，並記成美甲收入' : '已儲存');
            location.hash = r.customer_id ? `#/nail/customers/${r.customer_id}` : '#/nail';
          } catch (err) { showError(err); }
        });
      });
      const del = el.querySelector('#del');
      if (del) del.addEventListener('click', async () => {
        if (!confirm('刪除這筆施做紀錄？如果已記成收入，那筆收入也會一起刪除。')) return;
        try { await api.del(`/nail/services/${params.sid}`); invalidate('accounts'); toast('已刪除'); location.hash = back; } catch (err) { showError(err); }
      });
    };
    const sync = () => {
      const v = (id) => { const x = el.querySelector(id); return x ? x.value : undefined; };
      if (v('#newname') !== undefined) newName = v('#newname');
      ['date', 'time', 'amount', 'deposit', 'note', 'acc', 'ext'].forEach((k) => {
        const val = v(`#${k}`);
        if (val === undefined) return;
        if (k === 'date') s.service_date = val;
        else if (k === 'time') s.service_time = val;
        else if (k === 'acc') s.account_id = Number(val);
        else if (k === 'ext') s.extension_count = val;
        else s[k] = val;
      });
    };
    draw();
  },
};
