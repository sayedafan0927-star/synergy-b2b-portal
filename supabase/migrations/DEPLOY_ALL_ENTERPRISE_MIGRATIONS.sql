-- ==============================================================================
-- SYNERGY B2B PORTAL — CONSOLIDATED ENTERPRISE DATABASE MIGRATION SCRIPT
-- ==============================================================================
-- Run this script in the Supabase SQL Editor to apply all enterprise schema
-- enhancements: Catalog Staging, Outbox Idempotency, DLQ, and WMS Hold TTL.
-- Safe to run repeatedly (Idempotent DDL / IF NOT EXISTS).
-- ==============================================================================

BEGIN;

-- ==============================================================================
-- 1. CATALOG STAGING & INVENTORY BALANCES
-- ==============================================================================

-- 1.1. Table: catalog_cache (High-load Sub-50ms cache)
CREATE TABLE IF NOT EXISTS catalog_cache (
  cache_key text PRIMARY KEY,
  data jsonb NOT NULL,
  products_count integer NOT NULL DEFAULT 0,
  version bigint NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_catalog_cache_updated_at ON catalog_cache(updated_at);
ALTER TABLE catalog_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_catalog_cache" ON catalog_cache;
CREATE POLICY "anon_select_catalog_cache" ON catalog_cache FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "admin_service_all_catalog_cache" ON catalog_cache;
CREATE POLICY "admin_service_all_catalog_cache" ON catalog_cache FOR ALL
  TO authenticated
  USING (
    auth.jwt() ->> 'role' = 'service_role' OR
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    auth.jwt() ->> 'role' = 'service_role' OR
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- 1.2. Table: inventory_balances (Materialized real-time stock from ERP webhooks)
CREATE TABLE IF NOT EXISTS inventory_balances (
  sku text NOT NULL,
  warehouse_id integer NOT NULL DEFAULT 0,
  warehouse_name text NOT NULL DEFAULT '',
  free_stock numeric NOT NULL DEFAULT 0,
  reserved_stock numeric NOT NULL DEFAULT 0,
  total_stock numeric NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (sku, warehouse_id)
);

CREATE INDEX IF NOT EXISTS idx_inventory_balances_sku ON inventory_balances(sku);
CREATE INDEX IF NOT EXISTS idx_inventory_balances_warehouse ON inventory_balances(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_inventory_balances_updated_at ON inventory_balances(updated_at);
ALTER TABLE inventory_balances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_select_inventory_balances" ON inventory_balances;
CREATE POLICY "auth_select_inventory_balances" ON inventory_balances FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "admin_service_all_inventory_balances" ON inventory_balances;
CREATE POLICY "admin_service_all_inventory_balances" ON inventory_balances FOR ALL
  TO authenticated
  USING (
    auth.jwt() ->> 'role' = 'service_role' OR
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    auth.jwt() ->> 'role' = 'service_role' OR
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- 1.3. Profiles columns for financial compliance
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'credit_limit_usd') THEN
    ALTER TABLE profiles ADD COLUMN credit_limit_usd numeric DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'payment_delay_days') THEN
    ALTER TABLE profiles ADD COLUMN payment_delay_days integer DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'city') THEN
    ALTER TABLE profiles ADD COLUMN city text DEFAULT '';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'address') THEN
    ALTER TABLE profiles ADD COLUMN address text DEFAULT '';
  END IF;
END $$;


-- ==============================================================================
-- 2. OUTBOX RESILIENCE, IDEMPOTENCY & DEAD LETTER QUEUE (DLQ)
-- ==============================================================================

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

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'hold_expires_at') THEN
    ALTER TABLE orders ADD COLUMN hold_expires_at timestamptz;
  END IF;
END $$;

-- Status constraint expansion
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check 
  CHECK (status IN ('draft', 'pending', 'processing_sync', 'processing', 'confirmed', 'shipped', 'delivered', 'cancelled', 'failed_dlq'));

CREATE INDEX IF NOT EXISTS idx_orders_outbox_retry ON orders(status, next_retry_at) 
  WHERE status IN ('pending', 'processing_sync');

CREATE INDEX IF NOT EXISTS idx_orders_hold_expiry 
  ON orders (status, hold_expires_at) 
  WHERE status IN ('pending', 'draft');


-- ==============================================================================
-- 3. WMS RESERVATION HOLD TTL & AUTO-CANCELLATION FUNCTION
-- ==============================================================================

CREATE OR REPLACE FUNCTION cancel_expired_order_holds(p_batch_size integer DEFAULT 50)
RETURNS TABLE (
  cancelled_order_id uuid,
  cancelled_order_number text,
  user_id uuid,
  total_amount numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH expired_candidates AS (
    SELECT id
    FROM orders
    WHERE status = 'pending'
      AND (
        (hold_expires_at IS NOT NULL AND hold_expires_at <= now())
        OR (hold_expires_at IS NULL AND created_at <= now() - INTERVAL '24 hours')
      )
    ORDER BY created_at ASC
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  ),
  updated_orders AS (
    UPDATE orders o
    SET 
      status = 'cancelled',
      notes = TRIM(COALESCE(o.notes, '') || ' [Auto-cancelled: WMS reservation hold TTL expired (24h)]'),
      updated_at = now()
    FROM expired_candidates ec
    WHERE o.id = ec.id
    RETURNING o.id, o.order_number, o.user_id, o.total_amount
  )
  SELECT id, order_number, u.user_id, u.total_amount
  FROM updated_orders u;
END;
$$;

COMMIT;
