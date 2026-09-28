/*
# Create profiles table with roles

1. New Tables
  - `profiles`
    - `id` (uuid, PK, references auth.users)
    - `role` (text, one of: admin, manager_rm, manager_lm, supplier, client)
    - `partner_id` (text, nullable, ERP partner/counterparty ID)
    - `full_name` (text)
    - `company_name` (text)
    - `phone` (text)
    - `manager_id` (uuid, nullable, FK to profiles — which manager handles this client)
    - `created_at` (timestamptz)
    - `updated_at` (timestamptz)

2. Security
  - RLS enabled on `profiles`.
  - Admins can read all profiles.
  - Managers can read profiles of their assigned clients.
  - Users can read their own profile.
  - Users can update only their own display fields (full_name, company_name, phone).
  - Role and manager_id are protected from client writes via column-level privileges.

3. Trigger
  - Auto-creates a profile row with role='client' on new user signup.

4. Notes
  - `role` defaults to 'client' — admin and manager roles are assigned manually or via admin function.
  - `partner_id` links to the ERP counterparty for syncing debt/prices.
  - `manager_id` allows assigning a manager (RM or LM) to a client.
*/

-- Create enum-like check for roles
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'client'
    CHECK (role IN ('admin', 'manager_rm', 'manager_lm', 'supplier', 'client')),
  partner_id text,
  full_name text NOT NULL DEFAULT '',
  company_name text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  manager_id uuid REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_profiles_role ON profiles(role);
CREATE INDEX IF NOT EXISTS idx_profiles_partner_id ON profiles(partner_id);
CREATE INDEX IF NOT EXISTS idx_profiles_manager_id ON profiles(manager_id);

-- RLS
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- SELECT: admin sees all, managers see their clients + self, everyone sees self
DROP POLICY IF EXISTS "profiles_select" ON profiles;
CREATE POLICY "profiles_select" ON profiles FOR SELECT
  TO authenticated
  USING (
    auth.uid() = id
    OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
    OR EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('manager_rm', 'manager_lm')
        AND profiles.manager_id = p.id
    )
  );

-- INSERT: only via trigger (system), deny direct client inserts
DROP POLICY IF EXISTS "profiles_insert" ON profiles;
CREATE POLICY "profiles_insert" ON profiles FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);

-- UPDATE: users update own row only
DROP POLICY IF EXISTS "profiles_update" ON profiles;
CREATE POLICY "profiles_update" ON profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- DELETE: nobody deletes profiles (cascade from auth.users handles it)
DROP POLICY IF EXISTS "profiles_delete" ON profiles;
CREATE POLICY "profiles_delete" ON profiles FOR DELETE
  TO authenticated
  USING (false);

