import { api, invalidate } from '../api.js';
import { icon, showError } from '../ui.js';

export default {
  async render(el) {
    el.innerHTML = `
      <div class="page-head"><h1>設定</h1></div>
      <div class="list">
        <a class="list-row" href="#/categories">
          <div class="icon-box neutral">${icon('pie')}</div>
          <div class="body"><span class="title">分類管理</span><span class="meta">新增、改名、排序、換顏色</span></div>
          ${icon('next', 18, 2)}
        </a>
        <a class="list-row" href="#/accounts">
          <div class="icon-box neutral">${icon('wallet')}</div>
          <div class="body"><span class="title">帳戶管理</span><span class="meta">存款帳戶、信用卡、期初金額</span></div>
          ${icon('next', 18, 2)}
        </a>
        <a class="list-row" href="#/transactions">
          <div class="icon-box neutral">${icon('list')}</div>
          <div class="body"><span class="title">所有交易</span><span class="meta">依月份瀏覽、編輯</span></div>
          ${icon('next', 18, 2)}
        </a>
      </div>
      <button class="btn ghost" id="logout">登出</button>`;
    el.querySelector('#logout').addEventListener('click', async () => {
      try {
        await api.logout();
        invalidate();
        location.hash = '#/login';
      } catch (err) { showError(err); }
    });
  },
};
