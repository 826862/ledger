import { api, invalidate } from '../api.js';
import { esc, money, todayStr, icon, segmented, bindSegmented, busy, showError, toast, KIND_LABEL, confirmSheet } from '../ui.js';
import { confirmDeleteTxns } from './txn-list.js';

const LAST_ACCOUNT = 'ledger:lastAccount';

const blank = (categoryId = '', projectId = '') => ({
  name: '', unit_price: '', quantity: 1, category_id: categoryId, project_id: projectId, is_advance: false, advance_person: '',
});
const amountOf = (it) => Math.round((Number(it.unit_price) || 0) * (Number(it.quantity) || 1));
const DISCOUNT_LABELS = ['滿額折', '會員折扣', '優惠券', '點數折抵', '其他折扣'];

// 折扣分攤：target 指定時只折那一筆，否則依金額比例分攤；回傳每筆折後金額
function allocate(items, discount, target) {
  const gross = items.map(amountOf);
  const D = Math.max(0, Math.round(Number(discount) || 0));
  if (!D) return gross;
  if (target !== null && target !== undefined && gross[target] !== undefined) {
    return gross.map((g, i) => (i === Number(target) ? Math.max(0, g - D) : g));
  }
  const G = gross.reduce((a, b) => a + b, 0);
  if (!G) return gross;
  const pay = Math.max(0, G - D);
  const net = gross.map((g) => Math.round((g * pay) / G));
  const diff = pay - net.reduce((a, b) => a + b, 0);
  if (diff) { const k = gross.indexOf(Math.max(...gross)); net[k] += diff; }
  return net;
}

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
                name: i.name,
                unit_price: i.original_amount !== null && i.original_amount !== undefined ? i.original_amount : i.unit_price,
                quantity: i.original_amount !== null && i.original_amount !== undefined ? 1 : i.quantity,
                category_id: i.category_id ?? '',
                project_id: i.project_id ?? '', is_advance: i.is_advance, advance_person: i.advance_person || '',
              }))
            : [blank()],
          discount: {
            amount: existing.discount_amount || 0,
            label: existing.discount_label || '',
            target: existing.discount_amount && existing.items.filter((i) => i.original_amount !== null && i.original_amount !== undefined).length === 1
              && existing.items.length > 1
              ? existing.items.findIndex((i) => i.original_amount !== null && i.original_amount !== undefined) : null,
          },
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
          discount: { amount: 0, label: '', target: null },
        };
    let mode = s.items.length > 1 || s.items.some((i) => i.is_advance) || s.discount.amount ? 'detail' : 'simple';

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

    const nets = () => (mode === 'detail' ? allocate(s.items, s.discount.amount, s.discount.target) : s.items.map(amountOf));
    const subtotal = () => s.items.reduce((x, it) => x + amountOf(it), 0);
    const total = () => (s.type === 'transfer' ? Number(s.amount) || 0 : nets().reduce((a, b) => a + b, 0));
    const advTotal = () => {
      if (s.type !== 'expense') return 0;
      const n = nets();
      return s.items.reduce((x, it, i) => x + (it.is_advance ? n[i] : 0), 0);
    };

    const summary = () => {
      const byCat = new Map();
      const byProj = new Map();
      const n = nets();
      s.items.forEach((it, i) => {
        if (it.is_advance) return;
        const c = catById(it.category_id);
        const k = c ? c.name : '未分類';
        byCat.set(k, (byCat.get(k) || 0) + n[i]);
        if (it.project_id) {
          const p = projById(it.project_id);
          if (p) byProj.set(p.name, (byProj.get(p.name) || 0) + n[i]);
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
          ${s.discount.amount && nets()[i] !== amountOf(it) ? `<span class="small" style="color:#15803D" data-net="${i}">折後 ${money(nets()[i])}</span>` : `<span class="small" style="color:#15803D" data-net="${i}"></span>`}
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
          <span class="muted small" style="text-align:center">一筆裡有不同類別或有折扣？切到上方的「明細」。</span>`;
      } else {
        bodyHtml = `
          <div class="panel stack" style="gap:4px;padding:12px 16px;border:2px solid var(--blue)">
            <label for="title" style="font-size:12px;font-weight:700;color:var(--blue)">店家／大項名稱（必填）</label>
            <input id="title" value="${esc(s.title)}" placeholder="例如：7-11、家樂福" style="border:0;padding:0;font-size:18px;font-weight:700;background:transparent;min-height:32px">
          </div>
          <div class="list">
            <div class="field"><label for="acc">${accLabel}</label><select id="acc" class="${acc && acc.kind === 'credit_card' ? 'orange' : ''}">${accountOptions(s.account_id, notLoan)}</select></div>
            <div class="field"><label for="date">日期</label><input id="date" type="date" value="${esc(s.txn_date)}"></div>
          </div>
          <div class="spread"><h2 class="section" style="font-size:15px">明細（${s.items.length}）</h2><span class="muted small">每筆各自選類別、專項</span></div>
          <div class="list" id="items">${detailRows()}
            <div class="grid-2" style="gap:0">
              <button type="button" class="link-btn" id="add-item" style="min-height:48px;justify-content:center">${icon('plus', 18, 2)}新增明細</button>
              <button type="button" class="link-btn" id="discount" style="min-height:48px;justify-content:center;color:#15803D">${icon('plus', 18, 2)}${s.discount.amount ? '修改折扣' : '折扣'}</button>
            </div>
          </div>
          <div class="panel stack" style="gap:6px;padding:12px 16px">
            ${s.discount.amount ? `<div class="spread small"><span class="muted">小計</span><span class="num" id="subtotal">${money(subtotal())}</span></div>
              <div class="spread small" style="color:#15803D"><span>${esc(s.discount.label || '折扣')}${s.discount.target !== null && s.items[s.discount.target] ? `（${esc(s.items[s.discount.target].name || `明細 ${s.discount.target + 1}`)}）` : ''}</span>
                <span class="row" style="gap:8px"><span class="num">−${money(s.discount.amount)}</span><button type="button" class="link-btn" id="clear-discount" style="font-size:12px;color:var(--muted);min-height:28px">移除</button></span></div>` : ''}
            <div class="spread"><span class="muted" style="font-size:14px">${s.discount.amount ? '實付' : '總金額（明細加總）'}</span><span class="num" style="font-size:22px;font-weight:700" id="total">NT$ ${money(total())}</span></div>
            <div class="muted small" id="summary">${summary()}</div>
            ${s.discount.amount ? '<span class="muted small">折扣依金額比例分攤到每筆明細，報表和預算都用折後金額。</span>' : ''}
          </div>
`;
      }

      el.innerHTML = `
        <div class="page-head center">
          <a class="icon-btn plain" href="${backHref}" aria-label="返回">${icon('back', 22, 2)}</a>
          <h1>${title}</h1><span style="width:44px"></span>
        </div>
        ${segmented('type', [['expense', '支出'], ['income', '收入'], ['transfer', '轉帳']], s.type)}
        ${s.type !== 'transfer' ? segmented('mode', [['simple', '單筆'], ['detail', '明細']], mode) : ''}
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
      const st = el.querySelector('#subtotal');
      if (st) st.textContent = money(subtotal());
      if (s.discount.amount) {
        const n = nets();
        el.querySelectorAll('[data-net]').forEach((x) => {
          const i = Number(x.dataset.net);
          x.textContent = n[i] !== amountOf(s.items[i]) ? `折後 ${money(n[i])}` : '';
        });
      }
      const sm = el.querySelector('#summary');
      if (sm) sm.innerHTML = summary();
    };

    const openDiscount = () => {
      const dlg = document.createElement('dialog');
      dlg.className = 'sheet';
      const sub = subtotal();
      let dmode = 'amount';
      const cur = s.discount;
      dlg.innerHTML = `<div class="stack" style="gap:12px">
        <strong style="font-size:17px">折扣</strong>
        ${segmented('dmode', [['amount', '折扣金額'], ['paid', '輸入實付金額']], dmode)}
        <div class="list">
          <div class="field"><span class="label">明細小計</span><span class="num">${money(sub)}</span></div>
          <div class="field" id="row-amount"><label for="d-amount">折扣金額</label><input id="d-amount" class="num" inputmode="numeric" pattern="[0-9]*" value="${cur.amount || ''}" placeholder="0" style="font-weight:700"></div>
          <div class="field" id="row-paid" hidden><label for="d-paid">收據實付</label><input id="d-paid" class="num" inputmode="numeric" pattern="[0-9]*" value="${cur.amount ? sub - cur.amount : ''}" placeholder="0" style="font-weight:700"></div>
          <div class="field"><label for="d-label">折扣名稱</label><input id="d-label" list="d-labels" value="${esc(cur.label || '滿額折')}"></div>
        </div>
        <datalist id="d-labels">${DISCOUNT_LABELS.map((l) => `<option value="${l}">`).join('')}</datalist>
        ${s.items.length > 1 ? `<label class="toggle-row"><span>只折某一筆明細（例如單品折價）</span><input type="checkbox" id="d-one" ${cur.target !== null ? 'checked' : ''}></label>
          <select class="input" id="d-target" ${cur.target !== null ? '' : 'hidden'}>${s.items.map((it, i) => `<option value="${i}" ${i === cur.target ? 'selected' : ''}>${esc(it.name || `明細 ${i + 1}`)}（${money(amountOf(it))}）</option>`).join('')}</select>` : ''}
        <div class="panel small stack" style="gap:4px" id="d-preview"></div>
        <button type="button" class="btn" data-a="ok">套用折扣</button>
        <button type="button" class="btn ghost" data-a="cancel">取消</button>
      </div>`;
      document.body.appendChild(dlg);
      const q = (x) => dlg.querySelector(x);
      const read = () => {
        const D = dmode === 'paid' ? sub - (Number(q('#d-paid').value) || 0) : Number(q('#d-amount').value) || 0;
        const one = q('#d-one') && q('#d-one').checked;
        return { amount: Math.max(0, Math.min(D, sub)), target: one ? Number(q('#d-target').value) : null };
      };
      const preview = () => {
        const { amount, target } = read();
        if (q('#d-target')) q('#d-target').hidden = !(q('#d-one') && q('#d-one').checked);
        const n = allocate(s.items, amount, target);
        q('#d-preview').innerHTML = amount ? `<span class="muted">折扣 ${money(amount)}，${target !== null ? '只折這一筆' : '依比例分攤'}：</span>${s.items.map((it, i) => `<div class="spread"><span>${esc(it.name || `明細 ${i + 1}`)} ${money(amountOf(it))}</span><span style="color:#15803D">→ ${money(n[i])}</span></div>`).join('')}` : '<span class="muted">輸入折扣後，這裡會顯示每筆明細的折後金額。</span>';
      };
      bindSegmented(dlg, 'dmode', (v) => {
        dmode = v;
        q('#row-amount').hidden = v !== 'amount';
        q('#row-paid').hidden = v !== 'paid';
        preview();
      });
      dlg.addEventListener('input', preview);
      dlg.addEventListener('change', preview);
      const done = () => { dlg.close(); dlg.remove(); };
      dlg.addEventListener('click', (e) => {
        const b = e.target.closest('[data-a]');
        if (!b) return;
        if (b.dataset.a === 'ok') {
          const { amount, target } = read();
          if (sub > 0 && amount >= sub && target === null) { showError({ message: '折扣不能大於或等於小計' }); return; }
          s.discount = { amount, label: q('#d-label').value.trim(), target };
          draw();
        }
        done();
      });
      dlg.addEventListener('cancel', (e) => { e.preventDefault(); done(); });
      preview();
      dlg.showModal();
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

      if (s.type !== 'transfer') bindSegmented(el, 'mode', async (v) => {
        sync();
        if (v === 'detail') {
          mode = 'detail';
          if (!s.items[0].name && s.title) s.items[0].name = s.title;
          if (s.items.length === 1) s.items.push(blank(s.items[0].category_id, projectDefault));
          draw();
          el.querySelector('#title').focus();
          return;
        }
        if (s.items.length > 1 || s.items.some((i) => i.is_advance) || s.discount.amount) {
          const ok = await confirmSheet({
            title: '改回單筆？', body: `會只保留合計 ${money(total())}，類別用第一筆明細的類別。`,
            confirmLabel: '改回單筆', danger: false,
          });
          if (!ok) { draw(); return; }
          const first = s.items[0];
          s.items = [{ ...first, unit_price: total(), quantity: 1, is_advance: false, advance_person: '' }];
          s.discount = { amount: 0, label: '', target: null };
        }
        mode = 'simple';
        draw();
      });

      const discBtn = el.querySelector('#discount');
      if (discBtn) discBtn.addEventListener('click', () => { sync(); openDiscount(); });
      const clearDisc = el.querySelector('#clear-discount');
      if (clearDisc) clearDisc.addEventListener('click', () => { sync(); s.discount = { amount: 0, label: '', target: null }; draw(); });

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
            const k = Number(rm.dataset.remove);
            s.items.splice(k, 1);
            if (s.discount.target === k) s.discount.target = null;
            else if (s.discount.target !== null && s.discount.target > k) s.discount.target -= 1;
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
          const keep = list.map((it) => it.unit_price !== '' && it.unit_price !== null);
          if (!keep.some(Boolean)) return showError({ message: '請輸入金額' });
          if (mode === 'detail' && !String(s.title || '').trim()) {
            const first = (list.find((it) => it.name) || {}).name;
            const ok = first ? await confirmSheet({
              title: '還沒填店家／大項名稱', body: `要用第一筆明細的名稱「${esc(first)}」當標題嗎？`,
              confirmLabel: `用「${esc(first)}」`, cancelLabel: '回去填寫', danger: false,
            }) : false;
            if (!ok) { const t = el.querySelector('#title'); if (t) t.focus(); return showError({ message: '請填寫店家／大項名稱' }); }
            s.title = first;
            body.title = first;
          }
          const netList = mode === 'detail' ? allocate(list, s.discount.amount, s.discount.target) : list.map(amountOf);
          if (mode === 'detail' && s.discount.amount) {
            body.discount_amount = s.discount.amount;
            body.discount_label = s.discount.label || null;
          }
          body.items = list.map((it, i) => ({ it, net: netList[i], gross: amountOf(it) })).filter((_, i) => keep[i]).map(({ it, net, gross }) => ({
            name: mode === 'simple' ? (it.name || s.title || '') : it.name,
            unit_price: net !== gross ? net : Number(it.unit_price),
            quantity: net !== gross ? 1 : Number(it.quantity) || 1,
            original_amount: net !== gross ? gross : null,
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
