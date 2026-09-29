-- Migration 20260929140000: Add parent_order_id for Multi-Warehouse Order Hierarchy & Cascade Rollback
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'orders') THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'orders' AND column_name = 'parent_order_id'
    ) THEN
      ALTER TABLE orders ADD COLUMN parent_order_id uuid REFERENCES orders(id) ON DELETE CASCADE;
      CREATE INDEX IF NOT EXISTS idx_orders_parent_order_id ON orders(parent_order_id);
    END IF;
  END IF;
END $$;
