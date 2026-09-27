/*
# Create product catalog and pricing tables

1. New Tables
   - `products` — main product catalog (name, collection, manufacturer, specs, images, supplier link)
   - `product_variants` — sizes/SKUs per product with base price
   - `warehouse_stock` — per-variant stock by city
   - `price_types` — pricing tiers (wholesale, commission, deferred, retail, dealer)
   - `collection_prices` — price per m² by collection + price type

2. Modified Tables
   - `profiles` — adds `price_type` column (FK to price_types) for personalized pricing

3. Security
   - RLS enabled on all new tables
   - Products/variants/stock: public read (anon + authenticated), admin-only write
   - Price tables: authenticated-only read, admin-only write
   - profiles.price_type protected from direct user update (existing column grants unchanged)

4. Notes
   - Products use text IDs (e.g. 'sg-001') matching current frontend conventions
   - supplier_id links to ERP factory ID for future supplier isolation
   - collection_prices allows different $/m² per collection per contract type
   - base_price on variants is the default (retail) price for backward compatibility
*/

-- ===================== products =====================
CREATE TABLE IF NOT EXISTS products (
  id text PRIMARY KEY,
  name text NOT NULL,
  category text NOT NULL,
  collection text NOT NULL,
  manufacturer text NOT NULL,
  material text NOT NULL DEFAULT '',
  style text NOT NULL DEFAULT '',
  country text NOT NULL DEFAULT '',
  density text NOT NULL DEFAULT '',
  pile_height text NOT NULL DEFAULT '',
  images text[] NOT NULL DEFAULT '{}',
  supplier_id integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_products" ON products;
CREATE POLICY "anon_select_products" ON products FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "admin_insert_products" ON products;
CREATE POLICY "admin_insert_products" ON products FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

DROP POLICY IF EXISTS "admin_update_products" ON products;
CREATE POLICY "admin_update_products" ON products FOR UPDATE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "admin_delete_products" ON products;
CREATE POLICY "admin_delete_products" ON products FOR DELETE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- ===================== product_variants =====================
CREATE TABLE IF NOT EXISTS product_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id text NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  size text NOT NULL,
  sku text NOT NULL UNIQUE,
  base_price numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_variants_product ON product_variants(product_id);

ALTER TABLE product_variants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_variants" ON product_variants;
CREATE POLICY "anon_select_variants" ON product_variants FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "admin_insert_variants" ON product_variants;
CREATE POLICY "admin_insert_variants" ON product_variants FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

DROP POLICY IF EXISTS "admin_update_variants" ON product_variants;
CREATE POLICY "admin_update_variants" ON product_variants FOR UPDATE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "admin_delete_variants" ON product_variants;
CREATE POLICY "admin_delete_variants" ON product_variants FOR DELETE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- ===================== warehouse_stock =====================
CREATE TABLE IF NOT EXISTS warehouse_stock (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id uuid NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  city text NOT NULL,
  stock integer NOT NULL DEFAULT 0 CHECK (stock >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (variant_id, city)
);

CREATE INDEX IF NOT EXISTS idx_stock_variant ON warehouse_stock(variant_id);

ALTER TABLE warehouse_stock ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_stock" ON warehouse_stock;
CREATE POLICY "anon_select_stock" ON warehouse_stock FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "admin_insert_stock" ON warehouse_stock;
CREATE POLICY "admin_insert_stock" ON warehouse_stock FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

DROP POLICY IF EXISTS "admin_update_stock" ON warehouse_stock;
CREATE POLICY "admin_update_stock" ON warehouse_stock FOR UPDATE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "admin_delete_stock" ON warehouse_stock;
CREATE POLICY "admin_delete_stock" ON warehouse_stock FOR DELETE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- ===================== price_types =====================
CREATE TABLE IF NOT EXISTS price_types (
  id text PRIMARY KEY,
  name_ru text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0
);

ALTER TABLE price_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_select_price_types" ON price_types;
CREATE POLICY "auth_select_price_types" ON price_types FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "admin_insert_price_types" ON price_types;
CREATE POLICY "admin_insert_price_types" ON price_types FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

DROP POLICY IF EXISTS "admin_update_price_types" ON price_types;
CREATE POLICY "admin_update_price_types" ON price_types FOR UPDATE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "admin_delete_price_types" ON price_types;
CREATE POLICY "admin_delete_price_types" ON price_types FOR DELETE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- Seed default price types
INSERT INTO price_types (id, name_ru, sort_order) VALUES
  ('retail', 'Розничная', 1),
  ('wholesale', 'Оптовая', 2),
  ('commission', 'Комиссионная', 3),
  ('deferred', 'С отсрочкой', 4),
  ('dealer', 'Дилерская', 5)
ON CONFLICT (id) DO NOTHING;

-- ===================== collection_prices =====================
CREATE TABLE IF NOT EXISTS collection_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collection text NOT NULL,
  price_type_id text NOT NULL REFERENCES price_types(id) ON DELETE CASCADE,
  price_per_sqm numeric NOT NULL CHECK (price_per_sqm >= 0),
  UNIQUE (collection, price_type_id)
);

CREATE INDEX IF NOT EXISTS idx_coll_prices_collection ON collection_prices(collection);

ALTER TABLE collection_prices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_select_collection_prices" ON collection_prices;
CREATE POLICY "auth_select_collection_prices" ON collection_prices FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "admin_insert_collection_prices" ON collection_prices;
CREATE POLICY "admin_insert_collection_prices" ON collection_prices FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

DROP POLICY IF EXISTS "admin_update_collection_prices" ON collection_prices;
CREATE POLICY "admin_update_collection_prices" ON collection_prices FOR UPDATE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "admin_delete_collection_prices" ON collection_prices;
CREATE POLICY "admin_delete_collection_prices" ON collection_prices FOR DELETE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- ===================== profiles.price_type =====================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'price_type'
  ) THEN
    ALTER TABLE profiles ADD COLUMN price_type text REFERENCES price_types(id) DEFAULT 'retail';
  END IF;
END $$;
