-- Migration 20261001120000: Inventory Reconciliation, Atomic Pre-Insert & Hold Auto-Release
-- 1. Create fulfill_order_reservations: deducts reserved_stock and total_stock when ERP posts shipping invoice (РТУ)
-- 2. Harden release_order_reservations: FOR UPDATE row lock on orders to prevent concurrent double-releases
-- 3. Harden cancel_expired_order_holds: automatically release stock reservations when cancelling stale holds (>24h)
-- 4. Harden create_order_atomic: pre-insert inventory_balances rows before SELECT FOR UPDATE to eliminate lazy initialization race condition

-- 1. fulfill_order_reservations
CREATE OR REPLACE FUNCTION public.fulfill_order_reservations(p_order_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_item record;
  v_count integer := 0;
BEGIN
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
    ORDER BY oi.sku ASC
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

  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fulfill_order_reservations(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fulfill_order_reservations(uuid) TO authenticated, service_role;

-- 2. Harden release_order_reservations with FOR UPDATE
CREATE OR REPLACE FUNCTION public.release_order_reservations(p_order_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_item record;
  v_count integer := 0;
  v_is_already_released boolean;
  v_order_user_id uuid;
  v_caller_role text;
BEGIN
  -- Security Guard: Verify caller ownership if invoked in an authenticated context
  IF auth.uid() IS NOT NULL AND auth.role() <> 'service_role' THEN
    SELECT user_id INTO v_order_user_id FROM public.orders WHERE id = p_order_id;
    SELECT role INTO v_caller_role FROM public.profiles WHERE id = auth.uid();
    
    IF v_order_user_id IS NULL THEN
      RETURN 0;
    END IF;

    IF v_order_user_id <> auth.uid() AND v_caller_role NOT IN ('admin', 'manager_rm', 'manager_lm') THEN
      RAISE EXCEPTION 'Access Denied: You cannot release reservations for another client order (Anti-IDOR)';
    END IF;
  END IF;

  -- Concurrency Guard: Lock order row with FOR UPDATE to prevent duplicate releases
  SELECT COALESCE(reservations_released, false)
  INTO v_is_already_released
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_is_already_released IS TRUE THEN
    RETURN 0;
  END IF;

  -- Idempotently restore inventory balances
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

  UPDATE public.orders
  SET reservations_released = true,
      updated_at = now()
  WHERE id = p_order_id OR parent_order_id = p_order_id;

  RETURN v_count;
END;
$$;

-- 3. Harden cancel_expired_order_holds to release stock reservations
CREATE OR REPLACE FUNCTION public.cancel_expired_order_holds(p_batch_size integer DEFAULT 50)
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
  v_rec record;
BEGIN
  FOR v_rec IN
    SELECT id, order_number, o.user_id, o.total_amount
    FROM orders o
    WHERE o.status = 'pending'
      AND (
        (o.hold_expires_at IS NOT NULL AND o.hold_expires_at <= now())
        OR (o.hold_expires_at IS NULL AND o.created_at <= now() - INTERVAL '24 hours')
      )
    ORDER BY o.created_at ASC
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  LOOP
    -- 1. Release inventory reservations back to free stock
    PERFORM public.release_order_reservations(v_rec.id);

    -- 2. Mark order and suborders as cancelled and released
    UPDATE public.orders
    SET 
      status = 'cancelled',
      reservations_released = true,
      notes = TRIM(COALESCE(notes, '') || ' [Auto-cancelled: WMS reservation hold TTL expired (24h)]'),
      updated_at = now()
    WHERE id = v_rec.id OR parent_order_id = v_rec.id;

    cancelled_order_id := v_rec.id;
    cancelled_order_number := v_rec.order_number;
    user_id := v_rec.user_id;
    total_amount := v_rec.total_amount;
    RETURN NEXT;
  END LOOP;
END;
$$;

-- 4. Harden create_order_atomic: eliminate race condition via atomic pre-insert
CREATE OR REPLACE FUNCTION public.create_order_atomic(
  p_order jsonb,
  p_items jsonb,
  p_split_orders jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_id uuid;
  v_order_number text;
  v_item record;
  v_available integer;
  v_sku text;
  v_qty integer;
  v_wh_id integer;
  v_split_elem jsonb;
  v_sub_order_id uuid;
  v_sub_doc_number text;
  v_created_sub_orders jsonb := '[]'::jsonb;
  v_exchange_rate numeric;
  v_split_counter integer := 1;
  v_partner_id text;
BEGIN
  -- 0. Защита от бесконечных блокировок
  PERFORM set_config('lock_timeout', '2000ms', true);
  PERFORM set_config('statement_timeout', '4000ms', true);

  -- 0.1. Проверка контекста вызова: если вызвано напрямую через PostgREST клиентом
  IF auth.uid() IS NOT NULL AND auth.role() <> 'service_role' THEN
    IF (p_order->>'user_id')::uuid <> auth.uid() THEN
      RAISE EXCEPTION 'Access Denied: BOLA violation detected in create_order_atomic';
    END IF;
  END IF;

  -- 0.2. Разрешение partner_id
  v_partner_id := COALESCE(
    NULLIF(TRIM(p_order->>'partner_id'), ''),
    (SELECT partner_id FROM public.profiles WHERE id = (p_order->>'user_id')::uuid LIMIT 1)
  );

  -- 1. Курс валюты из display_settings
  SELECT COALESCE(exchange_rate_usd_kzt, 520.0000)
  INTO v_exchange_rate
  FROM public.display_settings
  LIMIT 1;

  IF v_exchange_rate IS NULL OR v_exchange_rate <= 0 THEN
    v_exchange_rate := 520.0000;
  END IF;

  -- 2. Предварительная атомарная вставка строк inventory_balances для гарантии блокировки FOR UPDATE
  FOR v_item IN
    SELECT 
      (elem->>'sku')::text AS sku,
      SUM((elem->>'quantity')::integer) AS qty,
      COALESCE((elem->>'warehouse_id')::integer, 81) AS warehouse_id
    FROM jsonb_array_elements(p_items) AS elem
    WHERE elem->>'sku' IS NOT NULL AND elem->>'sku' <> ''
    GROUP BY (elem->>'sku')::text, COALESCE((elem->>'warehouse_id')::integer, 81)
    ORDER BY (elem->>'sku')::text ASC, COALESCE((elem->>'warehouse_id')::integer, 81) ASC
  LOOP
    v_sku := v_item.sku;
    v_qty := v_item.qty;
    v_wh_id := v_item.warehouse_id;

    -- Гарантируем, что строка существует перед блокировкой FOR UPDATE (исключает race condition)
    INSERT INTO public.inventory_balances (sku, warehouse_id, free_stock, reserved_stock, total_stock)
    SELECT v_sku, v_wh_id, COALESCE(stock, 0), 0, COALESCE(stock, 0)
    FROM public.product_variants
    WHERE sku = v_sku
    ON CONFLICT (sku, warehouse_id) DO NOTHING;

    SELECT free_stock INTO v_available
    FROM public.inventory_balances
    WHERE sku = v_sku AND warehouse_id = v_wh_id
    FOR UPDATE;

    IF v_available IS NULL OR v_available < v_qty THEN
      RAISE EXCEPTION 'INSUFFICIENT_STOCK: SKU % on warehouse % has only % free items, requested %',
        v_sku, v_wh_id, COALESCE(v_available, 0), v_qty;
    END IF;

    UPDATE public.inventory_balances
    SET free_stock = free_stock - v_qty,
        reserved_stock = reserved_stock + v_qty,
        updated_at = now()
    WHERE sku = v_sku AND warehouse_id = v_wh_id;
  END LOOP;

  -- 3. Атомарная вставка мастер-заказа с сохранением partner_id
  INSERT INTO public.orders (
    user_id,
    placed_by_id,
    partner_id,
    warehouse,
    notes,
    total_amount,
    total_items,
    total_sqm,
    status,
    idempotency_key,
    currency,
    applied_exchange_rate,
    contract_id
  ) VALUES (
    (p_order->>'user_id')::uuid,
    COALESCE((p_order->>'placed_by_id')::uuid, (p_order->>'user_id')::uuid),
    v_partner_id,
    COALESCE(p_order->>'warehouse', 'Основной Склад Астана'),
    COALESCE(p_order->>'notes', ''),
    COALESCE((p_order->>'total_amount')::numeric, 0),
    COALESCE((p_order->>'total_items')::integer, 1),
    COALESCE((p_order->>'total_sqm')::numeric, 0),
    'pending',
    p_order->>'idempotency_key',
    COALESCE(p_order->>'currency', 'USD'),
    v_exchange_rate,
    CASE 
      WHEN p_order->>'contract_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN (p_order->>'contract_id')::uuid 
      ELSE NULL 
    END
  )
  RETURNING id, order_number INTO v_order_id, v_order_number;

  -- 4. Вставка позиций мастер-заказа
  INSERT INTO public.order_items (
    order_id,
    product_id,
    product_name,
    size,
    sku,
    warehouse,
    warehouse_id,
    price,
    quantity
  )
  SELECT
    v_order_id,
    COALESCE(elem->>'product_id', elem->>'productId', elem->>'sku', ''),
    COALESCE(elem->>'product_name', elem->>'sku', 'Ковровое изделие'),
    COALESCE(elem->>'size', 'Стандарт'),
    COALESCE(elem->>'sku', ''),
    COALESCE(elem->>'warehouse', 'Основной Склад Астана'),
    COALESCE((elem->>'warehouse_id')::integer, 81),
    COALESCE((elem->>'price')::numeric, 0),
    COALESCE((elem->>'quantity')::integer, 1)
  FROM jsonb_array_elements(p_items) AS elem;

  -- 5. Вставка дочерних подзаказов мультисклада
  IF p_split_orders IS NOT NULL AND jsonb_array_length(p_split_orders) > 0 THEN
    FOR v_split_elem IN SELECT * FROM jsonb_array_elements(p_split_orders)
    LOOP
      v_sub_doc_number := COALESCE(
        v_split_elem->>'doc_number',
        v_order_number || '-W' || COALESCE(v_split_elem->>'warehouse_id', v_split_counter::text)
      );

      IF v_sub_doc_number LIKE 'ORD-wh-%' THEN
        v_sub_doc_number := v_order_number || '-W' || v_split_counter::text;
      END IF;
      
      INSERT INTO public.orders (
        order_number,
        user_id,
        placed_by_id,
        partner_id,
        warehouse,
        notes,
        total_amount,
        total_items,
        total_sqm,
        status,
        idempotency_key,
        currency,
        applied_exchange_rate,
        contract_id,
        parent_order_id
      ) VALUES (
        v_sub_doc_number,
        (p_order->>'user_id')::uuid,
        COALESCE((p_order->>'placed_by_id')::uuid, (p_order->>'user_id')::uuid),
        v_partner_id,
        COALESCE(v_split_elem->>'warehouse', 'Основной Склад Астана'),
        COALESCE(v_split_elem->>'notes', ''),
        COALESCE((v_split_elem->>'amount')::numeric, 0),
        COALESCE((v_split_elem->>'items_count')::integer, 1),
        COALESCE((v_split_elem->>'sqm')::numeric, 0),
        'pending',
        v_split_elem->>'idempotency_key',
        COALESCE(p_order->>'currency', 'USD'),
        v_exchange_rate,
        CASE 
          WHEN p_order->>'contract_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          THEN (p_order->>'contract_id')::uuid 
          ELSE NULL 
        END,
        v_order_id
      )
      RETURNING id INTO v_sub_order_id;

      IF v_split_elem->'items' IS NOT NULL AND jsonb_array_length(v_split_elem->'items') > 0 THEN
        INSERT INTO public.order_items (
          order_id,
          product_id,
          product_name,
          size,
          sku,
          warehouse,
          warehouse_id,
          price,
          quantity
        )
        SELECT
          v_sub_order_id,
          COALESCE(s_elem->>'product_id', s_elem->>'productId', s_elem->>'sku', ''),
          COALESCE(s_elem->>'product_name', s_elem->>'sku', 'Ковровое изделие'),
          COALESCE(s_elem->>'size', 'Стандарт'),
          COALESCE(s_elem->>'sku', ''),
          COALESCE(v_split_elem->>'warehouse', 'Основной Склад Астана'),
          COALESCE((s_elem->>'warehouse_id')::integer, (v_split_elem->>'warehouse_id')::integer, 81),
          COALESCE((s_elem->>'price')::numeric, 0),
          COALESCE((s_elem->>'quantity')::integer, 1)
        FROM jsonb_array_elements(v_split_elem->'items') AS s_elem;
      END IF;

      v_created_sub_orders := v_created_sub_orders || jsonb_build_object(
        'doc_number', v_sub_doc_number,
        'warehouse', v_split_elem->>'warehouse',
        'sub_order_id', v_sub_order_id,
        'amount', (v_split_elem->>'amount')::numeric,
        'items_count', (v_split_elem->>'items_count')::integer
      );

      v_split_counter := v_split_counter + 1;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'order_id', v_order_id,
    'order_number', v_order_number,
    'status', 'pending',
    'exchange_rate', v_exchange_rate,
    'split_orders', v_created_sub_orders,
    'sub_orders', v_created_sub_orders
  );
END;
$$;
