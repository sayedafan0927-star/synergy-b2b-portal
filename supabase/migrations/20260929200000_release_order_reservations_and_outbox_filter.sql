-- Migration 20260929200000: Release Order Reservations, Monotonic Claim Filter & RLS Hardening

-- 1. Function to atomically release stock reservations for cancelled orders back to free_stock
CREATE OR REPLACE FUNCTION release_order_reservations(p_order_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_item record;
  v_count integer := 0;
BEGIN
  -- Iterates over all order items belonging to this order OR its child split orders
  FOR v_item IN
    SELECT 
      oi.sku,
      SUM(oi.quantity)::integer AS qty,
      COALESCE(oi.warehouse_id, 81) AS warehouse_id
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    WHERE (o.id = p_order_id OR o.parent_order_id = p_order_id)
      AND oi.sku IS NOT NULL AND oi.sku <> ''
      AND oi.quantity > 0
    GROUP BY oi.sku, COALESCE(oi.warehouse_id, 81)
    ORDER BY oi.sku ASC
  LOOP
    UPDATE inventory_balances
    SET 
      free_stock = free_stock + v_item.qty,
      reserved_stock = GREATEST(0, reserved_stock - v_item.qty),
      updated_at = now()
    WHERE sku = v_item.sku AND warehouse_id = v_item.warehouse_id;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION release_order_reservations(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION release_order_reservations(uuid) TO authenticated, service_role;

-- 2. Update cancel_expired_order_holds to automatically release reservations
CREATE OR REPLACE FUNCTION cancel_expired_order_holds(p_batch_size integer DEFAULT 50)
RETURNS TABLE (
  cancelled_order_id uuid,
  cancelled_order_number text,
  user_id uuid,
  total_amount numeric
)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT id
    FROM orders
    WHERE status IN ('pending', 'failed_dlq')
      AND (
        (hold_expires_at IS NOT NULL AND hold_expires_at <= now())
        OR (hold_expires_at IS NULL AND created_at <= now() - INTERVAL '24 hours')
      )
    ORDER BY created_at ASC
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  LOOP
    -- Release inventory hold back to free_stock
    PERFORM release_order_reservations(r.id);

    RETURN QUERY
    UPDATE orders o
    SET 
      status = 'cancelled',
      notes = TRIM(COALESCE(o.notes, '') || ' [Auto-cancelled: WMS reservation hold TTL expired (24h)]'),
      updated_at = now()
    WHERE o.id = r.id
    RETURNING o.id, o.order_number, o.user_id, o.total_amount;
  END LOOP;
END;
$$;

-- 3. Update claim_outbox_orders to isolate multi-warehouse sub-orders
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
      AND parent_order_id IS NULL
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

-- 4. RLS Hardening on orders and order_items
DROP POLICY IF EXISTS "orders_update" ON orders;
CREATE POLICY "orders_update" ON orders FOR UPDATE
  TO authenticated
  USING (
    public.is_admin()
    OR (
      user_id = auth.uid()
      AND status = 'pending'
    )
  )
  WITH CHECK (
    public.is_admin()
    OR (
      user_id = auth.uid()
      AND status IN ('pending', 'cancelled')
    )
  );

DROP POLICY IF EXISTS "order_items_update" ON order_items;
CREATE POLICY "order_items_update" ON order_items FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());
