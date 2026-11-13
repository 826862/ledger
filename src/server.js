const path = require('path');
const express = require('express');
const { passwordMatches, setSession, clearSession, requireAuth } = require('./auth');
const accounts = require('./routes/accounts');
const categories = require('./routes/categories');
const { router: transactions } = require('./routes/transactions');
const statements = require('./routes/statements');
const installments = require('./routes/installments');
const reports = require('./routes/reports');

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '200kb' }));

app.get('/healthz', (req, res) => res.send('ok'));

// 簡單的登入節流：同一 IP 15 分鐘內最多 10 次失敗
const failures = new Map();
app.post('/api/login', (req, res) => {
  const key = req.ip;
  const now = Date.now();
  const rec = failures.get(key) || { count: 0, since: now };
  if (now - rec.since > 15 * 60000) { rec.count = 0; rec.since = now; }
  if (rec.count >= 10) return res.status(429).json({ error: '嘗試次數太多，請 15 分鐘後再試' });
  if (!passwordMatches(req.body && req.body.password)) {
    rec.count += 1;
    failures.set(key, rec);
    return res.status(401).json({ error: '密碼不正確' });
  }
  failures.delete(key);
  setSession(res, req);
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

app.use('/api', requireAuth);
app.get('/api/session', (req, res) => res.json({ ok: true }));
app.use('/api/accounts', accounts);
app.use('/api/categories', categories);
app.use('/api/transactions', transactions);
app.use('/api', statements);
app.use('/api', installments);
app.use('/api', reports);

app.use('/api', (req, res) => res.status(404).json({ error: '找不到這個 API' }));

app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h' }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

// 錯誤處理
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err.status) return res.status(err.status).json({ error: err.message });
  if (err.code === '23505') return res.status(409).json({ error: '名稱重複了' });
  if (err.code === '23503') return res.status(409).json({ error: '這筆資料還有其他紀錄在使用，不能刪除' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: '資料格式不正確' });
  console.error(err);
  res.status(500).json({ error: '伺服器發生錯誤' });
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`記帳本已啟動：http://localhost:${port}`));
