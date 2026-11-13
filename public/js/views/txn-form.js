import { api, invalidate } from '../api.js';
import { esc, money, todayStr, icon, segmented, bindSegmented, busy, showError, toast } from '../ui.js';

const LAST_ACCOUNT = 'ledger:lastAccount';

function blankItem(categoryId = '') {
  return { name: '', unit_price: '', quantity: 1, category_id: categoryId };
}

function itemAmount(it) {
  return Math.round((Number(it.unit_price) || 0) * (Number(it.quantity) || 1));
}

export default {
  async render(el, params, query, alive) {
    const editing = Boolean(params.id);
    const [accounts, categories, existing] = await Promise.all([
      api.accounts(),
      api.categories(),
      editing ? api.get(`/transactions/${params.id}`) : null,
    ]);
    if (!alive()) return;

    if (!accounts.length) {
      el.innerHTML = `<div class="page-head center"><a class="icon-btn plain" href="#/" aria-label="返回">${icon('back', 22, 2)}</a><h1>記一筆</h1><span style="width:44px"></span></div>
        <div class="panel empty">要先有帳戶才能記帳。<br><a href="#/accounts/new">新增第一個帳戶</a></div>`;
      return;
    }

    const lastAccount = Number(localStorage.getItem(LAST_ACCOUNT));
    const defaultAccount = accounts.find((a) => a.id === lastAccount) || accounts[0];
    const firstDeposit = accounts.find((a) => a.kind === 'deposit');
    const firstCard = accounts.find((a) => a.kind === 'credit_card');

    const s = existing
      ? {
          type: existing.type,
          txn_date: existing.txn_date,
          account_id: existing.account_id,
          to_account_id: existing.to_account_id || '',
          amount: existing.amount || '',
          title: existing.title,
          note: existing.note || '',
          items: existing.items.length
            ? existing.items.map((i) => ({ name: i.name, unit_price: i.unit_price, quantity: i.quantity, category_id: i.category_id ?? '' }))
            : [blankItem()],
        }
      : {
          type: query.type || 'expense',
          txn_date: todayStr(),
          account_id: defaultAccount.id,
          to_account_id: (firstCard && firstCard.id !== defaultAccount.id ? firstCard : accounts.find((a) => a.id !== defaultAccount.id) || {}).id || '',
          amount: '',
          title: '',
          note: '',
          items: [blankItem()],
        };

    const catsFor = (type) => categories.filter((c) => c.kind === (type === 'income' ? 'income' : 'expense'));
    const ensureCategory = () => {
      const allowed = catsFor(s.type);
      s.items.forEach((it) => {
        if (!allowed.some((c) => c.id === Number(it.category_id))) it.category_id = allowed[0] ? allowed[0].id : '';
      });
    };
    ensureCategory();

    // 轉帳預設：從存款帳戶轉到信用卡（繳卡費最常見）
    const fixTransferDefaults = () => {
      const from = accounts.find((a) => a.id === Number(s.account_id));
      if (from && from.kind === 'credit_card' && firstDeposit) s.account_id = firstDeposit.id;
      if (!s.to_account_id || Number(s.to_account_id) === Number(s.account_id)) {
        const other = (firstCard && firstCard.id !== Number(s.account_id) ? firstCard : null)
          || accounts.find((a) => a.id !== Number(s.account_id));
        s.to_account_id = other ? other.id : '';
      }
    };
    if (!existing && s.type === 'transfer') fixTransferDefaults();

    const accountOptions = (selected, filter = () => true) => accounts.filter(filter)
      .map((a) => `<option value="${a.id}" ${a.id === Number(selected) ? 'selected' : ''}>${esc(a.name)}${a.kind === 'credit_card' ? '（信用卡）' : ''}</option>`).join('');
    const categoryOptions = (selected) => catsFor(s.type)
      .map((c) => `<option value="${c.id}" ${c.id === Number(selected) ? 'selected' : ''}>${esc(c.name)}</option>`).join('');

    const total = () => (s.type === 'transfer' ? Number(s.amount) || 0 : s.items.reduce((sum, it) => sum + itemAmount(it), 0));

    const subtotalText = () => {
      if (s.items.length < 2) return '';
      const map = new Map();
      s.items.forEach((it) => {
        const c = categories.find((x) => x.id === Number(it.category_id));
        const k = c ? c.name : '未分類';
        map.set(k, (map.get(k) || 0) + itemAmount(it));
      });
      return `分類小計：${[...map].map(([k, v]) => `${esc(k)} ${money(v)}`).join('　')}`;
    };

    const itemsHtml = () => s.items.map((it, i) => `
      <div class="item-row" data-i="${i}">
        <input data-k="name" value="${esc(it.name)}" placeholder="${s.items.length > 1 ? `品項 ${i + 1}` : '品項（選填）'}" aria-label="品項名稱">
        <input data-k="unit_price" class="price num" inputmode="numeric" pattern="[0-9]*" value="${esc(it.unit_price)}" placeholder="金額" aria-label="單價">
        <div class="controls">
          <select data-k="category_id" aria-label="分類">${categoryOptions(it.category_id)}</select>
          <input data-k="quantity" class="qty num" inputmode="decimal" value="${esc(it.quantity)}" aria-label="數量">
          <button type="button" class="icon-btn plain" data-remove="${i}" aria-label="刪除這個品項" ${s.items.length === 1 ? 'disabled style="opacity:.3"' : ''}>${icon('trash')}</button>
        </div>
      </div>`).join('');

    const refreshTotals = () => {
      const t = el.querySelector('#total');
      if (t) t.textContent = `NT$ ${money(total())}`;
      const sub = el.querySelector('#subtotal');
      if (sub) sub.innerHTML = subtotalText();
    };

    const draw = () => {
      const isTransfer = s.type === 'transfer';
      const acc = accounts.find((a) => a.id === Number(s.account_id));
      el.innerHTML = `
        <div class="page-head center">
          <a class="icon-btn plain" href="${editing ? '#/transactions' : '#/'}" aria-label="取消">${icon('back', 22, 2)}</a>
          <h1>${editing ? '編輯交易' : '記一筆'}</h1>
          <span style="width:44px"></span>
        </div>
        ${segmented('type', [['expense', '支出'], ['income', '收入'], ['transfer', '轉帳']], s.type)}

        <form id="f" class="stack" style="gap:14px">
          <div class="amount-hero">
            <span class="muted small">${isTransfer ? '轉帳金額' : s.items.length > 1 ? '合計（自動加總品項）' : '金額'}</span>
            ${isTransfer
              ? `<input id="amount" class="num" inputmode="numeric" pattern="[0-9]*" value="${esc(s.amount)}" placeholder="0" aria-label="轉帳金額" required>`
              : `<span class="value" id="total">NT$ ${money(total())}</span>`}
          </div>

          <div class="list">
            <div class="field"><label for="date">日期</label><input id="date" type="date" value="${esc(s.txn_date)}" required></div>
            <div class="field"><label for="acc">${isTransfer ? '轉出帳戶' : s.type === 'income' ? '收款帳戶' : '付款帳戶'}</label>
              <select id="acc" class="${acc && acc.kind === 'credit_card' ? 'orange' : ''}">${accountOptions(s.account_id)}</select></div>
            ${isTransfer ? `
              <div class="field"><label for="to">轉入帳戶</label><select id="to">${accountOptions(s.to_account_id, (a) => a.id !== Number(s.account_id))}</select></div>` : ''}
            <div class="field"><label for="title">標題</label><input id="title" value="${esc(s.title)}" placeholder="${isTransfer ? '例如：繳卡費' : '例如：超市採購'}"></div>
          </div>

          ${isTransfer ? `<div class="note blue">繳信用卡費就是「從存款帳戶轉帳到信用卡」，兩邊餘額會一起更新。也可以到信用卡的帳單頁按「記錄繳款」。</div>` : `
            <div class="spread">
              <h2 class="section" style="font-size:15px">品項（${s.items.length}）</h2>
              <span class="muted small">每個品項各自選分類</span>
            </div>
            <div class="list" id="items">${itemsHtml()}
              <button type="button" class="link-btn" id="add-item" style="min-height:48px">${icon('plus', 18, 2)}新增品項</button>
            </div>
            <div class="muted small" id="subtotal">${subtotalText()}</div>`}

          <div class="list">
            <div class="field"><label for="note">備註</label><input id="note" value="${esc(s.note)}" placeholder="選填"></div>
          </div>

          ${editing ? '<button type="button" class="btn danger" id="del">刪除這筆交易</button>' : ''}
        </form>
        <div class="action-bar"><button class="btn" type="submit" form="f">${editing ? '儲存' : '儲存'}</button></div>`;

      bindSegmented(el, 'type', (v) => {
        sync();
        s.type = v;
        ensureCategory();
        if (v === 'transfer') fixTransferDefaults();
        if (v === 'income' && firstDeposit && accounts.find((a) => a.id === Number(s.account_id)).kind === 'credit_card') {
          s.account_id = firstDeposit.id;
        }
        draw();
      });

      el.querySelector('#acc').addEventListener('change', (e) => {
        sync();
        s.account_id = Number(e.target.value);
        if (Number(s.to_account_id) === s.account_id) {
          const other = accounts.find((a) => a.id !== s.account_id);
          s.to_account_id = other ? other.id : '';
        }
        draw();
      });

      const items = el.querySelector('#items');
      if (items) {
        items.addEventListener('input', (e) => {
          const row = e.target.closest('[data-i]');
          if (!row || !e.target.dataset.k) return;
          s.items[Number(row.dataset.i)][e.target.dataset.k] = e.target.value;
          refreshTotals();
        });
        items.addEventListener('change', (e) => {
          const row = e.target.closest('[data-i]');
          if (!row || e.target.dataset.k !== 'category_id') return;
          s.items[Number(row.dataset.i)].category_id = e.target.value;
          refreshTotals();
        });
        items.addEventListener('click', (e) => {
          const rm = e.target.closest('[data-remove]');
          if (rm && s.items.length > 1) {
            sync();
            s.items.splice(Number(rm.dataset.remove), 1);
            draw();
          }
        });
        el.querySelector('#add-item').addEventListener('click', () => {
          sync();
          const lastCat = s.items[s.items.length - 1].category_id;
          s.items.push(blankItem(lastCat));
          draw();
          const rows = el.querySelectorAll('.item-row');
          rows[rows.length - 1].querySelector('[data-k="name"]').focus();
        });
      }

      el.querySelector('#f').addEventListener('submit', async (e) => {
        e.preventDefault();
        sync();
        const body = {
          type: s.type,
          txn_date: s.txn_date,
          account_id: Number(s.account_id),
          title: s.title,
          note: s.note,
        };
        if (s.type === 'transfer') {
          body.to_account_id = Number(s.to_account_id);
          body.amount = Number(s.amount);
          if (!(body.amount > 0)) return showError({ message: '請輸入轉帳金額' });
        } else {
          const items = s.items.filter((it) => it.unit_price !== '' && it.unit_price !== null);
          if (!items.length) return showError({ message: '請輸入金額' });
          body.items = items.map((it) => ({
            name: it.name,
            unit_price: Number(it.unit_price),
            quantity: Number(it.quantity) || 1,
            category_id: it.category_id ? Number(it.category_id) : null,
          }));
          if (!body.title && body.items.length === 1 && body.items[0].name) body.title = body.items[0].name;
        }
        await busy(document.querySelector('.action-bar .btn'), async () => {
          try {
            if (editing) await api.put(`/transactions/${params.id}`, body);
            else await api.post('/transactions', body);
            localStorage.setItem(LAST_ACCOUNT, String(body.account_id));
            invalidate('accounts');
            toast(editing ? '已儲存' : '已記帳');
            location.hash = editing ? '#/transactions' : '#/';
          } catch (err) { showError(err); }
        });
      });

      const del = el.querySelector('#del');
      if (del) del.addEventListener('click', async () => {
        if (!confirm('確定刪除這筆交易？')) return;
        try {
          await api.del(`/transactions/${params.id}`);
          invalidate('accounts');
          toast('已刪除');
          location.hash = '#/transactions';
        } catch (err) { showError(err); }
      });
    };

    // 把畫面上的值寫回 state
    const sync = () => {
      const v = (id) => { const x = el.querySelector(id); return x ? x.value : undefined; };
      if (v('#date') !== undefined) s.txn_date = v('#date');
      if (v('#acc') !== undefined) s.account_id = Number(v('#acc'));
      if (v('#to') !== undefined) s.to_account_id = Number(v('#to'));
      if (v('#amount') !== undefined) s.amount = v('#amount');
      if (v('#title') !== undefined) s.title = v('#title');
      if (v('#note') !== undefined) s.note = v('#note');
    };

    draw();
  },
};
