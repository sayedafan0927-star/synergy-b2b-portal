-- Migration 20260929100000: Enterprise Scale, Atomic Stock Reservation, Dynamic Discounts, Commission Stock

-- 1. T-20: Soft Foreign Key from order_items to products
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_order_items_product'
  ) THEN
    ALTER TABLE order_items ADD CONSTRAINT fk_order_items_product
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
      NOT VALID;
  END IF;
END $$;

-- 2. T-24: Atomic Stock Reservation with SELECT FOR UPDATE row locking
CREATE OR REPLACE FUNCTION reserve_stock(
  p_sku text,
  p_qty integer,
  p_warehouse_id integer DEFAULT 1
)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE
  v_available integer;
BEGIN
  -- Row-level exclusive lock prevents race conditions and overselling
  SELECT free_stock INTO v_available
  FROM inventory_balances
  WHERE sku = p_sku AND warehouse_id = p_warehouse_id
  FOR UPDATE;

  IF v_available IS NOT NULL AND v_available >= p_qty THEN
    UPDATE inventory_balances
    SET free_stock = free_stock - p_qty,
        reserved_stock = reserved_stock + p_qty,
        updated_at = now()
    WHERE sku = p_sku AND warehouse_id = p_warehouse_id;
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

-- Release stock reservation
CREATE OR REPLACE FUNCTION release_stock(
  p_sku text,
  p_qty integer,
  p_warehouse_id integer DEFAULT 1
)
RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  UPDATE inventory_balances
  SET free_stock = free_stock + p_qty,
      reserved_stock = GREATEST(0, reserved_stock - p_qty),
      updated_at = now()
  WHERE sku = p_sku AND warehouse_id = p_warehouse_id;
  RETURN true;
END;
$$;

-- 3. T-25: Dynamic Discount Rules in Database
CREATE TABLE IF NOT EXISTS discount_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  price_type_id text NOT NULL,
  discount_percent numeric NOT NULL CHECK (discount_percent >= 0 AND discount_percent <= 100),
  category text,
  min_order_amount numeric DEFAULT 0,
  valid_from timestamptz DEFAULT now(),
  valid_to timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_discount_rules_lookup ON discount_rules(price_type_id, is_active);

ALTER TABLE discount_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_select_discount_rules" ON discount_rules;
CREATE POLICY "auth_select_discount_rules" ON discount_rules FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "admin_all_discount_rules" ON discount_rules;
CREATE POLICY "admin_all_discount_rules" ON discount_rules FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- 4. T-26: Commission and Consignment Stock (Забалансовый учёт и остатки в пути)
CREATE TABLE IF NOT EXISTS commission_stock (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku text NOT NULL,
  warehouse_id integer NOT NULL DEFAULT 81,
  consignor_id text NOT NULL,
  quantity integer NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  currency text NOT NULL DEFAULT 'USD',
  consignment_price numeric NOT NULL DEFAULT 0,
  in_transit_qty integer NOT NULL DEFAULT 0,
  eta_date timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_commission_stock_sku ON commission_stock(sku);
CREATE INDEX IF NOT EXISTS idx_commission_stock_consignor ON commission_stock(consignor_id);

ALTER TABLE commission_stock ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_select_commission_stock" ON commission_stock;
CREATE POLICY "auth_select_commission_stock" ON commission_stock FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "admin_all_commission_stock" ON commission_stock;
CREATE POLICY "admin_all_commission_stock" ON commission_stock FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
