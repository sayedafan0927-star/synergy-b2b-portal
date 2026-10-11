-- Migration 20261011161000: High-Speed Trigram Catalog Search, Partial Stock Index & Chunk Stock Hashing

-- 1. Enable pg_trgm for sub-100ms typo-tolerant text searching
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 2. Partial index for instant filtering of items in stock across warehouses
CREATE INDEX IF NOT EXISTS idx_inventory_balances_positive_free
ON public.inventory_balances (warehouse_id, sku)
WHERE free_stock > 0;

-- 3. GIN Trigram index for catalog matrix searching (name, collection, category, manufacturer)
CREATE INDEX IF NOT EXISTS idx_products_search_trgm
ON public.products USING gin (
  (COALESCE(name, '') || ' ' || COALESCE(collection, '') || ' ' || COALESCE(category, '') || ' ' || COALESCE(manufacturer, '')) gin_trgm_ops
);

-- 4. High-performance chunk-based inventory checksum function (Reconciliation Speedup)
-- Calculates MD5 checksums of stock balances grouped by 3-character SKU prefixes.
-- Allows verifying tens of thousands of stock rows with ERP in sub-5ms without full data transfer.
CREATE OR REPLACE FUNCTION public.calculate_warehouse_stock_hashes(p_warehouse_id integer DEFAULT 81)
RETURNS TABLE (
  chunk_prefix text,
  item_count bigint,
  stock_checksum text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    SUBSTRING(sku FROM 1 FOR 3) AS chunk_prefix,
    COUNT(*)::bigint AS item_count,
    MD5(STRING_AGG(sku || ':' || free_stock::text || ':' || reserved_stock::text, ',' ORDER BY sku ASC)) AS stock_checksum
  FROM public.inventory_balances
  WHERE warehouse_id = p_warehouse_id
  GROUP BY SUBSTRING(sku FROM 1 FOR 3);
$$;

GRANT EXECUTE ON FUNCTION public.calculate_warehouse_stock_hashes(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.calculate_warehouse_stock_hashes(integer) TO authenticated;
