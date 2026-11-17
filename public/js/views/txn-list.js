import { api, invalidate } from '../api.js';
import { money, monthLabel, todayStr, icon, txnRow, groupByDate, dateLabel, periodBar, bindPeriodBar, confirmSheet, makeSwipeable, bindExpand, showError, toast, esc, md } from '../ui.js';

function impactText(list) {
  const parts = [];
  const cards = list.filter((t) => t.account_kind === 'credit_card' && t.type !== 'transfer');
  if (cards.length) parts.push('信用卡帳單金額會跟著減少');
  if (list.some((t) => t.project_name)) parts.push('相關專項的花費會減少');
  if (list.some((t) => t.type === 'expense')) parts.push('預算會加回去');
  if (list.some((t) => t.type === 'transfer')) parts.push('轉帳兩邊的帳戶餘額都會還原');
  return `${parts.length ? `刪除後：${parts.join('；')}。` : ''}這個動作無法復原。`;
}

export async function confirmDeleteTxns(list) {
  const total = list.reduce((s, t) => s + (t.type === 'income' ? 0 : t.total), 0);
  const title = list.length === 1 ? `刪除「${esc(list[0].title || '這筆交易')}」？` : `刪除 ${list.length} 筆交易？`;
  const body = list.length === 1
    ? `${md(list[0].txn_date)} · ${esc(list[0].account_name)} · <b>${money(list[0].total)}</b>${list[0].items.length > 1 ? `<div class="muted small">明細：${list[0].items.map((i) => `${esc(i.name || '')} ${money(i.amount)}`).join('、')}</div>` : ''}`
    : `共 ${money(total)}（不含收入）`;
  return confirmSheet({ title, body, impact: impactText(list), confirmLabel: list.length === 1 ? '刪除' : `刪除 ${list.length} 筆` });
}

