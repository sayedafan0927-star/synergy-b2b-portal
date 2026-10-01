import { createClient } from '@supabase/supabase-js';
import { getRedisCatalogCache, setRedisCatalogCache, invalidateRedisCatalogCache } from './catalogDistributedCache';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

const supabase = (SUPABASE_URL && SUPABASE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })
  : null as any;

const CACHE_FRESH_TTL_MS = 60 * 1000;

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

const inFlightRequests = new Map<string, Promise<CachedCatalogResult | null>>();

/**
 * Получить закэшированный снимок каталога (L1 RAM -> Redis -> L2 Supabase DB)
 * Защищен Singleflight паттерном от Cache Stampede при конкурентных запросах.
 */
export async function getCachedCatalog(cacheKey = 'catalog_global'): Promise<CachedCatalogResult | null> {
  const now = Date.now();

  // 1. L1 Memory Cache (мгновенное чтение)
  const mem = memoryCache.get(cacheKey);
  if (mem) {
    const ageMs = now - mem.cachedAt;
    return { data: mem.data, ageMs, isFresh: ageMs < CACHE_FRESH_TTL_MS, version: mem.version, source: 'memory' };
  }

  // 2. Singleflight Deduplication — объединяем параллельные запросы к холодному кэшу
  const existingInFlight = inFlightRequests.get(cacheKey);
  if (existingInFlight) {
    return existingInFlight;
  }

  const lookupPromise = (async (): Promise<CachedCatalogResult | null> => {
    // 2.1. L2 Distributed Redis Cache
    const redisData = await getRedisCatalogCache(cacheKey);
    if (redisData) {
      memoryCache.set(cacheKey, { data: redisData, cachedAt: Date.now(), version: 1 });
      return { data: redisData, ageMs: 0, isFresh: true, version: 1, source: 'memory' };
    }

    // 2.2. L2 Database Staging Cache
    if (!supabase) return null;
    try {
      const { data: row, error } = await supabase
        .from('catalog_cache')
        .select('data, version, updated_at')
        .eq('cache_key', cacheKey)
        .maybeSingle();

      if (!error && row && row.data) {
        const updatedAtMs = new Date(row.updated_at).getTime();
        const ageMs = Math.max(0, Date.now() - updatedAtMs);
        const version = Number(row.version || 1);

        // Сохраняем в L1 Memory и асинхронно прогреваем L2 Redis
        memoryCache.set(cacheKey, {
          data: row.data,
          cachedAt: updatedAtMs,
          version,
        });
        setRedisCatalogCache(cacheKey, row.data).catch(() => {});

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
  })();

  inFlightRequests.set(cacheKey, lookupPromise);
  try {
    return await lookupPromise;
  } finally {
    inFlightRequests.delete(cacheKey);
  }
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

  // Обновляем L1 Memory и асинхронно L2 Redis
  memoryCache.set(cacheKey, { data: catalogData, cachedAt: now, version: nextVersion });
  setRedisCatalogCache(cacheKey, catalogData).catch(() => {});

  // Асинхронно сохраняем в L2 DB
  if (!supabase) return true;
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
 * 1. Защищает от Out-of-Order перезаписи устаревшими пакетами (CDC Versioning)
 * 2. Сохраняет остатки в таблицу inventory_balances
 * 3. Точечно обновляет существующий снимок каталога в catalog_cache и L1 memory
 */
export async function patchCachedCatalogStock(
  items: StockItemUpdate[],
  cacheKey = 'catalog_global',
  versionTimestamp?: number | string
): Promise<{
  updatedInDb: number;
  cachePatched: boolean;
}> {
  if (!Array.isArray(items) || items.length === 0) {
    return { updatedInDb: 0, cachePatched: false };
  }

  const nowIso = new Date().toISOString();
  const incomingVersion = versionTimestamp ? Number(versionTimestamp) : Date.now();
  let updatedInDb = 0;

  // 1. Атомарный Upsert в inventory_balances с защитой от Out-of-Order версий
  try {
    const rawRows = items.map(it => {
      const sku = String(it.sku || it.article || it.code || '').trim();
      const free = Number(it.free_stock ?? 0);
      const reserved = Number(it.reserved_stock ?? 0);
      const total = Number(it.total_stock ?? (free + reserved));
      const rawWhId = Number(it.warehouse_id || 0);
      const whName = String(it.warehouse_name || (it as any).warehouse || 'Основной склад Астана');
      let effectiveWhId = rawWhId;
      if (effectiveWhId <= 0) {
        const wLow = whName.toLowerCase();
        if (wLow.includes('алматы')) effectiveWhId = 82;
        else if (wLow.includes('шымкент')) effectiveWhId = 83;
        else effectiveWhId = 81; // Дефолтный центральный склад Астана
      }
      return {
        sku,
        warehouse_id: effectiveWhId,
        warehouse_name: whName,
        free_stock: free,
        reserved_stock: reserved,
        total_stock: total,
        state_version: incomingVersion,
        updated_at: nowIso,
      };
    }).filter(r => r.sku.length > 0);

    if (rawRows.length > 0) {
      // Проверяем версии существующих записей в БД
      const skus = Array.from(new Set(rawRows.map(r => r.sku)));
      const { data: existingBalances } = await supabase
        .from('inventory_balances')
        .select('sku, warehouse_id, state_version')
        .in('sku', skus);

      const existingMap = new Map<string, number>();
      if (existingBalances) {
        for (const eb of existingBalances) {
          existingMap.set(`${eb.sku}::${eb.warehouse_id}`, Number(eb.state_version || 0));
        }
      }

      // Отбрасываем устаревшие или дублирующиеся строки (пришедшие не по порядку: version_timestamp <= db.state_version)
      const validRows = rawRows.filter(r => {
        const prevVer = existingMap.get(`${r.sku}::${r.warehouse_id}`);
        if (prevVer && prevVer >= r.state_version) {
          console.warn(`[CatalogCache] Out-of-order or duplicate webhook ignored for SKU ${r.sku} (incoming: ${r.state_version} <= db: ${prevVer})`);
          return false;
        }
        return true;
      });

      if (validRows.length > 0) {
        // Защита активных резервов: вычисляем объем броней в неотправленных/неподтвержденных заказах Outbox
        try {
          const { data: pendingItems } = await supabase
            .from('order_items')
            .select('sku, warehouse_id, quantity, orders!inner(status, reservations_released)')
            .in('orders.status', ['pending', 'processing_sync'])
            .or('reservations_released.is.null,reservations_released.eq.false', { foreignTable: 'orders' })
            .in('sku', skus);

          if (pendingItems && pendingItems.length > 0) {
            const pendingMap = new Map<string, number>();
            for (const pi of pendingItems) {
              const k = `${String(pi.sku).trim().toUpperCase()}::${Number(pi.warehouse_id || 81)}`;
              pendingMap.set(k, (pendingMap.get(k) || 0) + Number(pi.quantity || 0));
            }
            for (const r of validRows) {
              const k = `${r.sku.toUpperCase()}::${r.warehouse_id}`;
              const holdQty = pendingMap.get(k) || 0;
              if (holdQty > 0) {
                r.free_stock = Math.max(0, r.free_stock - holdQty);
                r.reserved_stock = Math.max(r.reserved_stock, holdQty);
              }
            }
          }
        } catch (holdErr) {
          console.warn('[CatalogCache] In-flight holds protection notice:', holdErr);
        }

        const { error } = await supabase
          .from('inventory_balances')
          .upsert(validRows, { onConflict: 'sku,warehouse_id' });

        if (!error) {
          updatedInDb = validRows.length;
        } else {
          console.warn('[CatalogCache] Error upserting inventory_balances:', error);
        }
      }
    }
  } catch (dbErr) {
    console.warn('[CatalogCache] Exception in inventory_balances upsert:', dbErr);
  }

  // 2. Точечно патчим снимок каталога (L1 + L2)
  let cachePatched = false;
  const cached = await getCachedCatalog(cacheKey);

  if (cached && cached.data && Array.isArray(cached.data.products)) {
    const skuUpdatesMap = new Map<string, StockItemUpdate[]>();
    for (const it of items) {
      const s = String(it.sku || it.article || it.code || '').trim().toUpperCase();
      if (s) {
        const list = skuUpdatesMap.get(s) || [];
        list.push(it);
        skuUpdatesMap.set(s, list);
      }
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

        const matchingUpdates = skuUpdatesMap.get(skuKey) || skuUpdatesMap.get(artKey) || skuUpdatesMap.get(codeKey);
        if (matchingUpdates && matchingUpdates.length > 0) {
          prodModified = true;
          anyProductModified = true;

          const existingWhs = Array.isArray(v.warehouses) ? [...v.warehouses] : [];
          const whUpdateMap = new Map<number, StockItemUpdate>();

          for (const u of matchingUpdates) {
            let uWhId = Number(u.warehouse_id || 0);
            if (uWhId <= 0) {
              const wLow = String(u.warehouse_name || (u as any).warehouse || '').toLowerCase();
              if (wLow.includes('алматы')) uWhId = 82;
              else if (wLow.includes('шымкент')) uWhId = 83;
              else uWhId = 81;
            }
            whUpdateMap.set(uWhId, u);
          }

          const updatedWarehouses = existingWhs.map((w: any) => {
            const u = whUpdateMap.get(Number(w.warehouse_id));
            if (u) {
              const wFree = Number(u.free_stock ?? u.total_stock ?? w.free_stock ?? 0);
              const wReserved = Number(u.reserved_stock ?? w.reserved_stock ?? 0);
              const wTotal = Number(u.total_stock ?? (wFree + wReserved));
              return {
                ...w,
                stock: wFree,
                free_stock: wFree,
                reserved_stock: wReserved,
                total_stock: wTotal,
              };
            }
            return w;
          });

          for (const [uWhId, u] of whUpdateMap.entries()) {
            if (!updatedWarehouses.some((w: any) => Number(w.warehouse_id) === uWhId)) {
              const wFree = Number(u.free_stock ?? u.total_stock ?? 0);
              const wReserved = Number(u.reserved_stock ?? 0);
              const wTotal = Number(u.total_stock ?? (wFree + wReserved));
              updatedWarehouses.push({
                warehouse_id: uWhId,
                warehouse_name: u.warehouse_name || (uWhId === 81 ? 'Основной Склад Астана' : (uWhId === 82 ? 'Склад Алматы' : 'Склад Шымкент')),
                stock: wFree,
                free_stock: wFree,
                reserved_stock: wReserved,
                total_stock: wTotal,
              });
            }
          }

          let newFree = 0;
          let newReserved = 0;
          let newTotal = 0;

          if (updatedWarehouses.length > 0) {
            newFree = updatedWarehouses.reduce((acc, w) => acc + (Number(w.free_stock) || 0), 0);
            newReserved = updatedWarehouses.reduce((acc, w) => acc + (Number(w.reserved_stock) || 0), 0);
            newTotal = updatedWarehouses.reduce((acc, w) => acc + (Number(w.total_stock) || 0), 0);
          } else {
            const firstU = matchingUpdates[0];
            newFree = Number(firstU.free_stock ?? firstU.total_stock ?? v.free_stock ?? 0);
            newReserved = Number(firstU.reserved_stock ?? v.reserved_stock ?? 0);
            newTotal = Number(firstU.total_stock ?? (newFree + newReserved));
          }

          deltaFreeStock += (newFree - (v.free_stock || 0));
          deltaReservedStock += (newReserved - (v.reserved_stock || 0));
          deltaTotalStock += (newTotal - (v.total_stock || 0));

          return {
            ...v,
            free_stock: newFree,
            stock: newFree,
            reserved_stock: newReserved,
            total_stock: newTotal,
            warehouses: updatedWarehouses,
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

/**
 * Инвалидация кэша каталога (L1 RAM + принудительный сброс)
 */
export async function invalidateCatalogCache(cacheKey?: string): Promise<void> {
  if (cacheKey) {
    memoryCache.delete(cacheKey);
    inFlightRequests.delete(cacheKey);
  } else {
    memoryCache.clear();
    inFlightRequests.clear();
  }
  await invalidateRedisCatalogCache(cacheKey);
}
