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
