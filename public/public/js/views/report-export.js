import { monthLabel, todayStr, backHead, segmented, bindSegmented, pickPeriod, icon, esc, toast } from '../ui.js';

const PARTS = [['txns', '交易明細（含明細、類別、專項）', true], ['cats', '類別統計', true], ['budget', '預算執行狀況', true], ['advances', '代墊與收回', false], ['nail', '美甲施做與進貨', false]];

export default {
  async render(el, params, query) {
    let range = 'month';
    let month = /^\d{4}-\d{2}$/.test(query.month || '') ? query.month : todayStr().slice(0, 7);
    let year = month.slice(0, 4);
    let from = `${month}-01`;
    let to = todayStr();
    let format = 'xlsx';

    const period = () => {
      if (range === 'month') {
        const [y, m] = month.split('-').map(Number);
        const end = new Date(y, m, 0).getDate();
        return [`${month}-01`, `${month}-${String(end).padStart(2, '0')}`, monthLabel(month)];
      }
      if (range === 'year') return [`${year}-01-01`, `${year}-12-31`, `${year} 年`];
      return [from, to, `${from} ～ ${to}`];
    };

    const draw = () => {
      const [, , label] = period();
      el.innerHTML = `
        ${backHead('匯出報表', `#/report?month=${month}`)}
        ${segmented('range', [['month', '單月'], ['year', '整年'], ['custom', '自訂區間']], range)}
        ${range === 'custom' ? `<div class="list">
            <div class="field"><label for="from">開始</label><input id="from" type="date" value="${esc(from)}"></div>
            <div class="field"><label for="to">結束</label><input id="to" type="date" value="${esc(to)}"></div>
          </div>`
          : `<button type="button" class="period-btn" id="pick" style="min-height:52px">${esc(label)}<span aria-hidden="true">▾</span></button>`}
        <div class="stack"><span class="muted small">格式</span>
          ${segmented('format', [['xlsx', 'Excel（.xlsx）'], ['csv', 'CSV']], format)}
          <span class="muted small">${format === 'xlsx' ? '每種內容一個工作表。' : 'CSV 只有交易明細，可以用 Excel 或 Google 試算表打開。'}</span>
        </div>
        ${format === 'xlsx' ? `<div class="list">${PARTS.map(([k, l, on]) => `<label class="toggle-row"><span>${l}</span><input type="checkbox" data-part="${k}" ${on ? 'checked' : ''}></label>`).join('')}</div>` : ''}
        <div class="action-bar"><button class="btn" id="go">${icon('download', 18, 2)}匯出 ${esc(label)}</button></div>`;

      bindSegmented(el, 'range', (v) => { range = v; draw(); });
      bindSegmented(el, 'format', (v) => { format = v; draw(); });
      const pick = el.querySelector('#pick');
      if (pick) pick.addEventListener('click', async () => {
        const v = await pickPeriod(range === 'year' ? year : month, { mode: range === 'year' ? 'year' : 'month' });
        if (!v) return;
        if (range === 'year') year = v; else month = v;
        draw();
      });
      ['from', 'to'].forEach((id) => {
        const x = el.querySelector(`#${id}`);
        if (x) x.addEventListener('change', () => { if (id === 'from') from = x.value; else to = x.value; draw(); });
      });
      el.querySelector('#go').addEventListener('click', () => {
        const [f, t] = period();
        if (!f || !t || f > t) return toast('區間不正確', { error: true });
        const parts = [...el.querySelectorAll('[data-part]')].filter((x) => x.checked).map((x) => x.dataset.part);
        const qs = new URLSearchParams({ from: f, to: t, format, parts: (parts.length ? parts : ['txns']).join(',') });
        window.location.href = `/api/export?${qs}`;
        toast('開始下載');
      });
    };
    draw();
  },
};
