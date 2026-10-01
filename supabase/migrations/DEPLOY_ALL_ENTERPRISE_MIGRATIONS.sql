-- ==============================================================================
-- SYNERGY B2B PORTAL — CONSOLIDATED ENTERPRISE DATABASE MIGRATION SCRIPT
-- ==============================================================================
-- Run this script in the Supabase SQL Editor to apply all enterprise schema
-- enhancements: Catalog Staging, Outbox Idempotency, DLQ, WMS Hold TTL, 
-- Contracts, Order Status History, Leads, Auditing & High-load Indexes.
-- Safe to run repeatedly (100% Idempotent DDL / IF NOT EXISTS / Defensive Guards).
-- ==============================================================================

BEGIN;

-- ==============================================================================
-- 0. DEFENSIVE TABLE & COLUMN HARMONIZATION
-- ==============================================================================

-- 0.1 Ensure profiles table has all required enterprise fields
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'profiles') THEN
    ALTER TABLE profiles ADD COLUMN IF NOT EXISTS credit_limit_usd numeric DEFAULT 0;
    ALTER TABLE profiles ADD COLUMN IF NOT EXISTS payment_delay_days integer DEFAULT 0;
    ALTER TABLE profiles ADD COLUMN IF NOT EXISTS city text DEFAULT '';
    ALTER TABLE profiles ADD COLUMN IF NOT EXISTS address text DEFAULT '';
    ALTER TABLE profiles ADD COLUMN IF NOT EXISTS partner_id text;
    ALTER TABLE profiles ADD COLUMN IF NOT EXISTS password_hash text;
  END IF;
END $$;

-- 0.2 Ensure orders table and all required enterprise columns exist
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'orders') THEN
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS total_amount numeric DEFAULT 0;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS total_sqm numeric DEFAULT 0;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS total_items integer DEFAULT 0;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS notes text DEFAULT '';
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS warehouse text DEFAULT '';
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS partner_id text;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS placed_by_id uuid;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS idempotency_key text UNIQUE;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS last_error text;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS next_retry_at timestamptz DEFAULT now();
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS hold_expires_at timestamptz;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'USD';
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS parent_order_id uuid REFERENCES orders(id) ON DELETE CASCADE;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS reservations_released boolean NOT NULL DEFAULT false;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_orders_parent_order_id ON orders(parent_order_id);
CREATE INDEX IF NOT EXISTS idx_orders_reservations_released ON orders(reservations_released);

-- 0.3 Ensure order_items table and all required columns exist
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'order_items') THEN
    ALTER TABLE order_items ADD COLUMN IF NOT EXISTS product_id text DEFAULT '';
    ALTER TABLE order_items ADD COLUMN IF NOT EXISTS product_name text DEFAULT '';
    ALTER TABLE order_items ADD COLUMN IF NOT EXISTS collection text DEFAULT '';
    ALTER TABLE order_items ADD COLUMN IF NOT EXISTS size text DEFAULT '';
    ALTER TABLE order_items ADD COLUMN IF NOT EXISTS sku text DEFAULT '';
    ALTER TABLE order_items ADD COLUMN IF NOT EXISTS warehouse text DEFAULT '';
    ALTER TABLE order_items ADD COLUMN IF NOT EXISTS price numeric DEFAULT 0;
    ALTER TABLE order_items ADD COLUMN IF NOT EXISTS quantity integer DEFAULT 1;
  END IF;
END $$;


-- ==============================================================================
-- 1. CATALOG STAGING & INVENTORY BALANCES
-- ==============================================================================

-- 1.1 Table: catalog_cache (High-load Sub-50ms cache)
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

-- 1.2 Table: inventory_balances (Materialized real-time stock from ERP webhooks)
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


-- ==============================================================================
-- 2. OUTBOX RESILIENCE, IDEMPOTENCY & DEAD LETTER QUEUE (DLQ)
-- ==============================================================================

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
    WHERE status IN ('pending', 'failed_dlq')
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

-- 4.1 Inventory Balances: state_version for out-of-order webhook defense
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'inventory_balances' AND column_name = 'state_version') THEN
    ALTER TABLE inventory_balances ADD COLUMN state_version bigint NOT NULL DEFAULT 0;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_inventory_balances_version ON inventory_balances(state_version);

-- 4.2 Pattern 1: Parent Product Designs (RugsUSA Normalized Master Entity)
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

-- 4.3 Pattern 3: Size Clusters & Runner Dimensions on product_variants (Conditional)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'product_variants') THEN
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

    CREATE INDEX IF NOT EXISTS idx_variants_cluster ON product_variants(size_cluster);
    CREATE INDEX IF NOT EXISTS idx_variants_runner ON product_variants(is_runner);
    CREATE INDEX IF NOT EXISTS idx_variants_design ON product_variants(design_id);
  END IF;
END $$;

