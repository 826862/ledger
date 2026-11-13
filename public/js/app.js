import { icon, showError } from './ui.js';
import login from './views/login.js';
import home from './views/home.js';
import accounts from './views/accounts.js';
import accountForm from './views/account-form.js';
import txnForm from './views/txn-form.js';
import txnList from './views/txn-list.js';
import report from './views/report.js';
import settings from './views/settings.js';
import categories from './views/categories.js';
import bill from './views/bill.js';
import installmentForm from './views/installment-form.js';
import reconcile from './views/reconcile.js';

// [路徑樣式, 畫面, 底部選單要亮的分頁（null = 不顯示選單）]
const routes = [
  ['/login', login, null],
  ['/', home, 'home'],
  ['/accounts', accounts, 'accounts'],
  ['/accounts/new', accountForm, null],
  ['/accounts/:id/edit', accountForm, null],
  ['/accounts/:id/bill', bill, null],
  ['/accounts/:id/installments/new', installmentForm, null],
  ['/statements/:sid', bill, null],
  ['/statements/:sid/reconcile', reconcile, null],
  ['/add', txnForm, null],
  ['/txn/:id', txnForm, null],
  ['/transactions', txnList, 'home'],
  ['/report', report, 'report'],
  ['/settings', settings, 'settings'],
  ['/categories', categories, 'settings'],
];

function match(path) {
  const parts = path.split('/').filter(Boolean);
  for (const [pattern, view, tab] of routes) {
    const pp = pattern.split('/').filter(Boolean);
    if (pp.length !== parts.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < pp.length; i++) {
      if (pp[i].startsWith(':')) params[pp[i].slice(1)] = decodeURIComponent(parts[i]);
      else if (pp[i] !== parts[i]) { ok = false; break; }
    }
    if (ok) return { view, tab, params };
  }
  return null;
}

const TABS = [
  ['home', '#/', 'home', '總覽'],
  ['accounts', '#/accounts', 'wallet', '帳戶'],
  ['add', '#/add', 'plus', ''],
  ['report', '#/report', 'pie', '報表'],
  ['settings', '#/settings', 'sliders', '設定'],
];

function renderTabbar(active) {
  const bar = document.getElementById('tabbar');
  if (!active) { bar.hidden = true; return; }
  bar.hidden = false;
  bar.innerHTML = TABS.map(([key, href, ic, label]) =>
    key === 'add'
      ? `<a class="add" href="${href}" aria-label="記一筆">${icon(ic, 26, 2.2)}</a>`
      : `<a href="${href}" ${key === active ? 'aria-current="page"' : ''}>${icon(ic, 24)}${label}</a>`
  ).join('');
}

let renderId = 0;
async function router() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = raw.split('?');
  const found = match(path) || match('/');
  const query = Object.fromEntries(new URLSearchParams(qs || ''));
  const el = document.getElementById('view');
  const id = ++renderId;
  renderTabbar(found.tab);
  el.classList.toggle('no-tabs', !found.tab);
  el.innerHTML = '<div class="loading">載入中…</div>';
  window.scrollTo(0, 0);
  try {
    await found.view.render(el, found.params, query, () => id === renderId);
  } catch (err) {
    if (id !== renderId) return;
    if (err.status === 401) return;
    el.innerHTML = `<div class="empty">${err.message || '載入失敗'}<br><a href="#/">回到總覽</a></div>`;
    showError(err);
  }
}

window.addEventListener('hashchange', router);
router();
