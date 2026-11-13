import { api, invalidate } from '../api.js';
import { esc, money, icon, busy, showError, toast } from '../ui.js';
import { nailTabs, serviceRow, productRow } from './nail-common.js';

function setupForm(categories, accounts, cfg) {
  const income = categories.filter((c) => c.kind === 'income');
  const expense = categories.filter((c) => c.kind === 'expense');
  const deposits = accounts.filter((a) => a.kind === 'deposit');
  const pick = (list, id, name) => (id ? Number(id) : (list.find((x) => x.name === name) || {}).id);
  const opt = (list, sel) => list.map((x) => `<option value="${x.id}" ${x.id === Number(sel) ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
  return `<div class="list">
      <div class="field"><label for="n-inc">美甲收入分類</label><select id="n-inc">${opt(income, pick(income, cfg && cfg.income_category_id, '美甲'))}</select></div>
      <div class="field"><label for="n-tool">進貨／工具分類</label><select id="n-tool"><option value="">不指定</option>${opt(expense, pick(expense, cfg && cfg.tool_category_id, '美甲材料'))}</select></div>
      <div class="field"><label for="n-src">美甲收入入帳帳戶</label><select id="n-src">${opt(deposits, cfg && cfg.source_account_id)}</select></div>
      <div class="field"><label for="n-bag">收入袋帳戶</label><select id="n-bag">${opt(deposits, cfg && cfg.bag_account_id)}</select></div>
      <div class="field"><label for="n-rate">每月撥入比例</label>
        <span class="row" style="gap:4px;flex:1;justify-content:flex-end"><input id="n-rate" inputmode="decimal" value="${cfg ? cfg.rate : 10}" style="max-width:70px"><span class="suffix">%</span></span></div>
    </div>`;
}
const readSetup = (root) => ({
  income_category_id: Number(root.querySelector('#n-inc').value),
  tool_category_id: Number(root.querySelector('#n-tool').value) || null,
  source_account_id: Number(root.querySelector('#n-src').value),
  bag_account_id: Number(root.querySelector('#n-bag').value),
  rate: Number(root.querySelector('#n-rate').value) || 10,
});

export default {
  async render(el, params, query, alive) {
    const [d, ov, categories, accounts] = await Promise.all([api.get('/nail'), api.get('/nail/overview'), api.categories(), api.accounts()]);
    if (!alive()) return;
    const deposits = accounts.filter((a) => a.kind === 'deposit');

    if (!d.configured) {
      el.innerHTML = `
        <div class="page-head"><h1>美甲</h1></div>
        <div class="note blue">先設定一次：美甲收入記在哪個分類、錢進哪個帳戶，以及收入袋是哪個帳戶。施做完成時會自動記收入，每個月結束後把上個月美甲收入的 10% 轉進收入袋（標成待核對）。</div>
        ${deposits.length < 2 ? `<div class="note">收入袋要是一個獨立的存款或現金帳戶。<a href="#/accounts/new?kind=deposit">先新增「美甲收入袋」帳戶</a></div>` : ''}
        <form id="f" class="stack" style="gap:14px">${setupForm(categories, accounts, null)}</form>
        <div class="action-bar"><button class="btn" form="f" type="submit" ${deposits.length < 2 ? 'disabled' : ''}>開始使用</button></div>`;
      el.querySelector('#f').addEventListener('submit', async (e) => {
        e.preventDefault();
        await busy(document.querySelector('.action-bar .btn'), async () => {
          try { await api.put('/nail/settings', readSetup(el)); toast('設定完成'); this.render(el, params, query, alive); } catch (err) { showError(err); }
        });
      });
      return;
    }

    const maxHist = Math.max(1, ...d.history.map((h) => h.income));
    el.innerHTML = `
      <div class="page-head">
        <h1>美甲</h1>
        <div class="row" style="gap:8px">
          <button type="button" class="icon-btn" id="settings" aria-label="美甲設定">${icon('sliders', 20)}</button>
          <a class="btn small" href="#/nail/service/new" style="min-height:40px">${icon('plus', 16, 2.2)}新增預約</a>
        </div>
      </div>
      ${nailTabs('home')}
      <div class="grid-3">
        <div class="panel stack" style="gap:2px;padding:12px"><span class="muted small">本月工作室收入</span><span class="num blue" style="font-size:18px;font-weight:700">${money(d.income_total)}</span><span class="muted small">${d.income_count} 筆</span></div>
        <a class="panel stack" href="#/accounts/${d.settings.bag_account_id}/edit" style="gap:2px;padding:12px;color:inherit"><span class="muted small">${esc(d.bag_name || '收入袋')}</span><span class="num" style="font-size:18px;font-weight:700">${money(d.bag_balance)}</span><span class="muted small">本月將撥 ${money(d.allocation_estimate)}</span></a>
        <div class="panel stack" style="gap:2px;padding:12px"><span class="muted small">本月施做</span><span class="num" style="font-size:18px;font-weight:700">${ov.month_done} 次</span><span class="muted small">新客 ${ov.new_customers} 位</span></div>
      </div>

      <section class="stack">
        <div class="spread"><h2 class="section" style="font-size:15px">今天的預約</h2><span class="muted small">${ov.today.length} 位</span></div>
        ${ov.today.length ? `<div class="list">${ov.today.map((s) => serviceRow(s)).join('')}</div>` : '<div class="panel empty" style="padding:14px">今天沒有預約</div>'}
      </section>
      ${ov.upcoming.length ? `<section class="stack"><h2 class="section" style="font-size:15px">接下來</h2><div class="list">${ov.upcoming.map((s) => serviceRow(s, { showDate: true })).join('')}</div></section>` : ''}

      ${ov.low_stock.length ? `<section class="stack">
        <div class="spread"><h2 class="section" style="font-size:15px">庫存快用完</h2><a href="#/nail/stock" style="font-size:13px">看庫存</a></div>
        <div class="list">${ov.low_stock.map((p) => productRow(p, { action: false })).join('')}</div>
      </section>` : ''}

      ${d.history.length > 1 ? `<div class="panel stack" style="gap:10px">
        <span class="muted small">近 6 個月美甲收入</span>
        <div class="row" style="align-items:flex-end;gap:8px;height:110px">
          ${d.history.map((h) => `<div class="stack" style="flex:1;align-items:center;gap:4px;justify-content:flex-end;height:100%">
            <span class="num" style="font-size:10px;color:var(--muted)">${money(h.income)}</span>
            <div style="width:100%;max-width:32px;height:${Math.max(4, Math.round((h.income / maxHist) * 70))}px;background:${h.month.slice(0, 7) === d.month ? '#1D4ED8' : '#93C5FD'};border-radius:6px 6px 2px 2px"></div>
            <span class="small muted">${Number(h.month.slice(5, 7))}月</span></div>`).join('')}
        </div></div>` : ''}

      <div class="grid-2">
        <a class="btn ghost" href="#/add?preset=nail" style="min-height:48px;font-size:14px">手動記美甲收入</a>
        <a class="btn ghost" href="#/add?preset=nailtool" style="min-height:48px;font-size:14px">用收入袋付其他費用</a>
      </div>

      <dialog class="sheet" id="sheet">
        <form method="dialog">
          <strong>美甲設定</strong>
          ${setupForm(categories, accounts, d.settings)}
          <span class="muted small">施做紀錄只記個人工作室；公司的薪水請記成「薪資」收入。</span>
          <div class="grid-2"><button class="btn ghost" value="cancel" formnovalidate>取消</button><button class="btn" value="ok">儲存</button></div>
        </form>
      </dialog>`;

    const sheet = el.querySelector('#sheet');
    el.querySelector('#settings').addEventListener('click', () => sheet.showModal());
    sheet.addEventListener('close', async () => {
      if (sheet.returnValue !== 'ok') return;
      try { await api.put('/nail/settings', readSetup(sheet)); invalidate('accounts'); toast('已儲存'); this.render(el, params, query, alive); } catch (err) { showError(err); }
    });
  },
};
