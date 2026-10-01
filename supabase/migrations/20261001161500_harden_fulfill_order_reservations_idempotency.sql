-- Migration: 20261001161500_harden_fulfill_order_reservations_idempotency.sql
-- Idempotency Guard & Deadlock Protection for order fulfillment (shipped/delivered)
-- Prevents duplicate stock deductions upon concurrent/repeated CDC webhooks

CREATE OR REPLACE FUNCTION public.fulfill_order_reservations(p_order_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_item record;
  v_count integer := 0;
  v_is_already_fulfilled boolean;
BEGIN
  -- 1. Concurrency Guard: Lock order row with FOR UPDATE to prevent duplicate fulfillment deduction
  SELECT COALESCE(reservations_released, false)
  INTO v_is_already_fulfilled
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_is_already_fulfilled IS TRUE THEN
    RETURN 0;
  END IF;

  -- 2. Idempotently deduct reserved_stock and total_stock with sorted locks to prevent deadlocks (40P01)
  FOR v_item IN
    SELECT 
      oi.sku,
      SUM(oi.quantity)::integer AS qty,
      COALESCE(oi.warehouse_id, 81) AS warehouse_id
    FROM public.order_items oi
    WHERE oi.order_id = p_order_id
      AND oi.sku IS NOT NULL AND oi.sku <> ''
      AND oi.quantity > 0
    GROUP BY oi.sku, COALESCE(oi.warehouse_id, 81)
    ORDER BY oi.sku ASC, COALESCE(oi.warehouse_id, 81) ASC
  LOOP
    UPDATE public.inventory_balances
    SET 
      reserved_stock = GREATEST(0, reserved_stock - v_item.qty),
      total_stock = GREATEST(0, total_stock - v_item.qty),
      updated_at = now()
    WHERE sku = v_item.sku AND warehouse_id = v_item.warehouse_id;

    v_count := v_count + 1;
  END LOOP;

  -- 3. Mark master order and suborders as fulfilled
  UPDATE public.orders
  SET reservations_released = true,
      updated_at = now()
  WHERE id = p_order_id OR parent_order_id = p_order_id;

  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fulfill_order_reservations(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fulfill_order_reservations(uuid) TO authenticated, service_role;
