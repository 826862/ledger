import { api, invalidate } from '../api.js';
import { esc, money, todayStr, backHead, busy, showError, toast } from '../ui.js';

export default {
  async render(el, params, query, alive) {
    const [loan, accounts] = await Promise.all([api.get(`/accounts/${params.id}`), api.accounts()]);
    if (!alive()) return;
    if (loan.kind !== 'loan') throw new Error('這不是貸款帳戶');
    const deposits = accounts.filter((a) => a.kind === 'deposit');
    if (!deposits.length) {
      el.innerHTML = `${backHead(`繳${esc(loan.name)}`, '#/accounts')}<div class="panel empty">要先新增存款帳戶才能記錄繳款。</div>`;
      return;
    }
    const defaultFrom = loan.autopay_account_id || (deposits.find((a) => !a.is_cash) || deposits[0]).id;

    el.innerHTML = `
      ${backHead(`繳${esc(loan.name)}`, '#/accounts')}
      <div class="panel stack" style="gap:4px">
        <span class="muted small">目前剩餘本金</span>
        <span class="big-number">NT$ ${money(loan.balance)}</span>
      </div>
      <form id="f" class="stack" style="gap:14px">
        <div class="list">
          <div class="field"><label for="from">從哪個帳戶付</label>
            <select id="from">${deposits.map((a) => `<option value="${a.id}" ${a.id === defaultFrom ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></div>
          <div class="field"><label for="amount">繳款金額</label>
            <input id="amount" class="num" inputmode="numeric" pattern="[0-9]*" value="${loan.loan_payment ?? ''}" placeholder="0" required></div>
          <div class="field"><label for="date">日期</label><input id="date" type="date" value="${todayStr()}" required></div>
          <div class="field"><label for="remain">繳完後台銀顯示的剩餘本金</label>
            <input id="remain" class="num" inputmode="numeric" pattern="[0-9]*" placeholder="選填"></div>
        </div>
        <span class="muted small">繳款金額會從存款轉到${esc(loan.name)}。有填剩餘本金的話，會直接更新成台銀的數字；沒填就先扣掉繳款金額，之後可以在帳戶頁「更新剩餘本金」。這次繳完後，當月的自動扣款會往後順延一期。</span>
      </form>
      <div class="action-bar"><button class="btn" type="submit" form="f">記錄繳款</button></div>`;

    el.querySelector('#f').addEventListener('submit', async (e) => {
      e.preventDefault();
      const remain = el.querySelector('#remain').value.trim();
      await busy(document.querySelector('.action-bar .btn'), async () => {
        try {
          await api.post(`/accounts/${loan.id}/loan-payment`, {
            from_account_id: Number(el.querySelector('#from').value),
            amount: Number(el.querySelector('#amount').value),
            date: el.querySelector('#date').value,
          });
          if (remain !== '') await api.post(`/accounts/${loan.id}/adjust`, { actual_balance: Number(remain) });
          invalidate('accounts');
          toast(remain !== '' ? `已記錄繳款，剩餘本金 ${money(Number(remain))}` : '已記錄繳款');
          location.hash = '#/accounts';
        } catch (err) { showError(err); }
      });
    });
  },
};
