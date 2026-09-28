/*
# Create catalog_cache and inventory_balances tables for Staging & High-Load Resilience

1. New Tables
   - `catalog_cache` — stores serialized catalog snapshots for sub-50ms responses and offline fallback.
     - `cache_key` (text, PK, e.g. 'catalog_global')
     - `data` (jsonb, complete catalog structure: products, variants, warehouses, summary)
     - `products_count` (integer, number of products)
     - `version` (bigint, monotonic version number)
     - `updated_at` (timestamptz, last sync timestamp)

   - `inventory_balances` — granular materialized inventory per SKU and warehouse from ERP webhooks.
     - `sku` (text)
     - `warehouse_id` (integer)
     - `warehouse_name` (text)
     - `free_stock` (numeric)
     - `reserved_stock` (numeric)
     - `total_stock` (numeric)
     - `updated_at` (timestamptz)
     - PRIMARY KEY (sku, warehouse_id)

2. Profiles Expansion
   - Adds `credit_limit_usd`, `payment_delay_days`, `city`, `address` to `profiles` (idempotent DO block).

3. Security & RLS
   - `catalog_cache`: public read (anon + authenticated), service-role and admin write.
   - `inventory_balances`: authenticated read, service-role and admin write.
*/

-- ===================== catalog_cache =====================
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


-- ===================== inventory_balances =====================
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


-- ===================== profiles extensions =====================
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
