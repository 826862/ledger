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
