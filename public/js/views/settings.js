import { api, invalidate } from '../api.js';
import { icon, showError } from '../ui.js';

const row = (href, ic, title, meta) => `<a class="list-row" href="${href}">
  <div class="icon-box neutral">${icon(ic)}</div>
  <div class="body"><span class="title">${title}</span><span class="meta">${meta}</span></div>
  ${icon('next', 18, 2)}
</a>`;

export default {
  async render(el) {
    el.innerHTML = `
      <div class="page-head"><h1>更多</h1></div>
      <div class="list">
        ${row('#/budget', 'target', '預算', '每月固定支出、分類預算剩多少')}
        ${row('#/projects', 'folder', '專項', '日本行、接案等各自花了多少、賺了多少')}
        ${row('#/advances', 'people', '代墊待收回', '誰還沒還你錢')}
        ${row('#/report', 'pie', '分類報表', '每月各分類佔比')}
      </div>
      <div class="list">
        ${row('#/accounts', 'wallet', '帳戶管理', '存款、信用卡、貸款')}
        ${row('#/categories', 'sliders', '分類管理', '新增、改名、排序、換顏色')}
        ${row('#/import', 'download', '匯入資料', '從匯入檔（例如 Notion 轉出的資料）重建記帳本')}
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
