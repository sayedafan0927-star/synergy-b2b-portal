/*
# Fix remaining RLS recursion in orders, order_items, partner_balances

All policies that do `EXISTS (SELECT 1 FROM profiles WHERE role = ...)` cause
infinite recursion because profiles has RLS enabled. Replace with calls to
the SECURITY DEFINER helpers is_admin() and is_manager() created in the
previous migration.
*/

-- orders
DROP POLICY IF EXISTS "orders_select" ON orders;
CREATE POLICY "orders_select" ON orders FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR placed_by_id = auth.uid()
    OR public.is_admin()
    OR (public.is_manager() AND EXISTS (
      SELECT 1 FROM profiles client
      WHERE client.id = orders.user_id AND client.manager_id = auth.uid()
    ))
  );

DROP POLICY IF EXISTS "orders_insert" ON orders;
CREATE POLICY "orders_insert" ON orders FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    OR public.is_admin()
    OR (public.is_manager() AND EXISTS (
      SELECT 1 FROM profiles client
      WHERE client.id = orders.user_id AND client.manager_id = auth.uid()
    ))
  );

DROP POLICY IF EXISTS "orders_update" ON orders;
CREATE POLICY "orders_update" ON orders FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid() OR public.is_admin())
  WITH CHECK (user_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "orders_delete" ON orders;
CREATE POLICY "orders_delete" ON orders FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- order_items
DROP POLICY IF EXISTS "order_items_select" ON order_items;
CREATE POLICY "order_items_select" ON order_items FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM orders o WHERE o.id = order_items.order_id
      AND (o.user_id = auth.uid() OR o.placed_by_id = auth.uid() OR public.is_admin()
        OR (public.is_manager() AND EXISTS (
          SELECT 1 FROM profiles client
          WHERE client.id = o.user_id AND client.manager_id = auth.uid()
        ))
      )
    )
  );

DROP POLICY IF EXISTS "order_items_insert" ON order_items;
CREATE POLICY "order_items_insert" ON order_items FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM orders o WHERE o.id = order_items.order_id
      AND (o.user_id = auth.uid() OR public.is_admin()
        OR (public.is_manager() AND EXISTS (
          SELECT 1 FROM profiles client
          WHERE client.id = o.user_id AND client.manager_id = auth.uid()
        ))
      )
    )
  );

DROP POLICY IF EXISTS "order_items_update" ON order_items;
CREATE POLICY "order_items_update" ON order_items FOR UPDATE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM orders o WHERE o.id = order_items.order_id
    AND (o.user_id = auth.uid() OR public.is_admin())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM orders o WHERE o.id = order_items.order_id
    AND (o.user_id = auth.uid() OR public.is_admin())
  ));

DROP POLICY IF EXISTS "order_items_delete" ON order_items;
CREATE POLICY "order_items_delete" ON order_items FOR DELETE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM orders o WHERE o.id = order_items.order_id
    AND public.is_admin()
  ));

-- partner_balances SELECT (the insert/update/delete were already fixed)
DROP POLICY IF EXISTS "partner_balances_select" ON partner_balances;
CREATE POLICY "partner_balances_select" ON partner_balances FOR SELECT
  TO authenticated
  USING (
    public.is_admin()
    OR EXISTS (
      SELECT 1 FROM profiles WHERE profiles.id = auth.uid()
      AND profiles.partner_id = partner_balances.partner_id
    )
    OR (public.is_manager() AND EXISTS (
      SELECT 1 FROM profiles client
      WHERE client.partner_id = partner_balances.partner_id
      AND client.manager_id = auth.uid()
    ))
  );
