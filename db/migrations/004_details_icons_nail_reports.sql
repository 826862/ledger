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
