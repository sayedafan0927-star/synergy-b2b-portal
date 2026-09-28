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
