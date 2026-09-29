-- Migration 20260929090000: Add overdue fields, expand order statuses, and create webhook deduplication table

-- 1. Overdue columns on partner_balances
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'partner_balances' AND column_name = 'is_overdue'
  ) THEN
    ALTER TABLE partner_balances ADD COLUMN is_overdue boolean NOT NULL DEFAULT false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'partner_balances' AND column_name = 'overdue_days'
  ) THEN
    ALTER TABLE partner_balances ADD COLUMN overdue_days integer NOT NULL DEFAULT 0;
  END IF;
END $$;

-- 2. Expand status check constraint on orders
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check
  CHECK (status IN ('draft', 'pending', 'reserved', 'awaiting_payment', 'processing', 'partially_shipped', 'shipped', 'delivered', 'cancelled', 'failed_dlq'));

-- 3. Webhook idempotency and deduplication table
CREATE TABLE IF NOT EXISTS webhook_events (
  event_id text PRIMARY KEY,
  event_type text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_processed_at ON webhook_events(processed_at DESC);

-- Enable RLS
ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_webhook_events" ON webhook_events;
CREATE POLICY "service_role_all_webhook_events" ON webhook_events
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);
