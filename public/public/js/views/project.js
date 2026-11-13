import { api } from '../api.js';
import { esc, money, md, txnRow, groupByDate, dateLabel, backHead, showError, toast, confirmSheet } from '../ui.js';

function breakdown(rows, total) {
  if (!rows.length) return '';
  return `<div class="list">${rows.map((c) => {
    const pct = total ? Math.round((c.amount / total) * 100) : 0;
    return `<div class="stack" style="gap:6px;padding:10px 0">
      <div class="row" style="gap:10px">
        <span class="dot" style="background:${esc(c.category_color)}"></span>
        <span style="flex:1">${esc(c.category_name)}</span>
        <span class="muted num small" style="width:40px;text-align:right">${pct}%</span>
        <span class="num" style="font-weight:700;width:72px;text-align:right">${money(c.amount)}</span>
      </div>
      <div class="bar-track" aria-hidden="true"><div style="width:${pct}%;background:${esc(c.category_color)}"></div></div>
    </div>`;
  }).join('')}</div>`;
}

export default {
  async render(el, params, query, alive) {
    const p = await api.get(`/projects/${params.pid}`);
    if (!alive()) return;
    const exp = p.categories.filter((c) => c.type === 'expense');
    const inc = p.categories.filter((c) => c.type === 'income');
    const txns = p.transactions.filter((t) => t.affects_balance || t.installment_id);
    const groups = groupByDate(txns);
    const net = p.income - p.expense;

    el.innerHTML = `
      ${backHead(esc(p.name), '#/projects')}
      ${p.start_date ? `<span class="muted small" style="text-align:center;margin-top:-10px">${md(p.start_date)}${p.end_date ? ` – ${md(p.end_date)}` : ' 起'}</span>` : ''}
      <div class="grid-3">
        <div class="panel stack" style="gap:2px;padding:12px"><span class="muted small">花費</span><span class="num" style="font-size:18px;font-weight:700">${money(p.expense)}</span></div>
        <div class="panel stack" style="gap:2px;padding:12px"><span class="muted small">收入</span><span class="num blue" style="font-size:18px;font-weight:700">${money(p.income)}</span></div>
        <div class="panel stack" style="gap:2px;padding:12px"><span class="muted small">淨額</span><span class="num" style="font-size:18px;font-weight:700;color:${net < 0 ? 'var(--orange)' : 'var(--blue)'}">${net < 0 ? '−' : ''}${money(Math.abs(net))}</span></div>
      </div>
      <a class="btn ghost" href="#/add?project=${p.id}">在這個專項記一筆</a>
      ${exp.length ? `<h2 class="section" style="font-size:15px">花費分類</h2>${breakdown(exp, p.expense)}` : ''}
      ${inc.length ? `<h2 class="section" style="font-size:15px">收入分類</h2>${breakdown(inc, p.income)}` : ''}
      <h2 class="section" style="font-size:15px">交易（${p.txn_count}）</h2>
      ${txns.length ? `<div class="list">${groups.map((g) => `<div class="list-date">${dateLabel(g.date)}</div>${g.items.map(txnRow).join('')}`).join('')}</div>`
        : '<div class="panel empty" style="padding:16px">還沒有交易。記帳時在「專項」選這個專項就會出現在這裡。</div>'}
      <span class="muted small">金額不含代墊；代墊的部分會在交易裡另外標示。</span>
      <div class="grid-2"><button type="button" class="btn ghost" id="archive">${p.archived ? '重新開啟' : '結束專項'}</button><button type="button" class="btn danger" id="delete">刪除專項</button></div>`;
    el.querySelector('#delete').addEventListener('click', async () => {
      const ok = await confirmSheet({
        title: `刪除專項「${esc(p.name)}」？`,
        impact: `${p.txn_count} 筆交易會保留，只是不再標記這個專項。這個動作無法復原。`,
      });
      if (!ok) return;
      try { await api.del(`/projects/${p.id}`); toast('已刪除專項'); location.hash = '#/projects'; } catch (err) { showError(err); }
    });

    el.querySelector('#archive').addEventListener('click', async () => {
      try {
        await api.put(`/projects/${p.id}`, { archived: !p.archived });
        toast(p.archived ? '已重新開啟' : '已結束，記帳時不會再出現在選單');
        location.hash = '#/projects';
      } catch (err) { showError(err); }
    });
  },
};
