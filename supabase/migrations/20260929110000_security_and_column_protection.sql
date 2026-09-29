-- Migration 20260929110000: Security & Column-Level Protection for Sensitive Auth Data

-- 1. Ensure password_hash column exists on profiles table
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS password_hash text;

-- 2. Revoke SELECT privilege on sensitive credentials from client-facing roles
-- Prevents clients from extracting password_hash via the Supabase Client SDK
DO $$ BEGIN
  REVOKE SELECT (password_hash) ON profiles FROM anon;
  REVOKE SELECT (password_hash) ON profiles FROM authenticated;
EXCEPTION
  WHEN OTHERS THEN
    NULL;
END $$;

-- 3. Explicitly grant full credentials access to service_role and backend workers
DO $$ BEGIN
  GRANT SELECT, UPDATE (password_hash) ON profiles TO service_role;
EXCEPTION
  WHEN OTHERS THEN
    NULL;
END $$;

-- 4. Advisory lock wrapper for bootstrap_admin to eliminate race conditions
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
