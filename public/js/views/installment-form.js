import { api, invalidate } from '../api.js';
import { esc, money, todayStr, backHead, segmented, bindSegmented, busy, showError, toast } from '../ui.js';

// 與後端 src/lib/installments.js 相同的算法，用來即時試算
function schedule({ principal, periods, interest_type, apr, fee_per_period }) {
  const rows = [];
  if (!(principal > 0) || !(periods > 0)) return rows;
  if (interest_type === 'apr' && apr > 0) {
    const r = apr / 1200;
    const payment = (principal * r) / (1 - Math.pow(1 + r, -periods));
    let balance = principal;
    for (let k = 1; k <= periods; k++) {
      const interest = Math.round(balance * r);
      let p = Math.round(payment - interest);
      if (k === periods || p > balance) p = balance;
      balance -= p;
      rows.push({ principal: p, interest });
    }
  } else {
    const base = Math.floor(principal / periods);
    const fee = interest_type === 'fixed_fee' ? fee_per_period || 0 : 0;
    for (let k = 1; k <= periods; k++) rows.push({ principal: base + (k === 1 ? principal - base * periods : 0), interest: fee });
  }
  return rows;
}

const PRESETS = [3, 6, 12, 24];

export default {
  async render(el, params, query, alive) {
    const [accounts, categories] = await Promise.all([api.accounts(), api.categories()]);
    if (!alive()) return;
    const cards = accounts.filter((a) => a.kind === 'credit_card');
    const back = `#/accounts/${params.id}/bill`;
    if (!cards.length) {
      el.innerHTML = `${backHead('新增分期', '#/accounts')}<div class="panel empty">要先新增信用卡才能建立分期。</div>`;
      return;
    }
    const expenseCats = categories.filter((c) => c.kind === 'expense');
    const s = {
      account_id: Number(params.id) || cards[0].id,
      name: '',
      principal: '',
      periods: 12,
      interest_type: 'none',
      apr: '',
      fee_per_period: '',
      purchase_date: todayStr(),
      category_id: (expenseCats.find((c) => c.name === '其他') || expenseCats[0] || {}).id || '',
      report_mode: 'full',
      paid: 0,
      next_bill: '',
    };
    // 某張卡從今天起的幾期結帳日
    const billOptions = (card) => {
      const sd = card.statement_day;
      const clamp = (y, m) => { const last = new Date(y, m, 0).getDate(); return `${y}-${String(m).padStart(2, '0')}-${String(Math.min(sd, last)).padStart(2, '0')}`; };
      const [ty, tm] = todayStr().split('-').map(Number);
      let first = clamp(ty, tm);
      if (todayStr() > first) first = clamp(tm === 12 ? ty + 1 : ty, tm === 12 ? 1 : tm + 1);
      const out = [];
      let [y, m] = first.split('-').map(Number);
      // 也列出最近兩期已結帳的帳單（例如剛收到、還沒繳的那期）
      m -= 2; if (m < 1) { m += 12; y -= 1; }
      for (let k = 0; k < 8; k++) {
        out.push(clamp(y, m));
        m += 1; if (m > 12) { m = 1; y += 1; }
      }
      return out;
    };

    const preview = () => {
      const rows = schedule({
        principal: Number(s.principal),
        periods: Number(s.periods),
        interest_type: s.interest_type,
        apr: Number(s.apr),
        fee_per_period: Number(s.fee_per_period),
      });
      const interest = rows.reduce((t, r) => t + r.interest, 0);
      const total = rows.reduce((t, r) => t + r.principal + r.interest, 0);
      const first = rows[0] ? rows[0].principal + rows[0].interest : 0;
      return `
        <div class="stack" style="gap:2px"><span class="small">每期約</span><span class="num" style="font-size:18px;font-weight:700">${money(first)}</span></div>
        <div class="stack" style="gap:2px"><span class="small">總利息</span><span class="num" style="font-size:18px;font-weight:700">${money(interest)}</span></div>
        <div class="stack" style="gap:2px"><span class="small">總還款</span><span class="num" style="font-size:18px;font-weight:700">${money(total)}</span></div>`;
    };

    // 和帳單頁一樣用「消費期間・繳款日」標示，避免把「11 月繳的帳單」和「11 月結帳的帳單」搞混
    const billLabels = (card) => {
      const ends = billOptions(card);
      const md2 = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8))}`;
      const addDay = (d) => { const x = new Date(`${d}T00:00:00`); x.setDate(x.getDate() + 1); return x; };
      const fmt = (x) => `${x.getMonth() + 1}/${x.getDate()}`;
      const dueOf = (end) => {
        const [y, m] = end.split('-').map(Number);
        const sd = card.statement_day;
        const dd = card.due_day;
        let yy = y; let mm = m;
        if (!(dd > sd)) { mm += 1; if (mm > 12) { mm = 1; yy += 1; } }
        const last = new Date(yy, mm, 0).getDate();
        return `${mm}/${Math.min(dd, last)}`;
      };
      return ends.map((end, i) => {
        const prev = i > 0 ? ends[i - 1] : (() => { const [y, m] = end.split('-').map(Number); const pm = m === 1 ? 12 : m - 1; const py = m === 1 ? y - 1 : y; const last = new Date(py, pm, 0).getDate(); return `${py}-${String(pm).padStart(2, '0')}-${String(Math.min(card.statement_day, last)).padStart(2, '0')}`; })();
        return [end, `${fmt(addDay(prev))}–${md2(end)} 消費・${dueOf(end)} 繳款${end < todayStr() ? '（已結帳）' : ''}`];
      });
    };

    const draw = () => {
      if (s.paid && !s.next_bill) {
        const card = cards.find((a) => a.id === Number(s.account_id)) || cards[0];
        s.next_bill = billOptions(card).find((d) => d >= todayStr()) || '';
      }
      const custom = !PRESETS.includes(Number(s.periods));
      el.innerHTML = `
        ${backHead('新增分期', back)}
        <form id="f" class="stack" style="gap:16px">
          <div class="list">
            <div class="field"><label for="name">品項</label><input id="name" value="${esc(s.name)}" placeholder="例如：手機" required></div>
            <div class="field"><label for="acc">刷卡帳戶</label>
              <select id="acc" class="orange">${cards.map((a) => `<option value="${a.id}" ${a.id === s.account_id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></div>
            <div class="field"><label for="principal">分期總額</label><input id="principal" class="num" inputmode="numeric" pattern="[0-9]*" value="${esc(s.principal)}" placeholder="0" required></div>
            <div class="field"><label for="pdate">刷卡日期</label><input id="pdate" type="date" value="${esc(s.purchase_date)}" required></div>
            <div class="field"><label for="cat">分類</label>
              <select id="cat">${expenseCats.map((c) => `<option value="${c.id}" ${c.id === Number(s.category_id) ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
          </div>

          <div class="stack">
            <span class="muted small">期數</span>
            <div class="chips" id="periods" role="group" aria-label="期數">
              ${PRESETS.map((p) => `<button type="button" class="chip" data-p="${p}" aria-pressed="${!custom && Number(s.periods) === p}">${p}</button>`).join('')}
              <input id="custom-p" class="chip num" inputmode="numeric" pattern="[0-9]*" style="width:84px;text-align:center" placeholder="自訂" aria-label="自訂期數" value="${custom ? esc(s.periods) : ''}">
            </div>
          </div>

          <div class="panel stack" style="gap:10px;padding:12px 16px;${s.paid ? 'border:2px solid var(--blue)' : ''}">
            <span style="font-weight:700;font-size:14px;color:${s.paid ? 'var(--blue)' : 'inherit'}">這筆分期已經繳了一部分？</span>
            <div class="spread" style="align-items:center">
              <span>已經繳了</span>
              <span class="row" style="gap:8px">
                <button type="button" class="icon-btn" id="paid-minus" aria-label="減少已繳期數" style="border:1.5px solid var(--border)">−</button>
                <b class="num" style="font-size:18px;min-width:24px;text-align:center" id="paid-n">${s.paid}</b>
                <button type="button" class="icon-btn" id="paid-plus" aria-label="增加已繳期數" style="border:1.5px solid var(--border)">＋</button>
                <span>期</span>
              </span>
            </div>
            ${s.paid ? `<div class="field" style="padding:0;min-height:44px"><label for="next-bill">第 ${s.paid + 1} 期出現在</label>
              <select id="next-bill">${billLabels(cards.find((a) => a.id === Number(s.account_id)) || cards[0]).map(([d, label]) => `<option value="${d}" ${d === s.next_bill ? 'selected' : ''}>${label}</option>`).join('')}</select></div>
              <span class="muted small">選「第 ${s.paid + 1} 期」出現在哪一張帳單（和帳單頁上方顯示的消費期間相同）。已繳的 ${s.paid} 期只做紀錄，不會再算進帳單、餘額或報表；剩下 ${Number(s.periods) - s.paid} 期會照常進每月帳單，報表按期計算。</span>`
              : '<span class="muted small">新刷的分期維持 0；之前就開始繳的分期，選已經繳了幾期。</span>'}
          </div>

          <div class="stack">
            <span class="muted small">利息計算方式</span>
            ${segmented('it', [['none', '零利率'], ['apr', '年利率'], ['fixed_fee', '固定手續費']], s.interest_type)}
            ${s.interest_type === 'apr' ? `<div class="list"><div class="field"><label for="apr">年利率</label>
              <span class="row" style="gap:4px;flex:1;justify-content:flex-end"><input id="apr" class="num" inputmode="decimal" value="${esc(s.apr)}" placeholder="0" style="max-width:90px"><span class="suffix">%</span></span></div></div>` : ''}
            ${s.interest_type === 'fixed_fee' ? `<div class="list"><div class="field"><label for="fee">每期手續費</label>
              <input id="fee" class="num" inputmode="numeric" pattern="[0-9]*" value="${esc(s.fee_per_period)}" placeholder="0"></div></div>` : ''}
          </div>

          <div class="note grid-3" id="preview" style="gap:8px">${preview()}</div>

          <div class="stack">
            <span class="muted small">報表怎麼算這筆消費</span>
            ${segmented('rm', [['full', '刷卡當月全額'], ['spread', '按期攤到每月']], s.report_mode)}
            <span class="muted small">卡費一律按期入帳；這裡只影響分類報表把金額算在哪個月。利息每期都會記在「利息」分類。</span>
          </div>
        </form>
        <div class="action-bar"><button class="btn" type="submit" form="f">${s.paid ? `建立分期（剩 ${Number(s.periods) - s.paid} 期）` : '建立分期'}</button></div>`;

      const sync = () => {
        s.name = el.querySelector('#name').value;
        s.account_id = Number(el.querySelector('#acc').value);
        s.principal = el.querySelector('#principal').value;
        s.purchase_date = el.querySelector('#pdate').value;
        s.category_id = el.querySelector('#cat').value;
        const apr = el.querySelector('#apr');
        if (apr) s.apr = apr.value;
        const fee = el.querySelector('#fee');
        if (fee) s.fee_per_period = fee.value;
        const nb = el.querySelector('#next-bill');
        if (nb) s.next_bill = nb.value;
      };
      const setPaid = (n) => {
        sync();
        const max = Math.max(0, Number(s.periods) - 1);
        s.paid = Math.max(0, Math.min(max, n));
        if (s.paid && s.report_mode === 'full') s.report_mode = 'spread';
        draw();
      };
      el.querySelector('#paid-minus').addEventListener('click', () => setPaid(s.paid - 1));
      el.querySelector('#acc').addEventListener('change', () => { if (s.paid) { sync(); s.next_bill = ''; draw(); } });
      el.querySelector('#paid-plus').addEventListener('click', () => setPaid(s.paid + 1));
      const refresh = () => { sync(); el.querySelector('#preview').innerHTML = preview(); };

      el.querySelector('#f').addEventListener('input', (e) => {
        if (e.target.id === 'custom-p') {
          s.periods = Number(e.target.value) || 0;
          el.querySelectorAll('#periods .chip[data-p]').forEach((c) => c.setAttribute('aria-pressed', 'false'));
        }
        refresh();
      });
      el.querySelector('#periods').addEventListener('click', (e) => {
        const b = e.target.closest('[data-p]');
        if (!b) return;
        s.periods = Number(b.dataset.p);
        el.querySelector('#custom-p').value = '';
        el.querySelectorAll('#periods .chip[data-p]').forEach((c) => c.setAttribute('aria-pressed', String(c === b)));
        refresh();
      });
      bindSegmented(el, 'it', (v) => { sync(); s.interest_type = v; draw(); });
      bindSegmented(el, 'rm', (v) => { s.report_mode = v; });

      el.querySelector('#f').addEventListener('submit', async (e) => {
        e.preventDefault();
        sync();
        if (!(Number(s.periods) > 0)) return showError({ message: '請選擇期數' });
        await busy(document.querySelector('.action-bar .btn'), async () => {
          try {
            await api.post('/installments', {
              account_id: s.account_id,
              name: s.name,
              principal: Number(s.principal),
              periods: Number(s.periods),
              interest_type: s.interest_type,
              apr: s.interest_type === 'apr' ? Number(s.apr) : null,
              fee_per_period: s.interest_type === 'fixed_fee' ? Number(s.fee_per_period) : null,
              purchase_date: s.purchase_date,
              category_id: s.category_id ? Number(s.category_id) : null,
              report_mode: s.report_mode,
              paid_periods: s.paid,
              next_bill_date: s.paid ? (s.next_bill || el.querySelector('#next-bill').value) : null,
            });
            invalidate('accounts');
            toast('已建立分期');
            location.hash = `#/accounts/${s.account_id}/bill`;
          } catch (err) { showError(err); }
        });
      });
    };
    draw();
  },
};
