import { api, invalidate } from '../api.js';
import { esc, money, todayStr, icon, segmented, bindSegmented, busy, showError, toast, KIND_LABEL } from '../ui.js';
import { confirmDeleteTxns } from './txn-list.js';

const LAST_ACCOUNT = 'ledger:lastAccount';

const blank = (categoryId = '', projectId = '') => ({
  name: '', unit_price: '', quantity: 1, category_id: categoryId, project_id: projectId, is_advance: false, advance_person: '',
});
const amountOf = (it) => Math.round((Number(it.unit_price) || 0) * (Number(it.quantity) || 1));

export default {
  async render(el, params, query, alive) {
    const editing = Boolean(params.id);
    const isNailPreset = query.preset === 'nail' || query.preset === 'nailtool';
    const [accounts, categories, existing, projects, nailCfg] = await Promise.all([
      api.accounts(),
      api.categories(),
      editing ? api.get(`/transactions/${params.id}`) : null,
      api.get('/projects'),
      isNailPreset ? api.get('/nail') : null,
    ]);
    if (!alive()) return;

    const backHref = editing ? '#/transactions' : isNailPreset ? '#/nail' : query.project ? `#/projects/${query.project}` : '#/';
    if (!accounts.length) {
      el.innerHTML = `<div class="page-head center"><a class="icon-btn plain" href="#/" aria-label="返回">${icon('back', 22, 2)}</a><h1>記一筆</h1><span style="width:44px"></span></div>
        <div class="panel empty">要先有帳戶才能記帳。<br><a href="#/accounts/new">新增第一個帳戶</a></div>`;
      return;
    }

    const lastAccount = Number(localStorage.getItem(LAST_ACCOUNT));
    const defaultAccount = accounts.find((a) => a.id === lastAccount && a.kind !== 'loan') || accounts.find((a) => a.kind !== 'loan') || accounts[0];
    const firstDeposit = accounts.find((a) => a.kind === 'deposit');
    const firstCard = accounts.find((a) => a.kind === 'credit_card');
    const projectDefault = query.project || '';

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
            ? existing.items.map((i) => ({
                name: i.name, unit_price: i.unit_price, quantity: i.quantity, category_id: i.category_id ?? '',
                project_id: i.project_id ?? '', is_advance: i.is_advance, advance_person: i.advance_person || '',
              }))
            : [blank()],
        }
      : {
          type: query.type || 'expense',
          txn_date: todayStr(),
          account_id: defaultAccount.id,
          to_account_id: '',
          amount: '',
          title: '',
          note: '',
          items: [blank('', projectDefault)],
        };
    let mode = s.items.length > 1 || s.items.some((i) => i.is_advance) ? 'detail' : 'simple';

    const catsFor = (type) => categories.filter((c) => c.kind === (type === 'income' ? 'income' : 'expense'));
    const ensureCategory = () => {
      const allowed = catsFor(s.type);
      s.items.forEach((it) => {
        if (!allowed.some((c) => c.id === Number(it.category_id))) it.category_id = allowed[0] ? allowed[0].id : '';
      });
    };
    const fixTransfer = () => {
      const from = accounts.find((a) => a.id === Number(s.account_id));
      if (from && from.kind !== 'deposit' && firstDeposit) s.account_id = firstDeposit.id;
      if (!s.to_account_id || Number(s.to_account_id) === Number(s.account_id)) {
        const other = (firstCard && firstCard.id !== Number(s.account_id) ? firstCard : null) || accounts.find((a) => a.id !== Number(s.account_id));
        s.to_account_id = other ? other.id : '';
      }
    };

    // 快速動作與美甲預設
    let presetHint = '';
    if (!existing) {
      const cash = accounts.find((a) => a.kind === 'deposit' && a.is_cash);
      const bank = accounts.find((a) => a.kind === 'deposit' && !a.is_cash);
      if (query.preset === 'withdraw' || query.preset === 'deposit') {
        s.type = 'transfer';
        if (cash && bank) {
          const w = query.preset === 'withdraw';
          s.account_id = w ? bank.id : cash.id;
          s.to_account_id = w ? cash.id : bank.id;
          s.title = w ? '提領現金' : '存入現金';
        } else {
          presetHint = `<div class="note">要先有一個銀行帳戶和一個標記為「現金」的存款帳戶。<a href="#/accounts/new?kind=deposit">新增現金帳戶</a></div>`;
          fixTransfer();
        }
      } else if (s.type === 'transfer') {
        fixTransfer();
      }
      if (nailCfg && nailCfg.configured) {
        const c = nailCfg.settings;
        if (query.preset === 'nail') {
          s.type = 'income';
          s.account_id = c.source_account_id;
          s.items = [blank(c.income_category_id)];
        } else if (query.preset === 'nailtool') {
          s.type = 'expense';
          s.account_id = c.bag_account_id;
          s.title = '美甲工具';
          s.items = [blank(c.tool_category_id || '')];
        }
      }
    }
    ensureCategory();

    const accountOptions = (selected, filter = () => true) => accounts.filter(filter)
      .map((a) => `<option value="${a.id}" ${a.id === Number(selected) ? 'selected' : ''}>${esc(a.name)}${KIND_LABEL[a.kind] || ''}</option>`).join('');
    const notLoan = (a) => a.kind !== 'loan';
    const catById = (id) => categories.find((c) => c.id === Number(id));
    const projById = (id) => projects.find((p) => p.id === Number(id));
    const projectOptions = (sel, none = '不屬於專項') => `<option value="">${none}</option>${projects
      .map((p) => `<option value="${p.id}" ${p.id === Number(sel) ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}`;

    const total = () => (s.type === 'transfer' ? Number(s.amount) || 0 : s.items.reduce((x, it) => x + amountOf(it), 0));
    const advTotal = () => (s.type === 'expense' ? s.items.filter((i) => i.is_advance).reduce((x, it) => x + amountOf(it), 0) : 0);

    const summary = () => {
      const byCat = new Map();
      const byProj = new Map();
      s.items.filter((i) => !i.is_advance).forEach((it) => {
        const c = catById(it.category_id);
        const k = c ? c.name : '未分類';
        byCat.set(k, (byCat.get(k) || 0) + amountOf(it));
        if (it.project_id) {
          const p = projById(it.project_id);
          if (p) byProj.set(p.name, (byProj.get(p.name) || 0) + amountOf(it));
        }
      });
      const parts = [[...byCat].map(([k, v]) => `${esc(k)} ${money(v)}`).join('　')];
      if (byProj.size) parts.push([...byProj].map(([k, v]) => `其中 ${money(v)} 算在 #${esc(k)}`).join('、'));
      const adv = advTotal();
      return `${parts.filter(Boolean).join(' · ')}${adv ? `<div style="color:#6B21A8;margin-top:4px">我的支出 ${money(total() - adv)}　代墊 ${money(adv)}（不算進支出和預算）</div>` : ''}`;
    };

    const detailRows = () => s.items.map((it, i) => {
      const c = catById(it.category_id);
      const p = projById(it.project_id);
      return `<div class="detail-row" data-i="${i}">
        <div class="top">
          <input data-k="name" value="${esc(it.name)}" placeholder="明細 ${i + 1}，例如：三明治" aria-label="明細名稱">
          <input data-k="unit_price" class="price num" inputmode="numeric" pattern="[0-9]*" value="${esc(it.unit_price)}" placeholder="金額" aria-label="金額">
        </div>
        <div class="tags">
          <label class="pill-select cat" style="background:${esc(c ? c.color : '#8A909C')}">${esc(c ? c.name : '選類別')} ▾
            <select data-k="category_id" aria-label="類別">${catsFor(s.type).map((x) => `<option value="${x.id}" ${x.id === Number(it.category_id) ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
          </label>
          ${projects.length ? `<label class="pill-select ${p ? 'on' : ''}">${p ? `#${esc(p.name)}` : '＋專項'}
            <select data-k="project_id" aria-label="專項">${projectOptions(it.project_id)}</select>
          </label>` : ''}
          ${s.type === 'expense' ? `<button type="button" class="adv-pill" data-adv="${i}" aria-pressed="${Boolean(it.is_advance)}">代墊</button>` : ''}
          ${Number(it.quantity) > 1 ? `<span class="muted small">× ${it.quantity}</span>` : ''}
          <span style="flex:1"></span>
          <button type="button" class="icon-btn plain" data-remove="${i}" aria-label="刪除這筆明細" style="width:36px;height:36px" ${s.items.length === 1 ? 'disabled' : ''}>${icon('trash', 18)}</button>
        </div>
        ${s.type === 'expense' && it.is_advance ? `<input data-k="advance_person" value="${esc(it.advance_person)}" placeholder="幫誰代墊？例如：小美" aria-label="代墊對象" style="border-color:#D8B4FE">` : ''}
      </div>`;
    }).join('');

    const draw = () => {
      const isTransfer = s.type === 'transfer';
      const acc = accounts.find((a) => a.id === Number(s.account_id));
      const cats = catsFor(s.type);
      const item0 = s.items[0];
      const accLabel = isTransfer ? '轉出帳戶' : s.type === 'income' ? '收款帳戶' : '付款帳戶';
      const title = editing ? '編輯交易' : query.preset === 'nail' ? '記美甲收入' : query.preset === 'nailtool' ? '用收入袋買工具' : '記一筆';

      let bodyHtml;
      if (isTransfer) {
        bodyHtml = `
          <div class="amount-hero"><span class="muted small">轉帳金額</span>
            <input id="amount" class="num" inputmode="numeric" pattern="[0-9]*" value="${esc(s.amount)}" placeholder="0" aria-label="轉帳金額"></div>
          <div class="list">
            <div class="field"><label for="acc">${accLabel}</label><select id="acc">${accountOptions(s.account_id)}</select></div>
            <div class="field"><label for="to">轉入帳戶</label><select id="to">${accountOptions(s.to_account_id, (a) => a.id !== Number(s.account_id))}</select></div>
            <div class="field"><label for="date">日期</label><input id="date" type="date" value="${esc(s.txn_date)}"></div>
            <div class="field"><label for="title">標題</label><input id="title" value="${esc(s.title)}" placeholder="例如：提領現金"></div>
          </div>
          ${presetHint}
          <div class="note blue">轉帳只移動帳戶之間的錢，不算支出。繳信用卡費建議到帳單頁按「記錄繳款」，繳學貸到帳戶頁按「記錄繳款」。</div>`;
      } else if (mode === 'simple') {
        bodyHtml = `
          <div class="amount-hero"><label class="muted small" for="amount1">金額</label>
            <input id="amount1" class="num" inputmode="numeric" pattern="[0-9]*" value="${esc(item0.unit_price)}" placeholder="0"></div>
          <div class="stack">
            <span class="muted small">類別</span>
            <div class="cat-chips" role="group" aria-label="類別" id="cats">
              ${cats.map((c) => `<button type="button" class="cat-chip" data-cat="${c.id}" aria-pressed="${c.id === Number(item0.category_id)}" ${c.id === Number(item0.category_id) ? `style="background:${esc(c.color)}"` : ''}>${esc(c.name)}</button>`).join('')}
            </div>
          </div>
          <div class="list">
            ${projects.length ? `<div class="field"><label for="proj">專項</label><select id="proj">${projectOptions(item0.project_id)}</select></div>` : ''}
            <div class="field"><label for="acc">${accLabel}</label><select id="acc" class="${acc && acc.kind === 'credit_card' ? 'orange' : ''}">${accountOptions(s.account_id, notLoan)}</select></div>
            <div class="field"><label for="date">日期</label><input id="date" type="date" value="${esc(s.txn_date)}"></div>
            <div class="field"><label for="title">標題</label><input id="title" value="${esc(s.title)}" placeholder="例如：蔥油餅"></div>
          </div>
          <button type="button" class="btn ghost" id="to-detail" style="border-style:dashed">${icon('plus', 18, 2)}拆成明細（一筆裡有不同類別）</button>`;
      } else {
        bodyHtml = `
          <div class="list">
            <div class="field"><label for="title">標題</label><input id="title" value="${esc(s.title)}" placeholder="例如：7-11"></div>
            <div class="field"><label for="acc">${accLabel}</label><select id="acc" class="${acc && acc.kind === 'credit_card' ? 'orange' : ''}">${accountOptions(s.account_id, notLoan)}</select></div>
            <div class="field"><label for="date">日期</label><input id="date" type="date" value="${esc(s.txn_date)}"></div>
          </div>
          <div class="spread"><h2 class="section" style="font-size:15px">明細（${s.items.length}）</h2><span class="muted small">每筆各自選類別、專項</span></div>
          <div class="list" id="items">${detailRows()}
            <button type="button" class="link-btn" id="add-item" style="min-height:48px">${icon('plus', 18, 2)}新增明細</button>
          </div>
          <div class="panel stack" style="gap:6px;padding:12px 16px">
            <div class="spread"><span class="muted" style="font-size:14px">總金額（明細加總）</span><span class="num" style="font-size:22px;font-weight:700" id="total">NT$ ${money(total())}</span></div>
            <div class="muted small" id="summary">${summary()}</div>
          </div>
          ${s.items.length <= 1 && !s.items.some((i) => i.is_advance) ? '<button type="button" class="link-btn" id="to-simple" style="align-self:center">改回簡單模式</button>' : ''}`;
      }

      el.innerHTML = `
        <div class="page-head center">
          <a class="icon-btn plain" href="${backHref}" aria-label="返回">${icon('back', 22, 2)}</a>
          <h1>${title}</h1><span style="width:44px"></span>
        </div>
        ${segmented('type', [['expense', '支出'], ['income', '收入'], ['transfer', '轉帳']], s.type)}
        <form id="f" class="stack" style="gap:14px">
          ${bodyHtml}
          <div class="list"><div class="field"><label for="note">備註</label><input id="note" value="${esc(s.note)}" placeholder="選填"></div></div>
          ${editing ? '<button type="button" class="btn danger" id="del">刪除這筆交易</button>' : ''}
        </form>
        <div class="action-bar"><button class="btn" type="submit" form="f">儲存</button></div>`;
      bind();
    };

    // 畫面 → 狀態
    const sync = () => {
      const v = (id) => { const x = el.querySelector(id); return x ? x.value : undefined; };
      if (v('#date') !== undefined) s.txn_date = v('#date');
      if (v('#acc') !== undefined) s.account_id = Number(v('#acc'));
      if (v('#to') !== undefined) s.to_account_id = Number(v('#to'));
      if (v('#amount') !== undefined) s.amount = v('#amount');
      if (v('#title') !== undefined) s.title = v('#title');
      if (v('#note') !== undefined) s.note = v('#note');
      if (v('#amount1') !== undefined) s.items[0].unit_price = v('#amount1');
      if (v('#proj') !== undefined) s.items[0].project_id = v('#proj');
    };

    const refreshTotals = () => {
      const t = el.querySelector('#total');
      if (t) t.textContent = `NT$ ${money(total())}`;
      const sm = el.querySelector('#summary');
      if (sm) sm.innerHTML = summary();
    };

    const bind = () => {
      bindSegmented(el, 'type', (v) => {
        sync();
        const prev = s.type;
        s.type = v;
        if (v === 'transfer') {
          fixTransfer();
          if (!s.amount && prev !== 'transfer') s.amount = total() || '';
        } else {
          const cur = accounts.find((a) => a.id === Number(s.account_id));
          if (cur && cur.kind === 'loan') s.account_id = (firstDeposit || accounts[0]).id;
          if (v === 'income' && cur && cur.kind === 'credit_card' && firstDeposit) s.account_id = firstDeposit.id;
          if (v === 'income') s.items.forEach((i) => { i.is_advance = false; });
          if (prev === 'transfer' && s.amount && !s.items[0].unit_price) s.items[0].unit_price = s.amount;
          ensureCategory();
        }
        draw();
      });

      const accSel = el.querySelector('#acc');
      if (accSel) accSel.addEventListener('change', () => { sync(); if (s.type === 'transfer') fixTransfer(); draw(); });

      const cats = el.querySelector('#cats');
      if (cats) cats.addEventListener('click', (e) => {
        const b = e.target.closest('[data-cat]');
        if (!b) return;
        sync();
        s.items[0].category_id = Number(b.dataset.cat);
        draw();
      });

      const toDetail = el.querySelector('#to-detail');
      if (toDetail) toDetail.addEventListener('click', () => {
        sync();
        mode = 'detail';
        if (!s.items[0].name && s.title) s.items[0].name = s.title;
        s.items.push(blank(s.items[0].category_id));
        draw();
        const rows = el.querySelectorAll('.detail-row');
        rows[rows.length - 1].querySelector('[data-k="name"]').focus();
      });
      const toSimple = el.querySelector('#to-simple');
      if (toSimple) toSimple.addEventListener('click', () => { sync(); mode = 'simple'; draw(); });

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
          if (!row || !['category_id', 'project_id'].includes(e.target.dataset.k)) return;
          sync();
          s.items[Number(row.dataset.i)][e.target.dataset.k] = e.target.value;
          draw();
        });
        items.addEventListener('click', (e) => {
          const adv = e.target.closest('[data-adv]');
          if (adv) {
            sync();
            const it = s.items[Number(adv.dataset.adv)];
            it.is_advance = !it.is_advance;
            draw();
            if (it.is_advance) el.querySelector(`[data-i="${adv.dataset.adv}"] [data-k="advance_person"]`).focus();
            return;
          }
          const rm = e.target.closest('[data-remove]');
          if (rm && s.items.length > 1) {
            sync();
            s.items.splice(Number(rm.dataset.remove), 1);
            draw();
          }
        });
        el.querySelector('#add-item').addEventListener('click', () => {
          sync();
          const last = s.items[s.items.length - 1];
          s.items.push(blank(last.category_id, projectDefault));
          draw();
          const rows = el.querySelectorAll('.detail-row');
          rows[rows.length - 1].querySelector('[data-k="name"]').focus();
        });
      }

      el.querySelector('#f').addEventListener('submit', async (e) => {
        e.preventDefault();
        sync();
        const body = { type: s.type, txn_date: s.txn_date, account_id: Number(s.account_id), title: s.title, note: s.note };
        if (s.type === 'transfer') {
          body.to_account_id = Number(s.to_account_id);
          body.amount = Number(s.amount);
          if (!(body.amount > 0)) return showError({ message: '請輸入轉帳金額' });
        } else {
          const list = mode === 'simple' ? [s.items[0]] : s.items;
          const filled = list.filter((it) => it.unit_price !== '' && it.unit_price !== null);
          if (!filled.length) return showError({ message: '請輸入金額' });
          body.items = filled.map((it) => ({
            name: mode === 'simple' ? (it.name || s.title || '') : it.name,
            unit_price: Number(it.unit_price),
            quantity: Number(it.quantity) || 1,
            category_id: it.category_id ? Number(it.category_id) : null,
            project_id: it.project_id ? Number(it.project_id) : null,
            is_advance: s.type === 'expense' && mode === 'detail' && Boolean(it.is_advance),
            advance_person: it.advance_person || null,
          }));
        }
        await busy(document.querySelector('.action-bar .btn'), async () => {
          try {
            if (editing) await api.put(`/transactions/${params.id}`, body);
            else await api.post('/transactions', body);
            localStorage.setItem(LAST_ACCOUNT, String(body.account_id));
            invalidate('accounts');
            toast(editing ? '已儲存' : '已記帳');
            location.hash = backHref;
          } catch (err) { showError(err); }
        });
      });

      const del = el.querySelector('#del');
      if (del) del.addEventListener('click', async () => {
        if (!(await confirmDeleteTxns([existing]))) return;
        try {
          await api.del(`/transactions/${params.id}`);
          invalidate('accounts');
          toast('已刪除');
          location.hash = '#/transactions';
        } catch (err) { showError(err); }
      });
    };

    draw();
  },
};
