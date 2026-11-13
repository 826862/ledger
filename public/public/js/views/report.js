import { api } from '../api.js';
import { esc, money, icon, monthLabel, todayStr, segmented, bindSegmented, periodBar, bindPeriodBar } from '../ui.js';

const TABS = [['month', '月報'], ['trend', '趨勢'], ['year', '年度'], ['networth', '資產']];
const R = 70;
const C = 2 * Math.PI * R;

function donut(cats, total, label) {
  let offset = 0;
  const gap = cats.length > 1 ? 2 : 0;
  const arcs = cats.map((c) => {
    const len = (c.amount / total) * C;
    const arc = `<circle cx="100" cy="100" r="${R}" fill="none" stroke="${esc(c.category_color)}" stroke-width="26"
      stroke-dasharray="${Math.max(len - gap, 0.1).toFixed(2)} ${C.toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}"></circle>`;
    offset += len;
    return arc;
  }).join('');
  return `<div class="donut" style="width:150px;height:150px;margin:0">
    <svg width="150" height="150" viewBox="0 0 200 200" role="img" aria-label="${esc(cats.map((c) => `${c.category_name} ${c.share_pct}%`).join('、'))}">
      <circle cx="100" cy="100" r="${R}" fill="none" stroke="#EEF0F3" stroke-width="26"></circle>
      <g transform="rotate(-90 100 100)">${arcs}</g>
    </svg>
    <div class="center"><span class="muted small">${label}</span><span class="num" style="font-size:17px;font-weight:700">${money(total)}</span></div>
  </div>`;
}

function delta(cur, prev, { goodWhenDown = true } = {}) {
  const d = cur - prev;
  if (!prev && !cur) return '<span class="muted small">—</span>';
  if (d === 0) return '<span class="muted small">持平</span>';
  const cls = (d < 0) === goodWhenDown ? 'down' : 'up';
  return `<span class="small ${cls}">${d > 0 ? '▲' : '▼'} ${money(Math.abs(d))}</span>`;
}

const tabsHtml = (active, q) => `<nav class="subtabs" aria-label="報表分頁">${TABS.map(([k, l]) =>
  `<a href="#/report?tab=${k}${q}" ${k === active ? 'aria-current="page"' : ''}>${l}</a>`).join('')}</nav>`;

function bars(list, { height = 140, highlight } = {}) {
  const max = Math.max(1, ...list.map((m) => Math.max(m.income, m.expense)));
  return `<div class="row" style="align-items:flex-end;gap:2px;height:${height + 20}px" role="img" aria-label="收入與支出長條圖">
    ${list.map((m) => {
      const on = m.month === highlight;
      return `<a href="#/report?tab=month&month=${m.month}" style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;color:inherit">
        <div style="display:flex;gap:2px;align-items:flex-end;height:${height}px">
          <div style="width:8px;height:${Math.round((m.income / max) * height)}px;background:${on ? '#1D4ED8' : '#93C5FD'};border-radius:3px 3px 0 0"></div>
          <div style="width:8px;height:${Math.round((m.expense / max) * height)}px;background:${on ? '#C2410C' : '#FDBA74'};border-radius:3px 3px 0 0"></div>
        </div>
        <span style="font-size:10px;${on ? 'font-weight:700' : 'color:var(--muted)'}">${Number(m.month.slice(5))}月</span>
      </a>`;
    }).join('')}
  </div>
  <div class="row small muted" style="gap:14px"><span class="row" style="gap:4px"><i style="width:8px;height:8px;border-radius:2px;background:#1D4ED8"></i>收入</span><span class="row" style="gap:4px"><i style="width:8px;height:8px;border-radius:2px;background:#C2410C"></i>支出</span></div>`;
}

function table(list) {
  return `<div class="list" style="padding:4px 16px">
    <div style="display:grid;grid-template-columns:44px repeat(3,minmax(0,1fr));gap:6px;padding:8px 0;font-size:12px;color:var(--muted)"><span>月份</span><span style="text-align:right">支出</span><span style="text-align:right">收入</span><span style="text-align:right">結餘</span></div>
    ${list.map((m) => `<a href="#/report?tab=month&month=${m.month}" style="display:grid;grid-template-columns:44px repeat(3,minmax(0,1fr));gap:6px;padding:9px 0;font-size:13px;color:inherit" class="num">
      <span class="muted">${Number(m.month.slice(5))}月</span><span style="text-align:right">${money(m.expense)}</span>
      <span style="text-align:right;color:var(--blue)">${money(m.income)}</span>
      <span style="text-align:right;font-weight:700;color:${m.income - m.expense < 0 ? '#B42318' : '#15803D'}">${m.income - m.expense < 0 ? '−' : ''}${money(Math.abs(m.income - m.expense))}</span></a>`).join('')}
  </div>`;
}

