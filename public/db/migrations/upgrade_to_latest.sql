-- =====================================================================
-- 一次升級到最新版（包含 002、003、004）
-- 適用：用最早那版 db/schema.sql 建立、之後都還沒執行過任何 migration 的資料庫。
-- 在 Neon SQL Editor 貼上整份按 Run 即可；重複執行也不會出錯。
-- =====================================================================

-- =====================================================================
-- 002：現金帳戶、貸款帳戶（學貸）、自動扣款、扣款待核對
-- 已經用舊版 schema.sql 建過資料表的資料庫，在 Neon SQL Editor 執行這個檔案一次即可。
-- 全新的資料庫直接執行 db/schema.sql 就好，不需要執行這個檔案。
-- =====================================================================

BEGIN;

-- 帳戶類型新增「貸款」
ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_kind_check;
ALTER TABLE accounts ADD CONSTRAINT accounts_kind_check CHECK (kind IN ('deposit', 'credit_card', 'loan'));
ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_check;
ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_card_days_check;
ALTER TABLE accounts ADD CONSTRAINT accounts_card_days_check
  CHECK (kind <> 'credit_card' OR (statement_day IS NOT NULL AND due_day IS NOT NULL));

-- 自動扣款帳戶（信用卡、貸款用）、貸款設定、現金標記
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS autopay_account_id INT REFERENCES accounts(id);
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS loan_rate NUMERIC(6,3);
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS loan_payment BIGINT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS loan_day SMALLINT CHECK (loan_day BETWEEN 1 AND 31);
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS loan_next_date DATE;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS is_cash BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE accounts SET is_cash = TRUE WHERE kind = 'deposit' AND name LIKE '%現金%';

-- 交易來源新增 autopay，並加上「待核對」
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_source_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_source_check
  CHECK (source IN ('manual', 'reconcile', 'installment', 'subscription', 'import', 'autopay'));
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS pending_review BOOLEAN NOT NULL DEFAULT FALSE;

-- 貸款跟信用卡一樣是負債：balance 顯示剩餘本金
CREATE OR REPLACE VIEW v_account_balances AS
SELECT ac.id,
       ac.name,
       ac.kind,
       CASE ac.kind
         WHEN 'deposit' THEN ac.opening_balance + COALESCE(SUM(m.delta), 0)
         ELSE                ac.opening_balance - COALESCE(SUM(m.delta), 0)
       END AS balance
FROM accounts ac
LEFT JOIN v_account_movements m ON m.account_id = ac.id
WHERE NOT ac.archived
GROUP BY ac.id;

COMMIT;


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


-- =====================================================================
-- 004：明細層級的專項、帳戶圖示、拖曳排序、美甲客戶／施做／進貨／庫存
-- 已經在用的資料庫：在 Neon SQL Editor 執行（需先執行過 002、003）。
-- 全新的資料庫：直接執行 db/schema.sql 即可（已包含這些內容）。
-- =====================================================================

BEGIN;

-- 專項改成掛在每一筆明細上；舊資料從交易搬到明細
ALTER TABLE transaction_items ADD COLUMN IF NOT EXISTS project_id INT REFERENCES projects(id) ON DELETE SET NULL;
UPDATE transaction_items i SET project_id = t.project_id
FROM transactions t
WHERE i.transaction_id = t.id AND t.project_id IS NOT NULL AND i.project_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_items_project ON transaction_items (project_id);

-- 帳戶圖示：auto（依類型）、text（文字）、icon（線條圖示）、emoji、image（上傳的圖片）
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS icon_type TEXT NOT NULL DEFAULT 'auto';
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS icon_value TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS icon_image TEXT;
ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_icon_type_check;
ALTER TABLE accounts ADD CONSTRAINT accounts_icon_type_check CHECK (icon_type IN ('auto', 'text', 'icon', 'emoji', 'image'));

-- 固定支出可排序
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS sort_order INT NOT NULL DEFAULT 0;

