import { api, invalidate } from '../api.js';
import { esc, money, backHead, busy, showError, toast } from '../ui.js';

const KIND = { deposit: '存款', credit_card: '信用卡', loan: '貸款' };
const days = (sel) => Array.from({ length: 31 }, (_, i) => i + 1)
  .map((d) => `<option value="${d}" ${d === Number(sel) ? 'selected' : ''}>${d} 日</option>`).join('');

export default {
  async render(el) {
    let data = null;

    const draw = (result) => {
      const txns = data ? data.transactions : [];
      const count = (type) => txns.filter((t) => t.type === type).length;
      const datesList = txns.map((t) => t.date).filter(Boolean).sort();
      el.innerHTML = `
        ${backHead('匯入資料', '#/settings')}
        <div class="note">匯入會<b>清空</b>目前記帳本裡的帳戶、交易、預算、專項和美甲資料，再用匯入檔重建。分類會保留。</div>
        <label class="btn ghost" style="cursor:pointer">選擇匯入檔（.json）<input type="file" id="file" accept=".json,application/json" hidden></label>
        ${data ? `
          <div class="panel stack" style="gap:4px">
            <span style="font-weight:700">${esc(data.name || '匯入檔')}</span>
            <span class="muted small">${datesList.length ? `${datesList[0]} ～ ${datesList[datesList.length - 1]}` : ''}</span>
            <span class="small">支出 ${count('expense')} 筆、收入 ${count('income')} 筆、轉帳 ${count('transfer')} 筆、帳戶 ${data.accounts.length} 個</span>
          </div>
          <h2 class="section" style="font-size:15px">帳戶</h2>
          <div class="list" id="accs">
            ${data.accounts.map((a, i) => `
              <div class="stack" style="gap:6px;padding:12px 0">
                <div class="spread"><span style="font-weight:500">${esc(a.name)} <span class="muted small">${KIND[a.kind] || ''}</span></span>
                  <span class="num">${a.kind === 'deposit' ? '期初' : '期初欠款'} ${money(a.opening_balance)}</span></div>
                ${a.kind === 'credit_card' ? `<div class="grid-2">
                  <label class="stack" style="gap:4px"><span class="muted small">結帳日</span><select class="input" data-i="${i}" data-k="statement_day">${days(a.statement_day)}</select></label>
                  <label class="stack" style="gap:4px"><span class="muted small">繳款日</span><select class="input" data-i="${i}" data-k="due_day">${days(a.due_day)}</select></label>
                </div>` : ''}
              </div>`).join('')}
          </div>
          <span class="muted small">信用卡的刷卡會依這裡的結帳日分到各期帳單，繳款日已過的帳單會標成已繳款。之後在帳戶設定改結帳日，也會自動重新分期。</span>
          <label class="toggle-row"><span>我了解會清空目前的資料</span><input type="checkbox" id="ok"></label>` : ''}
        ${result ? `<div class="panel stack" style="gap:8px">
          <span style="font-weight:700">匯入完成：${result.transactions} 筆交易</span>
          ${result.accounts.map((a) => `<div class="spread small"><span>${esc(a.name)}</span><span class="num">${a.kind === 'deposit' ? '' : '欠 '}${money(a.balance)}</span></div>`).join('')}
          <a href="#/accounts" class="btn small" style="align-self:flex-start">看帳戶</a>
        </div>` : ''}
        ${data && !result ? '<div class="action-bar"><button class="btn" id="go">開始匯入</button></div>' : ''}`;

      el.querySelector('#file').addEventListener('change', async (e) => {
        const f = e.target.files[0];
        if (!f) return;
        try {
          const parsed = JSON.parse(await f.text());
          if (!Array.isArray(parsed.accounts) || !Array.isArray(parsed.transactions)) throw new Error('格式不對');
          data = parsed;
          draw();
        } catch { showError({ message: '這個檔案不是記帳本的匯入檔' }); }
      });
      const accs = el.querySelector('#accs');
      if (accs) accs.addEventListener('change', (e) => {
        const s = e.target.closest('[data-k]');
        if (s) data.accounts[Number(s.dataset.i)][s.dataset.k] = Number(s.value);
      });
      const go = el.querySelector('#go');
      if (go) go.addEventListener('click', async () => {
        if (!el.querySelector('#ok').checked) return showError({ message: '請先勾選「我了解會清空目前的資料」' });
        await busy(go, async () => {
          try {
            const r = await api.post('/import', { ...data, wipe: true });
            invalidate();
            toast('匯入完成');
            draw(r);
          } catch (err) { showError(err); }
        });
      });
    };
    draw();
  },
};
