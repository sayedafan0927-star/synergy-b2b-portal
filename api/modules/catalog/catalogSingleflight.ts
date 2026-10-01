/**
 * Enterprise Singleflight & Stale-While-Revalidate Upstream Catalog Fetcher
 * Prevents Cache Stampede (Dog-piling) and protects 1C:ERP from peak-hour concurrency DoS.
 */

import { checkCircuit, recordSuccess, recordFailure } from '../../lib/circuitBreaker';
import { getCachedCatalog, saveCachedCatalog } from '../../lib/catalogCache';
import { normalizeErpDesigns } from '../erp/upstreamProxy';
import { getErpApiKey } from '../../lib/erpKey';
import { logger } from '../../lib/logger';

export interface FetchCatalogSingleflightOptions {
  targetErpUrl?: string;
  fallbackErpUrl?: string;
  serverErpKey?: string;
  correlationId?: string;
  forceRefresh?: boolean;
}

const upstreamCatalogInFlight = new Map<string, Promise<any>>();

/**
 * Выполняет сетевой запрос к 1C:ERP для получения каталога с защитой Singleflight.
 * Если уже выполняется идентичный запрос к ERP, все параллельные вызовы ожидают один промис.
 */
export async function fetchUpstreamCatalogSingleflight(
  options: FetchCatalogSingleflightOptions = {}
): Promise<any> {
  const targetErpUrl = options.targetErpUrl || process.env.ERP_API_URL || 'https://kilem-khan.kz/api/sin/public/api_portal.php';
  const fallbackErpUrl = options.fallbackErpUrl || process.env.ERP_FALLBACK_URL || 'https://crm.kilem-khan.kz/api_portal.php';
  const serverErpKey = options.serverErpKey || getErpApiKey();
  const correlationId = options.correlationId || `singleflight-${Date.now()}`;

  const inFlightKey = `catalog:${targetErpUrl}`;

  // 1. Singleflight Deduplication: если запрос уже летит в 1С, переиспользуем его
  const existingPromise = upstreamCatalogInFlight.get(inFlightKey);
  if (existingPromise) {
    logger.info('[Catalog Singleflight] Concurrent request coalesced into existing upstream fetch', {
      key: inFlightKey,
      correlationId,
    });
    return existingPromise;
  }

  // 2. Создаем единственный запрос к 1C:ERP
  const fetchPromise = (async () => {
    // 2.1. Circuit Breaker Guard
    const circuit = await checkCircuit('erp_gateway');
    if (!circuit.permitted) {
      logger.warn('[Catalog Singleflight] Circuit OPEN for erp_gateway. Serving stale cache fallback', { correlationId });
      const stale = await getCachedCatalog('catalog_global');
      if (stale?.data) {
        return stale.data;
      }
      throw new Error('Шлюз 1C:ERP временно недоступен (Circuit Breaker OPEN), а локальный кэш пуст.');
    }

    const headers: Record<string, string> = {
      Accept: 'application/json',
      'X-Correlation-ID': correlationId,
    };
    if (serverErpKey) {
      headers['X-Portal-Key'] = serverErpKey;
    }

    const effectiveTimeoutMs = 8500;
    async function sendFetch(url: string, timeoutMs: number): Promise<Response> {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), timeoutMs);
      try {
        return await fetch(url, { headers, signal: controller.signal });
      } finally {
        clearTimeout(tid);
      }
    }

    let erpRes: Response | null = null;
    let textData = '';

    try {
      const primaryUrl = `${targetErpUrl}?action=catalog`;
      erpRes = await sendFetch(primaryUrl, effectiveTimeoutMs);
      const isHtml = (erpRes.headers.get('content-type') || '').includes('text/html');

      if ((erpRes.status >= 500 || isHtml) && fallbackErpUrl && fallbackErpUrl !== targetErpUrl) {
        logger.warn('[Catalog Singleflight] Primary returned error, switching to fallback ERP', {
          status: erpRes.status,
          correlationId,
        });
        const fallbackUrl = `${fallbackErpUrl}?action=catalog`;
        erpRes = await sendFetch(fallbackUrl, effectiveTimeoutMs);
      }
      textData = await erpRes.text();
    } catch (primaryErr: any) {
      if (fallbackErpUrl && fallbackErpUrl !== targetErpUrl) {
        logger.warn('[Catalog Singleflight] Primary network error, attempting fallback ERP', {
          error: primaryErr?.message,
          correlationId,
        });
        const fallbackUrl = `${fallbackErpUrl}?action=catalog`;
        erpRes = await sendFetch(fallbackUrl, effectiveTimeoutMs);
        textData = await erpRes.text();
      } else {
        await recordFailure('erp_gateway');
        throw primaryErr;
      }
    }

    if (!erpRes || !erpRes.ok) {
      await recordFailure('erp_gateway');
      logger.warn('[Catalog Singleflight] ERP returned non-OK response', {
        status: erpRes?.status,
        correlationId,
      });
      // Fallback на устаревший кэш
      const stale = await getCachedCatalog('catalog_global');
      if (stale?.data) {
        return stale.data;
      }
      throw new Error(`1C:ERP вернула ошибку ${erpRes?.status || 'UNKNOWN'}`);
    }

    await recordSuccess('erp_gateway');

    let parsedJson: any = null;
    try {
      parsedJson = JSON.parse(textData);
    } catch (parseErr) {
      logger.error('[Catalog Singleflight] Failed to parse ERP JSON response', { correlationId });
      const stale = await getCachedCatalog('catalog_global');
      if (stale?.data) return stale.data;
      throw new Error('Некорректный JSON от шлюза 1C:ERP');
    }

    if (parsedJson?.success) {
      normalizeErpDesigns(parsedJson);
      // Асинхронно сохраняем в L1 Memory, L2 Redis и L2 PostgreSQL
      saveCachedCatalog(parsedJson, 'catalog_global').catch(e => {
        logger.warn('[Catalog Singleflight] Cache save warning:', e as Error);
      });
    }

    return parsedJson;
  })();

  upstreamCatalogInFlight.set(inFlightKey, fetchPromise);
  try {
    return await fetchPromise;
  } finally {
    upstreamCatalogInFlight.delete(inFlightKey);
  }
}
