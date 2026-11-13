import { api, invalidate } from '../api.js';
import { esc, money, md, icon, monthLabel, shiftMonth, todayStr, backHead, segmented, bindSegmented, busy, showError, toast } from '../ui.js';

const CYCLE = { monthly: '每月', bimonthly: '每兩個月', yearly: '每年' };

function barColor(spent, budget) {
  if (!budget) return '#8A909C';
  const r = spent / budget;
  if (r > 1) return '#B42318';
  if (r >= 0.8) return '#EA580C';
  return '#1D4ED8';
}

export default {
  async render(el, params, query, alive) {
    const month = /^\d{4}-\d{2}$/.test(query.month || '') ? query.month : todayStr().slice(0, 7);
    const [b, accounts, categories, subs] = await Promise.all([
      api.get(`/budget?month=${month}`),
      api.accounts(),
      api.categories(),
      api.get('/subscriptions'),
    ]);
    if (!alive()) return;
    const expenseCats = categories.filter((c) => c.kind === 'expense');
    const payAccounts = accounts.filter((a) => a.kind !== 'loan');
    let editing = query.edit === '1';
    let scope = 'default';

    const draw = () => {
      const withBudget = b.categories.filter((c) => c.budget !== null);
      const without = b.categories.filter((c) => c.budget === null && c.spent > 0);
      const pct = b.total_budget ? Math.min(100, Math.round((b.budgeted_spent / b.total_budget) * 100)) : 0;

      el.innerHTML = `
        ${backHead('預算', '#/settings')}
        <div class="row" style="justify-content:space-between">
          <a class="icon-btn" href="#/budget?month=${shiftMonth(month, -1)}" aria-label="上個月">${icon('back', 18, 2)}</a>
          <span style="font-weight:700">${monthLabel(month)}</span>
          <a class="icon-btn" href="#/budget?month=${shiftMonth(month, 1)}" aria-label="下個月">${icon('next', 18, 2)}</a>
        </div>

        ${b.total_budget ? `<div class="panel stack" style="gap:10px">
          <div class="spread"><span class="muted small">預算剩餘</span><span class="muted small">預算 ${money(b.total_budget)}</span></div>
          <span class="big-number" style="color:${b.remaining < 0 ? '#B42318' : 'var(--ink)'}">NT$ ${b.remaining < 0 ? '−' : ''}${money(Math.abs(b.remaining))}</span>
          <div class="bar-track" style="height:10px;border-radius:5px" aria-hidden="true"><div style="width:${pct}%;background:${barColor(b.budgeted_spent, b.total_budget)}"></div></div>
          <span class="muted small">已花 ${money(b.budgeted_spent)}（不含代墊）${b.total_spent > b.budgeted_spent ? `，另有 ${money(b.total_spent - b.budgeted_spent)} 花在沒設預算的分類` : ''}</span>
        </div>` : ''}

        <section class="stack">
          <div class="spread" style="align-items:center">
            <h2 class="section">每月固定支出</h2>
            <button type="button" class="link-btn" id="add-sub">${icon('plus', 16, 2)}新增</button>
          </div>
          ${b.fixed.length ? `<div class="list">
            ${b.fixed.map((f) => `
              <div class="list-row" style="gap:10px">
                <span class="icon-box ${f.paid ? '' : 'neutral'}" style="width:32px;height:32px;border-radius:16px">${f.paid ? icon('check', 16, 2.4) : ''}</span>
                <button type="button" class="body" ${f.kind === 'subscription' ? `data-edit-sub="${f.id}"` : ''} style="border:0;background:none;padding:0;text-align:left;color:inherit">
                  <span class="title">${esc(f.name)}</span>
                  <span class="meta">${f.due_date ? `${md(f.due_date)} · ` : ''}${f.kind === 'loan' ? '貸款' : CYCLE[f.cycle]}${f.account_name ? ` · ${esc(f.account_name)}` : ''}${f.auto_create ? ' · 自動' : ''}</span>
                </button>
                <span class="amount ${f.paid ? 'muted' : ''}">${money(f.amount)}</span>
                ${f.paid ? '<span class="badge ok">已付</span>'
                  : f.kind === 'loan' ? `<a class="btn small ghost" href="#/accounts/${f.id}/loan-pay" style="min-height:36px;padding:0 10px">繳款</a>`
                  : `<button type="button" class="btn small ghost" data-pay="${f.id}" style="min-height:36px;padding:0 10px">記一筆</button>`}
              </div>`).join('')}
          </div>
          <span class="muted small">本月固定支出 ${money(b.fixed_total)}，還沒付 ${money(b.fixed_unpaid)}</span>`
          : '<div class="panel empty" style="padding:16px">房租、電話費、保險這類每月固定的支出，可以在這裡列出來。學貸會自動帶入。</div>'}
        </section>

        <section class="stack">
          <div class="spread" style="align-items:center">
            <h2 class="section">分類預算</h2>
            ${editing ? '' : '<button type="button" class="link-btn" id="edit">編輯預算</button>'}
          </div>
          ${editing ? `
            ${segmented('scope', [['default', '每月沿用'], ['month', `只改 ${Number(month.slice(5))} 月`]], scope)}
            <div class="list" id="edit-list">
              ${expenseCats.map((c) => {
                const row = b.categories.find((x) => x.category_id === c.id) || {};
                return `<div class="field">
                  <label for="bud-${c.id}" class="row" style="gap:8px;color:var(--ink)"><span class="dot" style="background:${esc(c.color)}"></span>${esc(c.name)}</label>
                  <input id="bud-${c.id}" data-cat="${c.id}" class="num" inputmode="numeric" pattern="[0-9]*" placeholder="不設預算"
                    value="${scope === 'month' ? (row.budget ?? '') : (row.default_amount ?? '')}">
                </div>`;
              }).join('')}
            </div>
            <div class="grid-2"><button type="button" class="btn ghost" id="cancel-edit">取消</button><button type="button" class="btn" id="save-edit">儲存預算</button></div>`
          : withBudget.length ? `<div class="list">
            ${withBudget.map((c) => {
              const p = c.budget ? Math.min(100, Math.round((c.spent / c.budget) * 100)) : 100;
              return `<div class="stack" style="gap:6px;padding:12px 0">
                <div class="row" style="gap:10px">
                  <span class="dot" style="background:${esc(c.color)}"></span>
                  <span style="flex:1;font-weight:500">${esc(c.name)}${c.overridden ? ' <span class="muted small" style="font-weight:400">本月調整</span>' : ''}</span>
                  <span class="num small muted">${money(c.spent)} / ${money(c.budget)}</span>
                </div>
                <div class="bar-track" aria-hidden="true"><div style="width:${p}%;background:${barColor(c.spent, c.budget)}"></div></div>
                <span class="small" style="color:${c.remaining < 0 ? '#B42318' : 'var(--muted)'}">${c.remaining < 0 ? `超支 ${money(-c.remaining)}` : `還可以花 ${money(c.remaining)}`}</span>
              </div>`;
            }).join('')}
          </div>`
          : '<div class="panel empty" style="padding:16px">還沒設定分類預算。按「編輯預算」幫每個分類設定每月上限。</div>'}
          ${!editing && without.length ? `<span class="muted small">沒設預算的分類：${without.map((c) => `${esc(c.name)} ${money(c.spent)}`).join('、')}</span>` : ''}
        </section>

        <dialog class="sheet" id="sub-sheet">
          <form method="dialog" id="sub-form">
            <strong id="sub-title">新增固定支出</strong>
            <input class="input" id="s-name" placeholder="名稱，例如：房租" maxlength="40">
            <div class="grid-2">
              <input class="input num" id="s-amount" inputmode="numeric" pattern="[0-9]*" placeholder="金額">
              <select class="input" id="s-cycle">${Object.entries(CYCLE).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
            </div>
            <label class="muted small" for="s-date">下次扣款日</label>
            <input class="input" id="s-date" type="date" value="${todayStr()}">
            <div class="grid-2">
              <select class="input" id="s-acc" aria-label="付款帳戶">${payAccounts.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join('')}</select>
              <select class="input" id="s-cat" aria-label="分類">${expenseCats.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>
            </div>
            <label class="toggle-row"><span class="muted" style="font-size:14px">到期自動記帳（會標成待核對）</span><input type="checkbox" id="s-auto"></label>
            <div class="grid-2"><button class="btn ghost" value="cancel" formnovalidate>取消</button><button class="btn" value="ok">儲存</button></div>
            <button class="btn danger" value="stop" id="s-stop">不再列為固定支出</button>
          </form>
        </dialog>`;

      // 固定支出
      const sheet = el.querySelector('#sub-sheet');
      let editingSub = null;
      const openSub = (sub) => {
        editingSub = sub;
        sheet.querySelector('#sub-title').textContent = sub ? '編輯固定支出' : '新增固定支出';
        sheet.querySelector('#s-name').value = sub ? sub.name : '';
        sheet.querySelector('#s-amount').value = sub ? sub.amount : '';
        sheet.querySelector('#s-cycle').value = sub ? sub.cycle : 'monthly';
        sheet.querySelector('#s-date').value = sub ? sub.next_date : todayStr();
        if (sub) sheet.querySelector('#s-acc').value = sub.account_id;
        if (sub && sub.category_id) sheet.querySelector('#s-cat').value = sub.category_id;
        sheet.querySelector('#s-auto').checked = sub ? sub.auto_create : false;
        sheet.querySelector('#s-stop').hidden = !sub;
        sheet.showModal();
      };
      el.querySelector('#add-sub').addEventListener('click', () => openSub(null));
      el.querySelectorAll('[data-edit-sub]').forEach((x) => x.addEventListener('click', () => {
        openSub(subs.find((s) => s.id === Number(x.dataset.editSub)));
      }));
      sheet.addEventListener('close', async () => {
        const action = sheet.returnValue;
        if (!action || action === 'cancel') return;
        try {
          if (action === 'stop') {
            await api.put(`/subscriptions/${editingSub.id}`, { active: false });
          } else {
            const body = {
              name: sheet.querySelector('#s-name').value,
              amount: Number(sheet.querySelector('#s-amount').value),
              cycle: sheet.querySelector('#s-cycle').value,
              next_date: sheet.querySelector('#s-date').value,
              account_id: Number(sheet.querySelector('#s-acc').value),
              category_id: Number(sheet.querySelector('#s-cat').value) || null,
              auto_create: sheet.querySelector('#s-auto').checked,
            };
            if (editingSub) await api.put(`/subscriptions/${editingSub.id}`, body);
            else await api.post('/subscriptions', body);
          }
          toast('已儲存');
          this.render(el, params, query, alive);
        } catch (err) { showError(err); }
      });
      el.querySelectorAll('[data-pay]').forEach((x) => x.addEventListener('click', async () => {
        await busy(x, async () => {
          try {
            await api.post(`/subscriptions/${x.dataset.pay}/pay`, {});
            invalidate('accounts');
            toast('已記帳');
            this.render(el, params, query, alive);
          } catch (err) { showError(err); }
        });
      }));

      // 分類預算
      const edit = el.querySelector('#edit');
      if (edit) edit.addEventListener('click', () => { editing = true; draw(); });
      if (editing) {
        bindSegmented(el, 'scope', (v) => { scope = v; draw(); });
        el.querySelector('#cancel-edit').addEventListener('click', () => { editing = false; draw(); });
        el.querySelector('#save-edit').addEventListener('click', async (e) => {
          const items = [...el.querySelectorAll('[data-cat]')].map((i) => ({
            category_id: Number(i.dataset.cat),
            amount: i.value.trim() === '' ? null : Number(i.value),
          }));
          await busy(e.target, async () => {
            try {
              await api.put('/budget', { items, month: scope === 'month' ? month : undefined });
              toast('預算已儲存');
              this.render(el, params, { month }, alive);
            } catch (err) { showError(err); }
          });
        });
      }
    };
    draw();
  },
};
