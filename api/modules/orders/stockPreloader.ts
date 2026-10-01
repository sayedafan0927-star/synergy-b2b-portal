import type { SupabaseClient } from '@supabase/supabase-js';
import { getCachedCatalog } from '../../lib/catalogCache';
import { resolveWarehouseId, ValidatedItem } from '../../lib/pricingValidator';
import { logger } from '../../lib/logger';
import { getErpApiKey } from '../../lib/erpKey';

/**
 * Pre-seeds inventory_balances in PostgreSQL for the items in an order
 * to ensure that atomic reservations (create_order_atomic) have authoritative stock
 * from the ERP catalog instead of treating un-materialized rows as 0.
 */
export async function preloadInventoryBalancesForOrder(
  supabase: SupabaseClient,
  items: ValidatedItem[],
  correlationId?: string
): Promise<void> {
  if (!supabase || !Array.isArray(items) || items.length === 0) return;

  try {
    const uniqueSkus = Array.from(new Set(items.map(it => String(it.sku || '').trim()).filter(Boolean)));
    if (uniqueSkus.length === 0) return;

    // 1. Проверяем текущие остатки в БД inventory_balances
    const { data: existingRows } = await supabase
      .from('inventory_balances')
      .select('sku, warehouse_id, free_stock')
      .in('sku', uniqueSkus);

    const existingMap = new Map<string, number>();
    for (const row of (existingRows || [])) {
      existingMap.set(`${String(row.sku).toUpperCase()}::${row.warehouse_id}`, Number(row.free_stock || 0));
    }

    // 2. Находим позиции, которых нет в БД или у которых свободный остаток < запрошенного
    const itemsNeedingStock = items.filter(it => {
      const whId = resolveWarehouseId(it.warehouse_id, it.warehouse);
      const key = `${String(it.sku).toUpperCase()}::${whId}`;
      const existingStock = existingMap.get(key);
      return existingStock === undefined || existingStock < it.quantity;
    });

    if (itemsNeedingStock.length === 0) {
      return;
    }

    // 3. Подтягиваем актуальный снимок каталога из L1/L2 кэша
    let cachedCat = await getCachedCatalog('catalog_global');
    let products = Array.isArray(cachedCat?.data?.products) ? cachedCat.data.products : [];

    // Если кэш пуст, пробуем запросить ERP напрямую
    if (products.length === 0) {
      try {
        const erpUrl = (process.env.ERP_API_URL || 'https://kilem-khan.kz/api/sin/public/api_portal.php') + '?action=catalog';
        const erpKey = getErpApiKey();
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 6000);
        const res = await fetch(erpUrl, {
          headers: {
            Accept: 'application/json',
            'X-Portal-Key': erpKey,
            'X-Correlation-ID': correlationId || `preload-${Date.now()}`,
          },
          signal: controller.signal,
        }).finally(() => clearTimeout(timeout));

        if (res.ok) {
          const freshData = await res.json();
          if (Array.isArray(freshData?.products)) {
            products = freshData.products;
          }
        }
      } catch (erpErr) {
        logger.warn('[StockPreloader] Direct ERP catalog fallback warning:', erpErr as Error);
      }
    }

    const upsertRows: any[] = [];
    const nowIso = new Date().toISOString();
    const stateVer = Date.now();

    for (const item of itemsNeedingStock) {
      const targetSku = String(item.sku).trim().toUpperCase();
      const whId = resolveWarehouseId(item.warehouse_id, item.warehouse);
      const whName = item.warehouse || 'Основной Склад Астана';

      let actualFreeStock: number | null = null;
      let actualTotalStock: number | null = null;

      for (const p of products) {
        for (const v of (p.variants || [])) {
          const vSku = String(v.sku || '').trim().toUpperCase();
          if (vSku === targetSku) {
            const wh = (v.warehouses || []).find((w: any) => Number(w.warehouse_id) === whId);
            if (wh) {
              actualFreeStock = Number(wh.free_stock ?? wh.stock ?? 0);
              actualTotalStock = Number(wh.total_stock ?? wh.free_stock ?? 0);
            } else {
              actualFreeStock = Number(v.free_stock ?? v.stock ?? 0);
              actualTotalStock = Number(v.total_stock ?? v.free_stock ?? 0);
            }
            break;
          }
        }
        if (actualFreeStock !== null) break;
      }

      if (actualFreeStock !== null && actualFreeStock > 0) {
        upsertRows.push({
          sku: item.sku,
          warehouse_id: whId,
          warehouse_name: whName,
          free_stock: actualFreeStock,
          reserved_stock: 0,
          total_stock: actualTotalStock ?? actualFreeStock,
          state_version: stateVer,
          updated_at: nowIso,
        });
      }
    }

    if (upsertRows.length > 0) {
      const { error: upsertErr } = await supabase
        .from('inventory_balances')
        .upsert(upsertRows, { onConflict: 'sku,warehouse_id' });

      if (upsertErr) {
        logger.warn('[StockPreloader] Upsert notice:', { error: upsertErr.message, correlationId });
      } else {
        logger.info('[StockPreloader] Successfully pre-seeded inventory_balances from ERP catalog:', {
          count: upsertRows.length,
          skus: upsertRows.map(r => `${r.sku} (${r.free_stock} шт)`),
          correlationId,
        });
      }
    }
  } catch (err) {
    logger.warn('[StockPreloader] Notice during stock preloading:', { error: (err as Error)?.message, correlationId });
  }
}
