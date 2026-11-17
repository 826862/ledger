-- =====================================================================
-- 006：帳戶「預設隱藏餘額」
-- 在 Neon SQL Editor 執行一次（重複執行也不會出錯）。
-- =====================================================================

BEGIN;

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS hide_balance BOOLEAN NOT NULL DEFAULT FALSE;

COMMIT;
