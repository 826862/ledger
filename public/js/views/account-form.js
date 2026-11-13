import { api, invalidate } from '../api.js';
import { esc, money, backHead, segmented, bindSegmented, busy, showError, toast, SWATCHES } from '../ui.js';

const CARD_COLORS = ['#9A3412', '#C2410C', '#EA580C', '#FDBA74', '#5B6170'];
const DEPOSIT_COLORS = ['#1E3A8A', '#1D4ED8', '#2563EB', '#93C5FD', '#0F766E'];

function dayOptions(selected) {
  return Array.from({ length: 31 }, (_, i) => i + 1)
    .map((d) => `<option value="${d}" ${d === selected ? 'selected' : ''}>每月 ${d} 日</option>`).join('');
}

export default {
  async render(el, params, query, alive) {
    const editing = Boolean(params.id);
    const acc = editing
      ? await api.get(`/accounts/${params.id}`)
      : { kind: query.kind === 'credit_card' ? 'credit_card' : 'deposit', name: '', opening_balance: 0,
          statement_day: 2, due_day: 20, credit_limit: null, color: null };
    if (!alive()) return;
    let kind = acc.kind;
    let color = acc.color || (kind === 'credit_card' ? CARD_COLORS[0] : DEPOSIT_COLORS[1]);

    const draw = () => {
      const isCard = kind === 'credit_card';
      const colors = [...new Set([...(isCard ? CARD_COLORS : DEPOSIT_COLORS), ...SWATCHES])].slice(0, 6);
      el.innerHTML = `
        ${backHead(editing ? '編輯帳戶' : '新增帳戶', '#/accounts')}
        ${editing ? '' : segmented('kind', [['deposit', '存款帳戶'], ['credit_card', '信用卡']], kind, isCard ? 'card' : '')}
        <form id="f" class="stack" style="gap:16px">
          <div class="list">
            <div class="field"><label for="name">名稱</label>
              <input id="name" value="${esc(acc.name)}" placeholder="${isCard ? '例如：信用卡 A' : '例如：薪轉戶'}" required></div>
            ${isCard ? `
              <div class="field"><label for="sd">結帳日</label><select id="sd">${dayOptions(acc.statement_day || 2)}</select></div>
              <div class="field"><label for="dd">繳款日</label><select id="dd">${dayOptions(acc.due_day || 20)}</select></div>
              <div class="field"><label for="ob">${editing ? '開始記帳時的未繳金額' : '目前未繳金額'}</label>
                <input id="ob" inputmode="numeric" pattern="-?[0-9]*" value="${acc.opening_balance || 0}" class="orange"></div>
              <div class="field"><label for="cl">信用額度（選填）</label>
                <input id="cl" inputmode="numeric" pattern="[0-9]*" value="${acc.credit_limit ?? ''}" placeholder="未設定"></div>`
            : `
              <div class="field"><label for="ob">期初餘額</label>
                <input id="ob" inputmode="numeric" pattern="-?[0-9]*" value="${acc.opening_balance || 0}"></div>`}
          </div>

          <div class="stack">
            <span class="muted small">顏色</span>
            <div class="row" role="group" aria-label="帳戶顏色" id="colors">
              ${colors.map((c) => `<button type="button" class="swatch" data-color="${c}" aria-label="${c}" aria-pressed="${c === color}" style="background:${c}"></button>`).join('')}
            </div>
          </div>

          <div class="note ${isCard ? '' : 'blue'}">
            ${isCard
              ? '結帳日決定哪些消費算進同一期帳單；繳款日若比結帳日晚，視為同月繳款，否則為次月。'
              : '期初餘額是開始用記帳本時帳戶裡的金額，之後的餘額會自動依交易加減。'}
          </div>

          ${editing && !isCard ? `
            <div class="panel stack" style="gap:10px">
              <div class="spread"><span>目前餘額</span><span class="num" style="font-weight:700">${money(acc.balance)}</span></div>
              <button type="button" class="btn ghost small" id="adjust" style="align-self:flex-start">餘額對不上？校正餘額</button>
            </div>` : ''}

          ${editing ? `<button type="button" class="btn danger" id="archive">封存這個帳戶</button>` : ''}
        </form>
        <div class="action-bar"><button class="btn" form="f" type="submit">${editing ? '儲存' : '新增帳戶'}</button></div>
        <dialog class="sheet" id="adjust-sheet">
          <form method="dialog" id="adjust-form">
            <strong>校正餘額</strong>
            <span class="muted small">輸入銀行 App 顯示的實際餘額，系統會自動補一筆校正紀錄。</span>
            <input class="input num" id="actual" inputmode="numeric" pattern="-?[0-9]*" value="${acc.balance ?? 0}">
            <div class="grid-2"><button class="btn ghost" value="cancel" formnovalidate>取消</button><button class="btn" value="ok">確認校正</button></div>
          </form>
        </dialog>`;

      bindSegmented(el, 'kind', (v) => {
        kind = v;
        color = v === 'credit_card' ? CARD_COLORS[0] : DEPOSIT_COLORS[1];
        acc.name = el.querySelector('#name').value;
        draw();
      });
      el.querySelector('#colors').addEventListener('click', (e) => {
        const b = e.target.closest('[data-color]');
        if (!b) return;
        color = b.dataset.color;
        el.querySelectorAll('#colors .swatch').forEach((s) => s.setAttribute('aria-pressed', String(s === b)));
      });

      el.querySelector('#f').addEventListener('submit', async (e) => {
        e.preventDefault();
        const body = {
          name: el.querySelector('#name').value,
          opening_balance: Number(el.querySelector('#ob').value || 0),
          color,
        };
        if (!editing) body.kind = kind;
        if (kind === 'credit_card') {
          body.statement_day = Number(el.querySelector('#sd').value);
          body.due_day = Number(el.querySelector('#dd').value);
          const cl = el.querySelector('#cl').value;
          body.credit_limit = cl === '' ? null : Number(cl);
        }
        await busy(document.querySelector('.action-bar .btn'), async () => {
          try {
            if (editing) await api.put(`/accounts/${params.id}`, body);
            else await api.post('/accounts', body);
            invalidate('accounts');
            toast(editing ? '已儲存' : '已新增帳戶');
            location.hash = '#/accounts';
          } catch (err) { showError(err); }
        });
      });

      const archive = el.querySelector('#archive');
      if (archive) archive.addEventListener('click', async () => {
        if (!confirm('封存後這個帳戶不會再出現在列表與總額裡，過去的交易會保留。確定封存？')) return;
        try {
          await api.put(`/accounts/${params.id}`, { archived: true });
          invalidate('accounts');
          toast('已封存');
          location.hash = '#/accounts';
        } catch (err) { showError(err); }
      });

      const adjust = el.querySelector('#adjust');
      if (adjust) {
        const sheet = el.querySelector('#adjust-sheet');
        adjust.addEventListener('click', () => sheet.showModal());
        sheet.addEventListener('close', async () => {
          if (sheet.returnValue !== 'ok') return;
          try {
            const r = await api.post(`/accounts/${params.id}/adjust`, { actual_balance: Number(el.querySelector('#actual').value) });
            invalidate('accounts');
            toast(r.adjusted ? `已校正 ${r.adjusted > 0 ? '+' : ''}${money(r.adjusted)}` : '餘額一致，不需校正');
            location.hash = '#/accounts';
          } catch (err) { showError(err); }
        });
      }
    };
    draw();
  },
};
