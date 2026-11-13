// 呼叫後端 API；401 時導回登入
export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function request(method, url, body) {
  const res = await fetch(`/api${url}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  let data = null;
  try { data = await res.json(); } catch { /* 沒有內容 */ }
  if (res.status === 401 && !url.startsWith('/login')) {
    location.hash = '#/login';
    throw new ApiError(401, '請先登入');
  }
  if (!res.ok) throw new ApiError(res.status, (data && data.error) || `發生錯誤（${res.status}）`);
  return data;
}

// 分類與帳戶常被多個畫面用到，簡單快取；有異動就清掉
const cache = new Map();
function cached(key, loader) {
  if (!cache.has(key)) cache.set(key, loader().catch((e) => { cache.delete(key); throw e; }));
  return cache.get(key);
}
export function invalidate(...keys) {
  if (!keys.length) cache.clear();
  keys.forEach((k) => cache.delete(k));
}

export const api = {
  get: (url) => request('GET', url),
  post: (url, body) => request('POST', url, body || {}),
  put: (url, body) => request('PUT', url, body || {}),
  del: (url) => request('DELETE', url),

  login: (password) => request('POST', '/login', { password }),
  logout: () => request('POST', '/logout', {}),

  accounts: () => cached('accounts', () => request('GET', '/accounts')),
  categories: () => cached('categories', () => request('GET', '/categories')),
};