-- 美甲：客戶
CREATE TABLE IF NOT EXISTS nail_customers (
  id          SERIAL PRIMARY KEY,
  name        TEXT        NOT NULL,
  phone       TEXT,
  birthday    DATE,
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 美甲：施做紀錄（只記個人工作室）
-- status: booked 預約成功 / deposit 已付訂金 / done 施做完成
-- 施做完成時自動產生一筆美甲收入（transaction_id）
CREATE TABLE IF NOT EXISTS nail_services (
  id               SERIAL PRIMARY KEY,
  customer_id      INT         REFERENCES nail_customers(id) ON DELETE SET NULL,
  service_date     DATE        NOT NULL,
  service_time     TEXT,
  part             TEXT        CHECK (part IN ('手', '足')),
  items            TEXT[]      NOT NULL DEFAULT '{}',
  extension_count  INT,
  amount           BIGINT      NOT NULL DEFAULT 0 CHECK (amount >= 0),
  deposit          BIGINT      NOT NULL DEFAULT 0 CHECK (deposit >= 0),
  account_id       INT         REFERENCES accounts(id),
  status           TEXT        NOT NULL DEFAULT 'booked' CHECK (status IN ('booked', 'deposit', 'done')),
  note             TEXT,
  transaction_id   INT         REFERENCES transactions(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_nail_services_date ON nail_services (service_date);
CREATE INDEX IF NOT EXISTS idx_nail_services_customer ON nail_services (customer_id);

-- 美甲：商品（庫存 = 原始數量 + 進貨 − 拿取）
CREATE TABLE IF NOT EXISTS nail_products (
  id             SERIAL PRIMARY KEY,
  name           TEXT          NOT NULL,
  brand          TEXT,
  initial_qty    NUMERIC(10,2) NOT NULL DEFAULT 0,
  low_threshold  NUMERIC(10,2) NOT NULL DEFAULT 1,
  expiry         TEXT,
  archived       BOOLEAN       NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- 美甲：進貨（同時產生一筆支出）
CREATE TABLE IF NOT EXISTS nail_purchases (
  id              SERIAL PRIMARY KEY,
  vendor          TEXT        NOT NULL DEFAULT '',
  purchase_date   DATE        NOT NULL,
  account_id      INT         REFERENCES accounts(id),
  transaction_id  INT         REFERENCES transactions(id) ON DELETE SET NULL,
  note            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS nail_purchase_items (
  id           SERIAL PRIMARY KEY,
  purchase_id  INT           NOT NULL REFERENCES nail_purchases(id) ON DELETE CASCADE,
  product_id   INT           NOT NULL REFERENCES nail_products(id),
  unit_price   BIGINT        NOT NULL CHECK (unit_price >= 0),
  quantity     NUMERIC(10,2) NOT NULL CHECK (quantity > 0)
);

-- 美甲：拿取（使用紀錄）
CREATE TABLE IF NOT EXISTS nail_usage (
  id          SERIAL PRIMARY KEY,
  product_id  INT           NOT NULL REFERENCES nail_products(id) ON DELETE CASCADE,
  use_date    DATE          NOT NULL,
  user_name   TEXT,
  quantity    NUMERIC(10,2) NOT NULL CHECK (quantity > 0),
  note        TEXT,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE OR REPLACE VIEW v_nail_stock AS
SELECT p.*,
       COALESCE((SELECT SUM(pi.quantity) FROM nail_purchase_items pi WHERE pi.product_id = p.id), 0) AS purchased_qty,
       COALESCE((SELECT SUM(u.quantity) FROM nail_usage u WHERE u.product_id = p.id), 0) AS used_qty,
       p.initial_qty
         + COALESCE((SELECT SUM(pi.quantity) FROM nail_purchase_items pi WHERE pi.product_id = p.id), 0)
         - COALESCE((SELECT SUM(u.quantity) FROM nail_usage u WHERE u.product_id = p.id), 0) AS remaining
FROM nail_products p;

COMMIT;