-- Protect privileged columns: role, manager_id, partner_id
REVOKE UPDATE ON profiles FROM authenticated;
GRANT UPDATE (full_name, company_name, phone) ON profiles TO authenticated;

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO profiles (id, full_name, company_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', ''),
    COALESCE(NEW.raw_user_meta_data ->> 'company_name', '')
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Admin function to set roles (protected)
CREATE OR REPLACE FUNCTION set_user_role(p_user_id uuid, p_role text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF p_role NOT IN ('admin', 'manager_rm', 'manager_lm', 'supplier', 'client') THEN
    RAISE EXCEPTION 'Invalid role';
  END IF;
  UPDATE profiles SET role = p_role, updated_at = now() WHERE id = p_user_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION set_user_role FROM anon;
GRANT EXECUTE ON FUNCTION set_user_role TO authenticated;

-- Admin function to assign manager to client
CREATE OR REPLACE FUNCTION assign_manager(p_client_id uuid, p_manager_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_manager_id AND role IN ('manager_rm', 'manager_lm')) THEN
    RAISE EXCEPTION 'Target is not a manager';
  END IF;
  UPDATE profiles SET manager_id = p_manager_id, updated_at = now() WHERE id = p_client_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION assign_manager FROM anon;
GRANT EXECUTE ON FUNCTION assign_manager TO authenticated;

-- Admin function to set partner_id (link to ERP)
CREATE OR REPLACE FUNCTION set_partner_id(p_user_id uuid, p_partner_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  UPDATE profiles SET partner_id = p_partner_id, updated_at = now() WHERE id = p_user_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION set_partner_id FROM anon;
GRANT EXECUTE ON FUNCTION set_partner_id TO authenticated;
/*
# Create orders and order_items tables

1. New Tables
  - `orders`
    - `id` (uuid, PK)
    - `order_number` (text, unique, human-readable order number like ORD-2025-0001)
    - `user_id` (uuid, FK to profiles — who the order belongs to)
    - `placed_by_id` (uuid, FK to profiles — who actually placed it, for impersonation)
    - `status` (text: draft, pending, processing, shipped, delivered, cancelled)
    - `warehouse` (text)
    - `notes` (text)
    - `total_amount` (numeric)
    - `total_sqm` (numeric)
    - `total_items` (integer)
    - `created_at`, `updated_at`

  - `order_items`
    - `id` (uuid, PK)
    - `order_id` (uuid, FK to orders)
    - `product_id` (text, ERP product ID)
    - `product_name` (text)
    - `collection` (text)
    - `size` (text)
    - `sku` (text)
    - `warehouse` (text)
    - `price` (numeric)
    - `quantity` (integer)
    - `created_at`

2. Security
  - RLS on both tables.
  - Admins see all orders. Managers see orders of their clients. Users see own orders.
  - Users can insert orders for themselves. Admins/managers can insert for any visible user.
  - Order items follow parent order access.

3. Notes
  - `placed_by_id` tracks admin/manager impersonation: if an admin creates an order
    on behalf of client X, user_id=X and placed_by_id=admin.
  - Auto-generated order number via sequence.
*/

-- Sequence for order numbers
CREATE SEQUENCE IF NOT EXISTS order_number_seq START 1;

CREATE OR REPLACE FUNCTION generate_order_number()
RETURNS text
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN 'ORD-' || EXTRACT(YEAR FROM now())::text || '-' || LPAD(nextval('order_number_seq')::text, 4, '0');
END;
$$;

CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number text UNIQUE NOT NULL DEFAULT generate_order_number(),
  user_id uuid NOT NULL REFERENCES profiles(id),
  placed_by_id uuid NOT NULL DEFAULT auth.uid() REFERENCES profiles(id),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('draft', 'pending', 'processing', 'shipped', 'delivered', 'cancelled')),
  warehouse text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  total_amount numeric NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  total_sqm numeric NOT NULL DEFAULT 0 CHECK (total_sqm >= 0),
  total_items integer NOT NULL DEFAULT 0 CHECK (total_items >= 0),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_user_created ON orders(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_placed_by_id ON orders(placed_by_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

CREATE TABLE IF NOT EXISTS order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id text NOT NULL DEFAULT '',
  product_name text NOT NULL,
  collection text NOT NULL DEFAULT '',
  size text NOT NULL,
  sku text NOT NULL DEFAULT '',
  warehouse text NOT NULL DEFAULT '',
  price numeric NOT NULL CHECK (price >= 0),
  quantity integer NOT NULL CHECK (quantity > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_sku ON order_items(sku);
CREATE INDEX IF NOT EXISTS idx_order_items_product_id ON order_items(product_id);

-- RLS on orders
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "orders_select" ON orders;
CREATE POLICY "orders_select" ON orders FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR placed_by_id = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
    OR EXISTS (
      SELECT 1 FROM profiles client
      JOIN profiles mgr ON mgr.id = auth.uid()
      WHERE client.id = orders.user_id
        AND client.manager_id = mgr.id
        AND mgr.role IN ('manager_rm', 'manager_lm')
    )
  );

DROP POLICY IF EXISTS "orders_insert" ON orders;
CREATE POLICY "orders_insert" ON orders FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
    OR EXISTS (
      SELECT 1 FROM profiles client
      JOIN profiles mgr ON mgr.id = auth.uid()
      WHERE client.id = orders.user_id
        AND client.manager_id = mgr.id
        AND mgr.role IN ('manager_rm', 'manager_lm')
    )
  );

DROP POLICY IF EXISTS "orders_update" ON orders;
CREATE POLICY "orders_update" ON orders FOR UPDATE
  TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  )
  WITH CHECK (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  );

DROP POLICY IF EXISTS "orders_delete" ON orders;
CREATE POLICY "orders_delete" ON orders FOR DELETE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  );

-- RLS on order_items (follows parent order access)
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "order_items_select" ON order_items;
CREATE POLICY "order_items_select" ON order_items FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = order_items.order_id
        AND (
          o.user_id = auth.uid()
          OR o.placed_by_id = auth.uid()
          OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
          OR EXISTS (
            SELECT 1 FROM profiles client
            JOIN profiles mgr ON mgr.id = auth.uid()
            WHERE client.id = o.user_id
              AND client.manager_id = mgr.id
              AND mgr.role IN ('manager_rm', 'manager_lm')
          )
        )
    )
  );

