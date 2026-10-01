-- Migration 20261001110000: P1 B2B Multi-Tenancy & Counterparty Scoping (partner_id in orders)
-- 1. Ensure partner_id column and index exist on orders table
-- 2. Update create_order_atomic to strictly populate partner_id for master and split orders
-- 3. Update orders_select and order_items_select RLS policies for tenant-wide company visibility (Director, Buyer, Accountant)

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS partner_id text;
CREATE INDEX IF NOT EXISTS idx_orders_partner_id ON public.orders(partner_id);

-- Hardened create_order_atomic with partner_id tenant scoping
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
  v_init_stock integer;
  v_partner_id text;
BEGIN
  -- 0. Защита от бесконечных блокировок и зависаний транзакции под нагрузкой
  PERFORM set_config('lock_timeout', '2000ms', true);
  PERFORM set_config('statement_timeout', '4000ms', true);

  -- 0.1. Проверка контекста вызова: если вызвано напрямую через PostgREST клиентом
  IF auth.uid() IS NOT NULL AND auth.role() <> 'service_role' THEN
    IF (p_order->>'user_id')::uuid <> auth.uid() THEN
      RAISE EXCEPTION 'Access Denied: BOLA violation detected in create_order_atomic';
    END IF;
  END IF;

  -- 0.2. Разрешение partner_id (из параметров заказа либо из привязанного профиля)
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

  -- 2. Валидация и атомарное списание свободных остатков с блокировкой строк (FOR UPDATE)
  -- Отсортировано по возрастанию артикула и склада для защиты от взаимных блокировок (Deadlocks)
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

    SELECT free_stock INTO v_available
    FROM public.inventory_balances
    WHERE sku = v_sku AND warehouse_id = v_wh_id
    FOR UPDATE;

    -- Ленивая инициализация: если строки еще нет в inventory_balances, проверяем product_variants
    IF v_available IS NULL THEN
      SELECT stock INTO v_init_stock
      FROM public.product_variants
      WHERE sku = v_sku
      LIMIT 1;

      IF v_init_stock IS NOT NULL AND v_init_stock >= v_qty THEN
        INSERT INTO public.inventory_balances (sku, warehouse_id, free_stock, reserved_stock, total_stock)
        VALUES (v_sku, v_wh_id, v_init_stock, 0, v_init_stock)
        ON CONFLICT (sku, warehouse_id) DO UPDATE SET updated_at = now();

        v_available := v_init_stock;
      END IF;
    END IF;

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

  -- 5. Вставка дочерних подзаказов мультисклада с сохранением partner_id
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
    'partner_id', v_partner_id,
    'exchange_rate', v_exchange_rate,
    'split_orders', v_created_sub_orders,
    'sub_orders', v_created_sub_orders
  );
END;
$$;

-- Revoke direct execution from anon/authenticated, grant exclusively to service_role
REVOKE EXECUTE ON FUNCTION public.create_order_atomic(jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_order_atomic(jsonb, jsonb, jsonb) TO service_role;

-- 6. Обновление политик RLS для заказов с поддержкой B2B Multi-Tenancy (tenant-wide scope)
DROP POLICY IF EXISTS "orders_select" ON public.orders;
CREATE POLICY "orders_select" ON public.orders FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR placed_by_id = auth.uid()
    OR (
      orders.partner_id IS NOT NULL 
      AND orders.partner_id = (SELECT partner_id FROM public.profiles WHERE id = auth.uid())
    )
    OR public.is_admin()
    OR (public.is_manager() AND EXISTS (
      SELECT 1 FROM public.profiles client
      WHERE (client.id = orders.user_id OR (orders.partner_id IS NOT NULL AND client.partner_id = orders.partner_id))
        AND client.manager_id = auth.uid()
    ))
  );

DROP POLICY IF EXISTS "order_items_select" ON public.order_items;
CREATE POLICY "order_items_select" ON public.order_items FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.orders o WHERE o.id = order_items.order_id
      AND (
        o.user_id = auth.uid()
        OR o.placed_by_id = auth.uid()
        OR (
          o.partner_id IS NOT NULL
          AND o.partner_id = (SELECT partner_id FROM public.profiles WHERE id = auth.uid())
        )
        OR public.is_admin()
        OR (public.is_manager() AND EXISTS (
          SELECT 1 FROM public.profiles client
          WHERE (client.id = o.user_id OR (o.partner_id IS NOT NULL AND client.partner_id = o.partner_id))
            AND client.manager_id = auth.uid()
        ))
      )
    )
  );
