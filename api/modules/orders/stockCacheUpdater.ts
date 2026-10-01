/**
 * Zero Post-Checkout Stale Gap: Immediate Catalog Cache Stock Decrement
 * Keeps catalog stock in RAM, Redis, and DB synchronized immediately upon checkout.
 */

import { getCachedCatalog, saveCachedCatalog } from '../../lib/catalogCache';
import { logger } from '../../lib/logger';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface ReservedStockItemInput {
  sku: string;
  qty: number;
  whId?: number;
}

/**
 * Декремент остатков в кэше каталога сразу после успешного оформления заказа.
 * Устраняет разрыв (Post-Checkout Stale Gap), когда витрина показывает старый остаток.
 */
export async function decrementCachedCatalogStock(
  reservedItems: ReservedStockItemInput[],
  cacheKey = 'catalog_global',
  supabase?: SupabaseClient | null
): Promise<boolean> {
  if (!Array.isArray(reservedItems) || reservedItems.length === 0) return false;

  try {
    const cached = await getCachedCatalog(cacheKey);
    if (!cached?.data?.products || !Array.isArray(cached.data.products)) return false;

    const decMap = new Map<string, number>();
    for (const it of reservedItems) {
      const s = String(it.sku || '').trim().toUpperCase();
      if (s && it.qty > 0) {
        decMap.set(s, (decMap.get(s) || 0) + it.qty);
        if (it.whId) {
          decMap.set(`${s}::${it.whId}`, (decMap.get(`${s}::${it.whId}`) || 0) + it.qty);
        }
      }
    }

    let modified = false;
    for (const p of cached.data.products) {
      if (!Array.isArray(p.variants)) continue;
      for (const v of p.variants) {
        const vSku = String(v.sku || '').trim().toUpperCase();
        const decTotal = decMap.get(vSku);
        if (decTotal && decTotal > 0) {
          modified = true;
          v.free_stock = Math.max(0, (v.free_stock ?? v.stock ?? 0) - decTotal);
          v.reserved_stock = (v.reserved_stock ?? 0) + decTotal;
          v.stock = v.free_stock;
          if (Array.isArray(v.warehouses)) {
            for (const w of v.warehouses) {
              const wId = Number(w.warehouse_id || 81);
              const wDec = decMap.get(`${vSku}::${wId}`) ?? decTotal;
              w.free_stock = Math.max(0, (w.free_stock ?? w.stock ?? 0) - wDec);
              w.reserved_stock = (w.reserved_stock ?? 0) + wDec;
              w.stock = w.free_stock;
            }
          }
        }
      }
    }

    if (modified) {
      await saveCachedCatalog(cached.data, cacheKey);

      // Realtime Broadcast во все подключенные браузеры дилеров
      if (supabase) {
        const channel = supabase.channel('portal_live_updates');
        channel.send({
          type: 'broadcast',
          event: 'stock_decremented_checkout',
          payload: {
            items: reservedItems,
            timestamp: new Date().toISOString(),
          },
        }).catch((e: any) => logger.debug('[StockCacheUpdater Broadcast Notice]', { error: e?.message }));
      }
      return true;
    }
  } catch (err) {
    logger.warn('[StockCacheUpdater] Error decrementing cached catalog stock:', err as Error);
  }
  return false;
}
