-- ==============================================================================
-- SYNERGY B2B PORTAL — RUGSUSA ARCHITECTURAL PATTERNS MIGRATION
-- ==============================================================================
-- 1. Pattern 1: Normalized Parent Design Entity (product_designs)
-- 2. Pattern 3: Dimension Clusters (size_cluster) & Runners (is_runner)
-- 3. Pattern 4: Sub-50ms Faceted Trigram Search Indexes (pg_trgm)
-- 4. Out-of-Order Webhook Protection: state_version in inventory_balances
-- ==============================================================================

BEGIN;

-- 1. Inventory Balances: CDC Versioning Column for Out-of-Order Defense
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'inventory_balances' AND column_name = 'state_version') THEN
    ALTER TABLE inventory_balances ADD COLUMN state_version bigint NOT NULL DEFAULT 0;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_inventory_balances_version ON inventory_balances(state_version);


-- 2. Pattern 1: Parent Product Designs (RugsUSA Normalized Master Entity)
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

DROP POLICY IF EXISTS "admin_service_all_designs" ON product_designs;
CREATE POLICY "admin_service_all_designs" ON product_designs FOR ALL
  TO authenticated
  USING (
    auth.jwt() ->> 'role' = 'service_role' OR
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    auth.jwt() ->> 'role' = 'service_role' OR
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );


-- 3. Pattern 3: Size Clusters & Runner Dimensions on product_variants
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


-- 4. Pattern 4: High-Performance Trigram GIN Search Indexes (pg_trgm)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_designs_trgm ON product_designs USING gin (
  (collection || ' ' || article || ' ' || coalesce(color, '') || ' ' || manufacturer) gin_trgm_ops
);

CREATE INDEX IF NOT EXISTS idx_variants_sku_trgm ON product_variants USING gin (
  sku gin_trgm_ops
);

COMMIT;
