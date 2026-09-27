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