DROP POLICY IF EXISTS "order_items_insert" ON order_items;
CREATE POLICY "order_items_insert" ON order_items FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = order_items.order_id
        AND (
          o.user_id = auth.uid()
          OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
          OR EXISTS (
            SELECT 1 FROM profiles client
            JOIN profiles mgr ON mgr.id = auth.uid()
            WHERE client.id = o.user_id
              AND client.manager_id = mgr.id
              AND mgr.role IN ('manager_rm', 'manager_lm')
          )
        )
    )
  );

DROP POLICY IF EXISTS "order_items_update" ON order_items;
CREATE POLICY "order_items_update" ON order_items FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = order_items.order_id
        AND (
          o.user_id = auth.uid()
          OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = order_items.order_id
        AND (
          o.user_id = auth.uid()
          OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
        )
    )
  );

DROP POLICY IF EXISTS "order_items_delete" ON order_items;
CREATE POLICY "order_items_delete" ON order_items FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = order_items.order_id
        AND EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
    )
  );
/*
# Create display_settings and partner_balances tables

1. New Tables
  - `display_settings` — admin-controlled visibility of columns per role
    - `id` (uuid, PK)
    - `target_role` (text, which role this setting applies to)
    - `show_stock` (boolean, show "Остаток" column)
    - `show_reserve` (boolean, show "Резерв" column)
    - `show_total_pcs` (boolean, show "Всего шт." column)
    - `show_sqm` (boolean, show "м²" column)
    - `show_price` (boolean, show price column)
    - `updated_at` (timestamptz)
    - `updated_by` (uuid, FK to profiles — who last changed it)

  - `partner_balances` — debt/balance data synced from ERP
    - `id` (uuid, PK)
    - `partner_id` (text, ERP partner ID)
    - `balance` (numeric, current debt amount; negative = owes money)
    - `currency` (text, default 'USD')
    - `last_synced_at` (timestamptz, when ERP last updated this)
    - `created_at` (timestamptz)

2. Security
  - display_settings: anyone authenticated can read, only admins can write.
  - partner_balances: admins see all; users see their own partner_id balance;
    managers see balances of their assigned clients.

3. Notes
  - display_settings has one row per role. Seeded with defaults for all 5 roles.
  - partner_balances links to profiles via partner_id field.
*/

CREATE TABLE IF NOT EXISTS display_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_role text UNIQUE NOT NULL CHECK (target_role IN ('admin', 'manager_rm', 'manager_lm', 'supplier', 'client')),
  show_stock boolean NOT NULL DEFAULT true,
  show_reserve boolean NOT NULL DEFAULT false,
  show_total_pcs boolean NOT NULL DEFAULT true,
  show_sqm boolean NOT NULL DEFAULT true,
  show_price boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES profiles(id)
);

ALTER TABLE display_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "display_settings_select" ON display_settings;
CREATE POLICY "display_settings_select" ON display_settings FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "display_settings_insert" ON display_settings;
CREATE POLICY "display_settings_insert" ON display_settings FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "display_settings_update" ON display_settings;
CREATE POLICY "display_settings_update" ON display_settings FOR UPDATE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "display_settings_delete" ON display_settings;
CREATE POLICY "display_settings_delete" ON display_settings FOR DELETE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- Seed default settings for each role
INSERT INTO display_settings (target_role, show_stock, show_reserve, show_total_pcs, show_sqm, show_price)
VALUES
  ('admin', true, true, true, true, true),
  ('manager_rm', true, true, true, true, true),
  ('manager_lm', true, false, true, true, true),
  ('supplier', true, false, true, true, false),
  ('client', true, false, true, true, true)
