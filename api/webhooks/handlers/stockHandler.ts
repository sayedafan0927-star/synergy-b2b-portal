import type { SupabaseClient } from '@supabase/supabase-js';
import { patchCachedCatalogStock } from '../../lib/catalogCache';
import { recordAuditLog } from '../../audit/logs';

export async function handleStockChanged(
  payload: any,
  supabaseServer: SupabaseClient | null,
  eventId: string | undefined,
  timestamp: string,
  broadcastLiveUpdate: (event: string, payload: any) => Promise<void>,
) {
  const rawItems = Array.isArray(payload.items) ? payload.items : [];
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
  const versionTimestamp = payload.version_timestamp || (payload.timestamp ? new Date(payload.timestamp).getTime() : Date.now());
  let dbUpdated = 0;
  let cachePatched = false;
  try {
    const patchResult = await patchCachedCatalogStock(items, 'catalog_global', versionTimestamp);
    dbUpdated = patchResult.updatedInDb;
    cachePatched = patchResult.cachePatched;
  } catch (patchErr) {
    console.warn('[Webhook ERP] Error materializing stock updates:', patchErr);
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
    message: `Successfully processed stock update for ${items.length} item(s) (DB: ${dbUpdated}, Cache: ${cachePatched}).`,
    processed_at: new Date().toISOString(),
  };
}
