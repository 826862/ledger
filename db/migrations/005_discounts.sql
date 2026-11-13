-- =====================================================================
-- 005：折扣（明細記錄原價，交易記錄折扣名稱與金額）
-- 已經在用的資料庫：在 Neon SQL Editor 執行一次（重複執行也不會出錯）。
-- =====================================================================

BEGIN;

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS discount_amount BIGINT NOT NULL DEFAULT 0;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS discount_label TEXT;
-- 有折扣時，unit_price／amount 是折後金額，original_amount 是折扣前的金額
ALTER TABLE transaction_items ADD COLUMN IF NOT EXISTS original_amount BIGINT;

COMMIT;
