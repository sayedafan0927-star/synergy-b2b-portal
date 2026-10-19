import type { SupabaseClient } from '@supabase/supabase-js';
import { patchCachedCatalogStock, invalidateCatalogCache } from '../../lib/catalogCache';
import { fetchUpstreamCatalogSingleflight } from '../../modules/catalog/catalogSingleflight';
import { recordAuditLog } from '../../audit/logs';

export async function handleStockChanged(
  payload: any,
  supabaseServer: SupabaseClient | null,
  eventId: string | undefined,
  timestamp: string,
  broadcastLiveUpdate: (event: string, payload: any) => Promise<void>,
) {
  const rawItems = Array.isArray(payload.items)
    ? payload.items
    : (payload.sku || payload.article || payload.code || payload.barcode ? [payload] : []);
  const items = rawItems.map((it: any) => ({
    ...it,
    sku: String(it.sku || it.article || it.code || it.barcode || '').trim(),
    article: String(it.article || it.sku || '').trim(),
    free_stock: Number(it.free_stock ?? it.stock ?? 0),
    reserved_stock: Number(it.reserved_stock ?? 0),
    total_stock: Number(it.total_stock ?? ((it.free_stock ?? 0) + (it.reserved_stock ?? 0))),
  }));

  console.log(`[Webhook ERP: stock_changed] Reason: ${payload.reason || 'manual'}, Updated items count: ${items.length}`);

  // Материализация в БД (inventory_balances) и инкрементальное обновление кэша каталога с версионированием
  const isForceSync = Boolean(payload.force_resync || payload.is_full_sync || payload.reason === 'inventory_audit');
  let rawVersion = payload.version_timestamp || (payload.timestamp ? new Date(payload.timestamp).getTime() : Date.now());
  const versionTimestamp = isForceSync ? Math.max(rawVersion, Date.now()) : rawVersion;
  let dbUpdated = 0;
  let cachePatched = false;
  try {
    const patchResult = await patchCachedCatalogStock(items, 'catalog_global', versionTimestamp);
    dbUpdated = patchResult.updatedInDb;
    cachePatched = patchResult.cachePatched;
  } catch (patchErr) {
    console.warn('[Webhook ERP] Error materializing stock updates:', patchErr);
  }

  // Сбрасываем локальный кэш портала и запускаем фоновый прогрев ТОЛЬКО если инкрементальный патч кэша не сработал (!cachePatched)
  if (!cachePatched) {
    try {
      await invalidateCatalogCache();
      const warmupPromise = fetchUpstreamCatalogSingleflight({
        forceRefresh: true,
        correlationId: eventId || `stock-changed-${Date.now()}`,
      }).catch(err => {
        console.warn('[Webhook ERP: stock_changed] Background catalog refresh=1 warmup notice:', err?.message);
      });

      const waitUntilFn = (globalThis as any).waitUntil;
      if (typeof waitUntilFn === 'function') {
        waitUntilFn(warmupPromise);
      }
    } catch (invErr) {
      console.warn('[Webhook ERP: stock_changed] Cache invalidation notice:', invErr);
    }
  }

  // Сквозная трансляция в Realtime-шину браузеров
  await broadcastLiveUpdate('stock_changed', {
    items,
    reason: payload.reason || 'manual',
    timestamp,
  });

  // Фиксация в журнале аудита интеграции
  await recordAuditLog({
    eventType: 'stock_changed_webhook',
    direction: 'inbound',
    status: 'success',
    source: 'ERP Stock Webhook',
    payload: {
      items_count: items.length,
      db_updated: dbUpdated,
      cache_patched: cachePatched,
      cache_invalidated: !cachePatched,
      reason: payload.reason || 'manual',
    },
  });

  return {
    success: true,
    event: 'stock_changed',
    event_id: eventId || payload.event_id,
    items_processed: items.length,
    items_saved_to_db: dbUpdated,
    catalog_cache_updated: cachePatched,
    catalog_cache_invalidated: !cachePatched,
    message: `Successfully processed stock update for ${items.length} item(s) (DB: ${dbUpdated}, Cache Patched: ${cachePatched}).`,
    processed_at: new Date().toISOString(),
  };
}
