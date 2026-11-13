-- =====================================================================
-- 記帳本 schema (PostgreSQL / Neon)
-- 金額一律用整數（新台幣元），全部存正數，方向由交易類型決定。
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 帳戶：存款帳戶、信用卡、貸款分開
-- 存款：opening_balance = 期初餘額（is_cash = 現金／錢包）
-- 信用卡：opening_balance = 開始記帳時的未繳金額（欠款，正數）
-- 貸款：opening_balance = 開始記帳時的剩餘本金（欠款，正數）
-- autopay_account_id：信用卡自動扣繳／貸款自動扣款的存款帳戶
-- ---------------------------------------------------------------------
CREATE TABLE accounts (
  id               SERIAL PRIMARY KEY,
  name             TEXT        NOT NULL,
  kind             TEXT        NOT NULL CONSTRAINT accounts_kind_check CHECK (kind IN ('deposit', 'credit_card', 'loan')),
  opening_balance  BIGINT      NOT NULL DEFAULT 0,
  statement_day    SMALLINT    CHECK (statement_day BETWEEN 1 AND 31),  -- 結帳日（信用卡）
  due_day          SMALLINT    CHECK (due_day BETWEEN 1 AND 31),        -- 繳款日（信用卡，次月）
  credit_limit     BIGINT,                                              -- 額度（選填）
  autopay_account_id INT       REFERENCES accounts(id),                 -- 自動扣款帳戶
  loan_rate        NUMERIC(6,3),                                        -- 貸款年利率 %
  loan_payment     BIGINT,                                              -- 貸款每月繳款金額
  loan_day         SMALLINT    CHECK (loan_day BETWEEN 1 AND 31),       -- 貸款每月扣款日
  loan_next_date   DATE,                                                -- 下一次自動扣款日
  is_cash          BOOLEAN     NOT NULL DEFAULT FALSE,
  color            TEXT        NOT NULL DEFAULT '#1D4ED8',
  sort_order       INT         NOT NULL DEFAULT 0,
  archived         BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT accounts_card_days_check CHECK (kind <> 'credit_card' OR (statement_day IS NOT NULL AND due_day IS NOT NULL))
);

-- ---------------------------------------------------------------------
-- 分類：支出、收入分開管理
-- ---------------------------------------------------------------------
CREATE TABLE categories (
  id          SERIAL PRIMARY KEY,
  name        TEXT    NOT NULL,
  kind        TEXT    NOT NULL CHECK (kind IN ('expense', 'income')),
  color       TEXT    NOT NULL DEFAULT '#5B6170',
  sort_order  INT     NOT NULL DEFAULT 0,
  archived    BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (kind, name)
);

-- ---------------------------------------------------------------------
-- 專項
-- ---------------------------------------------------------------------
CREATE TABLE projects (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  start_date  DATE,
  end_date    DATE,
  note        TEXT
);

-- ---------------------------------------------------------------------
-- 信用卡帳單（每張卡每一期一筆）
-- status: open（預估中）→ reconciled（已對帳）→ paid（已繳款）
-- ---------------------------------------------------------------------
CREATE TABLE card_statements (
  id                SERIAL PRIMARY KEY,
  account_id        INT    NOT NULL REFERENCES accounts(id),
  period_start      DATE   NOT NULL,
  period_end        DATE   NOT NULL,           -- 結帳日
  due_date          DATE   NOT NULL,           -- 繳款截止日
  statement_amount  BIGINT,                    -- 銀行帳單應繳（對帳時輸入）
  status            TEXT   NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'reconciled', 'paid')),
  reconciled_at     TIMESTAMPTZ,
  UNIQUE (account_id, period_end)
);

