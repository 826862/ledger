import { api, invalidate } from '../api.js';
import { esc, money, md, icon, daysUntil, txnRow, busy, showError, toast } from '../ui.js';

const STATUS = {
  open: ['尚未對帳', ''],
  reconciled: ['已對帳', 'ok'],
  paid: ['已繳款', 'ok'],
};

export default {
  async render(el, params, query, alive) {
    // 從帳戶頁進來：先找出今天所屬的那一期
    if (params.id && !params.sid) {
      const { id } = await api.get(`/accounts/${params.id}/statements/for-date`);
      if (!alive()) return;
      location.replace(`#/statements/${id}`);
      return;
    }

    const s = await api.get(`/statements/${params.sid}`);
    const [txns, installments, accounts] = await Promise.all([
      api.get(`/transactions?statement_id=${s.id}`),
      api.get(`/accounts/${s.account_id}/installments`),
      api.accounts(),
    ]);
    if (!alive()) return;

    const charges = txns.filter((t) => t.affects_balance && (t.type === 'expense' || t.type === 'income'));
    const normal = charges.filter((t) => !t.installment_id);
    const inst = charges.filter((t) => t.installment_id);
    const normalSum = normal.reduce((sum, t) => sum + (t.type === 'income' ? -t.total : t.total), 0);
    const nearEnd = normal.filter((t) => Math.abs(daysUntil(t.txn_date) - daysUntil(s.period_end)) <= 3);
    const confirmed = s.status !== 'open';
    const due = confirmed && s.statement_amount !== null ? s.statement_amount : s.recorded_amount;
    const [statusLabel, statusClass] = STATUS[s.status];
    const left = daysUntil(s.due_date);
    const deposits = accounts.filter((a) => a.kind === 'deposit');

    el.innerHTML = `
      <div class="page-head center">
        <a class="icon-btn plain" href="#/accounts" aria-label="返回帳戶">${icon('back', 22, 2)}</a>
        <h1>${esc(s.account_name)}</h1>
        <span style="width:44px"></span>
      </div>

      <div class="row" style="justify-content:space-between">
        <a class="icon-btn" href="#/statements/${s.prev_id}" aria-label="上一期">${icon('back', 18, 2)}</a>
        <span class="muted num" style="font-size:14px">${md(s.period_start)} – ${md(s.period_end)} 消費</span>
        <a class="icon-btn" href="#/statements/${s.next_id}" aria-label="下一期">${icon('next', 18, 2)}</a>
      </div>

      <div class="panel stack" style="border:1.5px solid var(--orange-line);gap:6px;padding:18px">
        <div class="spread" style="align-items:center">
          <span class="muted" style="font-size:13px">${confirmed ? '應繳' : '預估應繳'}</span>
          <span class="badge ${statusClass}">${statusLabel}</span>
        </div>
        <span class="big-number orange" style="font-size:32px">NT$ ${money(due)}</span>
        <span class="muted" style="font-size:13px">繳款截止 ${md(s.due_date)}${s.status !== 'paid' && left >= 0 ? `，還有 ${left} 天` : ''}${!confirmed && nearEnd.length ? `；其中 ${nearEnd.length} 筆靠近結帳日，可能跨期` : ''}</span>
        ${s.status !== 'paid' ? `<a class="btn" href="#/statements/${s.id}/reconcile" style="margin-top:6px;min-height:44px;font-size:15px;border-radius:12px">${confirmed ? '重新對帳' : '收到銀行帳單了，開始對帳'}</a>` : ''}
      </div>

      <div class="list">
        <div class="field"><span class="label" style="color:var(--ink)">一般消費 <span class="muted small">${normal.length} 筆</span></span><span class="num" style="font-weight:700">${money(normalSum)}</span></div>
        ${inst.map((t) => {
          const principal = t.items.find((i) => i.name === '本金');
          const interest = t.items.find((i) => i.name === '利息');
          const plan = installments.find((p) => p.id === t.installment_id);
          return `<div class="stack" style="gap:2px;padding:10px 0">
            <div class="spread"><span>${esc(t.title)} <span class="muted small">第 ${t.installment_no} / ${plan ? plan.periods : '?'} 期</span></span><span class="num" style="font-weight:700">${money(t.total)}</span></div>
            <span class="muted small">本金 ${money(principal ? principal.amount : t.total)}${interest ? ` ＋ 利息 ${money(interest.amount)}` : ''}</span>
          </div>`;
        }).join('')}
      </div>

      ${normal.length ? `<div class="stack"><h2 class="section" style="font-size:15px">這期的消費</h2><div class="list">${normal.map(txnRow).join('')}</div></div>` : ''}

      <div class="stack">
        <div class="spread" style="align-items:center">
          <h2 class="section" style="font-size:15px">分期</h2>
          <a class="link-btn" href="#/accounts/${s.account_id}/installments/new">${icon('plus', 16, 2)}新增分期</a>
        </div>
        ${installments.length ? `<div class="list">
          ${installments.map((p) => {
            const pct = Math.round((p.billed_periods / p.periods) * 100);
            return `<div class="stack" style="gap:8px;padding:12px 0">
              <div class="spread"><span style="font-weight:500">${esc(p.name)}</span><span class="muted num" style="font-size:13px">剩餘本金 ${money(p.principal - p.principal_billed)}</span></div>
              <div class="progress" aria-hidden="true"><div style="width:${pct}%"></div></div>
              <div class="spread">
                <span class="muted small">${money(p.principal)} · ${p.periods} 期 · 已入帳 ${p.billed_periods} 期${p.total_interest ? ` · 總利息 ${money(p.total_interest)}` : ''}</span>
                <button type="button" class="link-btn" data-del-inst="${p.id}" style="color:#B42318;min-height:32px;font-size:12px">刪除</button>
              </div>
            </div>`;
          }).join('')}
        </div>` : '<div class="panel empty" style="padding:16px">這張卡沒有分期</div>'}
      </div>

      ${s.status !== 'paid' ? `<div class="action-bar"><button class="btn card" id="pay" ${due > 0 ? '' : 'disabled'}>記錄繳款 ${money(due)}</button></div>` : ''}

      <dialog class="sheet" id="pay-sheet">
        <form method="dialog">
          <strong>記錄繳款</strong>
          ${deposits.length ? `
            <label class="muted small" for="from">從哪個存款帳戶付</label>
            <select class="input" id="from">${deposits.map((a) => `<option value="${a.id}">${esc(a.name)}（餘額 ${money(a.balance)}）</option>`).join('')}</select>
            <label class="muted small" for="pay-amount">金額</label>
            <input class="input num" id="pay-amount" inputmode="numeric" pattern="[0-9]*" value="${due}">
            <div class="grid-2"><button class="btn ghost" value="cancel" formnovalidate>取消</button><button class="btn card" value="ok">確認繳款</button></div>`
          : `<span class="muted">要先新增存款帳戶才能記錄繳款。</span><button class="btn ghost" value="cancel">關閉</button>`}
        </form>
      </dialog>`;

    const pay = el.querySelector('#pay');
    const sheet = el.querySelector('#pay-sheet');
    if (pay) pay.addEventListener('click', () => sheet.showModal());
    sheet.addEventListener('close', async () => {
      if (sheet.returnValue !== 'ok') return;
      await busy(pay, async () => {
        try {
          await api.post(`/statements/${s.id}/pay`, {
            from_account_id: Number(el.querySelector('#from').value),
            amount: Number(el.querySelector('#pay-amount').value),
          });
          invalidate('accounts');
          toast('已記錄繳款');
          location.hash = '#/accounts';
        } catch (err) { showError(err); }
      });
    });

    el.querySelectorAll('[data-del-inst]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('刪除這筆分期會一併移除每一期的入帳紀錄，確定刪除？')) return;
      try {
        await api.del(`/installments/${b.dataset.delInst}`);
        invalidate('accounts');
        toast('已刪除分期');
        this.render(el, params, query, alive);
      } catch (err) { showError(err); }
    }));
  },
};
