import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://sjvvoxxwevwgziuxjvcy.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZmY2dscW5qaHl1Ynh1aGZ0cndvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDMwMzQ1MDUsImV4cCI6MjA1ODYxMDUwNX0.z0Vw3tJ4372iY-qC52dZ_Yl-kC46M25jH3_P9z3G30w';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Default cache TTL: 60 seconds for fresh HIT, after which background revalidation is encouraged
const CACHE_FRESH_TTL_MS = 60 * 1000;

// Level 1 In-Memory Cache (RAM) to handle micro-bursts and high concurrency
interface MemoryCacheEntry {
  data: any;
  cachedAt: number;
  version: number;
}
const memoryCache = new Map<string, MemoryCacheEntry>();

export interface CachedCatalogResult {
  data: any;
  ageMs: number;
  isFresh: boolean;
  version: number;
  source: 'memory' | 'database';
}

/**
 * Получить закэшированный снимок каталога (L1 RAM -> L2 Supabase DB)
 */
export async function getCachedCatalog(cacheKey = 'catalog_global'): Promise<CachedCatalogResult | null> {
  const now = Date.now();

  // 1. Проверяем L1 Memory Cache
  const mem = memoryCache.get(cacheKey);
  if (mem) {
    const ageMs = now - mem.cachedAt;
    return {
      data: mem.data,
      ageMs,
      isFresh: ageMs < CACHE_FRESH_TTL_MS,
      version: mem.version,
      source: 'memory',
    };
  }

  // 2. Проверяем L2 Database Staging Cache
  try {
    const { data: row, error } = await supabase
      .from('catalog_cache')
      .select('data, version, updated_at')
      .eq('cache_key', cacheKey)
      .maybeSingle();

    if (!error && row && row.data) {
      const updatedAtMs = new Date(row.updated_at).getTime();
      const ageMs = Math.max(0, now - updatedAtMs);
      const version = Number(row.version || 1);

      // Сохраняем в L1 Memory
      memoryCache.set(cacheKey, {
        data: row.data,
        cachedAt: updatedAtMs,
        version,
      });

      return {
        data: row.data,
        ageMs,
        isFresh: ageMs < CACHE_FRESH_TTL_MS,
        version,
        source: 'database',
      };
    }
  } catch (err) {
    console.warn('[CatalogCache] Error fetching from database cache:', err);
  }

  return null;
}

/**
 * Сохранить снимок каталога в Staging Cache (L1 + L2)
 */