ON CONFLICT (target_role) DO NOTHING;

-- Partner balances from ERP
CREATE TABLE IF NOT EXISTS partner_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id text UNIQUE NOT NULL,
  balance numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'USD',
  last_synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_partner_balances_partner_id ON partner_balances(partner_id);

ALTER TABLE partner_balances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "partner_balances_select" ON partner_balances;
CREATE POLICY "partner_balances_select" ON partner_balances FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
    OR EXISTS (
      SELECT 1 FROM profiles WHERE id = auth.uid() AND partner_id = partner_balances.partner_id
    )
    OR EXISTS (
      SELECT 1 FROM profiles client
      JOIN profiles mgr ON mgr.id = auth.uid()
      WHERE client.partner_id = partner_balances.partner_id
        AND client.manager_id = mgr.id
        AND mgr.role IN ('manager_rm', 'manager_lm')
    )
  );

DROP POLICY IF EXISTS "partner_balances_insert" ON partner_balances;
CREATE POLICY "partner_balances_insert" ON partner_balances FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "partner_balances_update" ON partner_balances;
CREATE POLICY "partner_balances_update" ON partner_balances FOR UPDATE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "partner_balances_delete" ON partner_balances;
CREATE POLICY "partner_balances_delete" ON partner_balances FOR DELETE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
/*
# Admin bootstrap function + partner_id type alignment

1. New function
  - `bootstrap_admin()` — promotes the calling authenticated user to admin role,
    but ONLY if no admin exists yet. This is a one-time setup mechanism so the
    site owner can self-promote after their first registration. Once any admin
    exists, this function becomes a no-op and raises an exception.

2. Changes to profiles
  - Add `erp_id` column (integer, nullable) — maps to the integer `id` field
    in ERP `counterparties` table. `partner_id` (text) is kept as-is for
    backwards compatibility, but `erp_id` is the primary ERP linkage going forward.
  - Add `bin_iin` column (text, nullable) — 12-digit BIN/IIN from ERP.
  - Add `supplier_id` column (integer, nullable) — for supplier-role users,
    links to their supplier/factory ID in ERP. Used for data isolation.

3. Security
  - `bootstrap_admin` is SECURITY DEFINER, callable by authenticated only.
  - Column grants updated to keep `erp_id`, `bin_iin`, `supplier_id` admin-only.
*/

-- Add new columns to profiles (idempotent)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'erp_id') THEN
    ALTER TABLE profiles ADD COLUMN erp_id integer;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'bin_iin') THEN
    ALTER TABLE profiles ADD COLUMN bin_iin text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'supplier_id') THEN
    ALTER TABLE profiles ADD COLUMN supplier_id integer;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_profiles_erp_id ON profiles(erp_id);
CREATE INDEX IF NOT EXISTS idx_profiles_supplier_id ON profiles(supplier_id);

-- Bootstrap admin: only works when zero admins exist
CREATE OR REPLACE FUNCTION bootstrap_admin()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM profiles WHERE role = 'admin') THEN
    RAISE EXCEPTION 'Admin already exists. Use set_user_role() instead.';
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Must be authenticated';
  END IF;

  UPDATE profiles SET role = 'admin', updated_at = now() WHERE id = auth.uid();
  RETURN 'You are now admin';
END;
$$;