export default {
  async render(el, params, query, alive) {
    const tab = TABS.some(([k]) => k === query.tab) ? query.tab : 'month';
    const thisMonth = todayStr().slice(0, 7);
    const month = /^\d{4}-\d{2}$/.test(query.month || '') ? query.month : thisMonth;
    const year = /^\d{4}$/.test(query.year || '') ? query.year : month.slice(0, 4);
    const go = (q) => { location.hash = `#/report?${new URLSearchParams(q)}`; };
    const head = `<div class="page-head"><h1>報表</h1>
      <a class="btn ghost small" href="#/report/export?month=${month}" style="min-height:40px">${icon('download', 16)}匯出</a></div>
      ${tabsHtml(tab, tab === 'year' ? `&year=${year}` : `&month=${month}`)}`;

    if (tab === 'month') {
      const type = query.type === 'income' ? 'income' : 'expense';
      const d = await api.get(`/reports/monthly?month=${month}&type=${type}`);
      if (!alive()) return;
      const net = d.income - d.expense;
      const cats = d.categories;
      el.innerHTML = `${head}${periodBar(monthLabel(month))}
        <div class="grid-3">
          <div class="panel stack" style="gap:2px;padding:10px 12px"><span class="muted small">支出</span><span class="num" style="font-size:17px;font-weight:700">${money(d.expense)}</span>${delta(d.expense, d.prev_expense)}</div>
          <div class="panel stack" style="gap:2px;padding:10px 12px"><span class="muted small">收入</span><span class="num blue" style="font-size:17px;font-weight:700">${money(d.income)}</span>${delta(d.income, d.prev_income, { goodWhenDown: false })}</div>
          <div class="panel stack" style="gap:2px;padding:10px 12px"><span class="muted small">結餘</span><span class="num" style="font-size:17px;font-weight:700;color:${net < 0 ? '#B42318' : '#15803D'}">${net < 0 ? '−' : ''}${money(Math.abs(net))}</span><span class="muted small">${d.income ? `存下 ${Math.max(0, Math.round((net / d.income) * 100))}%` : '　'}</span></div>
        </div>
        <div class="panel stack" style="gap:10px;padding:12px 16px">
          ${segmented('type', [['expense', '支出'], ['income', '收入']], type)}
          ${cats.length ? `<div class="row" style="gap:14px">${donut(cats, d.total, type === 'income' ? '收入' : '支出')}<span class="muted small" style="line-height:1.6">點類別看明細與近 6 個月趨勢。▲▼ 是跟上個月比較。</span></div>`
            : `<div class="empty" style="padding:16px">${monthLabel(month)}沒有${type === 'income' ? '收入' : '支出'}紀錄</div>`}
        </div>
        ${cats.length ? `<div class="list">${cats.map((c) => `
          <a href="#/report/category/${c.category_id ?? 'none'}?month=${month}" class="stack" style="gap:6px;padding:10px 0;color:inherit">
            <div class="row" style="gap:8px">
              <span class="dot" style="background:${esc(c.category_color)}"></span>
              <span style="flex:1;font-weight:500">${esc(c.category_name)} <span class="muted small" style="font-weight:400">${c.txn_count} 筆</span></span>
              ${delta(c.amount, c.prev_amount, { goodWhenDown: type === 'expense' })}
              <span class="muted num small" style="width:36px;text-align:right">${Math.round(c.share_pct)}%</span>
              <span class="num" style="font-weight:700;width:64px;text-align:right">${money(c.amount)}</span>
            </div>
            <div class="bar-track" aria-hidden="true"><div style="width:${c.share_pct}%;background:${esc(c.category_color)}"></div></div>
          </a>`).join('')}</div>` : ''}`;
      bindSegmented(el, 'type', (v) => go({ tab, month, type: v }));
      bindPeriodBar(el, { value: month, go: (m) => go({ tab, month: m, type }) });
      return;
    }

    if (tab === 'trend') {
      const d = await api.get(`/reports/trend?months=12&end=${month}`);
      if (!alive()) return;
      const list = d.months;
      const active = list.filter((m) => m.expense || m.income);
      const avg = active.length ? Math.round(active.reduce((x, m) => x + m.expense, 0) / active.length) : 0;
      const hi = active.length ? active.reduce((a, b) => (b.expense > a.expense ? b : a)) : null;
      const lo = active.length ? active.reduce((a, b) => (b.expense < a.expense ? b : a)) : null;
      el.innerHTML = `${head}${periodBar(`到 ${monthLabel(month)} 的 12 個月`)}
        <div class="panel stack" style="gap:10px">${bars(list, { highlight: month })}<span class="muted small">平均每月支出 ${money(avg)}；點長條可以看那個月的月報。</span></div>
        ${hi ? `<div class="grid-2">
          <div class="panel stack" style="gap:2px;padding:12px"><span class="muted small">支出最高</span><span style="font-weight:700">${Number(hi.month.slice(5))} 月 ${money(hi.expense)}</span></div>
          <div class="panel stack" style="gap:2px;padding:12px"><span class="muted small">支出最低</span><span style="font-weight:700">${Number(lo.month.slice(5))} 月 ${money(lo.expense)}</span></div>
        </div>` : ''}
        ${table([...list].reverse())}`;
      bindPeriodBar(el, { value: month, go: (m) => go({ tab, month: m }) });
      return;
    }

    if (tab === 'year') {
      const d = await api.get(`/reports/year?year=${year}`);
      if (!alive()) return;
      const rate = d.income ? Math.round((d.saved / d.income) * 100) : 0;
      el.innerHTML = `${head}${periodBar(`${year} 年`)}
        <div class="panel stack" style="gap:8px">
          <span class="muted small">${year} 年存下</span>
          <span class="big-number" style="color:${d.saved < 0 ? '#B42318' : '#15803D'}">NT$ ${d.saved < 0 ? '−' : ''}${money(Math.abs(d.saved))}</span>
          <div class="row" style="gap:16px;font-size:13px;flex-wrap:wrap"><span>收入 <b class="blue num">${money(d.income)}</b></span><span>支出 <b class="num">${money(d.expense)}</b></span><span class="muted">儲蓄率 ${rate}%</span></div>
        </div>
        ${d.top_categories.length ? `<div class="panel stack" style="gap:8px;padding:12px 16px"><span class="muted small">支出最多的類別</span>
          <div class="row" style="gap:6px;flex-wrap:wrap">${d.top_categories.map((c) => `<span class="tag" style="background:${esc(c.category_color)}">${esc(c.category_name)} ${money(c.amount)}</span>`).join('')}</div></div>` : ''}
        <div class="panel stack">${bars(d.months, { height: 110 })}</div>
        ${table(d.months.filter((m) => m.month <= thisMonth))}`;
      bindPeriodBar(el, { value: year, mode: 'year', go: (y) => go({ tab, year: y }) });
      return;
    }

    // 資產
    const d = await api.get('/reports/networth?months=12');
    if (!alive()) return;
    const pts = d.points;
    const last = pts[pts.length - 1];
    const first = pts[0];
    const vals = pts.flatMap((p) => [p.net, p.deposit]);
    const lo = Math.min(0, ...vals);
    const hi = Math.max(1, ...vals);
    const W = 320;
    const H = 150;
    const xy = (i, v) => `${Math.round((i * W) / Math.max(1, pts.length - 1))},${Math.round(H - ((v - lo) / (hi - lo)) * H)}`;
    const line = (key) => pts.map((p, i) => xy(i, p[key])).join(' ');
    const zeroY = Math.round(H - ((0 - lo) / (hi - lo)) * H);
    el.innerHTML = `${head}
      <div class="panel stack" style="gap:4px">
        <span class="muted small">目前淨資產</span>
        <span class="big-number">NT$ ${last.net < 0 ? '−' : ''}${money(Math.abs(last.net))}</span>
        <span class="small ${last.net - first.net >= 0 ? 'down' : 'up'}">近 12 個月${last.net - first.net >= 0 ? '增加' : '減少'} ${money(Math.abs(last.net - first.net))}</span>
      </div>
      <div class="panel stack" style="gap:8px">
        <div class="row small muted" style="gap:14px"><span class="row" style="gap:4px"><i style="width:14px;height:3px;background:#15181D"></i>淨資產</span><span class="row" style="gap:4px"><i style="width:14px;height:3px;background:#1D4ED8"></i>存款</span></div>
        <svg viewBox="0 -6 ${W} ${H + 12}" width="100%" height="${H + 12}" role="img" aria-label="近 12 個月淨資產與存款變化">
          <line x1="0" y1="${zeroY}" x2="${W}" y2="${zeroY}" stroke="#D6D9DF" stroke-dasharray="4 4"></line>
          <polyline points="${line('deposit')}" fill="none" stroke="#1D4ED8" stroke-width="2.5" stroke-linejoin="round"></polyline>
          <polyline points="${line('net')}" fill="none" stroke="#15181D" stroke-width="2.5" stroke-linejoin="round"></polyline>
        </svg>
        <div class="spread small muted"><span>${first.month.replace('-', '/')}</span><span>虛線為 0</span><span>${last.month.replace('-', '/')}</span></div>
      </div>
      <div class="list">
        <div class="field"><span class="label" style="color:var(--ink)">存款</span><span class="num" style="font-weight:700">${money(last.deposit)}</span></div>
        <div class="field"><span class="label" style="color:var(--ink)">信用卡未繳</span><span class="num orange" style="font-weight:700">−${money(last.card)}</span></div>
        ${last.loan ? `<div class="field"><span class="label" style="color:var(--ink)">貸款</span><span class="num" style="font-weight:700">−${money(last.loan)}</span></div>` : ''}
      </div>
      <span class="muted small">每個月以月底的帳戶餘額計算。</span>`;
  },
};