export async function saveCachedCatalog(catalogData: any, cacheKey = 'catalog_global'): Promise<boolean> {
  if (!catalogData || typeof catalogData !== 'object') {
    return false;
  }

  const now = Date.now();
  const productsCount = Array.isArray(catalogData.products) ? catalogData.products.length : 0;
  const currentMem = memoryCache.get(cacheKey);
  const nextVersion = (currentMem?.version || 0) + 1;

  // Обновляем L1 Memory
  memoryCache.set(cacheKey, {
    data: catalogData,
    cachedAt: now,
    version: nextVersion,
  });

  // Асинхронно сохраняем в L2 DB
  try {
    const { error } = await supabase
      .from('catalog_cache')
      .upsert({
        cache_key: cacheKey,
        data: catalogData,
        products_count: productsCount,
        version: nextVersion,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'cache_key' });

    if (error) {
      console.warn('[CatalogCache] Database cache upsert failed:', error);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[CatalogCache] Exception saving to database cache:', err);
    return false;
  }
}

export interface StockItemUpdate {
  sku: string;
  article?: string;
  code?: string;
  free_stock?: number;
  reserved_stock?: number;
  total_stock?: number;
  warehouse_id?: number;
  warehouse_name?: string;
}

/**
 * Инкрементальное обновление остатков по вебхуку:
 * 1. Сохраняет остатки в таблицу inventory_balances
 * 2. Точечно обновляет существующий снимок каталога в catalog_cache и L1 memory
 */
export async function patchCachedCatalogStock(items: StockItemUpdate[], cacheKey = 'catalog_global'): Promise<{
  updatedInDb: number;
  cachePatched: boolean;
}> {
  if (!Array.isArray(items) || items.length === 0) {
    return { updatedInDb: 0, cachePatched: false };
  }

  const nowIso = new Date().toISOString();
  let updatedInDb = 0;

  // 1. Атомарный Upsert в inventory_balances
  try {
    const rows = items.map(it => {
      const sku = String(it.sku || it.article || it.code || '').trim();
      const free = Number(it.free_stock ?? 0);
      const reserved = Number(it.reserved_stock ?? 0);
      const total = Number(it.total_stock ?? (free + reserved));
      return {
        sku,
        warehouse_id: Number(it.warehouse_id || 0),
        warehouse_name: String(it.warehouse_name || 'Основной склад'),
        free_stock: free,
        reserved_stock: reserved,
        total_stock: total,
        updated_at: nowIso,
      };
    }).filter(r => r.sku.length > 0);

    if (rows.length > 0) {
      const { error } = await supabase
        .from('inventory_balances')
        .upsert(rows, { onConflict: 'sku,warehouse_id' });

      if (!error) {
        updatedInDb = rows.length;
      } else {
        console.warn('[CatalogCache] Error upserting inventory_balances:', error);
      }
    }
  } catch (dbErr) {
    console.warn('[CatalogCache] Exception in inventory_balances upsert:', dbErr);
  }

  // 2. Точечно патчим снимок каталога (L1 + L2)
  let cachePatched = false;
  const cached = await getCachedCatalog(cacheKey);

  if (cached && cached.data && Array.isArray(cached.data.products)) {
    const itemMap = new Map<string, StockItemUpdate>();
    for (const it of items) {
      const s = String(it.sku || it.article || it.code || '').trim().toUpperCase();
      if (s) itemMap.set(s, it);
    }

    let deltaTotalStock = 0;
    let deltaFreeStock = 0;
    let deltaReservedStock = 0;
    let anyProductModified = false;

    const updatedProducts = cached.data.products.map((prod: any) => {
      if (!Array.isArray(prod.variants)) return prod;
      let prodModified = false;

      const updatedVariants = prod.variants.map((v: any) => {
        const skuKey = String(v.sku || '').trim().toUpperCase();
        const artKey = String(v.article || '').trim().toUpperCase();
        const codeKey = String(v.code || '').trim().toUpperCase();

        const update = itemMap.get(skuKey) || itemMap.get(artKey) || itemMap.get(codeKey);
        if (update) {
          prodModified = true;
          anyProductModified = true;

          const newFree = Number(update.free_stock ?? update.total_stock ?? v.free_stock ?? 0);
          const newReserved = Number(update.reserved_stock ?? v.reserved_stock ?? 0);
          const newTotal = Number(update.total_stock ?? (newFree + newReserved));

          deltaFreeStock += (newFree - (v.free_stock || 0));
          deltaReservedStock += (newReserved - (v.reserved_stock || 0));
          deltaTotalStock += (newTotal - (v.total_stock || 0));

          return {
            ...v,
            free_stock: newFree,
            stock: newFree,
            reserved_stock: newReserved,
            total_stock: newTotal,
            warehouses: (v.warehouses || []).map((w: any) => {
              if (w.warehouse_id === 81 || w.is_hub || update.warehouse_id === w.warehouse_id) {
                return {
                  ...w,
                  stock: newFree,
                  free_stock: newFree,
                  reserved_stock: newReserved,
                  total_stock: newTotal,
                };
              }
              return w;
            }),
          };
        }
        return v;
      });

      return prodModified ? { ...prod, variants: updatedVariants } : prod;
    });

    if (anyProductModified) {
      const updatedCatalog = {
        ...cached.data,
        products: updatedProducts,
        summary: cached.data.summary ? {
          ...cached.data.summary,
          free_stock_qty: Math.max(0, (cached.data.summary.free_stock_qty || 0) + deltaFreeStock),
          reserved_stock_qty: Math.max(0, (cached.data.summary.reserved_stock_qty || 0) + deltaReservedStock),
          total_stock_qty: Math.max(0, (cached.data.summary.total_stock_qty || 0) + deltaTotalStock),
        } : cached.data.summary,
      };

      await saveCachedCatalog(updatedCatalog, cacheKey);
      cachePatched = true;
    }
  }

  return { updatedInDb, cachePatched };
}
