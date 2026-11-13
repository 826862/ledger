import { api, invalidate } from '../api.js';
import { esc, money, icon, backHead, segmented, bindSegmented, busy, showError, toast, accountBadge, ICON_CHOICES, recentColors, resizeImage } from '../ui.js';

const COLORS = {
  deposit: ['#1E3A8A', '#1D4ED8', '#2563EB', '#93C5FD', '#0F766E'],
  credit_card: ['#9A3412', '#C2410C', '#EA580C', '#FDBA74', '#5B6170'],
  loan: ['#334155', '#475569', '#64748B', '#0F766E', '#1E3A8A'],
};
const TITLES = { deposit: '存款帳戶', credit_card: '信用卡', loan: '貸款' };

function dayOptions(selected) {
  return Array.from({ length: 31 }, (_, i) => i + 1)
    .map((d) => `<option value="${d}" ${d === selected ? 'selected' : ''}>每月 ${d} 日</option>`).join('');
}

export default {
  async render(el, params, query, alive) {
    const editing = Boolean(params.id);
    const [acc0, accounts] = await Promise.all([
      editing ? api.get(`/accounts/${params.id}`) : null,
      api.accounts(),
    ]);
    if (!alive()) return;
    const initialKind = ['credit_card', 'loan'].includes(query.kind) ? query.kind : 'deposit';
    const acc = acc0 || {
      kind: initialKind, name: '', opening_balance: 0, statement_day: 2, due_day: 20, credit_limit: null,
      color: null, autopay_account_id: null, loan_rate: null, loan_payment: null, loan_day: null, is_cash: false,
    };
    let kind = acc.kind;
    let color = acc.color || COLORS[kind][1];
    let iconType = acc.icon_type || 'auto';
    let iconValue = acc.icon_value || '';
    let iconImage = acc.icon_image || null;
    const deposits = accounts.filter((a) => a.kind === 'deposit' && a.id !== Number(params.id));

    const autopayOptions = (selected) => `<option value="">不自動扣款</option>${deposits
      .map((a) => `<option value="${a.id}" ${a.id === Number(selected) ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}`;

    const draw = () => {
      let fields = '';
      if (kind === 'deposit') {
        fields = `
          <div class="field"><label for="ob">期初餘額</label>
            <input id="ob" inputmode="numeric" pattern="-?[0-9]*" value="${acc.opening_balance || 0}"></div>
          <label class="toggle-row"><span style="font-size:14px;color:var(--muted)">這是現金（錢包）</span>
            <input type="checkbox" id="cash" ${acc.is_cash ? 'checked' : ''}></label>`;
      } else if (kind === 'credit_card') {
        fields = `
          <div class="field"><label for="sd">結帳日</label><select id="sd">${dayOptions(acc.statement_day || 2)}</select></div>
          <div class="field"><label for="dd">繳款日</label><select id="dd">${dayOptions(acc.due_day || 20)}</select></div>
          <div class="field"><label for="ob">${editing ? '開始記帳時的未繳金額' : '目前未繳金額'}</label>
            <input id="ob" inputmode="numeric" pattern="-?[0-9]*" value="${acc.opening_balance || 0}" class="orange"></div>
          <div class="field"><label for="cl">信用額度（選填）</label>
            <input id="cl" inputmode="numeric" pattern="[0-9]*" value="${acc.credit_limit ?? ''}" placeholder="未設定"></div>
          <div class="field"><label for="ap">自動扣繳帳戶</label><select id="ap">${autopayOptions(acc.autopay_account_id)}</select></div>`;
      } else {
        fields = `
          <div class="field"><label for="ob">${editing ? '開始記帳時的剩餘本金' : '目前剩餘本金'}</label>
            <input id="ob" inputmode="numeric" pattern="[0-9]*" value="${acc.opening_balance || 0}"></div>
          <div class="field"><label for="lp">每月繳款金額</label>
            <input id="lp" inputmode="numeric" pattern="[0-9]*" value="${acc.loan_payment ?? ''}" placeholder="0"></div>
          <div class="field"><label for="ld">每月扣款日</label><select id="ld"><option value="">未設定</option>${dayOptions(acc.loan_day)}</select></div>
          <div class="field"><label for="ap">扣款帳戶</label><select id="ap">${autopayOptions(acc.autopay_account_id)}</select></div>`;
      }

      const notes = {
        deposit: '期初餘額是開始用記帳本時帳戶裡的金額，之後的餘額會自動依交易加減。標記為現金的帳戶，會用在「提領現金」「存入現金」快速動作。',
        credit_card: '結帳日決定哪些消費算進同一期帳單；繳款日若比結帳日晚，視為同月繳款，否則為次月。設定自動扣繳後，只有「已對帳」的帳單會在繳款日自動扣款，金額就是對帳時勾選的總額，扣款後會標成待核對。',
        loan: '每月扣款時，整筆繳款金額從扣款帳戶轉到貸款帳戶，紀錄會標成待核對。系統不計算利息；剩餘本金以銀行為準，看到台銀顯示的剩餘本金時，按「更新剩餘本金」輸入即可。',
      };

      el.innerHTML = `
        ${backHead(editing ? `編輯${TITLES[kind]}` : '新增帳戶', '#/accounts')}
        ${editing ? '' : segmented('kind', [['deposit', '存款'], ['credit_card', '信用卡'], ['loan', '貸款']], kind, kind === 'credit_card' ? 'card' : '')}
        <form id="f" class="stack" style="gap:16px">
          <div class="list">
            <div class="field"><label for="name">名稱</label>
              <input id="name" value="${esc(acc.name)}" placeholder="${{ deposit: '例如：台灣銀行、現金', credit_card: '例如：信用卡 A', loan: '例如：學貸' }[kind]}" required></div>
            ${fields}
          </div>

          <div class="panel row" style="padding:12px 16px" id="preview-row">
            <span id="preview">${accountBadge({ kind, color, icon_type: iconType, icon_value: iconValue, icon_image: iconImage, name: acc.name, is_cash: acc.is_cash }, 48)}</span>
            <div class="stack" style="gap:2px;flex:1"><span style="font-weight:500" id="preview-name">${esc(acc.name || '帳戶名稱')}</span><span class="muted small">帳戶列表、記帳選單都會用這個樣式</span></div>
          </div>

          <div class="stack">
            <span class="muted small">圖示</span>
            <div class="grid-2" style="grid-template-columns:repeat(5,minmax(0,1fr));gap:6px" role="group" aria-label="圖示樣式" id="icon-types">
              ${[['auto', '預設'], ['text', '文字'], ['icon', '圖示'], ['emoji', '表情'], ['image', '圖片']].map(([k, l]) => `<button type="button" class="chip" data-itype="${k}" aria-pressed="${iconType === k}" style="min-height:44px;padding:0 4px;font-size:13px;min-width:0">${l}</button>`).join('')}
            </div>
            <div id="icon-extra"></div>
          </div>

          <div class="stack">
            <span class="muted small">顏色</span>
            <div class="panel row" style="padding:12px 16px;gap:12px;flex-wrap:wrap">
              <label class="row" style="gap:10px;cursor:pointer">
                <input type="color" id="color" value="${esc(color)}" style="width:48px;height:48px;border:0;padding:0;background:none;border-radius:24px;cursor:pointer" aria-label="選擇顏色（色環）">
                <span class="small muted">點色塊打開色環</span>
              </label>
              <input id="hex" class="input num" value="${esc(color)}" aria-label="色碼" style="width:110px;min-height:40px;font-size:15px">
              <div class="row" id="recent" style="gap:8px;flex-wrap:wrap;width:100%">
                ${[...new Set([...recentColors(), ...COLORS[kind]])].slice(0, 8).map((c) => `<button type="button" class="swatch" data-color="${c}" aria-label="${c}" aria-pressed="${c.toLowerCase() === color.toLowerCase()}" style="background:${c};width:32px;height:32px;border-width:2px"></button>`).join('')}
              </div>
            </div>
          </div>

          <div class="note ${kind === 'credit_card' ? '' : 'blue'}">${notes[kind]}</div>

          ${editing && kind === 'deposit' ? `
            <div class="panel stack" style="gap:10px">
              <div class="spread"><span>目前餘額</span><span class="num" style="font-weight:700">${money(acc.balance)}</span></div>
              <button type="button" class="btn ghost small" id="adjust" style="align-self:flex-start">餘額對不上？校正餘額</button>
            </div>` : ''}
          ${editing && kind === 'loan' ? `
            <div class="panel stack" style="gap:10px">
              <div class="spread"><span>目前剩餘本金</span><span class="num" style="font-weight:700">${money(acc.balance)}</span></div>
              ${acc.loan_next_date ? `<span class="muted small">下次自動扣款：${acc.loan_next_date}</span>` : ''}
              <button type="button" class="btn ghost small" id="adjust" style="align-self:flex-start">更新剩餘本金</button>
            </div>` : ''}

          ${editing ? `<button type="button" class="btn danger" id="archive">封存這個帳戶</button>` : ''}
        </form>
        <div class="action-bar"><button class="btn" form="f" type="submit">${editing ? '儲存' : '新增帳戶'}</button></div>
        <dialog class="sheet" id="adjust-sheet">
          <form method="dialog">
            <strong>${kind === 'loan' ? '更新剩餘本金' : '校正餘額'}</strong>
            <span class="muted small">${kind === 'loan' ? '輸入台銀顯示的貸款剩餘本金，系統會自動調整，不算支出。' : '輸入銀行 App 顯示的實際餘額，系統會自動補一筆校正紀錄。'}</span>
            <input class="input num" id="actual" inputmode="numeric" pattern="-?[0-9]*" value="${acc.balance ?? 0}">
            <div class="grid-2"><button class="btn ghost" value="cancel" formnovalidate>取消</button><button class="btn" value="ok">確認校正</button></div>
          </form>
        </dialog>`;

      bindSegmented(el, 'kind', (v) => {
        acc.name = el.querySelector('#name').value;
        kind = v;
        if (!acc.color) color = COLORS[v][1];
        draw();
      });
      const updatePreview = () => {
        el.querySelector('#preview').innerHTML = accountBadge({ kind, color, icon_type: iconType, icon_value: iconValue, icon_image: iconImage, name: el.querySelector('#name').value, is_cash: el.querySelector('#cash') ? el.querySelector('#cash').checked : acc.is_cash }, 48);
        el.querySelector('#preview-name').textContent = el.querySelector('#name').value || '帳戶名稱';
      };
      const setColor = (c) => {
        if (!/^#[0-9a-fA-F]{6}$/.test(c)) return;
        color = c;
        el.querySelector('#color').value = c;
        el.querySelector('#hex').value = c;
        el.querySelectorAll('#recent .swatch').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.color.toLowerCase() === c.toLowerCase())));
        updatePreview();
      };
      el.querySelector('#color').addEventListener('input', (e) => setColor(e.target.value));
      el.querySelector('#hex').addEventListener('input', (e) => setColor(e.target.value.trim()));
      el.querySelector('#recent').addEventListener('click', (e) => { const b = e.target.closest('[data-color]'); if (b) setColor(b.dataset.color); });
      el.querySelector('#name').addEventListener('input', updatePreview);

      const drawExtra = () => {
        const box = el.querySelector('#icon-extra');
        if (iconType === 'text') {
          box.innerHTML = `<input class="input" id="icon-text" maxlength="2" value="${esc(iconValue || (el.querySelector('#name').value || '').slice(0, 2))}" placeholder="最多 2 個字，例如：台銀" aria-label="圖示文字">`;
          iconValue = box.querySelector('#icon-text').value;
          box.querySelector('#icon-text').addEventListener('input', (e) => { iconValue = e.target.value; updatePreview(); });
        } else if (iconType === 'icon') {
          if (!ICON_CHOICES.includes(iconValue)) iconValue = ICON_CHOICES[0];
          box.innerHTML = `<div class="row" style="gap:8px;flex-wrap:wrap">${ICON_CHOICES.map((n) => `<button type="button" class="chip" data-icon="${n}" aria-pressed="${n === iconValue}" aria-label="${n}" style="width:48px;padding:0">${icon(n, 22)}</button>`).join('')}</div>`;
          box.querySelectorAll('[data-icon]').forEach((b) => b.addEventListener('click', () => {
            iconValue = b.dataset.icon;
            box.querySelectorAll('[data-icon]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
            updatePreview();
          }));
        } else if (iconType === 'emoji') {
          box.innerHTML = `<input class="input" id="icon-emoji" maxlength="4" value="${esc(iconValue)}" placeholder="貼上或輸入一個表情符號，例如 🏦" aria-label="表情符號">`;
          box.querySelector('#icon-emoji').addEventListener('input', (e) => { iconValue = e.target.value.trim(); updatePreview(); });
        } else if (iconType === 'image') {
          box.innerHTML = `<label class="btn ghost" style="cursor:pointer">${icon('image', 18)}${iconImage ? '換一張圖片' : '選擇圖片'}<input type="file" id="icon-file" accept="image/*" hidden></label>
            <span class="muted small">可以上傳自己存的銀行標誌圖，會自動裁成正方形。</span>`;
          box.querySelector('#icon-file').addEventListener('change', async (e) => {
            const f = e.target.files[0];
            if (!f) return;
            try { iconImage = await resizeImage(f, 96); updatePreview(); drawExtra(); } catch (err) { showError(err); }
          });
        } else {
          box.innerHTML = '';
        }
      };
      el.querySelector('#icon-types').addEventListener('click', (e) => {
        const b = e.target.closest('[data-itype]');
        if (!b) return;
        iconType = b.dataset.itype;
        if (iconType !== 'image') iconValue = iconType === 'icon' ? iconValue : iconType === 'text' || iconType === 'emoji' ? '' : iconValue;
        el.querySelectorAll('#icon-types [data-itype]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        drawExtra();
        updatePreview();
      });
      drawExtra();

      el.querySelector('#f').addEventListener('submit', async (e) => {
        e.preventDefault();
        const v = (id) => { const x = el.querySelector(id); return x ? x.value : ''; };
        const body = {
          name: v('#name'), opening_balance: Number(v('#ob') || 0), color,
          icon_type: iconType === 'image' && !iconImage ? 'auto' : iconType,
          icon_value: ['text', 'icon', 'emoji'].includes(iconType) ? iconValue || null : null,
          icon_image: iconType === 'image' ? iconImage : null,
        };
        recentColors(color);
        if (!editing) body.kind = kind;
        if (kind === 'deposit') body.is_cash = el.querySelector('#cash').checked;
        if (kind === 'credit_card') {
          body.statement_day = Number(v('#sd'));
          body.due_day = Number(v('#dd'));
          body.credit_limit = v('#cl') === '' ? null : Number(v('#cl'));
          body.autopay_account_id = v('#ap') ? Number(v('#ap')) : null;
        }
        if (kind === 'loan') {
          body.loan_payment = v('#lp') === '' ? null : Number(v('#lp'));
          body.loan_day = v('#ld') ? Number(v('#ld')) : null;
          body.autopay_account_id = v('#ap') ? Number(v('#ap')) : null;
          if (body.autopay_account_id && (!body.loan_day || !body.loan_payment)) {
            return showError({ message: '自動扣款需要設定每月繳款金額和扣款日' });
          }
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
            toast(kind === 'loan' ? `剩餘本金已更新為 ${money(r.balance)}`
              : r.adjusted ? `已校正 ${r.adjusted > 0 ? '+' : ''}${money(r.adjusted)}` : '餘額一致，不需校正');
            location.hash = '#/accounts';
          } catch (err) { showError(err); }
        });
      }
    };
    draw();
  },
};
