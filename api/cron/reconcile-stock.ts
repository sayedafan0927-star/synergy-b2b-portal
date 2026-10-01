import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { recordAuditLog } from '../audit/logs';
import { applyCorrelationId } from '../lib/trace';
import { applyCorsHeaders } from '../lib/cors';
import { saveCachedCatalog, getCachedCatalog, patchCachedCatalogStock } from '../lib/catalogCache';
import { getErpApiKey } from '../lib/erpKey';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
const CRON_SECRET = process.env.CRON_SECRET || process.env.PORTAL_SECRET_KEY || '';
const TARGET_ERP_URL = process.env.ERP_API_URL || process.env.VITE_ERP_API_URL || 'https://kilem-khan.kz/api/sin/public/api_portal.php';
const SERVER_ERP_KEY = getErpApiKey();

const supabase = (SUPABASE_URL && SUPABASE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })
  : null as any;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!applyCorsHeaders(req, res)) {
    return;
  }

  const correlationId = applyCorrelationId(req, res);

  // Авторизация крона
  const authHeader = req.headers['authorization'] || '';
  const cronKeyHeader = req.headers['x-cron-key'] || req.headers['x-portal-key'];
  const isAuthorized =
    (process.env.NODE_ENV !== 'production' && !CRON_SECRET) ||
    (CRON_SECRET && (cronKeyHeader === CRON_SECRET || authHeader === `Bearer ${CRON_SECRET}`));

  if (!isAuthorized) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized: Invalid or missing cron authorization token.',
    });
  }

  const startTime = Date.now();

  try {
    // 1. Загрузка каталога с остатками из ERP
    const erpUrl = `${TARGET_ERP_URL}?action=catalog`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    const erpRes = await fetch(erpUrl, {
      headers: {
        'X-Portal-Key': SERVER_ERP_KEY,
        'Accept': 'application/json',
        'X-Correlation-ID': correlationId,
      },
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    if (!erpRes.ok) {
      throw new Error(`ERP catalog fetch failed with status ${erpRes.status}`);
    }

    const erpData: any = await erpRes.json();
    const erpProducts = Array.isArray(erpData?.products) ? erpData.products : [];

    if (erpProducts.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No products received from ERP catalog.',
        checked_products: 0,
        discrepancies_fixed: 0,
        duration_ms: Date.now() - startTime,
      });
    }

    // 1.5. Self-Healing: Автоматическое освобождение зависших резервов отмененных/отклоненных заказов
    let selfHealedOrders = 0;
    if (supabase) {
      try {
        const { data: leakedOrders } = await supabase
          .from('orders')
          .select('id, order_number, status')
          .in('status', ['cancelled', 'rejected'])
          .or('reservations_released.is.null,reservations_released.eq.false')
          .limit(50);

        if (leakedOrders && leakedOrders.length > 0) {
          for (const lo of leakedOrders) {
            await supabase.rpc('release_order_reservations', { p_order_id: lo.id });
            await supabase
              .from('orders')
              .update({ reservations_released: true, updated_at: new Date().toISOString() })
              .eq('id', lo.id);
            selfHealedOrders++;
          }
          console.log(`[Stock Reconciliation] Self-healed ${selfHealedOrders} unreleased cancelled/rejected orders.`);
        }
      } catch (leakErr) {
        console.warn('[Stock Reconciliation] Notice self-healing leaked cancelled orders:', leakErr);
      }
    }

    // 1.6. Self-Healing: Автоматический перезапуск заказов из DLQ при подтвержденной доступности 1С
    let autoRetriedDlqCount = 0;
    if (supabase && erpProducts.length > 0) {
      try {
        const { data: transientDlqOrders } = await supabase
          .from('orders')
          .select('id, order_number, last_error, notes')
          .eq('status', 'failed_dlq')
          .not('last_error', 'ilike', '%[Fatal Business Error]%')
          .limit(10);

        if (transientDlqOrders && transientDlqOrders.length > 0) {
          for (const tOrder of transientDlqOrders) {
            const autoRetryMarker = (tOrder.notes || '').match(/\[DLQ_AUTO_RETRY_(\d+)\]/);
            const currentAutoRetries = autoRetryMarker ? parseInt(autoRetryMarker[1], 10) : 0;

            if (currentAutoRetries < 3) {
              const nextAuto = currentAutoRetries + 1;
              const newNotes = `${tOrder.notes || ''} [DLQ_AUTO_RETRY_${nextAuto} на ${new Date().toISOString()}]`.trim();
              
              await supabase
                .from('orders')
                .update({
                  status: 'pending',
                  retry_count: 0,
                  next_retry_at: new Date().toISOString(),
                  notes: newNotes,
                  updated_at: new Date().toISOString(),
                })
                .eq('id', tOrder.id);

              autoRetriedDlqCount++;
              console.log(`[Stock Reconciliation] Auto-recovered transient DLQ order ${tOrder.order_number} (attempt ${nextAuto}/3)`);
            }
          }
        }
      } catch (dlqRecoverErr) {
        console.warn('[Stock Reconciliation] Notice in DLQ auto-recovery:', dlqRecoverErr);
      }
    }

    // 2. Получение текущего локального кэша каталога и активных резервов
    const localCached = await getCachedCatalog('catalog_global');
    const localProducts = Array.isArray(localCached?.data?.products) ? localCached.data.products : [];

    // Загружаем текущие активные резервы из inventory_balances для защиты от затирания броней
    const localReservedMap = new Map<string, number>();
    let phantomReservationsFixed = 0;
    if (supabase) {
      try {
        // Подсчитываем реальные активные брони по заказам клиентов (Zero Ghost Reservation)
        const actualActiveOrderReservations = new Map<string, number>();
        const { data: activeOrderItems } = await supabase
          .from('order_items')
          .select('sku, quantity, warehouse_id, orders!inner(status, reservations_released)')
          .not('orders.status', 'in', '("cancelled","rejected","completed","delivered")')
          .or('reservations_released.is.null,reservations_released.eq.false', { foreignTable: 'orders' });

        if (activeOrderItems) {
          for (const item of activeOrderItems) {
            const sku = String(item.sku || '').trim().toUpperCase();
            const wh = Number(item.warehouse_id || 81);
            const qty = Number(item.quantity || 0);
            if (sku && qty > 0) {
              const key = `${sku}::${wh}`;
              actualActiveOrderReservations.set(key, (actualActiveOrderReservations.get(key) || 0) + qty);
              actualActiveOrderReservations.set(sku, (actualActiveOrderReservations.get(sku) || 0) + qty);
            }
          }
        }

        // Queries canonical .select('sku, reserved_stock') with warehouse granularity
        const { data: dbBalances, error: qErr } = await supabase
          .from('inventory_balances')
          .select('sku, reserved_stock, warehouse_id')
          .gt('reserved_stock', 0)
          .limit(5000);

        let activeBalances = (!qErr && dbBalances) ? dbBalances : null;
        if (!activeBalances) {
          const { data: fallbackBalances } = await supabase
            .from('inventory_balances')
            .select('sku, stock_reserved, warehouse_id')
            .gt('stock_reserved', 0)
            .limit(5000);
          activeBalances = fallbackBalances;
        }

        if (activeBalances) {
          for (const b of activeBalances) {
            const resStock = Number((b as any).reserved_stock ?? (b as any).stock_reserved ?? 0);
            if (b.sku && resStock > 0) {
              const skuUpper = String(b.sku).trim().toUpperCase();
              const bWh = Number(b.warehouse_id || 81);
              const key = `${skuUpper}::${bWh}`;

              // Self-Healing: устраняем фантомные резервы, не подтвержденные активными заказами
              const realReserved = actualActiveOrderReservations.get(key) || 0;
              const effectiveReserved = Math.min(resStock, realReserved);

              if (resStock > realReserved) {
                phantomReservationsFixed++;
                supabase
                  .from('inventory_balances')
                  .update({ reserved_stock: realReserved, updated_at: new Date().toISOString() })
                  .eq('sku', b.sku)
                  .eq('warehouse_id', bWh)
                  .then(() => {})
                  .catch(() => {});
              }

              // Точная привязка броней к конкретному складу (Zero Cross-Warehouse Contamination)
              localReservedMap.set(`${skuUpper}::${bWh}`, (localReservedMap.get(`${skuUpper}::${bWh}`) || 0) + effectiveReserved);
              localReservedMap.set(skuUpper, (localReservedMap.get(skuUpper) || 0) + effectiveReserved);
            }
          }
        }
      } catch (balErr) {
        console.warn('[Stock Reconciliation] Notice fetching db stock_reserved / reserved_stock:', balErr);
      }
    }

    // Построение карты локальных остатков: sku -> free_stock
    const localStockMap = new Map<string, number>();
    for (const p of localProducts) {
      for (const v of (p.variants || [])) {
        if (v.sku) {
          localStockMap.set(v.sku, Number(v.free_stock ?? v.stock ?? 0));
        }
      }
    }

    let discrepanciesFixed = 0;
    const driftedSkus: Array<{ sku: string; local: number; erp: number; reserved: number; diff: number; warehouse_id: number; warehouse_name: string }> = [];

    // 3. Сверка остатков по каждому SKU с учетом активных холдов (Zero Reservation Leak)
    for (const p of erpProducts) {
      for (const v of (p.variants || [])) {
        if (!v.sku) continue;
        const normSku = String(v.sku).trim().toUpperCase();
        const erpStock = Number(v.free_stock ?? v.stock ?? 0);

        const mainWh = (v.warehouses && v.warehouses.length > 0) ? v.warehouses[0] : null;
        const whId = Number(mainWh?.warehouse_id || v.warehouse_id || 81);
        const whName = String(mainWh?.warehouse_name || v.warehouse_name || v.warehouse || 'Основной склад Астана');

        // Точный расчет брони конкретного склада
        const currentReserved = localReservedMap.get(`${normSku}::${whId}`) ?? localReservedMap.get(normSku) ?? 0;
        
        // Ожидаемый свободный остаток: если на портале есть локальные брони склада, они вычитаются из остатка 1С
        const expectedFreeStock = Math.max(0, erpStock - currentReserved);
        const localStock = localStockMap.get(v.sku);

        if (localStock !== undefined && Math.abs(localStock - expectedFreeStock) > 0) {
          discrepanciesFixed++;
          driftedSkus.push({
            sku: v.sku,
            local: localStock,
            erp: expectedFreeStock,
            reserved: currentReserved,
            diff: expectedFreeStock - localStock,
            warehouse_id: whId,
            warehouse_name: whName,
          });
        }
      }
    }

    // 4. Обновление локального L2 кэша каталога и inventory_balances при наличии расхождений
    if (discrepanciesFixed > 0 || !localCached?.data) {
      if (erpProducts.length <= 50000) {
        await saveCachedCatalog(erpData, 'catalog_global');
      }

      // Пакетная синхронизация расхождений непосредственно в таблицу inventory_balances с сохранением складов и резервов
      if (driftedSkus.length > 0) {
        try {
          const patchItems = driftedSkus.map(d => ({
            sku: d.sku,
            warehouse_id: d.warehouse_id,
            warehouse_name: d.warehouse_name,
            free_stock: d.erp,
            reserved_stock: d.reserved,
            total_stock: d.erp + d.reserved,
          }));
          await patchCachedCatalogStock(patchItems, 'catalog_global');
        } catch (patchErr) {
          console.warn('[Stock Reconciliation] Direct inventory_balances patch notice:', patchErr);
        }
      }
    }

    // 5. Логирование результатов сверки в integration_audit_logs
    await recordAuditLog({
      eventType: 'reconcile_stock',
      direction: 'inbound',
      status: discrepanciesFixed > 0 ? 'warning' : 'success',
      statusCode: 200,
      latencyMs: Date.now() - startTime,
      source: 'Stock Reconciliation Cron',
      correlationId,
      payload: {
        total_products: erpProducts.length,
        discrepancies_count: discrepanciesFixed,
        self_healed_orders: selfHealedOrders,
        phantom_reservations_fixed: phantomReservationsFixed,
        auto_retried_dlq_count: autoRetriedDlqCount,
        sample_drifted_skus: driftedSkus.slice(0, 20),
      },
    });

    return res.status(200).json({
      success: true,
      checked_products: erpProducts.length,
      discrepancies_fixed: discrepanciesFixed,
      self_healed_orders: selfHealedOrders,
      phantom_reservations_fixed: phantomReservationsFixed,
      auto_retried_dlq_orders: autoRetriedDlqCount,
      sample_drifted: driftedSkus.slice(0, 10),
      duration_ms: Date.now() - startTime,
      correlation_id: correlationId,
    });
  } catch (err: any) {
    console.error('[Stock Reconciliation Cron Error]:', err);
    await recordAuditLog({
      eventType: 'reconcile_stock',
      direction: 'inbound',
      status: 'error',
      statusCode: 500,
      latencyMs: Date.now() - startTime,
      source: 'Stock Reconciliation Cron',
      errorMessage: err?.message,
      correlationId,
    });

    return res.status(500).json({
      success: false,
      error: 'Stock reconciliation failed',
      details: err?.message,
    });
  }
}
