const crypto = require('crypto');

const COOKIE = 'ledger_session';
const MAX_AGE_DAYS = 90;

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error('缺少 SESSION_SECRET 環境變數');
  return s;
}

function sign(value) {
  return crypto.createHmac('sha256', secret()).update(value).digest('hex');
}

function makeToken() {
  const expires = Date.now() + MAX_AGE_DAYS * 86400000;
  const payload = String(expires);
  return `${payload}.${sign(payload)}`;
}

function verifyToken(token) {
  if (!token || !token.includes('.')) return false;
  const [payload, mac] = token.split('.');
  const expected = sign(payload);
  if (mac.length !== expected.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return false;
  return Number(payload) > Date.now();
}

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

function passwordMatches(input) {
  const expected = process.env.APP_PASSWORD;
  if (!expected) throw new Error('缺少 APP_PASSWORD 環境變數');
  const a = crypto.createHash('sha256').update(String(input || '')).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

function setSession(res, req) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.setHeader(
    'Set-Cookie',
    `${COOKIE}=${encodeURIComponent(makeToken())}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_DAYS * 86400}${secure ? '; Secure' : ''}`
  );
}

function clearSession(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function requireAuth(req, res, next) {
  if (verifyToken(readCookie(req, COOKIE))) return next();
  res.status(401).json({ error: '請先登入' });
}

module.exports = { passwordMatches, setSession, clearSession, requireAuth };