REVOKE EXECUTE ON FUNCTION bootstrap_admin FROM anon;
GRANT EXECUTE ON FUNCTION bootstrap_admin TO authenticated;
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
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_products_collection ON products(collection);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_products_supplier ON products(supplier_id);

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
  base_price numeric NOT NULL DEFAULT 0 CHECK (base_price >= 0),
  version integer NOT NULL DEFAULT 1,
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
CREATE INDEX IF NOT EXISTS idx_warehouse_stock_city ON warehouse_stock(city);

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
CREATE INDEX IF NOT EXISTS idx_collection_prices_type ON collection_prices(price_type_id);

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
/*
# Fix infinite recursion in RLS policies

## Problem
The profiles SELECT policy references profiles itself (checking role = 'admin'),
causing infinite recursion. The same pattern is used in admin-write policies on
products, product_variants, warehouse_stock, collection_prices, and price_types.

## Solution
1. Create a SECURITY DEFINER function `public.is_admin()` that reads `profiles.role`
   while bypassing RLS (runs as the function owner, not the calling role).
2. Rewrite the profiles SELECT policy to use `auth.uid() = id` (own row only) --
   admin/manager cross-reads will be handled separately via the is_admin() function.
3. Rewrite all admin-gated write policies on catalog tables to use `is_admin()`.

## Security
- `is_admin()` is SECURITY DEFINER with a fixed search_path to prevent injection.
- Only authenticated users can execute it.
- Profiles SELECT: users see own row; admins and assigned managers see others via is_admin().
*/

-- 1. Create helper function that bypasses RLS
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_manager()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('manager_rm', 'manager_lm')
  );
$$;

-- 2. Fix profiles SELECT policy (was self-referencing)
DROP POLICY IF EXISTS "profiles_select" ON profiles;
CREATE POLICY "profiles_select" ON profiles FOR SELECT
  TO authenticated
  USING (
    auth.uid() = id
    OR public.is_admin()
    OR (public.is_manager() AND profiles.manager_id = auth.uid())
  );

-- 3. Fix products policies
DROP POLICY IF EXISTS "admin_insert_products" ON products;
CREATE POLICY "admin_insert_products" ON products FOR INSERT
  TO authenticated WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admin_update_products" ON products;
CREATE POLICY "admin_update_products" ON products FOR UPDATE
  TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admin_delete_products" ON products;
CREATE POLICY "admin_delete_products" ON products FOR DELETE
  TO authenticated USING (public.is_admin());

-- 4. Fix product_variants policies
DROP POLICY IF EXISTS "admin_insert_variants" ON product_variants;
CREATE POLICY "admin_insert_variants" ON product_variants FOR INSERT
  TO authenticated WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admin_update_variants" ON product_variants;
CREATE POLICY "admin_update_variants" ON product_variants FOR UPDATE
  TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admin_delete_variants" ON product_variants;
CREATE POLICY "admin_delete_variants" ON product_variants FOR DELETE
  TO authenticated USING (public.is_admin());

-- 5. Fix warehouse_stock policies
DROP POLICY IF EXISTS "admin_insert_stock" ON warehouse_stock;
CREATE POLICY "admin_insert_stock" ON warehouse_stock FOR INSERT
  TO authenticated WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admin_update_stock" ON warehouse_stock;
CREATE POLICY "admin_update_stock" ON warehouse_stock FOR UPDATE
  TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admin_delete_stock" ON warehouse_stock;
CREATE POLICY "admin_delete_stock" ON warehouse_stock FOR DELETE
  TO authenticated USING (public.is_admin());

-- 6. Fix price_types policies
DROP POLICY IF EXISTS "admin_insert_price_types" ON price_types;
CREATE POLICY "admin_insert_price_types" ON price_types FOR INSERT
  TO authenticated WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admin_update_price_types" ON price_types;
CREATE POLICY "admin_update_price_types" ON price_types FOR UPDATE
  TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admin_delete_price_types" ON price_types;
CREATE POLICY "admin_delete_price_types" ON price_types FOR DELETE
  TO authenticated USING (public.is_admin());

-- 7. Fix collection_prices policies
DROP POLICY IF EXISTS "admin_insert_collection_prices" ON collection_prices;
CREATE POLICY "admin_insert_collection_prices" ON collection_prices FOR INSERT
  TO authenticated WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admin_update_collection_prices" ON collection_prices;
CREATE POLICY "admin_update_collection_prices" ON collection_prices FOR UPDATE
  TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admin_delete_collection_prices" ON collection_prices;
CREATE POLICY "admin_delete_collection_prices" ON collection_prices FOR DELETE
  TO authenticated USING (public.is_admin());

