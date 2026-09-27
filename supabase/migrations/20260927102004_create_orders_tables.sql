/*
# Create orders and order_items tables

1. New Tables
  - `orders`
    - `id` (uuid, PK)
    - `order_number` (text, unique, human-readable order number like ORD-2025-0001)
    - `user_id` (uuid, FK to profiles — who the order belongs to)
    - `placed_by_id` (uuid, FK to profiles — who actually placed it, for impersonation)
    - `status` (text: draft, pending, processing, shipped, delivered, cancelled)
    - `warehouse` (text)
    - `notes` (text)
    - `total_amount` (numeric)
    - `total_sqm` (numeric)
    - `total_items` (integer)
    - `created_at`, `updated_at`

  - `order_items`
    - `id` (uuid, PK)
    - `order_id` (uuid, FK to orders)
    - `product_id` (text, ERP product ID)
    - `product_name` (text)
    - `collection` (text)
    - `size` (text)
    - `sku` (text)
    - `warehouse` (text)
    - `price` (numeric)
    - `quantity` (integer)
    - `created_at`

2. Security
  - RLS on both tables.
  - Admins see all orders. Managers see orders of their clients. Users see own orders.
  - Users can insert orders for themselves. Admins/managers can insert for any visible user.
  - Order items follow parent order access.

3. Notes
  - `placed_by_id` tracks admin/manager impersonation: if an admin creates an order
    on behalf of client X, user_id=X and placed_by_id=admin.
  - Auto-generated order number via sequence.
*/

-- Sequence for order numbers
CREATE SEQUENCE IF NOT EXISTS order_number_seq START 1;

CREATE OR REPLACE FUNCTION generate_order_number()
RETURNS text
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN 'ORD-' || EXTRACT(YEAR FROM now())::text || '-' || LPAD(nextval('order_number_seq')::text, 4, '0');
END;
$$;

CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number text UNIQUE NOT NULL DEFAULT generate_order_number(),
  user_id uuid NOT NULL REFERENCES profiles(id),
  placed_by_id uuid NOT NULL DEFAULT auth.uid() REFERENCES profiles(id),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('draft', 'pending', 'processing', 'shipped', 'delivered', 'cancelled')),
  warehouse text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  total_amount numeric NOT NULL DEFAULT 0,
  total_sqm numeric NOT NULL DEFAULT 0,
  total_items integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_placed_by_id ON orders(placed_by_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

CREATE TABLE IF NOT EXISTS order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id text NOT NULL DEFAULT '',
  product_name text NOT NULL,
  collection text NOT NULL DEFAULT '',
  size text NOT NULL,
  sku text NOT NULL DEFAULT '',
  warehouse text NOT NULL DEFAULT '',
  price numeric NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);

-- RLS on orders
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "orders_select" ON orders;
CREATE POLICY "orders_select" ON orders FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR placed_by_id = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
    OR EXISTS (
      SELECT 1 FROM profiles client
      JOIN profiles mgr ON mgr.id = auth.uid()
      WHERE client.id = orders.user_id
        AND client.manager_id = mgr.id
        AND mgr.role IN ('manager_rm', 'manager_lm')
    )
  );

DROP POLICY IF EXISTS "orders_insert" ON orders;
CREATE POLICY "orders_insert" ON orders FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
    OR EXISTS (
      SELECT 1 FROM profiles client
      JOIN profiles mgr ON mgr.id = auth.uid()
      WHERE client.id = orders.user_id
        AND client.manager_id = mgr.id
        AND mgr.role IN ('manager_rm', 'manager_lm')
    )
  );

DROP POLICY IF EXISTS "orders_update" ON orders;
CREATE POLICY "orders_update" ON orders FOR UPDATE
  TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  )
  WITH CHECK (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  );

DROP POLICY IF EXISTS "orders_delete" ON orders;
CREATE POLICY "orders_delete" ON orders FOR DELETE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  );

-- RLS on order_items (follows parent order access)
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "order_items_select" ON order_items;
CREATE POLICY "order_items_select" ON order_items FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = order_items.order_id
        AND (
          o.user_id = auth.uid()
          OR o.placed_by_id = auth.uid()
          OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
          OR EXISTS (
            SELECT 1 FROM profiles client
            JOIN profiles mgr ON mgr.id = auth.uid()
            WHERE client.id = o.user_id
              AND client.manager_id = mgr.id
              AND mgr.role IN ('manager_rm', 'manager_lm')
          )
        )
    )
  );

DROP POLICY IF EXISTS "order_items_insert" ON order_items;
CREATE POLICY "order_items_insert" ON order_items FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = order_items.order_id
        AND (
          o.user_id = auth.uid()
          OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
          OR EXISTS (
            SELECT 1 FROM profiles client
            JOIN profiles mgr ON mgr.id = auth.uid()
            WHERE client.id = o.user_id
              AND client.manager_id = mgr.id
              AND mgr.role IN ('manager_rm', 'manager_lm')
          )
        )
    )
  );

DROP POLICY IF EXISTS "order_items_update" ON order_items;
CREATE POLICY "order_items_update" ON order_items FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = order_items.order_id
        AND (
          o.user_id = auth.uid()
          OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = order_items.order_id
        AND (
          o.user_id = auth.uid()
          OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
        )
    )
  );

DROP POLICY IF EXISTS "order_items_delete" ON order_items;
CREATE POLICY "order_items_delete" ON order_items FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = order_items.order_id
        AND EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
    )
  );
