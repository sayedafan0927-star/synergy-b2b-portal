import type { Product } from '@/types';

/**
 * In-memory client-side product cache for zero-latency instant transitions.
 * Pre-populates product details when browsing catalog or hovering over cards.
 * Implements bounded eviction (max 2000 entries) to prevent OOM memory bloat on mobile.
 */
const MAX_CACHE_ENTRIES = 2000;
const memoryProductCache = new Map<string, Product>();

function trimCacheIfNeeded() {
  if (memoryProductCache.size > MAX_CACHE_ENTRIES) {
    const iterator = memoryProductCache.keys();
    for (let i = 0; i < 400; i++) {
      const next = iterator.next();
      if (next.done) break;
      memoryProductCache.delete(next.value);
    }
  }
}

export function cacheProduct(product: Product): void {
  if (!product || !product.id) return;
  trimCacheIfNeeded();

  const pId = String(product.id).trim().toLowerCase();
  memoryProductCache.set(pId, product);

  if (product.article) {
    memoryProductCache.set(String(product.article).trim().toLowerCase(), product);
  }

  if (Array.isArray(product.variants)) {
    for (const v of product.variants) {
      if (v.id) memoryProductCache.set(String(v.id).trim().toLowerCase(), product);
      if (v.sku) memoryProductCache.set(String(v.sku).trim().toLowerCase(), product);
      if (v.barcode) memoryProductCache.set(String(v.barcode).trim().toLowerCase(), product);
      if (v.article) memoryProductCache.set(String(v.article).trim().toLowerCase(), product);
    }
  }
}

export function cacheProducts(products: Product[]): void {
  if (!Array.isArray(products)) return;
  for (const p of products) {
    cacheProduct(p);
  }
}

export function getCachedProduct(id: string): Product | null {
  if (!id) return null;
  const clean = decodeURIComponent(String(id)).trim().toLowerCase();
  const found = memoryProductCache.get(clean);
  if (found) {
    // Re-insert to refresh LRU order
    memoryProductCache.delete(clean);
    memoryProductCache.set(clean, found);
    return found;
  }
  return null;
}
