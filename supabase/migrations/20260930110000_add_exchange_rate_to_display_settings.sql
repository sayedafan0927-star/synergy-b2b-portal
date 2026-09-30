-- Migration 20260930110000: Add exchange_rate_usd_kzt to display_settings

ALTER TABLE display_settings ADD COLUMN IF NOT EXISTS exchange_rate_usd_kzt numeric(12,4) DEFAULT 520.0000;

-- Update existing default rows with standard 520.00 rate if null
UPDATE display_settings
SET exchange_rate_usd_kzt = 520.0000
WHERE exchange_rate_usd_kzt IS NULL;
