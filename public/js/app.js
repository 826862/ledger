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
import loanPay from './views/loan-pay.js';
import review from './views/review.js';
import budget from './views/budget.js';
import projects from './views/projects.js';
import project from './views/project.js';
import advances from './views/advances.js';
import nail from './views/nail.js';
import nailCustomers from './views/nail-customers.js';
import nailService from './views/nail-service.js';
import nailPurchases from './views/nail-purchases.js';
import nailStock from './views/nail-stock.js';
import reportCategory from './views/report-category.js';
import reportExport from './views/report-export.js';
import importer from './views/import.js';

// [路徑樣式, 畫面, 底部選單要亮的分頁（null = 不顯示選單）]
const routes = [
  ['/login', login, null],
  ['/', home, 'home'],
  ['/accounts', accounts, 'accounts'],
  ['/accounts/new', accountForm, 'accounts'],
  ['/accounts/:id/edit', accountForm, 'accounts'],
  ['/accounts/:id/bill', bill, 'accounts'],
  ['/accounts/:id/installments/new', installmentForm, 'accounts'],
  ['/accounts/:id/loan-pay', loanPay, 'accounts'],
  ['/review', review, 'home'],
  ['/statements/:sid', bill, 'accounts'],
  ['/statements/:sid/reconcile', reconcile, 'accounts'],
  ['/add', txnForm, 'none'],
  ['/txn/:id', txnForm, 'detail'],
  ['/transactions', txnList, 'detail'],
  ['/report', report, 'more'],
  ['/settings', settings, 'more'],
  ['/categories', categories, 'more'],
  ['/budget', budget, 'more'],
  ['/projects', projects, 'more'],
  ['/projects/:pid', project, 'more'],
  ['/advances', advances, 'more'],
  ['/nail', nail, 'nail'],
  ['/nail/customers', nailCustomers, 'nail'],
  ['/nail/customers/:cid', nailCustomers, 'nail'],
  ['/nail/service/new', nailService, 'nail'],
  ['/nail/service/:sid', nailService, 'nail'],
  ['/nail/purchases', nailPurchases, 'nail'],
  ['/nail/stock', nailStock, 'nail'],
  ['/report/category/:cid', reportCategory, 'more'],
  ['/report/export', reportExport, 'more'],
  ['/import', importer, 'more'],
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
  ['detail', '#/transactions', 'list', '明細'],
  ['accounts', '#/accounts', 'wallet', '帳戶'],
  ['nail', '#/nail', 'sparkle', '美甲'],
  ['more', '#/settings', 'grid', '更多'],
];

// 底部選單在每一頁都顯示（登入頁除外）；「記一筆」是右下角的浮動按鈕
function renderTabbar(active) {
  const bar = document.getElementById('tabbar');
  if (!active) { bar.hidden = true; return; }
  bar.hidden = false;
  bar.innerHTML = TABS.map(([key, href, ic, label]) =>
    `<a href="${href}" ${key === active ? 'aria-current="page"' : ''}>${icon(ic, 24)}${label}</a>`
  ).join('');
}

function updateFab(show) {
  let fab = document.getElementById('fab');
  if (!fab) {
    fab = document.createElement('a');
    fab.id = 'fab';
    fab.className = 'fab';
    fab.href = '#/add';
    fab.setAttribute('aria-label', '記一筆');
    fab.innerHTML = icon('plus', 26, 2.2);
    document.body.appendChild(fab);
  }
  fab.hidden = !show;
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
    updateFab(false);
    await found.view.render(el, found.params, query, () => id === renderId);
    // 有「儲存」等底部按鈕的頁面不顯示浮動的記一筆按鈕
    if (id === renderId) updateFab(Boolean(found.tab) && !el.querySelector('.action-bar'));
  } catch (err) {
    if (id !== renderId) return;
    if (err.status === 401) return;
    el.innerHTML = `<div class="empty">${err.message || '載入失敗'}<br><a href="#/">回到總覽</a></div>`;
    showError(err);
  }
}

window.addEventListener('hashchange', router);
router();