-- 4.4 Pattern 4: High-Performance Trigram GIN Search Indexes (pg_trgm)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_designs_trgm ON product_designs USING gin (((collection || '' '' || article || '' '' || coalesce(color, '''') || '' '' || manufacturer)) gin_trgm_ops)';
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'trgm index on designs skipped: %', SQLERRM;
    END;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'product_variants') THEN
      BEGIN
        EXECUTE 'CREATE INDEX IF NOT EXISTS idx_variants_sku_trgm ON product_variants USING gin (sku gin_trgm_ops)';
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'trgm index on variants skipped: %', SQLERRM;
      END;
    END IF;
  END IF;
END $$;


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

-- 6.1 Non-negative CHECK Constraints (Fully Defensive)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'total_amount') THEN
    ALTER TABLE orders DROP CONSTRAINT IF EXISTS chk_orders_total_amount;
    ALTER TABLE orders ADD CONSTRAINT chk_orders_total_amount CHECK (total_amount >= 0);
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'total_sqm') THEN
    ALTER TABLE orders DROP CONSTRAINT IF EXISTS chk_orders_total_sqm;
    ALTER TABLE orders ADD CONSTRAINT chk_orders_total_sqm CHECK (total_sqm >= 0);
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'total_items') THEN
    ALTER TABLE orders DROP CONSTRAINT IF EXISTS chk_orders_total_items;
    ALTER TABLE orders ADD CONSTRAINT chk_orders_total_items CHECK (total_items >= 0);
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'order_items' AND column_name = 'price') THEN
    ALTER TABLE order_items DROP CONSTRAINT IF EXISTS chk_order_items_price;
    ALTER TABLE order_items ADD CONSTRAINT chk_order_items_price CHECK (price >= 0);
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'credit_limit_usd') THEN
    ALTER TABLE profiles DROP CONSTRAINT IF EXISTS chk_profiles_credit_limit;
    ALTER TABLE profiles ADD CONSTRAINT chk_profiles_credit_limit CHECK (credit_limit_usd >= 0);
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'payment_delay_days') THEN
    ALTER TABLE profiles DROP CONSTRAINT IF EXISTS chk_profiles_delay_days;
    ALTER TABLE profiles ADD CONSTRAINT chk_profiles_delay_days CHECK (payment_delay_days >= 0);
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'inventory_balances') THEN
    ALTER TABLE inventory_balances DROP CONSTRAINT IF EXISTS chk_inv_free_stock;
    ALTER TABLE inventory_balances ADD CONSTRAINT chk_inv_free_stock CHECK (free_stock >= 0);

    ALTER TABLE inventory_balances DROP CONSTRAINT IF EXISTS chk_inv_reserved_stock;
    ALTER TABLE inventory_balances ADD CONSTRAINT chk_inv_reserved_stock CHECK (reserved_stock >= 0);

    ALTER TABLE inventory_balances DROP CONSTRAINT IF EXISTS chk_inv_total_stock;
    ALTER TABLE inventory_balances ADD CONSTRAINT chk_inv_total_stock CHECK (total_stock >= 0);
  END IF;
END $$;

-- 6.2 Optimistic Locking (version columns)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'orders') THEN
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'products') THEN
    ALTER TABLE products ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
    CREATE INDEX IF NOT EXISTS idx_products_collection ON products (collection);
    CREATE INDEX IF NOT EXISTS idx_products_category ON products (category);
    CREATE INDEX IF NOT EXISTS idx_products_supplier ON products (supplier_id);
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'product_variants') THEN
    ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'warehouse_stock') THEN
    CREATE INDEX IF NOT EXISTS idx_warehouse_stock_city ON warehouse_stock (city);
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'collection_prices') THEN
    CREATE INDEX IF NOT EXISTS idx_collection_prices_type ON collection_prices (price_type_id);
  END IF;
END $$;


-- ==============================================================================
-- 7. HIGH-PERFORMANCE QUERY INDEXES
-- ==============================================================================

CREATE INDEX IF NOT EXISTS idx_orders_user_created ON orders (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_order_items_sku ON order_items (sku);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'order_items' AND column_name = 'product_id') THEN
    CREATE INDEX IF NOT EXISTS idx_order_items_product_id ON order_items (product_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_leads_kanban ON leads (kanban_stage);


-- ==============================================================================
-- 8. AUDIT LOGS (BASE TABLE & PARTITIONED V2)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS integration_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  direction text NOT NULL,
  status text NOT NULL,
  status_code integer,
  latency_ms integer,
  source text NOT NULL,
  payload jsonb,
  error_message text,
  correlation_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE integration_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_read_audit_logs" ON integration_audit_logs;
CREATE POLICY "admin_read_audit_logs" ON integration_audit_logs FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "service_insert_audit_logs" ON integration_audit_logs;
CREATE POLICY "service_insert_audit_logs" ON integration_audit_logs FOR INSERT
  TO anon, authenticated WITH CHECK (true);

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


-- ==============================================================================
-- 9. SENSITIVE CREDENTIALS PROTECTION & ADVISORY LOCKS
-- ==============================================================================

-- 9.1 Ensure password_hash column exists on profiles table
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'profiles') THEN
    ALTER TABLE profiles ADD COLUMN IF NOT EXISTS password_hash text;
  END IF;
END $$;

-- 9.2 Revoke SELECT privilege on sensitive credentials from client-facing roles
DO $$ BEGIN
  REVOKE SELECT (password_hash) ON profiles FROM anon;
  REVOKE SELECT (password_hash) ON profiles FROM authenticated;
EXCEPTION
  WHEN OTHERS THEN
    NULL;
END $$;

-- 9.3 Explicitly grant full credentials access to service_role
DO $$ BEGIN
  GRANT SELECT, UPDATE (password_hash) ON profiles TO service_role;
EXCEPTION
  WHEN OTHERS THEN
    NULL;
END $$;

-- 9.4 Advisory lock wrapper for bootstrap_admin to eliminate race conditions
CREATE OR REPLACE FUNCTION bootstrap_admin_safe(p_user_id uuid, p_email text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_admin_count integer;
BEGIN
  -- Acquire transaction-level advisory lock (key: 420001)
  PERFORM pg_advisory_xact_lock(420001);

  SELECT count(*) INTO v_admin_count FROM profiles WHERE role = 'admin';
  IF v_admin_count > 0 THEN
    RETURN false;
  END IF;

  UPDATE profiles
  SET role = 'admin', updated_at = now()
  WHERE id = p_user_id;

  RETURN true;
END;
$$;


-- ==============================================================================
-- 10. ORDER STATUS HISTORY AUDIT TRAIL & SKIP LOCKED OUTBOX CLAIM
-- ==============================================================================

-- 10.1 Table order_status_history for immutable audit trail of order lifecycle
CREATE TABLE IF NOT EXISTS order_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  previous_status text,
  new_status text NOT NULL,
  changed_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  correlation_id text,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_status_history_order_id ON order_status_history(order_id);
CREATE INDEX IF NOT EXISTS idx_order_status_history_created_at ON order_status_history(created_at DESC);

ALTER TABLE order_status_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "client_view_own_order_status_history" ON order_status_history;
CREATE POLICY "client_view_own_order_status_history" ON order_status_history
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM orders
      WHERE orders.id = order_status_history.order_id
        AND orders.user_id = auth.uid()
    )
    OR
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('admin', 'manager_rm', 'manager_lm')
    )
  );

-- 10.2 Trigger to record every order status transition automatically
CREATE OR REPLACE FUNCTION log_order_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF (TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status) THEN
    INSERT INTO order_status_history (
      order_id,
      previous_status,
      new_status,
      changed_by,
      reason,
      created_at
    ) VALUES (
      NEW.id,
      OLD.status,
      NEW.status,
      auth.uid(),
      COALESCE(NEW.notes, 'Status transitioned in order processing pipeline'),
      now()
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_order_status_transition ON orders;
CREATE TRIGGER trg_order_status_transition
  AFTER UPDATE OF status ON orders
  FOR EACH ROW
  EXECUTE FUNCTION log_order_status_transition();

-- 10.3 Atomic concurrent outbox claim function (FOR UPDATE SKIP LOCKED)
CREATE OR REPLACE FUNCTION claim_outbox_orders(p_limit integer DEFAULT 10)
RETURNS SETOF orders
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH locked_orders AS (
    SELECT id
    FROM orders
    WHERE status = 'pending'
      AND parent_order_id IS NULL
      AND (next_retry_at IS NULL OR next_retry_at <= now())
    ORDER BY created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  UPDATE orders o
  SET status = 'processing_sync',
      updated_at = now()
  FROM locked_orders lo
  WHERE o.id = lo.id
  RETURNING o.*;
END;
$$;


-- ==============================================================================
-- 11. CONTRACTS LIFECYCLE & MULTI-CURRENCY SUPPORT
-- ==============================================================================

-- 11.1 Table contracts for formal B2B agreements, credit limits, price types and payment terms
CREATE TABLE IF NOT EXISTS contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id text NOT NULL,
  contract_number text NOT NULL,
  contract_type text NOT NULL DEFAULT 'prepayment' CHECK (contract_type IN ('prepayment', 'deferred_14', 'deferred_30', 'deferred_60', 'consignment')),
  price_type text NOT NULL DEFAULT 'wholesale',
  credit_limit_usd numeric(12,2) NOT NULL DEFAULT 0.00 CHECK (credit_limit_usd >= 0),
  payment_deferral_days integer NOT NULL DEFAULT 0 CHECK (payment_deferral_days >= 0),
  valid_from date NOT NULL DEFAULT CURRENT_DATE,
  valid_to date,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'suspended', 'terminated', 'expired')),
  allowed_warehouses integer[] DEFAULT '{81}',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contracts_partner_id ON contracts(partner_id);
CREATE INDEX IF NOT EXISTS idx_contracts_status ON contracts(status);

ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "client_view_own_contracts" ON contracts;
CREATE POLICY "client_view_own_contracts" ON contracts
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND (profiles.partner_id = contracts.partner_id OR profiles.role IN ('admin', 'manager_rm', 'manager_lm'))
    )
  );

DROP POLICY IF EXISTS "admin_manage_contracts" ON contracts;
CREATE POLICY "admin_manage_contracts" ON contracts
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('admin', 'manager_rm')
    )
  );

-- 11.2 Multi-currency support on orders table
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'currency'
  ) THEN
    ALTER TABLE orders ADD COLUMN currency text NOT NULL DEFAULT 'USD' CHECK (currency IN ('USD', 'KZT', 'RUB', 'EUR'));
  END IF;
END $$;

-- 11.3 Add contract_id reference to orders
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'contract_id'
  ) THEN
    ALTER TABLE orders ADD COLUMN contract_id uuid REFERENCES contracts(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 11.5 Exact currency conversion exchange rate column
ALTER TABLE orders 
ADD COLUMN IF NOT EXISTS applied_exchange_rate numeric(12,4) DEFAULT 1.0000;

-- 12. High-Load Atomic Checkout Transaction (create_order_atomic)
CREATE OR REPLACE FUNCTION create_order_atomic(
  p_order jsonb,
  p_items jsonb,
  p_split_orders jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_sku text;
  v_qty integer;
  v_wh_id integer;
  v_available integer;
  v_order_id uuid;
  v_order_number text;
  v_split_elem jsonb;
  v_sub_order_id uuid;
  v_sub_doc_number text;
  v_created_sub_orders jsonb := '[]'::jsonb;
  v_exchange_rate numeric(12,4);
BEGIN
  v_exchange_rate := COALESCE((p_order->>'applied_exchange_rate')::numeric, 1.0000);

  -- 1. Сортировка SKU по алфавиту для Zero-Deadlock гарантии
  FOR v_sku, v_qty, v_wh_id IN
    SELECT 
      (elem->>'sku')::text,
      SUM((elem->>'quantity')::integer)::integer,
      COALESCE((elem->>'warehouse_id')::integer, 81)
    FROM jsonb_array_elements(p_items) AS elem
    WHERE COALESCE(elem->>'sku', '') <> ''
    GROUP BY (elem->>'sku')::text, COALESCE((elem->>'warehouse_id')::integer, 81)
    ORDER BY (elem->>'sku')::text ASC
  LOOP
    SELECT free_stock INTO v_available
    FROM inventory_balances
    WHERE sku = v_sku AND warehouse_id = v_wh_id
    FOR UPDATE;

    IF v_available IS NULL OR v_available < v_qty THEN
      RAISE EXCEPTION 'INSUFFICIENT_STOCK: SKU "%" (доступно: %, запрошено: %)', 
        v_sku, COALESCE(v_available, 0), v_qty;
    END IF;

    UPDATE inventory_balances
    SET free_stock = free_stock - v_qty,
        reserved_stock = reserved_stock + v_qty,
        updated_at = now()
    WHERE sku = v_sku AND warehouse_id = v_wh_id;
  END LOOP;

  -- 2. Вставка мастер-заказа
  INSERT INTO orders (
    user_id,
    placed_by_id,
    warehouse,
    notes,
    total_amount,
    total_items,
    total_sqm,
    status,
    idempotency_key,
    currency,
    applied_exchange_rate,
    contract_id
  ) VALUES (
    (p_order->>'user_id')::uuid,
    COALESCE((p_order->>'placed_by_id')::uuid, (p_order->>'user_id')::uuid),
    COALESCE(p_order->>'warehouse', 'Основной Склад Астана'),
    COALESCE(p_order->>'notes', ''),
    COALESCE((p_order->>'total_amount')::numeric, 0),
    COALESCE((p_order->>'total_items')::integer, 1),
    COALESCE((p_order->>'total_sqm')::numeric, 0),
    'pending',
    p_order->>'idempotency_key',
    COALESCE(p_order->>'currency', 'USD'),
    v_exchange_rate,
    CASE 
      WHEN p_order->>'contract_id' IS NOT NULL 
           AND p_order->>'contract_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN (p_order->>'contract_id')::uuid 
      ELSE NULL 
    END
  )
  RETURNING id, order_number INTO v_order_id, v_order_number;

  -- 3. Пакетная вставка позиций мастер-заказа
  INSERT INTO order_items (
    order_id,
    product_id,
    product_name,
    size,
    sku,
    warehouse,
    warehouse_id,
    price,
    quantity
  )
  SELECT
    v_order_id,
    COALESCE(elem->>'product_id', elem->>'productId', elem->>'sku', ''),
    COALESCE(elem->>'product_name', elem->>'sku', 'Ковровое изделие'),
    COALESCE(elem->>'size', 'Стандарт'),
    COALESCE(elem->>'sku', ''),
    COALESCE(elem->>'warehouse', 'Основной Склад Астана'),
    COALESCE((elem->>'warehouse_id')::integer, 81),
    COALESCE((elem->>'price')::numeric, 0),
    COALESCE((elem->>'quantity')::integer, 1)
  FROM jsonb_array_elements(p_items) AS elem;

  -- 4. Обработка дочерних субордеров мультисклада
  IF p_split_orders IS NOT NULL AND jsonb_array_length(p_split_orders) > 0 THEN
    FOR v_split_elem IN SELECT * FROM jsonb_array_elements(p_split_orders)
    LOOP
      v_sub_doc_number := v_split_elem->>'doc_number';
      
      INSERT INTO orders (
        order_number,
        user_id,
        placed_by_id,
        warehouse,
        notes,
        total_amount,
        total_items,
        total_sqm,
        status,
        idempotency_key,
        currency,
        applied_exchange_rate,
        contract_id,
        parent_order_id
      ) VALUES (
        v_sub_doc_number,
        (p_order->>'user_id')::uuid,
        COALESCE((p_order->>'placed_by_id')::uuid, (p_order->>'user_id')::uuid),
        COALESCE(v_split_elem->>'warehouse', 'Основной Склад Астана'),
        COALESCE(v_split_elem->>'notes', ''),
        COALESCE((v_split_elem->>'amount')::numeric, 0),
        COALESCE((v_split_elem->>'items_count')::integer, 1),
        COALESCE((v_split_elem->>'sqm')::numeric, 0),
        'pending',
        v_split_elem->>'idempotency_key',
        COALESCE(p_order->>'currency', 'USD'),
        v_exchange_rate,
        CASE 
          WHEN p_order->>'contract_id' IS NOT NULL 
               AND p_order->>'contract_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          THEN (p_order->>'contract_id')::uuid 
          ELSE NULL 
        END,
        v_order_id
      )
      RETURNING id INTO v_sub_order_id;

      IF v_split_elem->'items' IS NOT NULL AND jsonb_array_length(v_split_elem->'items') > 0 THEN
        INSERT INTO order_items (
          order_id,
          product_id,
          product_name,
          size,
          sku,
          warehouse,
          warehouse_id,
          price,
          quantity
        )
        SELECT
          v_sub_order_id,
          COALESCE(s_elem->>'product_id', s_elem->>'productId', s_elem->>'sku', ''),
          COALESCE(s_elem->>'product_name', s_elem->>'sku', 'Ковровое изделие'),
          COALESCE(s_elem->>'size', 'Стандарт'),
          COALESCE(s_elem->>'sku', ''),
          COALESCE(v_split_elem->>'warehouse', 'Основной Склад Астана'),
          COALESCE((s_elem->>'warehouse_id')::integer, (v_split_elem->>'warehouse_id')::integer, 81),
          COALESCE((s_elem->>'price')::numeric, 0),
          COALESCE((s_elem->>'quantity')::integer, 1)
        FROM jsonb_array_elements(v_split_elem->'items') AS s_elem;
      END IF;

      v_created_sub_orders := v_created_sub_orders || jsonb_build_object(
        'doc_number', v_sub_doc_number,
        'warehouse', v_split_elem->>'warehouse',
        'amount', (v_split_elem->>'amount')::numeric,
        'items_count', (v_split_elem->>'items_count')::integer
      );
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'order_id', v_order_id,
    'order_number', v_order_number,
    'split_orders', v_created_sub_orders
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION create_order_atomic(jsonb, jsonb, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION create_order_atomic(jsonb, jsonb, jsonb) TO authenticated, service_role;

-- ==============================================================================
-- 13. Warehouse Atomicity & Reservation Release on Cancellation
-- ==============================================================================

CREATE OR REPLACE FUNCTION release_order_reservations(p_order_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_item record;
  v_count integer := 0;
  v_is_already_released boolean;
BEGIN
  -- Проверяем, не были ли резервы уже высвобождены ранее
  SELECT COALESCE(reservations_released, false)
  INTO v_is_already_released
  FROM orders
  WHERE id = p_order_id;

  IF v_is_already_released IS TRUE THEN
    RETURN 0;
  END IF;

  FOR v_item IN
    SELECT 
      oi.sku,
      SUM(oi.quantity)::integer AS qty,
      COALESCE(oi.warehouse_id, 81) AS warehouse_id
    FROM order_items oi
    WHERE oi.order_id = p_order_id
      AND oi.sku IS NOT NULL AND oi.sku <> ''
      AND oi.quantity > 0
    GROUP BY oi.sku, COALESCE(oi.warehouse_id, 81)
    ORDER BY oi.sku ASC
  LOOP
    UPDATE inventory_balances
    SET 
      free_stock = free_stock + v_item.qty,
      reserved_stock = GREATEST(0, reserved_stock - v_item.qty),
      updated_at = now()
    WHERE sku = v_item.sku AND warehouse_id = v_item.warehouse_id;

    v_count := v_count + 1;
  END LOOP;

  -- Помечаем и сам заказ, и любые дочерние подзаказы мультисклада как освобожденные
  UPDATE orders
  SET reservations_released = true,
      updated_at = now()
  WHERE id = p_order_id OR parent_order_id = p_order_id;

  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION release_order_reservations(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION release_order_reservations(uuid) TO authenticated, service_role;

-- Update cancel_expired_order_holds to release holds automatically
CREATE OR REPLACE FUNCTION cancel_expired_order_holds(p_batch_size integer DEFAULT 50)
RETURNS TABLE (
  cancelled_order_id uuid,
  cancelled_order_number text,
  user_id uuid,
  total_amount numeric
)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT id
    FROM orders
    WHERE status IN ('pending', 'failed_dlq')
      AND parent_order_id IS NULL
      AND (
        (hold_expires_at IS NOT NULL AND hold_expires_at <= now())
        OR (hold_expires_at IS NULL AND created_at <= now() - INTERVAL '24 hours')
      )
    ORDER BY created_at ASC
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  LOOP
    PERFORM release_order_reservations(r.id);

    -- Каскадно отменяем дочерние подзаказы мультисклада
    UPDATE orders
    SET 
      status = 'cancelled',
      notes = TRIM(COALESCE(notes, '') || ' [Auto-cancelled: Master reservation hold TTL expired (24h)]'),
      updated_at = now()
    WHERE parent_order_id = r.id;

    RETURN QUERY
    UPDATE orders o
    SET 
      status = 'cancelled',
      notes = TRIM(COALESCE(o.notes, '') || ' [Auto-cancelled: WMS reservation hold TTL expired (24h)]'),
      updated_at = now()
    WHERE o.id = r.id
    RETURNING o.id, o.order_number, o.user_id, o.total_amount;
  END LOOP;
END;
$$;

-- RLS Hardening on orders and order_items
DROP POLICY IF EXISTS "orders_update" ON orders;
CREATE POLICY "orders_update" ON orders FOR UPDATE
  TO authenticated
  USING (
    public.is_admin()
    OR (
      user_id = auth.uid()
      AND status = 'pending'
    )
  )
  WITH CHECK (
    public.is_admin()
    OR (
      user_id = auth.uid()
      AND status IN ('pending', 'cancelled')
    )
  );

DROP POLICY IF EXISTS "order_items_update" ON order_items;
CREATE POLICY "order_items_update" ON order_items FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ==============================================================================
-- 14. Admin Currency Exchange Rate Configuration (display_settings)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.display_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_role text UNIQUE NOT NULL CHECK (target_role IN ('admin', 'manager_rm', 'manager_lm', 'supplier', 'client')),
  show_stock boolean NOT NULL DEFAULT true,
  show_reserve boolean NOT NULL DEFAULT false,
  show_total_pcs boolean NOT NULL DEFAULT true,
  show_sqm boolean NOT NULL DEFAULT true,
  show_price boolean NOT NULL DEFAULT true,
  exchange_rate_usd_kzt numeric(12,4) NOT NULL DEFAULT 520.0000,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles(id)
);

ALTER TABLE public.display_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "display_settings_select" ON public.display_settings;
CREATE POLICY "display_settings_select" ON public.display_settings 
  FOR SELECT TO authenticated, anon USING (true);

DROP POLICY IF EXISTS "display_settings_admin_all" ON public.display_settings;
CREATE POLICY "display_settings_admin_all" ON public.display_settings 
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

ALTER TABLE display_settings ADD COLUMN IF NOT EXISTS exchange_rate_usd_kzt numeric(12,4) DEFAULT 520.0000;
UPDATE display_settings SET exchange_rate_usd_kzt = 520.0000 WHERE exchange_rate_usd_kzt IS NULL;

-- ==============================================================================
-- 15. Client Stock Summary Visibility Permission
-- ==============================================================================

ALTER TABLE client_warehouse_rules ADD COLUMN IF NOT EXISTS show_stock_summary boolean NOT NULL DEFAULT false;

-- ==============================================================================
-- 16. Fix create_order_atomic success contract and deterministic deadlock prevention
-- ==============================================================================

CREATE OR REPLACE FUNCTION create_order_atomic(
  p_order jsonb,
  p_items jsonb,
  p_split_orders jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_id uuid;
  v_order_number text;
  v_item record;
  v_available integer;
  v_sku text;
  v_qty integer;
  v_wh_id integer;
  v_split_elem jsonb;
  v_sub_order_id uuid;
  v_sub_doc_number text;
  v_created_sub_orders jsonb := '[]'::jsonb;
  v_exchange_rate numeric;
BEGIN
  SELECT COALESCE(exchange_rate_usd_kzt, 520.0000)
  INTO v_exchange_rate
  FROM display_settings
  LIMIT 1;

  IF v_exchange_rate IS NULL OR v_exchange_rate <= 0 THEN
    v_exchange_rate := 520.0000;
  END IF;

  FOR v_item IN
    SELECT 
      (elem->>'sku')::text AS sku,
      SUM((elem->>'quantity')::integer) AS qty,
      COALESCE((elem->>'warehouse_id')::integer, 81) AS warehouse_id
    FROM jsonb_array_elements(p_items) AS elem
    WHERE elem->>'sku' IS NOT NULL AND elem->>'sku' <> ''
    GROUP BY (elem->>'sku')::text, COALESCE((elem->>'warehouse_id')::integer, 81)
    ORDER BY (elem->>'sku')::text ASC, COALESCE((elem->>'warehouse_id')::integer, 81) ASC
  LOOP
    v_sku := v_item.sku;
    v_qty := v_item.qty;
    v_wh_id := v_item.warehouse_id;

    SELECT free_stock INTO v_available
    FROM inventory_balances
    WHERE sku = v_sku AND warehouse_id = v_wh_id
    FOR UPDATE;

    IF v_available IS NULL OR v_available < v_qty THEN
      RAISE EXCEPTION 'INSUFFICIENT_STOCK: SKU % on warehouse % has only % free items, requested %',
        v_sku, v_wh_id, COALESCE(v_available, 0), v_qty;
    END IF;

    UPDATE inventory_balances
    SET free_stock = free_stock - v_qty,
        reserved_stock = reserved_stock + v_qty,
        updated_at = now()
    WHERE sku = v_sku AND warehouse_id = v_wh_id;
  END LOOP;

  INSERT INTO orders (
    user_id,
    placed_by_id,
    warehouse,
    notes,
    total_amount,
    total_items,
    total_sqm,
    status,
    idempotency_key,
    currency,
    applied_exchange_rate,
    contract_id
  ) VALUES (
    (p_order->>'user_id')::uuid,
    COALESCE((p_order->>'placed_by_id')::uuid, (p_order->>'user_id')::uuid),
    COALESCE(p_order->>'warehouse', 'Основной Склад Астана'),
    COALESCE(p_order->>'notes', ''),
    COALESCE((p_order->>'total_amount')::numeric, 0),
    COALESCE((p_order->>'total_items')::integer, 1),
    COALESCE((p_order->>'total_sqm')::numeric, 0),
    'pending',
    p_order->>'idempotency_key',
    COALESCE(p_order->>'currency', 'USD'),
    v_exchange_rate,
    CASE 
      WHEN p_order->>'contract_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN (p_order->>'contract_id')::uuid 
      ELSE NULL 
    END
  )
  RETURNING id, order_number INTO v_order_id, v_order_number;

  INSERT INTO order_items (
    order_id,
    product_id,
    product_name,
    size,
    sku,
    warehouse,
    warehouse_id,
    price,
    quantity
  )
  SELECT
    v_order_id,
    COALESCE(elem->>'product_id', elem->>'productId', elem->>'sku', ''),
    COALESCE(elem->>'product_name', elem->>'sku', 'Ковровое изделие'),
    COALESCE(elem->>'size', 'Стандарт'),
    COALESCE(elem->>'sku', ''),
    COALESCE(elem->>'warehouse', 'Основной Склад Астана'),
    COALESCE((elem->>'warehouse_id')::integer, 81),
    COALESCE((elem->>'price')::numeric, 0),
    COALESCE((elem->>'quantity')::integer, 1)
  FROM jsonb_array_elements(p_items) AS elem;

  IF p_split_orders IS NOT NULL AND jsonb_array_length(p_split_orders) > 0 THEN
    FOR v_split_elem IN SELECT * FROM jsonb_array_elements(p_split_orders)
    LOOP
      v_sub_doc_number := v_split_elem->>'doc_number';
      
      INSERT INTO orders (
        order_number,
        user_id,
        placed_by_id,
        warehouse,
        notes,
        total_amount,
        total_items,
        total_sqm,
        status,
        idempotency_key,
        currency,
        applied_exchange_rate,
        contract_id,
        parent_order_id
      ) VALUES (
        v_sub_doc_number,
        (p_order->>'user_id')::uuid,
        COALESCE((p_order->>'placed_by_id')::uuid, (p_order->>'user_id')::uuid),
        COALESCE(v_split_elem->>'warehouse', 'Основной Склад Астана'),
        COALESCE(v_split_elem->>'notes', ''),
        COALESCE((v_split_elem->>'amount')::numeric, 0),
        COALESCE((v_split_elem->>'items_count')::integer, 1),
        COALESCE((v_split_elem->>'sqm')::numeric, 0),
        'pending',
        v_split_elem->>'idempotency_key',
        COALESCE(p_order->>'currency', 'USD'),
        v_exchange_rate,
        CASE 
          WHEN p_order->>'contract_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          THEN (p_order->>'contract_id')::uuid 
          ELSE NULL 
        END,
        v_order_id
      )
      RETURNING id INTO v_sub_order_id;

      IF v_split_elem->'items' IS NOT NULL AND jsonb_array_length(v_split_elem->'items') > 0 THEN
        INSERT INTO order_items (
          order_id,
          product_id,
          product_name,
          size,
          sku,
          warehouse,
          warehouse_id,
          price,
          quantity
        )
        SELECT
          v_sub_order_id,
          COALESCE(s_elem->>'product_id', s_elem->>'productId', s_elem->>'sku', ''),
          COALESCE(s_elem->>'product_name', s_elem->>'sku', 'Ковровое изделие'),
          COALESCE(s_elem->>'size', 'Стандарт'),
          COALESCE(s_elem->>'sku', ''),
          COALESCE(v_split_elem->>'warehouse', 'Основной Склад Астана'),
          COALESCE((s_elem->>'warehouse_id')::integer, (v_split_elem->>'warehouse_id')::integer, 81),
          COALESCE((s_elem->>'price')::numeric, 0),
          COALESCE((s_elem->>'quantity')::integer, 1)
        FROM jsonb_array_elements(v_split_elem->'items') AS s_elem;
      END IF;

      v_created_sub_orders := v_created_sub_orders || jsonb_build_object(
        'doc_number', v_sub_doc_number,
        'warehouse', v_split_elem->>'warehouse',
        'sub_order_id', v_sub_order_id,
        'amount', (v_split_elem->>'amount')::numeric,
        'items_count', (v_split_elem->>'items_count')::integer
      );
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'order_id', v_order_id,
    'order_number', v_order_number,
    'status', 'pending',
    'exchange_rate', v_exchange_rate,
    'split_orders', v_created_sub_orders,
    'sub_orders', v_created_sub_orders
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION create_order_atomic(jsonb, jsonb, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION create_order_atomic(jsonb, jsonb, jsonb) TO authenticated, service_role;

-- ==============================================================================
-- 17. P1 B2B Multi-Tenancy & Counterparty Scoping (partner_id in orders & RLS)
-- ==============================================================================

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS partner_id text;
CREATE INDEX IF NOT EXISTS idx_orders_partner_id ON public.orders(partner_id);

CREATE OR REPLACE FUNCTION public.create_order_atomic(
  p_order jsonb,
  p_items jsonb,
  p_split_orders jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_id uuid;
  v_order_number text;
  v_item record;
  v_available integer;
  v_sku text;
  v_qty integer;
  v_wh_id integer;
  v_split_elem jsonb;
  v_sub_order_id uuid;
  v_sub_doc_number text;
  v_created_sub_orders jsonb := '[]'::jsonb;
  v_exchange_rate numeric;
  v_split_counter integer := 1;
  v_init_stock integer;
  v_partner_id text;
BEGIN
  PERFORM set_config('lock_timeout', '2000ms', true);
  PERFORM set_config('statement_timeout', '4000ms', true);

  IF auth.uid() IS NOT NULL AND auth.role() <> 'service_role' THEN
    IF (p_order->>'user_id')::uuid <> auth.uid() THEN
      RAISE EXCEPTION 'Access Denied: BOLA violation detected in create_order_atomic';
    END IF;
  END IF;

  v_partner_id := COALESCE(
    NULLIF(TRIM(p_order->>'partner_id'), ''),
    (SELECT partner_id FROM public.profiles WHERE id = (p_order->>'user_id')::uuid LIMIT 1)
  );

  SELECT COALESCE(exchange_rate_usd_kzt, 520.0000)
  INTO v_exchange_rate
  FROM public.display_settings
  LIMIT 1;

  IF v_exchange_rate IS NULL OR v_exchange_rate <= 0 THEN
    v_exchange_rate := 520.0000;
  END IF;

  FOR v_item IN
    SELECT 
      (elem->>'sku')::text AS sku,
      SUM((elem->>'quantity')::integer) AS qty,
      COALESCE((elem->>'warehouse_id')::integer, 81) AS warehouse_id
    FROM jsonb_array_elements(p_items) AS elem
    WHERE elem->>'sku' IS NOT NULL AND elem->>'sku' <> ''
    GROUP BY (elem->>'sku')::text, COALESCE((elem->>'warehouse_id')::integer, 81)
    ORDER BY (elem->>'sku')::text ASC, COALESCE((elem->>'warehouse_id')::integer, 81) ASC
  LOOP
    v_sku := v_item.sku;
    v_qty := v_item.qty;
    v_wh_id := v_item.warehouse_id;

    SELECT free_stock INTO v_available
    FROM public.inventory_balances
    WHERE sku = v_sku AND warehouse_id = v_wh_id
    FOR UPDATE;

    IF v_available IS NULL THEN
      SELECT stock INTO v_init_stock
      FROM public.product_variants
      WHERE sku = v_sku
      LIMIT 1;

      IF v_init_stock IS NOT NULL AND v_init_stock >= v_qty THEN
        INSERT INTO public.inventory_balances (sku, warehouse_id, free_stock, reserved_stock, total_stock)
        VALUES (v_sku, v_wh_id, v_init_stock, 0, v_init_stock)
        ON CONFLICT (sku, warehouse_id) DO UPDATE SET updated_at = now();

        v_available := v_init_stock;
      END IF;
    END IF;

    IF v_available IS NULL OR v_available < v_qty THEN
      RAISE EXCEPTION 'INSUFFICIENT_STOCK: SKU % on warehouse % has only % free items, requested %',
        v_sku, v_wh_id, COALESCE(v_available, 0), v_qty;
    END IF;

    UPDATE public.inventory_balances
    SET free_stock = free_stock - v_qty,
        reserved_stock = reserved_stock + v_qty,
        updated_at = now()
    WHERE sku = v_sku AND warehouse_id = v_wh_id;
  END LOOP;

  INSERT INTO public.orders (
    user_id,
    placed_by_id,
    partner_id,
    warehouse,
    notes,
    total_amount,
    total_items,
    total_sqm,
    status,
    idempotency_key,
    currency,
    applied_exchange_rate,
    contract_id
  ) VALUES (
    (p_order->>'user_id')::uuid,
    COALESCE((p_order->>'placed_by_id')::uuid, (p_order->>'user_id')::uuid),
    v_partner_id,
    COALESCE(p_order->>'warehouse', 'Основной Склад Астана'),
    COALESCE(p_order->>'notes', ''),
    COALESCE((p_order->>'total_amount')::numeric, 0),
    COALESCE((p_order->>'total_items')::integer, 1),
    COALESCE((p_order->>'total_sqm')::numeric, 0),
    'pending',
    p_order->>'idempotency_key',
    COALESCE(p_order->>'currency', 'USD'),
    v_exchange_rate,
    CASE 
      WHEN p_order->>'contract_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN (p_order->>'contract_id')::uuid 
      ELSE NULL 
    END
  )
  RETURNING id, order_number INTO v_order_id, v_order_number;

  INSERT INTO public.order_items (
    order_id,
    product_id,
    product_name,
    size,
    sku,
    warehouse,
    warehouse_id,
    price,
    quantity
  )
  SELECT
    v_order_id,
    COALESCE(elem->>'product_id', elem->>'productId', elem->>'sku', ''),
    COALESCE(elem->>'product_name', elem->>'sku', 'Ковровое изделие'),
    COALESCE(elem->>'size', 'Стандарт'),
    COALESCE(elem->>'sku', ''),
    COALESCE(elem->>'warehouse', 'Основной Склад Астана'),
    COALESCE((elem->>'warehouse_id')::integer, 81),
    COALESCE((elem->>'price')::numeric, 0),
    COALESCE((elem->>'quantity')::integer, 1)
  FROM jsonb_array_elements(p_items) AS elem;

  IF p_split_orders IS NOT NULL AND jsonb_array_length(p_split_orders) > 0 THEN
    FOR v_split_elem IN SELECT * FROM jsonb_array_elements(p_split_orders)
    LOOP
      v_sub_doc_number := COALESCE(
        v_split_elem->>'doc_number',
        v_order_number || '-W' || COALESCE(v_split_elem->>'warehouse_id', v_split_counter::text)
      );

      IF v_sub_doc_number LIKE 'ORD-wh-%' THEN
        v_sub_doc_number := v_order_number || '-W' || v_split_counter::text;
      END IF;
      
      INSERT INTO public.orders (
        order_number,
        user_id,
        placed_by_id,
        partner_id,
        warehouse,
        notes,
        total_amount,
        total_items,
        total_sqm,
        status,
        idempotency_key,
        currency,
        applied_exchange_rate,
        contract_id,
        parent_order_id
      ) VALUES (
        v_sub_doc_number,
        (p_order->>'user_id')::uuid,
        COALESCE((p_order->>'placed_by_id')::uuid, (p_order->>'user_id')::uuid),
        v_partner_id,
        COALESCE(v_split_elem->>'warehouse', 'Основной Склад Астана'),
        COALESCE(v_split_elem->>'notes', ''),
        COALESCE((v_split_elem->>'amount')::numeric, 0),
        COALESCE((v_split_elem->>'items_count')::integer, 1),
        COALESCE((v_split_elem->>'sqm')::numeric, 0),
        'pending',
        v_split_elem->>'idempotency_key',
        COALESCE(p_order->>'currency', 'USD'),
        v_exchange_rate,
        CASE 
          WHEN p_order->>'contract_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          THEN (p_order->>'contract_id')::uuid 
          ELSE NULL 
        END,
        v_order_id
      )
      RETURNING id INTO v_sub_order_id;

      IF v_split_elem->'items' IS NOT NULL AND jsonb_array_length(v_split_elem->'items') > 0 THEN
        INSERT INTO public.order_items (
          order_id,
          product_id,
          product_name,
          size,
          sku,
          warehouse,
          warehouse_id,
          price,
          quantity
        )
        SELECT
          v_sub_order_id,
          COALESCE(s_elem->>'product_id', s_elem->>'productId', s_elem->>'sku', ''),
          COALESCE(s_elem->>'product_name', s_elem->>'sku', 'Ковровое изделие'),
          COALESCE(s_elem->>'size', 'Стандарт'),
          COALESCE(s_elem->>'sku', ''),
          COALESCE(v_split_elem->>'warehouse', 'Основной Склад Астана'),
          COALESCE((s_elem->>'warehouse_id')::integer, (v_split_elem->>'warehouse_id')::integer, 81),
          COALESCE((s_elem->>'price')::numeric, 0),
          COALESCE((s_elem->>'quantity')::integer, 1)
        FROM jsonb_array_elements(v_split_elem->'items') AS s_elem;
      END IF;

      v_created_sub_orders := v_created_sub_orders || jsonb_build_object(
        'doc_number', v_sub_doc_number,
        'warehouse', v_split_elem->>'warehouse',
        'sub_order_id', v_sub_order_id,
        'amount', (v_split_elem->>'amount')::numeric,
        'items_count', (v_split_elem->>'items_count')::integer
      );

      v_split_counter := v_split_counter + 1;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'order_id', v_order_id,
    'order_number', v_order_number,
    'status', 'pending',
    'partner_id', v_partner_id,
    'exchange_rate', v_exchange_rate,
    'split_orders', v_created_sub_orders,
    'sub_orders', v_created_sub_orders
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_order_atomic(jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_order_atomic(jsonb, jsonb, jsonb) TO service_role;

DROP POLICY IF EXISTS "orders_select" ON public.orders;
CREATE POLICY "orders_select" ON public.orders FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR placed_by_id = auth.uid()
    OR (
      orders.partner_id IS NOT NULL 
      AND orders.partner_id = (SELECT partner_id FROM public.profiles WHERE id = auth.uid())
    )
    OR public.is_admin()
    OR (public.is_manager() AND EXISTS (
      SELECT 1 FROM public.profiles client
      WHERE (client.id = orders.user_id OR (orders.partner_id IS NOT NULL AND client.partner_id = orders.partner_id))
        AND client.manager_id = auth.uid()
    ))
  );

DROP POLICY IF EXISTS "order_items_select" ON public.order_items;
CREATE POLICY "order_items_select" ON public.order_items FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.orders o WHERE o.id = order_items.order_id
      AND (
        o.user_id = auth.uid()
        OR o.placed_by_id = auth.uid()
        OR (
          o.partner_id IS NOT NULL
          AND o.partner_id = (SELECT partner_id FROM public.profiles WHERE id = auth.uid())
        )
        OR public.is_admin()
        OR (public.is_manager() AND EXISTS (
          SELECT 1 FROM public.profiles client
          WHERE (client.id = o.user_id OR (o.partner_id IS NOT NULL AND client.partner_id = o.partner_id))
            AND client.manager_id = auth.uid()
        ))
      )
    )
  );

-- 17.1 Reload PostgREST schema cache immediately
NOTIFY pgrst, 'reload schema';

-- 18. Fix P0 user_id UUID parsing and credit check
CREATE OR REPLACE FUNCTION public.create_order_atomic(
  p_order jsonb,
  p_items jsonb,
  p_split_orders jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_id uuid;
  v_order_number text;
  v_item record;
  v_available integer;
  v_sku text;
  v_qty integer;
  v_wh_id integer;
  v_split_elem jsonb;
  v_sub_order_id uuid;
  v_sub_doc_number text;
  v_created_sub_orders jsonb := '[]'::jsonb;
  v_exchange_rate numeric;
  v_split_counter integer := 1;
  v_partner_id text;
  v_user_id uuid;
  v_overdue_days integer;
  v_is_blocked boolean;
  v_impersonation boolean;
  v_status text;
BEGIN
  PERFORM set_config('lock_timeout', '2000ms', true);
  PERFORM set_config('statement_timeout', '4000ms', true);

  IF auth.uid() IS NOT NULL AND auth.role() <> 'service_role' THEN
    IF (p_order->>'user_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' 
       OR (p_order->>'user_id')::uuid <> auth.uid() THEN
      RAISE EXCEPTION 'Access Denied: BOLA violation detected in create_order_atomic';
    END IF;
  END IF;

  v_partner_id := NULLIF(TRIM(p_order->>'partner_id'), '');
  IF v_partner_id IS NULL AND (p_order->>'user_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT partner_id INTO v_partner_id FROM public.profiles WHERE id = (p_order->>'user_id')::uuid LIMIT 1;
  END IF;

  IF (p_order->>'user_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    v_user_id := (p_order->>'user_id')::uuid;
  ELSIF v_partner_id IS NOT NULL AND v_partner_id <> '' THEN
    SELECT id INTO v_user_id FROM public.profiles WHERE partner_id = v_partner_id LIMIT 1;
  END IF;

  IF v_user_id IS NULL THEN
    v_user_id := '00000000-0000-0000-0000-000000000000'::uuid;
  END IF;

  IF v_partner_id IS NOT NULL AND v_partner_id <> '' THEN
    SELECT overdue_days, is_blocked_for_orders, impersonation_enabled, status
    INTO v_overdue_days, v_is_blocked, v_impersonation, v_status
    FROM public.profiles
    WHERE partner_id = v_partner_id
    LIMIT 1;

    IF v_impersonation = false OR v_status = 'inactive' THEN
      RAISE EXCEPTION 'CLIENT_DEACTIVATED: Учетная запись контрагента деактивирована в ERP';
    END IF;

    IF v_is_blocked = true THEN
      RAISE EXCEPTION 'CLIENT_BLOCKED: Оформление новых заказов временно заблокировано';
    END IF;

    IF v_overdue_days > 14 THEN
      RAISE EXCEPTION 'OVERDUE_DEBT: Имеется просроченная задолженность более 14 дней';
    END IF;
  END IF;

  SELECT COALESCE(exchange_rate_usd_kzt, 520.0000)
  INTO v_exchange_rate
  FROM public.display_settings
  LIMIT 1;

  IF v_exchange_rate IS NULL OR v_exchange_rate <= 0 THEN
    v_exchange_rate := 520.0000;
  END IF;

  FOR v_item IN
    SELECT 
      (elem->>'sku')::text AS sku,
      SUM((elem->>'quantity')::integer) AS qty,
      COALESCE((elem->>'warehouse_id')::integer, 81) AS warehouse_id
    FROM jsonb_array_elements(p_items) AS elem
    WHERE elem->>'sku' IS NOT NULL AND elem->>'sku' <> ''
    GROUP BY (elem->>'sku')::text, COALESCE((elem->>'warehouse_id')::integer, 81)
    ORDER BY (elem->>'sku')::text ASC, COALESCE((elem->>'warehouse_id')::integer, 81) ASC
  LOOP
    v_sku := v_item.sku;
    v_qty := v_item.qty;
    v_wh_id := v_item.warehouse_id;

    INSERT INTO public.inventory_balances (sku, warehouse_id, free_stock, reserved_stock, total_stock)
    SELECT v_sku, v_wh_id, COALESCE(stock, 0), 0, COALESCE(stock, 0)
    FROM public.product_variants
    WHERE sku = v_sku
    ON CONFLICT (sku, warehouse_id) DO NOTHING;

    SELECT free_stock INTO v_available
    FROM public.inventory_balances
    WHERE sku = v_sku AND warehouse_id = v_wh_id
    FOR UPDATE;

    IF v_available IS NULL OR v_available < v_qty THEN
      RAISE EXCEPTION 'INSUFFICIENT_STOCK: SKU % on warehouse % has only % free items, requested %',
        v_sku, v_wh_id, COALESCE(v_available, 0), v_qty;
    END IF;

    UPDATE public.inventory_balances
    SET free_stock = free_stock - v_qty,
        reserved_stock = reserved_stock + v_qty,
        updated_at = now()
    WHERE sku = v_sku AND warehouse_id = v_wh_id;
  END LOOP;

  INSERT INTO public.orders (
    user_id,
    placed_by_id,
    partner_id,
    warehouse,
    notes,
    total_amount,
    total_items,
    total_sqm,
    status,
    idempotency_key,
    currency,
    applied_exchange_rate,
    contract_id
  ) VALUES (
    v_user_id,
    CASE 
      WHEN (p_order->>'placed_by_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN (p_order->>'placed_by_id')::uuid 
      ELSE v_user_id 
    END,
    v_partner_id,
    COALESCE(p_order->>'warehouse', 'Основной Склад Астана'),
    COALESCE(p_order->>'notes', ''),
    COALESCE((p_order->>'total_amount')::numeric, 0),
    COALESCE((p_order->>'total_items')::integer, 1),
    COALESCE((p_order->>'total_sqm')::numeric, 0),
    'pending',
    p_order->>'idempotency_key',
    COALESCE(p_order->>'currency', 'USD'),
    v_exchange_rate,
    CASE 
      WHEN p_order->>'contract_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN (p_order->>'contract_id')::uuid 
      ELSE NULL 
    END
  )
  RETURNING id, order_number INTO v_order_id, v_order_number;

  INSERT INTO public.order_items (
    order_id,
    product_id,
    product_name,
    size,
    sku,
    warehouse,
    warehouse_id,
    price,
    quantity
  )
  SELECT
    v_order_id,
    COALESCE(elem->>'product_id', elem->>'productId', elem->>'sku', ''),
    COALESCE(elem->>'product_name', elem->>'sku', 'Ковровое изделие'),
    COALESCE(elem->>'size', 'Стандарт'),
    COALESCE(elem->>'sku', ''),
    COALESCE(elem->>'warehouse', 'Основной Склад Астана'),
    COALESCE((elem->>'warehouse_id')::integer, 81),
    COALESCE((elem->>'price')::numeric, 0),
    COALESCE((elem->>'quantity')::integer, 1)
  FROM jsonb_array_elements(p_items) AS elem;

  IF p_split_orders IS NOT NULL AND jsonb_array_length(p_split_orders) > 0 THEN
    FOR v_split_elem IN SELECT * FROM jsonb_array_elements(p_split_orders)
    LOOP
      v_sub_doc_number := COALESCE(
        v_split_elem->>'doc_number',
        v_order_number || '-W' || COALESCE(v_split_elem->>'warehouse_id', v_split_counter::text)
      );

      IF v_sub_doc_number LIKE 'ORD-wh-%' THEN
        v_sub_doc_number := v_order_number || '-W' || v_split_counter::text;
      END IF;
      
      INSERT INTO public.orders (
        order_number,
        user_id,
        placed_by_id,
        partner_id,
        warehouse,
        notes,
        total_amount,
        total_items,
        total_sqm,
        status,
        idempotency_key,
        currency,
        applied_exchange_rate,
        contract_id,
        parent_order_id
      ) VALUES (
        v_sub_doc_number,
        v_user_id,
        CASE 
          WHEN (p_order->>'placed_by_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          THEN (p_order->>'placed_by_id')::uuid 
          ELSE v_user_id 
        END,
        v_partner_id,
        COALESCE(v_split_elem->>'warehouse', 'Основной Склад Астана'),
        COALESCE(v_split_elem->>'notes', ''),
        COALESCE((v_split_elem->>'amount')::numeric, 0),
        COALESCE((v_split_elem->>'items_count')::integer, 1),
        COALESCE((v_split_elem->>'sqm')::numeric, 0),
        'pending',
        v_split_elem->>'idempotency_key',
        COALESCE(p_order->>'currency', 'USD'),
        v_exchange_rate,
        CASE 
          WHEN p_order->>'contract_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          THEN (p_order->>'contract_id')::uuid 
          ELSE NULL 
        END,
        v_order_id
      )
      RETURNING id INTO v_sub_order_id;

      IF v_split_elem->'items' IS NOT NULL AND jsonb_array_length(v_split_elem->'items') > 0 THEN
        INSERT INTO public.order_items (
          order_id,
          product_id,
          product_name,
          size,
          sku,
          warehouse,
          warehouse_id,
          price,
          quantity
        )
        SELECT
          v_sub_order_id,
          COALESCE(s_elem->>'product_id', s_elem->>'productId', s_elem->>'sku', ''),
          COALESCE(s_elem->>'product_name', s_elem->>'sku', 'Ковровое изделие'),
          COALESCE(s_elem->>'size', 'Стандарт'),
          COALESCE(s_elem->>'sku', ''),
          COALESCE(v_split_elem->>'warehouse', 'Основной Склад Астана'),
          COALESCE((s_elem->>'warehouse_id')::integer, (v_split_elem->>'warehouse_id')::integer, 81),
          COALESCE((s_elem->>'price')::numeric, 0),
          COALESCE((s_elem->>'quantity')::integer, 1)
        FROM jsonb_array_elements(v_split_elem->'items') AS s_elem;
      END IF;

      v_created_sub_orders := v_created_sub_orders || jsonb_build_object(
        'doc_number', v_sub_doc_number,
        'warehouse', v_split_elem->>'warehouse',
        'sub_order_id', v_sub_order_id,
        'amount', (v_split_elem->>'amount')::numeric,
        'items_count', (v_split_elem->>'items_count')::integer
      );

      v_split_counter := v_split_counter + 1;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'order_id', v_order_id,
    'order_number', v_order_number,
    'status', 'pending',
    'partner_id', v_partner_id,
    'exchange_rate', v_exchange_rate,
    'split_orders', v_created_sub_orders,
    'sub_orders', v_created_sub_orders
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_order_atomic(jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_order_atomic(jsonb, jsonb, jsonb) TO service_role;

-- fulfill_order_reservations: Idempotent deduction of reserved and total stock on shipment
CREATE OR REPLACE FUNCTION public.fulfill_order_reservations(p_order_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_item record;
  v_count integer := 0;
  v_is_already_fulfilled boolean;
BEGIN
  SELECT COALESCE(reservations_released, false)
  INTO v_is_already_fulfilled
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_is_already_fulfilled IS TRUE THEN
    RETURN 0;
  END IF;

  FOR v_item IN
    SELECT 
      oi.sku,
      SUM(oi.quantity)::integer AS qty,
      COALESCE(oi.warehouse_id, 81) AS warehouse_id
    FROM public.order_items oi
    WHERE oi.order_id = p_order_id
      AND oi.sku IS NOT NULL AND oi.sku <> ''
      AND oi.quantity > 0
    GROUP BY oi.sku, COALESCE(oi.warehouse_id, 81)
    ORDER BY oi.sku ASC, COALESCE(oi.warehouse_id, 81) ASC
  LOOP
    UPDATE public.inventory_balances
    SET 
      reserved_stock = GREATEST(0, reserved_stock - v_item.qty),
      total_stock = GREATEST(0, total_stock - v_item.qty),
      updated_at = now()
    WHERE sku = v_item.sku AND warehouse_id = v_item.warehouse_id;

    v_count := v_count + 1;
  END LOOP;

  UPDATE public.orders
  SET reservations_released = true,
      updated_at = now()
  WHERE id = p_order_id OR parent_order_id = p_order_id;

  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fulfill_order_reservations(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fulfill_order_reservations(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

