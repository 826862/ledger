-- =====================================================================
-- 003：代墊、預算、固定支出、專案、美甲收入與 10% 收入袋
-- 已經在用的資料庫：在 Neon SQL Editor 執行這個檔案一次（需先執行過 002）。
-- 全新的資料庫：直接執行 db/schema.sql 即可（已包含這些內容）。
-- =====================================================================

BEGIN;

-- 代墊：品項層級標記，記錄對象與是否已收回
ALTER TABLE transaction_items ADD COLUMN IF NOT EXISTS is_advance BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE transaction_items ADD COLUMN IF NOT EXISTS advance_person TEXT;
ALTER TABLE transaction_items ADD COLUMN IF NOT EXISTS advance_settled_on DATE;
ALTER TABLE transaction_items ADD COLUMN IF NOT EXISTS advance_settle_txn_id INT REFERENCES transactions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_items_advance_open ON transaction_items (advance_person) WHERE is_advance AND advance_settled_on IS NULL;

-- 固定支出（訂閱）付款紀錄
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS subscription_id INT REFERENCES subscriptions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_transactions_project ON transactions (project_id);

-- 專案
ALTER TABLE projects ADD COLUMN IF NOT EXISTS color TEXT NOT NULL DEFAULT '#1D4ED8';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- 分類預算：budgets 是每月沿用的預設值，budget_overrides 是個別月份的調整
CREATE TABLE IF NOT EXISTS budgets (
  category_id  INT    PRIMARY KEY REFERENCES categories(id) ON DELETE CASCADE,
  amount       BIGINT NOT NULL CHECK (amount >= 0)
);
CREATE TABLE IF NOT EXISTS budget_overrides (
  category_id  INT    NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  month        DATE   NOT NULL,
  amount       BIGINT NOT NULL CHECK (amount >= 0),
  PRIMARY KEY (category_id, month)
);

-- 一般設定（美甲收入袋等）
CREATE TABLE IF NOT EXISTS app_settings (
  key    TEXT  PRIMARY KEY,
  value  JSONB NOT NULL
);

-- 美甲 10% 收入袋：每個月撥一次，避免重複
CREATE TABLE IF NOT EXISTS nail_allocations (
  month           DATE        PRIMARY KEY,
  income          BIGINT      NOT NULL,
  amount          BIGINT      NOT NULL,
  transaction_id  INT         REFERENCES transactions(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 報表排除代墊
CREATE OR REPLACE VIEW v_monthly_category AS
WITH base AS (
  SELECT date_trunc('month', t.txn_date)::DATE AS month,
         t.type,
         i.category_id,
         SUM(i.amount) AS amount,
         COUNT(DISTINCT t.id) AS txn_count
  FROM transaction_items i
  JOIN transactions t ON t.id = i.transaction_id
  WHERE t.type IN ('expense', 'income') AND i.in_report AND NOT i.is_advance
  GROUP BY 1, 2, 3
)
SELECT b.month,
       b.type,
       b.category_id,
       c.name  AS category_name,
       c.color AS category_color,
       b.amount,
       b.txn_count,
       round(100.0 * b.amount / NULLIF(SUM(b.amount) OVER (PARTITION BY b.month, b.type), 0), 1) AS share_pct
FROM base b
LEFT JOIN categories c ON c.id = b.category_id;

-- 新增「美甲工具」以外不需要的預設分類；確保有美甲收入與美甲材料分類
INSERT INTO categories (name, kind, color, sort_order)
SELECT '美甲', 'income', '#2563EB', 2 WHERE NOT EXISTS (SELECT 1 FROM categories WHERE kind = 'income' AND name = '美甲');
INSERT INTO categories (name, kind, color, sort_order)
SELECT '美甲材料', 'expense', '#93C5FD', 3 WHERE NOT EXISTS (SELECT 1 FROM categories WHERE kind = 'expense' AND name = '美甲材料');

COMMIT;