-- ---------------------------------------------------------------------
-- 分期
-- interest_type: none（零利率）/ apr（年利率，等額本息）/ fixed_fee（每期固定手續費）
-- report_mode:   full（刷卡當月全額計入報表）/ spread（按期攤到每月）
-- 建立分期時由程式產生「購買交易」＋每期的「分期交易」
-- ---------------------------------------------------------------------
CREATE TABLE installments (
  id               SERIAL PRIMARY KEY,
  account_id       INT          NOT NULL REFERENCES accounts(id),
  category_id      INT          REFERENCES categories(id),
  name             TEXT         NOT NULL,
  principal        BIGINT       NOT NULL CHECK (principal > 0),
  periods          SMALLINT     NOT NULL CHECK (periods > 0),
  interest_type    TEXT         NOT NULL DEFAULT 'none'
                   CHECK (interest_type IN ('none', 'apr', 'fixed_fee')),
  apr              NUMERIC(5,2),               -- 年利率 %，interest_type = apr 時使用
  fee_per_period   BIGINT,                     -- interest_type = fixed_fee 時使用
  first_bill_date  DATE         NOT NULL,      -- 第一期入帳的帳單結帳日
  report_mode      TEXT         NOT NULL DEFAULT 'full'
                   CHECK (report_mode IN ('full', 'spread')),
  purchase_date    DATE         NOT NULL,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 交易：支出、收入、轉帳（含信用卡繳款）、餘額校正 統一在這張表
-- 支出／收入的金額來自 transaction_items 加總
-- 轉帳與校正的金額放在 amount
-- affects_balance = false：不影響帳戶餘額（例如分期的「購買交易」，餘額改由每期交易計算）
-- ---------------------------------------------------------------------
CREATE TABLE transactions (
  id               SERIAL PRIMARY KEY,
  type             TEXT        NOT NULL
                   CHECK (type IN ('expense', 'income', 'transfer', 'adjustment')),
  txn_date         DATE        NOT NULL,                 -- 消費日
  account_id       INT         NOT NULL REFERENCES accounts(id),
  to_account_id    INT         REFERENCES accounts(id),  -- 轉帳目的帳戶
  amount           BIGINT,                               -- 轉帳金額；校正可正可負
  title            TEXT        NOT NULL DEFAULT '',
  note             TEXT,
  project_id       INT         REFERENCES projects(id),
  statement_id     INT         REFERENCES card_statements(id), -- 信用卡消費歸屬的帳單期別
  installment_id   INT         REFERENCES installments(id),
  installment_no   SMALLINT,                             -- 第幾期（分期交易用）
  affects_balance  BOOLEAN     NOT NULL DEFAULT TRUE,
  source           TEXT        NOT NULL DEFAULT 'manual'
                   CONSTRAINT transactions_source_check
                   CHECK (source IN ('manual', 'reconcile', 'installment', 'subscription', 'import', 'autopay')),
  pending_review   BOOLEAN     NOT NULL DEFAULT FALSE,               -- 自動扣款產生，等你核對
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (type <> 'transfer' OR (to_account_id IS NOT NULL AND to_account_id <> account_id AND amount > 0)),
  CHECK (type <> 'adjustment' OR amount IS NOT NULL)
);

CREATE INDEX idx_transactions_date      ON transactions (txn_date);
CREATE INDEX idx_transactions_account   ON transactions (account_id);
CREATE INDEX idx_transactions_statement ON transactions (statement_id);

-- ---------------------------------------------------------------------
-- 明細：分類放在明細層，一筆刷卡可拆多個分類
-- in_report：是否計入分類報表（分期 full / spread 模式用來避免重複計算）
-- ---------------------------------------------------------------------
CREATE TABLE transaction_items (
  id              SERIAL PRIMARY KEY,
  transaction_id  INT           NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  name            TEXT          NOT NULL DEFAULT '',
  unit_price      BIGINT        NOT NULL CHECK (unit_price >= 0),
  quantity        NUMERIC(10,2) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  amount          BIGINT        GENERATED ALWAYS AS (round(unit_price * quantity)::BIGINT) STORED,
  category_id     INT           REFERENCES categories(id),
  in_report       BOOLEAN       NOT NULL DEFAULT TRUE,
  sort_order      INT           NOT NULL DEFAULT 0
);

CREATE INDEX idx_items_transaction ON transaction_items (transaction_id);
CREATE INDEX idx_items_category    ON transaction_items (category_id);

-- ---------------------------------------------------------------------
-- 訂閱／固定支出
-- ---------------------------------------------------------------------
CREATE TABLE subscriptions (
  id           SERIAL PRIMARY KEY,
  name         TEXT    NOT NULL,
  amount       BIGINT  NOT NULL CHECK (amount > 0),
  cycle        TEXT    NOT NULL CHECK (cycle IN ('monthly', 'bimonthly', 'yearly')),
  next_date    DATE    NOT NULL,
  account_id   INT     NOT NULL REFERENCES accounts(id),
  category_id  INT     REFERENCES categories(id),
  auto_create  BOOLEAN NOT NULL DEFAULT TRUE,   -- 到期自動產生交易
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  note         TEXT
);

-- =====================================================================
-- Views
-- =====================================================================

-- 每筆交易的總額
CREATE VIEW v_transaction_amounts AS
SELECT t.id,
       t.type,
       CASE WHEN t.type IN ('expense', 'income')
            THEN COALESCE((SELECT SUM(i.amount) FROM transaction_items i WHERE i.transaction_id = t.id), 0)
            ELSE t.amount
       END AS total
FROM transactions t;

-- 每筆交易對各帳戶「資產」的影響（正數＝資產增加）
-- 計入條件：日期已到（以台灣時間為準），或所屬信用卡帳單已對帳／已繳款
-- 因此尚未入帳的未來分期不會先算進去
CREATE VIEW v_account_movements AS
WITH counted AS (
  SELECT t.*, a.total
  FROM transactions t
  JOIN v_transaction_amounts a ON a.id = t.id
  LEFT JOIN card_statements s ON s.id = t.statement_id
  WHERE t.affects_balance
    AND (t.txn_date <= (now() AT TIME ZONE 'Asia/Taipei')::DATE OR s.status IN ('reconciled', 'paid'))
)
SELECT account_id,
       CASE type
         WHEN 'income'     THEN  total
         WHEN 'expense'    THEN -total
         WHEN 'transfer'   THEN -total
         WHEN 'adjustment' THEN  total
       END AS delta
FROM counted
UNION ALL
SELECT to_account_id, total
FROM counted
WHERE type = 'transfer';

-- 帳戶目前餘額
-- 存款：balance = 目前餘額
-- 信用卡：balance = 目前未繳（欠款，正數）
-- 貸款：balance = 剩餘本金（欠款，正數）
CREATE VIEW v_account_balances AS
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

-- 每月各分類金額與佔比（支出、收入分開算）
CREATE VIEW v_monthly_category AS
WITH base AS (
  SELECT date_trunc('month', t.txn_date)::DATE AS month,
         t.type,
         i.category_id,
         SUM(i.amount) AS amount,
         COUNT(DISTINCT t.id) AS txn_count
  FROM transaction_items i
  JOIN transactions t ON t.id = i.transaction_id
  WHERE t.type IN ('expense', 'income') AND i.in_report
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

-- 信用卡每期帳單：預估金額（系統記錄）vs 銀行帳單金額
CREATE VIEW v_statement_summary AS
SELECT s.id,
       s.account_id,
       s.period_start,
       s.period_end,
       s.due_date,
       s.status,
       s.statement_amount,
       COALESCE(SUM(CASE t.type WHEN 'expense' THEN a.total WHEN 'income' THEN -a.total ELSE 0 END), 0) AS recorded_amount,
       s.statement_amount
         - COALESCE(SUM(CASE t.type WHEN 'expense' THEN a.total WHEN 'income' THEN -a.total ELSE 0 END), 0)
         AS difference
FROM card_statements s
LEFT JOIN transactions t ON t.statement_id = s.id AND t.affects_balance
LEFT JOIN v_transaction_amounts a ON a.id = t.id
GROUP BY s.id;

-- =====================================================================
-- 預設分類
-- =====================================================================
INSERT INTO categories (name, kind, color, sort_order) VALUES
  ('食物',     'expense', '#1E3A8A', 1),
  ('家用',     'expense', '#2563EB', 2),
  ('美甲材料', 'expense', '#93C5FD', 3),
  ('交通',     'expense', '#EA580C', 4),
  ('娛樂',     'expense', '#FDBA74', 5),
  ('訂閱',     'expense', '#C2410C', 6),
  ('手續費',   'expense', '#5B6170', 7),
  ('利息',     'expense', '#374151', 8),
  ('其他',     'expense', '#9A3412', 9),
  ('薪資',     'income',  '#1D4ED8', 1),
  ('美甲',     'income',  '#2563EB', 2),
  ('利息',     'income',  '#93C5FD', 3),
  ('代墊收款', 'income',  '#EA580C', 4),
  ('其他',     'income',  '#9A3412', 5);

COMMIT;

-- =====================================================================
-- 代墊、預算、固定支出、專案、美甲（與 db/migrations/003 相同）
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
-- 明細專項、帳戶圖示、美甲客戶／施做／進貨／庫存（與 db/migrations/004 相同）
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

-- =====================================================================
-- 折扣（與 db/migrations/005 相同）
-- =====================================================================

BEGIN;

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS discount_amount BIGINT NOT NULL DEFAULT 0;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS discount_label TEXT;
-- 有折扣時，unit_price／amount 是折後金額，original_amount 是折扣前的金額
ALTER TABLE transaction_items ADD COLUMN IF NOT EXISTS original_amount BIGINT;

COMMIT;
