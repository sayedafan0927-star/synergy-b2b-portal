import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { recordAuditLog } from '../audit/logs';
import { applyCorrelationId } from '../lib/trace';
import { applyCorsHeaders } from '../lib/cors';
import { saveCachedCatalog, getCachedCatalog } from '../lib/catalogCache';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
const CRON_SECRET = process.env.CRON_SECRET || process.env.PORTAL_SECRET_KEY || '';
const TARGET_ERP_URL = process.env.ERP_API_URL || process.env.VITE_ERP_API_URL || 'https://kilem-khan.kz/api/sin/public/api_portal.php';
const SERVER_ERP_KEY = process.env.PORTAL_SECRET_KEY || process.env.ERP_API_KEY || '';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

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

    // 2. Получение текущего локального кэша каталога
    const localCached = await getCachedCatalog('catalog_global');
    const localProducts = Array.isArray(localCached?.data?.products) ? localCached.data.products : [];

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
    const driftedSkus: Array<{ sku: string; local: number; erp: number; diff: number }> = [];

    // 3. Сверка остатков по каждому SKU
    for (const p of erpProducts) {
      for (const v of (p.variants || [])) {
        if (!v.sku) continue;
        const erpStock = Number(v.free_stock ?? v.stock ?? 0);
        const localStock = localStockMap.get(v.sku);

        if (localStock !== undefined && Math.abs(localStock - erpStock) > 0) {
          discrepanciesFixed++;
          driftedSkus.push({
            sku: v.sku,
            local: localStock,
            erp: erpStock,
            diff: erpStock - localStock,
          });
        }
      }
    }

    // 4. Обновление локального L2 кэша каталога при наличии расхождений
    if (discrepanciesFixed > 0 || !localCached?.data) {
      await saveCachedCatalog(erpData, 'catalog_global');
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
