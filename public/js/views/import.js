import { api, invalidate } from '../api.js';
import { esc, money, backHead, busy, showError, toast } from '../ui.js';

const KIND = { deposit: '存款', credit_card: '信用卡', loan: '貸款' };
const days = (sel) => Array.from({ length: 31 }, (_, i) => i + 1)
  .map((d) => `<option value="${d}" ${d === Number(sel) ? 'selected' : ''}>${d} 日</option>`).join('');

export default {
  async render(el) {
    let data = null;
    const accounts = await api.accounts();
    const deposits = accounts.filter((a) => a.kind === 'deposit');

    const drawNail = (result) => {
      const bagSum = data.bag.reduce((x, r) => x + r.amount, 0);
      const itemCount = data.purchases.reduce((x, p) => x + p.items.length, 0);
      el.innerHTML = `
        ${backHead('匯入美甲資料', '#/settings')}
        <div class="note">會<b>取代</b>目前美甲的商品庫存、進貨紀錄和拿取紀錄。記帳本的帳戶和交易不會被清空。</div>
        <div class="panel stack" style="gap:6px">
          <span style="font-weight:700">${esc(data.name || '美甲匯入檔')}</span>
          <span class="small">商品庫存 ${data.products.length} 項、拿取紀錄 ${data.usage.length} 筆</span>
          <span class="small">進貨紀錄 ${data.purchases.length} 筆（${itemCount} 個品項）</span>
          <span class="small">10% 收入袋紀錄 ${data.bag.length} 筆，結餘 NT$ ${money(bagSum)}</span>
        </div>
        <div class="list">
          <div class="field"><label for="bag">10% 收入袋帳戶</label>
            <select id="bag"><option value="">新建「美甲 10% 收入袋」</option>${deposits.map((a) => `<option value="${a.id}" ${/收入袋|10%/.test(a.name) ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></div>
        </div>
        <span class="muted small">進貨只做紀錄，不會產生支出（這些消費已經在記帳本裡）。收入袋的紀錄會以餘額調整加到這個帳戶，不算進收支報表；重複匯入會先移除上次匯入的收入袋紀錄。</span>
        <label class="toggle-row"><span>我了解會取代目前的美甲商品、進貨、拿取資料</span><input type="checkbox" id="ok"></label>
        ${result ? `<div class="panel stack" style="gap:6px">
          <span style="font-weight:700">匯入完成</span>
          <span class="small">商品 ${result.products} 項、拿取 ${result.usage} 筆、進貨 ${result.purchases} 筆（${result.purchase_items} 個品項）</span>
          ${result.bag_account ? `<span class="small">${esc(result.bag_account)} 餘額 NT$ ${money(result.bag_balance)}</span>` : ''}
          <a href="#/nail/stock" class="btn small" style="align-self:flex-start">看庫存</a>
        </div>` : '<div class="action-bar"><button class="btn" id="go">開始匯入</button></div>'}`;
      const go = el.querySelector('#go');
      if (go) go.addEventListener('click', async () => {
        if (!el.querySelector('#ok').checked) return showError({ message: '請先勾選確認' });
        await busy(go, async () => {
          try {
            const bag = el.querySelector('#bag').value;
            const r = await api.post('/import/nail', { ...data, replace: true, bag_account_id: bag ? Number(bag) : null });
            invalidate();
            toast('美甲資料匯入完成');
            drawNail(r);
          } catch (err) { showError(err); }
        });
      });
    };

    const draw = (result) => {
      const txns = data ? data.transactions : [];
      const count = (type) => txns.filter((t) => t.type === type).length;
      const datesList = txns.map((t) => t.date).filter(Boolean).sort();
      el.innerHTML = `
        ${backHead('匯入資料', '#/settings')}
        <span class="muted small">記帳資料（ledger_import.json）和美甲資料（nail_import.json）都從這裡匯入，選檔後會自動判斷。</span>
        <div class="note">記帳資料匯入會<b>清空</b>目前記帳本裡的帳戶、交易、預算、專項和美甲資料，再用匯入檔重建。分類會保留。</div>
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
          if (parsed.kind === 'nail') { data = parsed; drawNail(); return; }
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
