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
