/*
# Create leads table
1. New Tables:
   - `leads`
     - `id` (uuid, PK)
     - `name` (text, NOT NULL)
     - `phone` (text, NOT NULL)
     - `company` (text)
     - `email` (text)
     - `message` (text)
     - `source` (text, default 'Форма заявки с сайта B2B')
     - `kanban_stage` (text, default 'Новые лиды')
     - `status` (text, default 'new')
     - `created_at` (timestamptz, default now())
     - `updated_at` (timestamptz, default now())
2. Security:
   - Admins can view and manage leads.
   - Public/authenticated can insert leads.
*/

CREATE TABLE IF NOT EXISTS leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text NOT NULL,
  company text,
  email text,
  message text,
  source text NOT NULL DEFAULT 'Форма заявки с сайта B2B',
  kanban_stage text NOT NULL DEFAULT 'Новые лиды',
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'in_progress', 'converted', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads(phone);

ALTER TABLE leads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_manage_leads" ON leads;
CREATE POLICY "admin_manage_leads" ON leads
  FOR ALL
  TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "anyone_insert_leads" ON leads;
CREATE POLICY "anyone_insert_leads" ON leads
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);
