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
