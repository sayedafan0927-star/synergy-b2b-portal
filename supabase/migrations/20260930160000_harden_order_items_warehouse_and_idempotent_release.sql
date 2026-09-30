-- Migration 20260930160000: Harden order_items warehouse_id, idempotent reservation release, and safe UUID contract casting

-- 1. Add reservations_released flag to orders to guarantee idempotent inventory rollback
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'orders' AND column_name = 'reservations_released'
  ) THEN
    ALTER TABLE orders ADD COLUMN reservations_released boolean NOT NULL DEFAULT false;
    CREATE INDEX IF NOT EXISTS idx_orders_reservations_released ON orders(reservations_released);
  END IF;
END $$;

-- 2. Update create_order_atomic to insert warehouse_id and safely validate contract_id UUID format
CREATE OR REPLACE FUNCTION create_order_atomic(
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
BEGIN
  -- Извлекаем актуальный курс валюты из display_settings
  SELECT COALESCE(exchange_rate_usd_kzt, 520.0000)
  INTO v_exchange_rate
  FROM display_settings
  LIMIT 1;

  IF v_exchange_rate IS NULL OR v_exchange_rate <= 0 THEN
    v_exchange_rate := 520.0000;
  END IF;

  -- 1. Валидация и атомарное списание свободных остатков с блокировкой строк (FOR UPDATE)
  FOR v_item IN
    SELECT 
      (elem->>'sku')::text AS sku,
      SUM((elem->>'quantity')::integer) AS qty,
      COALESCE((elem->>'warehouse_id')::integer, 81) AS warehouse_id
    FROM jsonb_array_elements(p_items) AS elem
    GROUP BY (elem->>'sku')::text, COALESCE((elem->>'warehouse_id')::integer, 81)
  LOOP
    v_sku := v_item.sku;
    v_qty := v_item.qty;
    v_wh_id := v_item.warehouse_id;

    SELECT free_stock INTO v_available
    FROM inventory_balances
    WHERE sku = v_sku AND warehouse_id = v_wh_id
    FOR UPDATE;

    IF v_available IS NULL OR v_available < v_qty THEN
      RAISE EXCEPTION 'INSUFFICIENT_STOCK: SKU % on warehouse % has only % free items, requested %',
        v_sku, v_wh_id, COALESCE(v_available, 0), v_qty;
    END IF;

    UPDATE inventory_balances
    SET free_stock = free_stock - v_qty,
        reserved_stock = reserved_stock + v_qty,
        updated_at = now()
    WHERE sku = v_sku AND warehouse_id = v_wh_id;
  END LOOP;

  -- 2. Атомарная вставка мастер-заказа с сохранением точного курса валюты и безопасной проверкой UUID contract_id
  INSERT INTO orders (
    user_id,
    placed_by_id,
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
      WHEN p_order->>'contract_id' IS NOT NULL 
           AND p_order->>'contract_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN (p_order->>'contract_id')::uuid 
      ELSE NULL 
    END
  )
  RETURNING id, order_number INTO v_order_id, v_order_number;

  -- 3. Пакетная вставка позиций мастер-заказа с обязательным сохранением warehouse_id
  INSERT INTO order_items (
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

  -- 4. Обработка дочерних субордеров мультисклада (если переданы)
  IF p_split_orders IS NOT NULL AND jsonb_array_length(p_split_orders) > 0 THEN
    FOR v_split_elem IN SELECT * FROM jsonb_array_elements(p_split_orders)
    LOOP
      v_sub_doc_number := v_split_elem->>'doc_number';
      
      INSERT INTO orders (
        order_number,
        user_id,
        placed_by_id,
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
          WHEN p_order->>'contract_id' IS NOT NULL 
               AND p_order->>'contract_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          THEN (p_order->>'contract_id')::uuid 
          ELSE NULL 
        END,
        v_order_id
      )
      RETURNING id INTO v_sub_order_id;

      IF v_split_elem->'items' IS NOT NULL AND jsonb_array_length(v_split_elem->'items') > 0 THEN
        INSERT INTO order_items (
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
        'sub_order_id', v_sub_order_id
      );
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'order_id', v_order_id,
    'order_number', v_order_number,
    'status', 'pending',
    'exchange_rate', v_exchange_rate,
    'sub_orders', v_created_sub_orders
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION create_order_atomic(jsonb, jsonb, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION create_order_atomic(jsonb, jsonb, jsonb) TO authenticated, service_role;

-- 3. Idempotent release_order_reservations: strictly avoids double-counting and multi-release
CREATE OR REPLACE FUNCTION release_order_reservations(p_order_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_item record;
  v_count integer := 0;
  v_is_already_released boolean;
BEGIN
  -- Проверяем, не были ли резервы уже высвобождены ранее
  SELECT COALESCE(reservations_released, false)
  INTO v_is_already_released
  FROM orders
  WHERE id = p_order_id;

  IF v_is_already_released IS TRUE THEN
    RETURN 0;
  END IF;

  -- Высвобождаем остатки строго по позициям переданного заказа
  FOR v_item IN
    SELECT 
      oi.sku,
      SUM(oi.quantity)::integer AS qty,
      COALESCE(oi.warehouse_id, 81) AS warehouse_id
    FROM order_items oi
    WHERE oi.order_id = p_order_id
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

  -- Помечаем и сам заказ, и любые дочерние подзаказы мультисклада как освобожденные
  UPDATE orders
  SET reservations_released = true,
      updated_at = now()
  WHERE id = p_order_id OR parent_order_id = p_order_id;

  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION release_order_reservations(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION release_order_reservations(uuid) TO authenticated, service_role;

-- 4. Update cancel_expired_order_holds to cascade cancellation to child suborders
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
      AND parent_order_id IS NULL
      AND (
        (hold_expires_at IS NOT NULL AND hold_expires_at <= now())
        OR (hold_expires_at IS NULL AND created_at <= now() - INTERVAL '24 hours')
      )
    ORDER BY created_at ASC
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  LOOP
    -- Высвобождаем остатки для мастер-заказа
    PERFORM release_order_reservations(r.id);

    -- Каскадно отменяем дочерние подзаказы мультисклада
    UPDATE orders
    SET 
      status = 'cancelled',
      notes = TRIM(COALESCE(notes, '') || ' [Auto-cancelled: Master reservation hold TTL expired (24h)]'),
      updated_at = now()
    WHERE parent_order_id = r.id;

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

REVOKE EXECUTE ON FUNCTION cancel_expired_order_holds(integer) FROM anon;
GRANT EXECUTE ON FUNCTION cancel_expired_order_holds(integer) TO authenticated, service_role;
