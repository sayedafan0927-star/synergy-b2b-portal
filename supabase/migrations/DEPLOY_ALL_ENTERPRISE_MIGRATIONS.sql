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


-- ==============================================================================
-- 4. RUGSUSA ARCHITECTURAL PATTERNS & CDC VERSIONING
-- ==============================================================================

-- 4.1. Inventory Balances: state_version for out-of-order webhook defense
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'inventory_balances' AND column_name = 'state_version') THEN
    ALTER TABLE inventory_balances ADD COLUMN state_version bigint NOT NULL DEFAULT 0;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_inventory_balances_version ON inventory_balances(state_version);

-- 4.2. Pattern 1: Parent Product Designs (RugsUSA Normalized Master Entity)
CREATE TABLE IF NOT EXISTS product_designs (
  id text PRIMARY KEY,
  collection text NOT NULL,
  manufacturer text NOT NULL DEFAULT 'Karmen Hali',
  country text NOT NULL DEFAULT 'Турция',
  article text NOT NULL,
  color text DEFAULT '',
  category text NOT NULL DEFAULT 'Ковры',
  density text DEFAULT '',
  pile_height text DEFAULT '',
  material text DEFAULT '',
  style text DEFAULT '',
  images text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE product_designs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_designs" ON product_designs;
CREATE POLICY "anon_select_designs" ON product_designs FOR SELECT
  TO anon, authenticated USING (true);

-- 4.3. Pattern 3: Size Clusters & Runner Dimensions on product_variants
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'product_variants' AND column_name = 'width') THEN
    ALTER TABLE product_variants ADD COLUMN width numeric(4,2) DEFAULT 1.60;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'product_variants' AND column_name = 'length') THEN
    ALTER TABLE product_variants ADD COLUMN length numeric(4,2) DEFAULT 2.30;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'product_variants' AND column_name = 'area_sqm') THEN
    ALTER TABLE product_variants ADD COLUMN area_sqm numeric(5,2) DEFAULT 3.68;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'product_variants' AND column_name = 'price_per_sqm') THEN
    ALTER TABLE product_variants ADD COLUMN price_per_sqm numeric(10,2) DEFAULT 32.60;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'product_variants' AND column_name = 'size_cluster') THEN
    ALTER TABLE product_variants ADD COLUMN size_cluster text DEFAULT 'medium';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'product_variants' AND column_name = 'is_runner') THEN
    ALTER TABLE product_variants ADD COLUMN is_runner boolean DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'product_variants' AND column_name = 'design_id') THEN
    ALTER TABLE product_variants ADD COLUMN design_id text REFERENCES product_designs(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_variants_cluster ON product_variants(size_cluster);
CREATE INDEX IF NOT EXISTS idx_variants_runner ON product_variants(is_runner);
CREATE INDEX IF NOT EXISTS idx_variants_design ON product_variants(design_id);

-- 4.4. Pattern 4: High-Performance Trigram GIN Search Indexes (pg_trgm)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_designs_trgm ON product_designs USING gin (
  (collection || ' ' || article || ' ' || coalesce(color, '') || ' ' || manufacturer) gin_trgm_ops
);

CREATE INDEX IF NOT EXISTS idx_variants_sku_trgm ON product_variants USING gin (
  sku gin_trgm_ops
);

-- ==============================================================================
-- 5. LEADS & CONTACT FORM SUBMISSIONS
-- ==============================================================================

CREATE TABLE IF NOT EXISTS leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text NOT NULL,
  company text,
  email text,
  message text,
  source text NOT NULL DEFAULT 'Форма заявки с сайта B2B',
  kanban_stage text NOT NULL DEFAULT 'Новые лиды',
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'in_progress', 'converted', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads(phone);

ALTER TABLE leads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_manage_leads" ON leads;
CREATE POLICY "admin_manage_leads" ON leads
  FOR ALL
  TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "anyone_insert_leads" ON leads;
CREATE POLICY "anyone_insert_leads" ON leads
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- ==============================================================================
-- 6. DATA INTEGRITY CHECK CONSTRAINTS & OPTIMISTIC LOCKING
-- ==============================================================================

-- 6.1 Non-negative CHECK Constraints
ALTER TABLE orders DROP CONSTRAINT IF EXISTS chk_orders_total_amount;
ALTER TABLE orders ADD CONSTRAINT chk_orders_total_amount CHECK (total_amount >= 0);

ALTER TABLE orders DROP CONSTRAINT IF EXISTS chk_orders_total_sqm;
ALTER TABLE orders ADD CONSTRAINT chk_orders_total_sqm CHECK (total_sqm >= 0);

ALTER TABLE orders DROP CONSTRAINT IF EXISTS chk_orders_total_items;
ALTER TABLE orders ADD CONSTRAINT chk_orders_total_items CHECK (total_items >= 0);

ALTER TABLE order_items DROP CONSTRAINT IF EXISTS chk_order_items_price;
ALTER TABLE order_items ADD CONSTRAINT chk_order_items_price CHECK (price >= 0);

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS chk_profiles_credit_limit;
ALTER TABLE profiles ADD CONSTRAINT chk_profiles_credit_limit CHECK (credit_limit_usd >= 0);

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS chk_profiles_delay_days;
ALTER TABLE profiles ADD CONSTRAINT chk_profiles_delay_days CHECK (payment_delay_days >= 0);

ALTER TABLE inventory_balances DROP CONSTRAINT IF EXISTS chk_inv_free_stock;
ALTER TABLE inventory_balances ADD CONSTRAINT chk_inv_free_stock CHECK (free_stock >= 0);

ALTER TABLE inventory_balances DROP CONSTRAINT IF EXISTS chk_inv_reserved_stock;
ALTER TABLE inventory_balances ADD CONSTRAINT chk_inv_reserved_stock CHECK (reserved_stock >= 0);

ALTER TABLE inventory_balances DROP CONSTRAINT IF EXISTS chk_inv_total_stock;
ALTER TABLE inventory_balances ADD CONSTRAINT chk_inv_total_stock CHECK (total_stock >= 0);

-- 6.2 Optimistic Locking (version columns)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE products ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;

-- ==============================================================================
-- 7. HIGH-PERFORMANCE QUERY INDEXES
-- ==============================================================================

CREATE INDEX IF NOT EXISTS idx_orders_user_created ON orders (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_order_items_sku ON order_items (sku);
CREATE INDEX IF NOT EXISTS idx_order_items_product_id ON order_items (product_id);
CREATE INDEX IF NOT EXISTS idx_products_collection ON products (collection);
CREATE INDEX IF NOT EXISTS idx_products_category ON products (category);
CREATE INDEX IF NOT EXISTS idx_products_supplier ON products (supplier_id);
CREATE INDEX IF NOT EXISTS idx_warehouse_stock_city ON warehouse_stock (city);
CREATE INDEX IF NOT EXISTS idx_collection_prices_type ON collection_prices (price_type_id);
CREATE INDEX IF NOT EXISTS idx_leads_kanban ON leads (kanban_stage);

-- ==============================================================================
-- 8. PARTITIONED AUDIT LOGS (RANGE BY MONTH)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS integration_audit_logs_v2 (
  id uuid DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  status text NOT NULL CHECK (status IN ('success', 'warning', 'error')),
  status_code integer,
  latency_ms integer,
  source text NOT NULL,
  payload jsonb,
  error_message text,
  correlation_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS audit_logs_y2026m09 PARTITION OF integration_audit_logs_v2
  FOR VALUES FROM ('2026-09-01 00:00:00+00') TO ('2026-10-01 00:00:00+00');
CREATE TABLE IF NOT EXISTS audit_logs_y2026m10 PARTITION OF integration_audit_logs_v2
  FOR VALUES FROM ('2026-10-01 00:00:00+00') TO ('2026-11-01 00:00:00+00');
CREATE TABLE IF NOT EXISTS audit_logs_y2026m11 PARTITION OF integration_audit_logs_v2
  FOR VALUES FROM ('2026-11-01 00:00:00+00') TO ('2026-12-01 00:00:00+00');
CREATE TABLE IF NOT EXISTS audit_logs_y2026m12 PARTITION OF integration_audit_logs_v2
  FOR VALUES FROM ('2026-12-01 00:00:00+00') TO ('2027-01-01 00:00:00+00');
CREATE TABLE IF NOT EXISTS audit_logs_default PARTITION OF integration_audit_logs_v2 DEFAULT;

CREATE INDEX IF NOT EXISTS idx_audit_v2_created ON integration_audit_logs_v2 (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_v2_status ON integration_audit_logs_v2 (status);
CREATE INDEX IF NOT EXISTS idx_audit_v2_event_type ON integration_audit_logs_v2 (event_type);
CREATE INDEX IF NOT EXISTS idx_audit_v2_correlation ON integration_audit_logs_v2 (correlation_id);

ALTER TABLE integration_audit_logs_v2 ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_read_audit_logs_v2" ON integration_audit_logs_v2;
CREATE POLICY "admin_read_audit_logs_v2" ON integration_audit_logs_v2 FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "service_insert_audit_logs_v2" ON integration_audit_logs_v2;
CREATE POLICY "service_insert_audit_logs_v2" ON integration_audit_logs_v2 FOR INSERT
  TO authenticated WITH CHECK (true);

COMMIT;