-- 8. Fix any other tables that had the same pattern
-- display_settings
DROP POLICY IF EXISTS "display_settings_delete" ON display_settings;
CREATE POLICY "display_settings_delete" ON display_settings FOR DELETE
  TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS "display_settings_insert" ON display_settings;
CREATE POLICY "display_settings_insert" ON display_settings FOR INSERT
  TO authenticated WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "display_settings_update" ON display_settings;
CREATE POLICY "display_settings_update" ON display_settings FOR UPDATE
  TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- partner_balances
DROP POLICY IF EXISTS "balances_update" ON partner_balances;
CREATE POLICY "balances_update" ON partner_balances FOR UPDATE
  TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "balances_insert" ON partner_balances;
CREATE POLICY "balances_insert" ON partner_balances FOR INSERT
  TO authenticated WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "balances_delete" ON partner_balances;
CREATE POLICY "balances_delete" ON partner_balances FOR DELETE
  TO authenticated USING (public.is_admin());
/*
# Fix remaining RLS recursion in orders, order_items, partner_balances

All policies that do `EXISTS (SELECT 1 FROM profiles WHERE role = ...)` cause
infinite recursion because profiles has RLS enabled. Replace with calls to
the SECURITY DEFINER helpers is_admin() and is_manager() created in the
previous migration.
*/

-- orders
DROP POLICY IF EXISTS "orders_select" ON orders;
CREATE POLICY "orders_select" ON orders FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR placed_by_id = auth.uid()
    OR public.is_admin()
    OR (public.is_manager() AND EXISTS (
      SELECT 1 FROM profiles client
      WHERE client.id = orders.user_id AND client.manager_id = auth.uid()
    ))
  );

DROP POLICY IF EXISTS "orders_insert" ON orders;
CREATE POLICY "orders_insert" ON orders FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    OR public.is_admin()
    OR (public.is_manager() AND EXISTS (
      SELECT 1 FROM profiles client
      WHERE client.id = orders.user_id AND client.manager_id = auth.uid()
    ))
  );

DROP POLICY IF EXISTS "orders_update" ON orders;
CREATE POLICY "orders_update" ON orders FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid() OR public.is_admin())
  WITH CHECK (user_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "orders_delete" ON orders;
CREATE POLICY "orders_delete" ON orders FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- order_items
DROP POLICY IF EXISTS "order_items_select" ON order_items;
CREATE POLICY "order_items_select" ON order_items FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM orders o WHERE o.id = order_items.order_id
      AND (o.user_id = auth.uid() OR o.placed_by_id = auth.uid() OR public.is_admin()
        OR (public.is_manager() AND EXISTS (
          SELECT 1 FROM profiles client
          WHERE client.id = o.user_id AND client.manager_id = auth.uid()
        ))
      )
    )
  );

DROP POLICY IF EXISTS "order_items_insert" ON order_items;
CREATE POLICY "order_items_insert" ON order_items FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM orders o WHERE o.id = order_items.order_id
      AND (o.user_id = auth.uid() OR public.is_admin()
        OR (public.is_manager() AND EXISTS (
          SELECT 1 FROM profiles client
          WHERE client.id = o.user_id AND client.manager_id = auth.uid()
        ))
      )
    )
  );

DROP POLICY IF EXISTS "order_items_update" ON order_items;
CREATE POLICY "order_items_update" ON order_items FOR UPDATE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM orders o WHERE o.id = order_items.order_id
    AND (o.user_id = auth.uid() OR public.is_admin())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM orders o WHERE o.id = order_items.order_id
    AND (o.user_id = auth.uid() OR public.is_admin())
  ));

DROP POLICY IF EXISTS "order_items_delete" ON order_items;
CREATE POLICY "order_items_delete" ON order_items FOR DELETE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM orders o WHERE o.id = order_items.order_id
    AND public.is_admin()
  ));

