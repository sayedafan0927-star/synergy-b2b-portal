-- Migration: Partitioning strategy for integration_audit_logs
-- Divides append-heavy integration logs by month for fast pruning, indexing, and high write throughput.

-- Create partitioned master table
CREATE TABLE IF NOT EXISTS integration_audit_logs_v2 (
  id uuid DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  status text NOT NULL CHECK (status IN ('success', 'warning', 'error')),
  status_code integer,
  latency_ms integer,
  source text NOT NULL,
  payload jsonb,
  error_message text,
  correlation_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- Monthly partitions for 2026 and 2027
CREATE TABLE IF NOT EXISTS audit_logs_y2026m09 PARTITION OF integration_audit_logs_v2
  FOR VALUES FROM ('2026-09-01 00:00:00+00') TO ('2026-10-01 00:00:00+00');

CREATE TABLE IF NOT EXISTS audit_logs_y2026m10 PARTITION OF integration_audit_logs_v2
  FOR VALUES FROM ('2026-10-01 00:00:00+00') TO ('2026-11-01 00:00:00+00');

CREATE TABLE IF NOT EXISTS audit_logs_y2026m11 PARTITION OF integration_audit_logs_v2
  FOR VALUES FROM ('2026-11-01 00:00:00+00') TO ('2026-12-01 00:00:00+00');

CREATE TABLE IF NOT EXISTS audit_logs_y2026m12 PARTITION OF integration_audit_logs_v2
  FOR VALUES FROM ('2026-12-01 00:00:00+00') TO ('2027-01-01 00:00:00+00');

CREATE TABLE IF NOT EXISTS audit_logs_y2027m01 PARTITION OF integration_audit_logs_v2
  FOR VALUES FROM ('2027-01-01 00:00:00+00') TO ('2027-02-01 00:00:00+00');

CREATE TABLE IF NOT EXISTS audit_logs_y2027m02 PARTITION OF integration_audit_logs_v2
  FOR VALUES FROM ('2027-02-01 00:00:00+00') TO ('2027-03-01 00:00:00+00');

-- Default partition for dates beyond the pre-allocated ranges
CREATE TABLE IF NOT EXISTS audit_logs_default PARTITION OF integration_audit_logs_v2 DEFAULT;

-- Partitioned Indexes
CREATE INDEX IF NOT EXISTS idx_audit_v2_created ON integration_audit_logs_v2 (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_v2_status ON integration_audit_logs_v2 (status);
CREATE INDEX IF NOT EXISTS idx_audit_v2_event_type ON integration_audit_logs_v2 (event_type);
CREATE INDEX IF NOT EXISTS idx_audit_v2_correlation ON integration_audit_logs_v2 (correlation_id);

-- Enable Row Level Security on the partitioned master table
ALTER TABLE integration_audit_logs_v2 ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_read_audit_logs_v2" ON integration_audit_logs_v2;
CREATE POLICY "admin_read_audit_logs_v2" ON integration_audit_logs_v2 FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "service_insert_audit_logs_v2" ON integration_audit_logs_v2;
CREATE POLICY "service_insert_audit_logs_v2" ON integration_audit_logs_v2 FOR INSERT
  TO authenticated WITH CHECK (true);
