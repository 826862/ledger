// 建立資料表：npm run db:init
// 已經建過就會略過；加上 --force 會先刪除所有表重建（資料會全部清空）
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('缺少 DATABASE_URL，請先建立 .env（參考 .env.example）');
    process.exit(1);
  }
  const force = process.argv.includes('--force');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query(`SELECT to_regclass('public.accounts') AS t`);
    if (rows[0].t && !force) {
      console.log('資料表已存在，略過。若要清空重建請執行：npm run db:init -- --force');
      return;
    }
    if (force) {
      await client.query(`
        DROP VIEW IF EXISTS v_nail_stock, v_statement_summary, v_monthly_category, v_account_balances,
          v_account_movements, v_transaction_amounts CASCADE;
        DROP TABLE IF EXISTS nail_usage, nail_purchase_items, nail_purchases, nail_products, nail_services, nail_customers, nail_allocations, app_settings, budget_overrides, budgets, transaction_items,
          transactions, installments, card_statements, subscriptions, projects, categories, accounts CASCADE;
      `);
      console.log('已刪除舊資料表');
    }
    const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
    await client.query(sql);
    console.log('資料表建立完成');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
