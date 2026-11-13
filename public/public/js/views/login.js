import { api, invalidate } from '../api.js';
import { busy, showError } from '../ui.js';

export default {
  async render(el) {
    el.innerHTML = `
      <div style="min-height:60dvh;display:flex;flex-direction:column;justify-content:center;gap:18px">
        <h1 style="margin:0;font-size:26px">記帳本</h1>
        <form id="login" class="stack" style="gap:12px">
          <label for="pw" class="muted">密碼</label>
          <input id="pw" class="input" type="password" autocomplete="current-password" required>
          <button class="btn" type="submit">登入</button>
        </form>
      </div>`;
    const form = el.querySelector('#login');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      await busy(form.querySelector('button'), async () => {
        try {
          await api.login(el.querySelector('#pw').value);
          invalidate();
          location.hash = '#/';
        } catch (err) { showError(err); }
      });
    });
    el.querySelector('#pw').focus();
  },
};
