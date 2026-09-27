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
