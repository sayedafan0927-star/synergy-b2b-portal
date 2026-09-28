-- Migration: Add CHECK constraints on monetary and quantity columns
-- Prevents negative values in financial and inventory fields

-- Orders
ALTER TABLE orders ADD CONSTRAINT chk_orders_total_amount CHECK (total_amount >= 0);
ALTER TABLE orders ADD CONSTRAINT chk_orders_total_sqm CHECK (total_sqm >= 0);
ALTER TABLE orders ADD CONSTRAINT chk_orders_total_items CHECK (total_items >= 0);

-- Order Items
ALTER TABLE order_items ADD CONSTRAINT chk_order_items_price CHECK (price >= 0);

-- Profiles
ALTER TABLE profiles ADD CONSTRAINT chk_profiles_credit_limit CHECK (credit_limit_usd >= 0);
ALTER TABLE profiles ADD CONSTRAINT chk_profiles_delay_days CHECK (payment_delay_days >= 0);

-- Inventory Balances
ALTER TABLE inventory_balances ADD CONSTRAINT chk_inv_free_stock CHECK (free_stock >= 0);
ALTER TABLE inventory_balances ADD CONSTRAINT chk_inv_reserved_stock CHECK (reserved_stock >= 0);
ALTER TABLE inventory_balances ADD CONSTRAINT chk_inv_total_stock CHECK (total_stock >= 0);

-- Collection Prices (may already have it, use IF NOT EXISTS pattern)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'collection_prices_price_per_sqm_check'
  ) THEN
    ALTER TABLE collection_prices ADD CONSTRAINT chk_collection_prices_price CHECK (price_per_sqm >= 0);
  END IF;
END $$;

-- Partner Balances (balance CAN be negative - represents client debt, so no check)
-- Product Variants base_price
ALTER TABLE product_variants ADD CONSTRAINT chk_variants_base_price CHECK (base_price >= 0);
