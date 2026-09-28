/*
# Enterprise WMS Reservation Hold TTL & Auto-Cancellation Migration
1. Schema Additions:
   - Add `hold_expires_at` column to `orders` table.
   - Add index on `(status, hold_expires_at)` for high-performance cron scans.

2. Automation Function:
   - `cancel_expired_order_holds(p_batch_size int)` to atomically cancel stale reservations (>24h).
*/

-- 1. Добавляем колонку времени истечения брони склада
ALTER TABLE orders 
ADD COLUMN IF NOT EXISTS hold_expires_at timestamptz;

-- 2. Индекс для мгновенного поиска просроченных заказов кроном
CREATE INDEX IF NOT EXISTS idx_orders_hold_expiry 
ON orders (status, hold_expires_at) 
WHERE status IN ('pending', 'draft');

-- 3. Атомарная функция отмены просроченных резервов
CREATE OR REPLACE FUNCTION cancel_expired_order_holds(p_batch_size integer DEFAULT 50)
RETURNS TABLE (
  cancelled_order_id uuid,
  cancelled_order_number text,
  user_id uuid,
  total_amount numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH expired_candidates AS (
    SELECT id
    FROM orders
    WHERE status = 'pending'
      AND (
        (hold_expires_at IS NOT NULL AND hold_expires_at <= now())
        OR (hold_expires_at IS NULL AND created_at <= now() - INTERVAL '24 hours')
      )
    ORDER BY created_at ASC
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  ),
  updated_orders AS (
    UPDATE orders o
    SET 
      status = 'cancelled',
      notes = TRIM(COALESCE(o.notes, '') || ' [Auto-cancelled: WMS reservation hold TTL expired (24h)]'),
      updated_at = now()
    FROM expired_candidates ec
    WHERE o.id = ec.id
    RETURNING o.id, o.order_number, o.user_id, o.total_amount
  )
  SELECT id, order_number, u.user_id, u.total_amount
  FROM updated_orders u;
END;
$$;
