-- Migration 20260929120000: Order Status History Audit Trail and Concurrent SKIP LOCKED Outbox Claim

-- 1. Table order_status_history for immutable audit trail of order lifecycle
CREATE TABLE IF NOT EXISTS order_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  previous_status text,
  new_status text NOT NULL,
  changed_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  correlation_id text,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_status_history_order_id ON order_status_history(order_id);
CREATE INDEX IF NOT EXISTS idx_order_status_history_created_at ON order_status_history(created_at DESC);

ALTER TABLE order_status_history ENABLE ROW LEVEL SECURITY;

-- Clients can view status history of their own orders
DROP POLICY IF EXISTS "client_view_own_order_status_history" ON order_status_history;
CREATE POLICY "client_view_own_order_status_history" ON order_status_history
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM orders
      WHERE orders.id = order_status_history.order_id
        AND orders.user_id = auth.uid()
    )
    OR
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('admin', 'manager_rm', 'manager_lm')
    )
  );

-- Trigger to record every order status transition automatically
CREATE OR REPLACE FUNCTION log_order_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF (TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status) THEN
    INSERT INTO order_status_history (
      order_id,
      previous_status,
      new_status,
      changed_by,
      reason,
      created_at
    ) VALUES (
      NEW.id,
      OLD.status,
      NEW.status,
      auth.uid(),
      COALESCE(NEW.notes, 'Status transitioned in order processing pipeline'),
      now()
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_order_status_transition ON orders;
CREATE TRIGGER trg_order_status_transition
  AFTER UPDATE OF status ON orders
  FOR EACH ROW
  EXECUTE FUNCTION log_order_status_transition();

-- 2. Atomic concurrent outbox claim function (FOR UPDATE SKIP LOCKED)
-- Guarantees that multiple Vercel cron instances never claim the same order concurrently
CREATE OR REPLACE FUNCTION claim_outbox_orders(p_limit integer DEFAULT 10)
RETURNS SETOF orders
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH locked_orders AS (
    SELECT id
    FROM orders
    WHERE status = 'pending'
      AND (next_retry_at IS NULL OR next_retry_at <= now())
    ORDER BY created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  UPDATE orders o
  SET status = 'processing_sync',
      updated_at = now()
  FROM locked_orders lo
  WHERE o.id = lo.id
  RETURNING o.*;
END;
$$;