export default {
  async render(el, params, query, alive) {
    const month = /^\d{4}-\d{2}$/.test(query.month || '') ? query.month : todayStr().slice(0, 7);
    const txns = await api.get(`/transactions?month=${month}`);
    if (!alive()) return;
    const today = todayStr();
    const filter = ['expense', 'income', 'transfer'].includes(query.f) ? query.f : 'all';
    const all = txns.filter((t) => t.affects_balance && t.txn_date <= today);
    const visible = filter === 'all' ? all : all.filter((t) => (filter === 'transfer' ? ['transfer', 'adjustment'].includes(t.type) : t.type === filter));
    const byId = new Map(visible.map((t) => [t.id, t]));
    let selecting = query.select === '1';
    const selected = new Set();

    const draw = () => {
      const out = all.filter((t) => t.type === 'expense').reduce((x, t) => x + t.total, 0);
      const inc = all.filter((t) => t.type === 'income').reduce((x, t) => x + t.total, 0);
      const groups = groupByDate(visible);
      const row = (t) => {
        if (selecting) {
          const on = selected.has(t.id);
          const locked = Boolean(t.installment_id);
          return `<button type="button" class="list-row" data-pick="${t.id}" ${locked ? 'disabled style="opacity:.45"' : ''}>
            <span class="select-dot ${on ? 'on' : ''}">${on ? icon('check', 14, 3) : ''}</span>
            ${txnRow(t).replace(/^<a class="list-row"[^>]*>|^<div class="list-row"[^>]*>/, '').replace(/<\/a>$|<\/div>$/, '')}
          </button>`;
        }
        return t.installment_id ? txnRow(t) : `<div data-swipe-id="${t.id}">${txnRow(t)}</div>`;
      };
      const selTotal = [...selected].reduce((s, id) => s + (byId.get(id).type === 'income' ? 0 : byId.get(id).total), 0);
      el.innerHTML = `
        <div class="page-head">
          ${selecting ? '<button type="button" class="link-btn" id="cancel" style="color:var(--muted)">取消</button>' : '<h1>明細</h1>'}
          ${selecting ? `<strong>已選 ${selected.size} 筆</strong><button type="button" class="link-btn" id="all">全選</button>`
            : `<button type="button" class="btn ghost small" id="select" style="min-height:40px" ${visible.length ? '' : 'disabled'}>選取</button>`}
        </div>
        ${selecting ? '' : periodBar(monthLabel(month))}
        ${selecting ? '' : `<div class="grid-3">
          <div class="panel stack" style="gap:2px;padding:10px 12px"><span class="muted small">支出</span><span class="num" style="font-size:17px;font-weight:700">${money(out)}</span></div>
          <div class="panel stack" style="gap:2px;padding:10px 12px"><span class="muted small">收入</span><span class="num blue" style="font-size:17px;font-weight:700">${money(inc)}</span></div>
          <div class="panel stack" style="gap:2px;padding:10px 12px"><span class="muted small">筆數</span><span class="num" style="font-size:17px;font-weight:700">${all.length}</span></div>
        </div>
        <div class="chips">${[['all', '全部'], ['expense', '支出'], ['income', '收入'], ['transfer', '轉帳']].map(([k, l]) =>
          `<a class="chip" href="#/transactions?month=${month}${k === 'all' ? '' : `&f=${k}`}" aria-pressed="${filter === k}" style="display:inline-flex;align-items:center">${l}</a>`).join('')}</div>`}
        ${visible.length ? `<div class="list" id="list">${groups.map((g) => `<div class="list-date">${dateLabel(g.date)}</div>${g.items.map(row).join('')}`).join('')}</div>`
          : `<div class="panel empty">${filter === 'all' ? '這個月沒有交易' : '這個月沒有這類交易'}</div>`}
        ${!selecting && visible.length ? '<span class="muted small" style="text-align:center">往左滑可以刪除單筆；按「選取」可以一次刪除多筆</span>' : ''}
        ${selecting ? `<div class="action-bar"><button class="btn danger-solid" id="del" ${selected.size ? '' : 'disabled'}>${selected.size ? `刪除 ${selected.size} 筆（共 ${money(selTotal)}）` : '勾選要刪除的交易'}</button></div>` : ''}`;

      const list = el.querySelector('#list');
      if (selecting) {
        el.querySelector('#cancel').addEventListener('click', () => { selecting = false; selected.clear(); draw(); });
        el.querySelector('#all').addEventListener('click', () => {
          const all = visible.filter((t) => !t.installment_id);
          if (selected.size === all.length) selected.clear(); else all.forEach((t) => selected.add(t.id));
          draw();
        });
        if (list) list.addEventListener('click', (e) => {
          const b = e.target.closest('[data-pick]');
          if (!b) return;
          e.preventDefault();
          const id = Number(b.dataset.pick);
          if (selected.has(id)) selected.delete(id); else selected.add(id);
          draw();
        });
        el.querySelector('#del').addEventListener('click', async () => {
          const items = [...selected].map((id) => byId.get(id));
          if (!(await confirmDeleteTxns(items))) return;
          try {
            const r = await api.post('/transactions/bulk-delete', { ids: [...selected] });
            invalidate('accounts');
            toast(`已刪除 ${r.deleted} 筆${r.skipped ? `，${r.skipped} 筆分期略過` : ''}`);
            this.render(el, params, { month, f: query.f }, alive);
          } catch (err) { showError(err); }
        });
      } else {
        el.querySelector('#select').addEventListener('click', () => { selecting = true; draw(); });
        bindPeriodBar(el, { value: month, go: (m) => { location.hash = `#/transactions?month=${m}${filter === 'all' ? '' : `&f=${filter}`}`; } });
        if (list) bindExpand(list, visible);
        if (list) makeSwipeable(list, async (id) => {
          const t = byId.get(Number(id));
          if (!(await confirmDeleteTxns([t]))) return;
          try {
            await api.del(`/transactions/${id}`);
            invalidate('accounts');
            toast('已刪除');
            this.render(el, params, { month, f: query.f }, alive);
          } catch (err) { showError(err); }
        });
      }
    };
    draw();
  },
};
