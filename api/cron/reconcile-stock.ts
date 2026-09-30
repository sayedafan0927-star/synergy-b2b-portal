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

    // 2. Получение текущего локального кэша каталога и активных резервов
    const localCached = await getCachedCatalog('catalog_global');
    const localProducts = Array.isArray(localCached?.data?.products) ? localCached.data.products : [];

    // Загружаем текущие активные резервы из inventory_balances для защиты от затирания броней
    const localReservedMap = new Map<string, number>();
    if (supabase) {
      try {
        const { data: dbBalances } = await supabase
          .from('inventory_balances')
          .select('sku, stock_reserved')
          .gt('stock_reserved', 0)
          .limit(5000);
        if (dbBalances) {
          for (const b of dbBalances) {
            if (b.sku && Number(b.stock_reserved) > 0) {
              localReservedMap.set(String(b.sku).trim().toUpperCase(), Number(b.stock_reserved));
            }
          }
        }
      } catch (balErr) {
        console.warn('[Stock Reconciliation] Notice fetching db stock_reserved:', balErr);
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
    const driftedSkus: Array<{ sku: string; local: number; erp: number; reserved: number; diff: number }> = [];

    // 3. Сверка остатков по каждому SKU с учетом активных холдов (Zero Reservation Leak)
    for (const p of erpProducts) {
      for (const v of (p.variants || [])) {
        if (!v.sku) continue;
        const normSku = String(v.sku).trim().toUpperCase();
        const erpStock = Number(v.free_stock ?? v.stock ?? 0);
        const currentReserved = localReservedMap.get(normSku) || 0;
        
        // Ожидаемый свободный остаток: если на портале есть брони, они вычитаются из остатка 1С
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
          });
        }
      }
    }

    // 4. Обновление локального L2 кэша каталога и inventory_balances при наличии расхождений
    if (discrepanciesFixed > 0 || !localCached?.data) {
      if (erpProducts.length <= 50000) {
        await saveCachedCatalog(erpData, 'catalog_global');
      }

      // Пакетная синхронизация расхождений непосредственно в таблицу inventory_balances с сохранением резервов
      if (driftedSkus.length > 0) {
        try {
          const patchItems = driftedSkus.map(d => ({
            sku: d.sku,
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
        sample_drifted_skus: driftedSkus.slice(0, 20),
      },
    });

    return res.status(200).json({
      success: true,
      checked_products: erpProducts.length,
      discrepancies_fixed: discrepanciesFixed,
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
