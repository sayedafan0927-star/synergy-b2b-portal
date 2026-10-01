-- Migration: 20261001170000_composite_suborder_safe_reservations.sql
-- Suborder-Aware Release and Fulfillment of Inventory Reservations
-- Prevents Phantom Inventory Duplication & Double Deductions in Composite Multi-Warehouse Orders

-- 1. release_order_reservations: Suborder-aware release
CREATE OR REPLACE FUNCTION public.release_order_reservations(p_order_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_item record;
  v_count integer := 0;
  v_parent_id uuid;
  v_is_already_released boolean;
  v_has_children boolean := false;
BEGIN
  -- 1. Concurrency Guard: Lock order row with FOR UPDATE
  SELECT parent_order_id, COALESCE(reservations_released, false)
  INTO v_parent_id, v_is_already_released
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_is_already_released IS TRUE THEN
    RETURN 0;
  END IF;

  -- 2. Проверяем, является ли данный заказ мастер-заказом с дочерними складскими партиями
  SELECT EXISTS (
    SELECT 1 FROM public.orders WHERE parent_order_id = p_order_id
  ) INTO v_has_children;

  -- 3. Высвобождаем остатки:
  -- Если это мастер-заказ, берем строки ТОЛЬКО тех дочерних подзаказов, у которых reservations_released = false
  -- (чтобы не возвращать остатки повторно за уже ранее отклоненные/отмененные подзаказы)
  -- Если одиночный заказ или подзаказ — берем его собственные строки
  IF v_has_children IS TRUE THEN
    FOR v_item IN
      SELECT 
        oi.sku,
        SUM(oi.quantity)::integer AS qty,
        COALESCE(oi.warehouse_id, 81) AS warehouse_id
      FROM public.orders sub
      JOIN public.order_items oi ON oi.order_id = sub.id
      WHERE sub.parent_order_id = p_order_id
        AND COALESCE(sub.reservations_released, false) = false
        AND oi.sku IS NOT NULL AND oi.sku <> ''
        AND oi.quantity > 0
      GROUP BY oi.sku, COALESCE(oi.warehouse_id, 81)
      ORDER BY oi.sku ASC, COALESCE(oi.warehouse_id, 81) ASC
    LOOP
      UPDATE public.inventory_balances
      SET 
        free_stock = free_stock + v_item.qty,
        reserved_stock = GREATEST(0, reserved_stock - v_item.qty),
        updated_at = now()
      WHERE sku = v_item.sku AND warehouse_id = v_item.warehouse_id;

      v_count := v_count + 1;
    END LOOP;

    -- Помечаем мастер-заказ и все дочерние как освобожденные
    UPDATE public.orders
    SET reservations_released = true,
        updated_at = now()
    WHERE id = p_order_id OR parent_order_id = p_order_id;
  ELSE
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
        free_stock = free_stock + v_item.qty,
        reserved_stock = GREATEST(0, reserved_stock - v_item.qty),
        updated_at = now()
      WHERE sku = v_item.sku AND warehouse_id = v_item.warehouse_id;

      v_count := v_count + 1;
    END LOOP;

    -- Помечаем конкретный подзаказ/заказ
    UPDATE public.orders
    SET reservations_released = true,
        updated_at = now()
    WHERE id = p_order_id;

    -- Если это был подзаказ, и у родителя не осталось незавершенных подзаказов — помечаем родителя
    IF v_parent_id IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.orders 
        WHERE parent_order_id = v_parent_id 
          AND COALESCE(reservations_released, false) = false
      ) THEN
        UPDATE public.orders
        SET reservations_released = true,
            updated_at = now()
        WHERE id = v_parent_id;
      END IF;
    END IF;
  END IF;

  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.release_order_reservations(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.release_order_reservations(uuid) TO authenticated, service_role;


-- 2. fulfill_order_reservations: Suborder-aware fulfillment
CREATE OR REPLACE FUNCTION public.fulfill_order_reservations(p_order_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_item record;
  v_count integer := 0;
  v_parent_id uuid;
  v_is_already_fulfilled boolean;
  v_has_children boolean := false;
BEGIN
  -- 1. Concurrency Guard: Lock order row with FOR UPDATE
  SELECT parent_order_id, COALESCE(reservations_released, false)
  INTO v_parent_id, v_is_already_fulfilled
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_is_already_fulfilled IS TRUE THEN
    RETURN 0;
  END IF;

  -- 2. Проверяем, является ли данный заказ мастер-заказом с дочерними складскими партиями
  SELECT EXISTS (
    SELECT 1 FROM public.orders WHERE parent_order_id = p_order_id
  ) INTO v_has_children;

  -- 3. Списываем остатки по позициям:
  -- Если это мастер-заказ, берем строки ТОЛЬКО тех дочерних подзаказов, у которых reservations_released = false
  IF v_has_children IS TRUE THEN
    FOR v_item IN
      SELECT 
        oi.sku,
        SUM(oi.quantity)::integer AS qty,
        COALESCE(oi.warehouse_id, 81) AS warehouse_id
      FROM public.orders sub
      JOIN public.order_items oi ON oi.order_id = sub.id
      WHERE sub.parent_order_id = p_order_id
        AND COALESCE(sub.reservations_released, false) = false
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

    UPDATE public.orders
    SET reservations_released = true,
        updated_at = now()
    WHERE id = p_order_id OR parent_order_id = p_order_id;
  ELSE
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

    UPDATE public.orders
    SET reservations_released = true,
        updated_at = now()
    WHERE id = p_order_id;

    IF v_parent_id IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.orders 
        WHERE parent_order_id = v_parent_id 
          AND COALESCE(reservations_released, false) = false
      ) THEN
        UPDATE public.orders
        SET reservations_released = true,
            updated_at = now()
        WHERE id = v_parent_id;
      END IF;
    END IF;
  END IF;

  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fulfill_order_reservations(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fulfill_order_reservations(uuid) TO authenticated, service_role;
