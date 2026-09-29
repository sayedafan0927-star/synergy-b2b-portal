-- Migration 20260929160000: High-Load Atomic Checkout Transaction in PostgreSQL
-- Eliminates N+1 HTTP RPC roundtrips and provides Zero-Deadlock concurrency control.

CREATE OR REPLACE FUNCTION create_order_atomic(
  p_order jsonb,
  p_items jsonb,
  p_split_orders jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_sku text;
  v_qty integer;
  v_wh_id integer;
  v_available integer;
  v_order_id uuid;
  v_order_number text;
  v_split_elem jsonb;
  v_sub_order_id uuid;
  v_sub_doc_number text;
  v_created_sub_orders jsonb := '[]'::jsonb;
BEGIN
  -- 1. Сортировка SKU по алфавиту для гарантии защиты от дедлоков (Zero-Deadlock Invariant)
  -- Атомарная блокировка строк через SELECT FOR UPDATE
  FOR v_sku, v_qty, v_wh_id IN
    SELECT 
      (elem->>'sku')::text,
      SUM((elem->>'quantity')::integer)::integer,
      COALESCE((elem->>'warehouse_id')::integer, 81)
    FROM jsonb_array_elements(p_items) AS elem
    WHERE COALESCE(elem->>'sku', '') <> ''
    GROUP BY (elem->>'sku')::text, COALESCE((elem->>'warehouse_id')::integer, 81)
    ORDER BY (elem->>'sku')::text ASC
  LOOP
    SELECT free_stock INTO v_available
    FROM inventory_balances
    WHERE sku = v_sku AND warehouse_id = v_wh_id
    FOR UPDATE;

    IF v_available IS NULL OR v_available < v_qty THEN
      -- Мгновенный откат всей транзакции без необходимости внешних компенсирующих саг
      RAISE EXCEPTION 'INSUFFICIENT_STOCK: SKU "%" (доступно: %, запрошено: %)', 
        v_sku, COALESCE(v_available, 0), v_qty;
    END IF;

    -- Списание из свободного остатка и фиксация в резерв
    UPDATE inventory_balances
    SET free_stock = free_stock - v_qty,
        reserved_stock = reserved_stock + v_qty,
        updated_at = now()
    WHERE sku = v_sku AND warehouse_id = v_wh_id;
  END LOOP;

  -- 2. Атомарная вставка мастер-заказа
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
    CASE WHEN p_order->>'contract_id' IS NOT NULL AND p_order->>'contract_id' <> '' 
         THEN (p_order->>'contract_id')::uuid 
         ELSE NULL END
  )
  RETURNING id, order_number INTO v_order_id, v_order_number;

  -- 3. Пакетная вставка позиций мастер-заказа
  INSERT INTO order_items (
    order_id,
    product_id,
    product_name,
    size,
    sku,
    warehouse,
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
        CASE WHEN p_order->>'contract_id' IS NOT NULL AND p_order->>'contract_id' <> '' 
             THEN (p_order->>'contract_id')::uuid 
             ELSE NULL END,
        v_order_id
      )
      RETURNING id INTO v_sub_order_id;

      -- Вставка позиций субордера
      IF v_split_elem->'items' IS NOT NULL AND jsonb_array_length(v_split_elem->'items') > 0 THEN
        INSERT INTO order_items (
          order_id,
          product_id,
          product_name,
          size,
          sku,
          warehouse,
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
          COALESCE((s_elem->>'price')::numeric, 0),
          COALESCE((s_elem->>'quantity')::integer, 1)
        FROM jsonb_array_elements(v_split_elem->'items') AS s_elem;
      END IF;

      v_created_sub_orders := v_created_sub_orders || jsonb_build_object(
        'doc_number', v_sub_doc_number,
        'warehouse', v_split_elem->>'warehouse',
        'amount', (v_split_elem->>'amount')::numeric,
        'items_count', (v_split_elem->>'items_count')::integer
      );
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'order_id', v_order_id,
    'order_number', v_order_number,
    'split_orders', v_created_sub_orders
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION create_order_atomic(jsonb, jsonb, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION create_order_atomic(jsonb, jsonb, jsonb) TO authenticated, service_role;
