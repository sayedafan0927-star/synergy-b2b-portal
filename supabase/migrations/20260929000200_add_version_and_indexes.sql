-- Migration: Add version column for optimistic locking and missing high-performance indexes
-- Enhances concurrency safety and eliminates slow table scans

-- 1. Optimistic Locking (version columns)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE products ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;

-- 2. Missing High-Performance Indexes
-- Fast client order history lookup
CREATE INDEX IF NOT EXISTS idx_orders_user_created ON orders (user_id, created_at DESC);

-- SKU and Product ID lookups in order lines
CREATE INDEX IF NOT EXISTS idx_order_items_sku ON order_items (sku);
CREATE INDEX IF NOT EXISTS idx_order_items_product_id ON order_items (product_id);

-- Catalog filtering by collection, category, and factory supplier
CREATE INDEX IF NOT EXISTS idx_products_collection ON products (collection);
CREATE INDEX IF NOT EXISTS idx_products_category ON products (category);
CREATE INDEX IF NOT EXISTS idx_products_supplier ON products (supplier_id);

-- Warehouse stock lookup by city
CREATE INDEX IF NOT EXISTS idx_warehouse_stock_city ON warehouse_stock (city);

-- Contract price tier join performance
CREATE INDEX IF NOT EXISTS idx_collection_prices_type ON collection_prices (price_type_id);

-- Lead Kanban stage aggregation performance
CREATE INDEX IF NOT EXISTS idx_leads_kanban ON leads (kanban_stage);
