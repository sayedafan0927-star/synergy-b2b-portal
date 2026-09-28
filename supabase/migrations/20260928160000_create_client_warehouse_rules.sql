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
