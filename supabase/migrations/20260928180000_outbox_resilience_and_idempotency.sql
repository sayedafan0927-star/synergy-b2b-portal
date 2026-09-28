/*
# Outbox Resilience, Idempotency & Dead Letter Queue (DLQ)

1. New Columns on `orders`:
   - `idempotency_key` (text, UNIQUE) — prevents duplicate orders from multiple clicks / retries.
   - `retry_count` (integer, DEFAULT 0) — tracks sync attempts to 1C.
   - `last_error` (text, nullable) — logs last failure message from ERP.
   - `next_retry_at` (timestamptz, DEFAULT now()) — supports exponential backoff scheduling.

2. Status Expansion:
   - Add 'processing_sync' (in-flight lock) and 'failed_dlq' (Dead Letter Queue after max retries).
*/

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'idempotency_key') THEN
    ALTER TABLE orders ADD COLUMN idempotency_key text UNIQUE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'retry_count') THEN
    ALTER TABLE orders ADD COLUMN retry_count integer NOT NULL DEFAULT 0;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'last_error') THEN
    ALTER TABLE orders ADD COLUMN last_error text;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'next_retry_at') THEN
    ALTER TABLE orders ADD COLUMN next_retry_at timestamptz DEFAULT now();
  END IF;
END $$;

-- Update status check constraint to include 'processing_sync' and 'failed_dlq'
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check 
  CHECK (status IN ('draft', 'pending', 'processing_sync', 'processing', 'confirmed', 'shipped', 'delivered', 'cancelled', 'failed_dlq'));

CREATE INDEX IF NOT EXISTS idx_orders_outbox_retry ON orders(status, next_retry_at) 
  WHERE status IN ('pending', 'processing_sync');
