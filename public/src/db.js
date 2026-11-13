const { Pool, types } = require('pg');

// DATE → 'YYYY-MM-DD' 字串，避免時區位移
types.setTypeParser(1082, (v) => v);
// BIGINT / NUMERIC → number（金額都在安全整數範圍內）
types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10)));
types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));

if (!process.env.DATABASE_URL) {
  console.error('缺少 DATABASE_URL 環境變數，請參考 .env.example');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 30000,
});

async function query(text, params) {
  return pool.query(text, params);
}

// 交易包裝：fn 收到 client，成功自動 COMMIT，失敗 ROLLBACK
async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, tx };
