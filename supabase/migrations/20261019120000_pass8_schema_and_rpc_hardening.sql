-- Migration: 20261019120000_pass8_schema_and_rpc_hardening.sql
-- Pass 8 Schema Alignment, Foreign Key Decoupling & Preorder-Safe Reservation RPCs

-- 1. Add missing columns to public.profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS debt_usd numeric(15,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS overdue_days integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_blocked_for_orders boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_blocked_for_shipment boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS showroom_warehouse_id integer,
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS bin_iin text,
  ADD COLUMN IF NOT EXISTS payment_delay_days integer DEFAULT 0;

-- 2. Decouple rigid auth.users foreign keys for ERP-first accounts & manager IDs
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_id_fkey;
ALTER TABLE public.profiles ALTER COLUMN id SET DEFAULT gen_random_uuid();

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_manager_id_fkey;
ALTER TABLE public.profiles ALTER COLUMN manager_id TYPE text USING manager_id::text;

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_user_id_fkey;

-- 3. Ensure warehouse_id and is_preorder exist on public.order_items
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS warehouse_id integer DEFAULT 81;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS is_preorder boolean DEFAULT false;

-- 4. Ensure stock, price_per_sqm, and area_sqm exist on public.product_variants
ALTER TABLE public.product_variants
  ADD COLUMN IF NOT EXISTS stock integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS price_per_sqm numeric(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS area_sqm numeric(10,4) DEFAULT 1;

-- 5. Expand orders_status_check constraint on public.orders
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_status_check CHECK (
  status IN (
    'pending',
    'processing_sync',
    'waiting_approval',
    'confirmed',
    'partially_confirmed',
    'processing',
    'picking',
    'shipped',
    'delivered',
    'completed',
    'cancelled',
    'cancellation_pending',
    'rejected',
    'failed_dlq',
    'split_parent',
    'reserved'
  )
);

-- 6. Ensure public.defect_reports and public.leads tables exist
CREATE TABLE IF NOT EXISTS public.defect_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  defect_id text,
  act_number text,
  act_date text,
  supplier_id integer,
  supplier_name text DEFAULT 'Фабрика',
  article text DEFAULT '',
  collection text DEFAULT '',
  size text DEFAULT '',
  warehouse_id integer DEFAULT 81,
  warehouse_name text DEFAULT 'Основной Склад Астана',
  city text DEFAULT 'Астана',
  qty_pcs integer DEFAULT 1,
  area_sqm numeric(10,4) DEFAULT 0,
  defect_type text DEFAULT 'factory_defect',
  responsible_party text DEFAULT 'Фабрика-изготовитель',
  comment text,
  photo_urls jsonb DEFAULT '[]'::jsonb,
  status text DEFAULT 'inspecting',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_defect_reports_supplier_id ON public.defect_reports(supplier_id);
CREATE INDEX IF NOT EXISTS idx_defect_reports_status ON public.defect_reports(status);

CREATE TABLE IF NOT EXISTS public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text NOT NULL,
  company text,
  email text,
  message text,
  source text NOT NULL DEFAULT 'Форма заявки с сайта B2B',
  kanban_stage text NOT NULL DEFAULT 'Новые лиды',
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'in_progress', 'converted', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_leads_created_at ON public.leads(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_status ON public.leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_phone ON public.leads(phone);

-- 7. Harden release_order_reservations and fulfill_order_reservations (skip preorders + child updates)
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
  SELECT parent_order_id, COALESCE(reservations_released, false)
  INTO v_parent_id, v_is_already_released
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_is_already_released IS TRUE THEN
    RETURN 0;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.orders WHERE parent_order_id = p_order_id
  ) INTO v_has_children;

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
        AND COALESCE(oi.is_preorder, false) = false
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
    WHERE id = p_order_id;

    UPDATE public.orders
    SET reservations_released = true,
        updated_at = now()
    WHERE parent_order_id = p_order_id;
  ELSE
    FOR v_item IN
      SELECT 
        oi.sku,
        SUM(oi.quantity)::integer AS qty,
        COALESCE(oi.warehouse_id, 81) AS warehouse_id
      FROM public.order_items oi
      WHERE oi.order_id = p_order_id
        AND COALESCE(oi.is_preorder, false) = false
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

REVOKE EXECUTE ON FUNCTION public.release_order_reservations(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.release_order_reservations(uuid) TO authenticated, service_role;


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
  SELECT parent_order_id, COALESCE(reservations_released, false)
  INTO v_parent_id, v_is_already_fulfilled
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_is_already_fulfilled IS TRUE THEN
    RETURN 0;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.orders WHERE parent_order_id = p_order_id
  ) INTO v_has_children;

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
        AND COALESCE(oi.is_preorder, false) = false
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

    UPDATE public.orders
    SET reservations_released = true,
        updated_at = now()
    WHERE parent_order_id = p_order_id;
  ELSE
    FOR v_item IN
      SELECT 
        oi.sku,
        SUM(oi.quantity)::integer AS qty,
        COALESCE(oi.warehouse_id, 81) AS warehouse_id
      FROM public.order_items oi
      WHERE oi.order_id = p_order_id
        AND COALESCE(oi.is_preorder, false) = false
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