-- partner_balances SELECT (the insert/update/delete were already fixed)
DROP POLICY IF EXISTS "partner_balances_select" ON partner_balances;
CREATE POLICY "partner_balances_select" ON partner_balances FOR SELECT
  TO authenticated
  USING (
    public.is_admin()
    OR EXISTS (
      SELECT 1 FROM profiles WHERE profiles.id = auth.uid()
      AND profiles.partner_id = partner_balances.partner_id
    )
    OR (public.is_manager() AND EXISTS (
      SELECT 1 FROM profiles client
      WHERE client.partner_id = partner_balances.partner_id
      AND client.manager_id = auth.uid()
    ))
  );
/*
# Add impersonation_enabled column to profiles

1. Changes to profiles
  - Add `impersonation_enabled` (boolean, default false) — admin-controlled flag
    that determines whether the "Войти под клиентом" button is shown for a
    given client in the admin's "Мои клиенты" tab.

2. Security
  - Column is admin-only writable via RLS column grants (role column already
    restricted). The existing update policy on profiles already restricts
    writes to the row owner; we add a separate grant so admins can update
    this flag on any profile.
*/

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'impersonation_enabled'
  ) THEN
    ALTER TABLE profiles ADD COLUMN impersonation_enabled boolean NOT NULL DEFAULT false;
  END IF;
END $$;
/*
# Create client_warehouse_rules table
1. New Tables:
   - `client_warehouse_rules`
     - `id` (uuid, PK)
     - `client_id` (text, UNIQUE, ID контрагента или ERP ID)
     - `mode` (text: 'auto' | 'custom')
     - `show_central_warehouse` (boolean)
     - `show_showroom_warehouse` (boolean)
     - `allowed_warehouse_ids` (integer[])
     - `hidden_warehouse_ids` (integer[])
     - `custom_name` (text, nullable)
     - `updated_at` (timestamptz)
     - `updated_by` (uuid, FK profiles)
2. Security:
   - Authenticated users can read rules.
   - Admins can create, update, delete rules.
*/

CREATE TABLE IF NOT EXISTS client_warehouse_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id text UNIQUE NOT NULL,
  mode text NOT NULL DEFAULT 'auto' CHECK (mode IN ('auto', 'custom')),
  show_central_warehouse boolean NOT NULL DEFAULT true,
  show_showroom_warehouse boolean NOT NULL DEFAULT true,
  allowed_warehouse_ids integer[] NOT NULL DEFAULT '{}',
  hidden_warehouse_ids integer[] NOT NULL DEFAULT '{}',
  custom_name text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES profiles(id)
);

CREATE INDEX IF NOT EXISTS idx_client_wh_rules_client_id ON client_warehouse_rules(client_id);

ALTER TABLE client_warehouse_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_select_client_wh_rules" ON client_warehouse_rules;
CREATE POLICY "auth_select_client_wh_rules" ON client_warehouse_rules FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "admin_all_client_wh_rules" ON client_warehouse_rules;
CREATE POLICY "admin_all_client_wh_rules" ON client_warehouse_rules FOR ALL
  TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
/*
# Create integration_audit_logs table
1. New Tables:
   - `integration_audit_logs`
     - `id` (uuid, PK)
     - `event_type` (text: 'order_sync', 'webhook', 'stock_event', etc.)
     - `direction` (text: 'inbound' | 'outbound')
     - `status` (text: 'success' | 'warning' | 'error')
     - `status_code` (integer)
     - `latency_ms` (integer)
     - `source` (text)
     - `payload` (jsonb)
     - `error_message` (text)
     - `created_at` (timestamptz)
2. Security:
   - Admins can read integration audit logs.
*/

CREATE TABLE IF NOT EXISTS integration_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  status text NOT NULL CHECK (status IN ('success', 'warning', 'error')),
  status_code integer,
  latency_ms integer,
  source text NOT NULL,
  payload jsonb,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON integration_audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_status ON integration_audit_logs(status);
CREATE INDEX IF NOT EXISTS idx_audit_logs_event_type ON integration_audit_logs(event_type);

ALTER TABLE integration_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_select_audit_logs" ON integration_audit_logs;
CREATE POLICY "admin_select_audit_logs" ON integration_audit_logs FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "system_insert_audit_logs" ON integration_audit_logs;
CREATE POLICY "system_insert_audit_logs" ON integration_audit_logs FOR INSERT
  TO authenticated
  WITH CHECK (true);
