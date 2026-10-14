/**
 * Enterprise Singleflight & Stale-While-Revalidate Upstream Catalog Fetcher
 * Prevents Cache Stampede (Dog-piling) and protects 1C:ERP from peak-hour concurrency DoS.
 */

import { checkCircuit, recordSuccess, recordFailure } from '../../lib/circuitBreaker';
import { getCachedCatalog, saveCachedCatalog } from '../../lib/catalogCache';
import { normalizeErpDesigns } from '../erp/upstreamProxy';
import { getErpApiKey, getTargetErpUrl, getErpFallbackUrl } from '../../lib/erpKey';
import { logger } from '../../lib/logger';

export interface FetchCatalogSingleflightOptions {
  targetErpUrl?: string;
  fallbackErpUrl?: string;
  serverErpKey?: string;
  correlationId?: string;
  forceRefresh?: boolean;
  dealerId?: number | string;
}

const upstreamCatalogInFlight = new Map<string, Promise<any>>();

function buildErpCatalogUrl(baseUrl: string, options?: { dealerId?: number | string; forceRefresh?: boolean }): string {
  try {
    const url = new URL(baseUrl);
    url.searchParams.set('action', 'catalog');
    if (options?.dealerId) {
      url.searchParams.set('dealer_id', String(options.dealerId));
    }
    if (options?.forceRefresh) {
      url.searchParams.set('refresh', '1');
    }
    return url.toString();
  } catch {
    const params = new URLSearchParams({ action: 'catalog' });
    if (options?.dealerId) params.set('dealer_id', String(options.dealerId));
    if (options?.forceRefresh) params.set('refresh', '1');
    return `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}${params.toString()}`;
  }
}

/**
 * Прямой запрос каталога ERP с поддержкой Cache Bypass (?refresh=1) и заголовка X-Cache (HIT / MISS).
 */
export async function fetchErpCatalog(options?: { dealerId?: number | string; forceRefresh?: boolean }) {
  const baseUrl = getTargetErpUrl();
  const portalKey = getErpApiKey();
  const url = buildErpCatalogUrl(baseUrl, options);

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'X-Portal-Key': portalKey,
      Accept: 'application/json',
    },
    cache: options?.forceRefresh ? 'no-store' : 'default',
  });

  if (!res.ok) {
    throw new Error(`ERP catalog request failed: ${res.status}`);
  }

  const xCache = res.headers.get('x-cache') || res.headers.get('X-Cache') || 'UNKNOWN';
  const data = await res.json();
  return { data, xCache };
}

/**
 * Выполняет сетевой запрос к Synergy ERP для получения каталога с защитой Singleflight.
 * Если уже выполняется идентичный запрос к ERP, все параллельные вызовы ожидают один промис.
 */
export async function fetchUpstreamCatalogSingleflight(
  options: FetchCatalogSingleflightOptions = {}
): Promise<any> {
  const targetErpUrl = options.targetErpUrl || getTargetErpUrl();
  const fallbackErpUrl = options.fallbackErpUrl || getErpFallbackUrl();
  const serverErpKey = options.serverErpKey || getErpApiKey();
  const correlationId = options.correlationId || `singleflight-${Date.now()}`;
  const isForceRefresh = Boolean(options.forceRefresh);
  const dealerKey = options.dealerId ? String(options.dealerId) : 'global';

  const inFlightKey = `catalog:${targetErpUrl}:dealer=${dealerKey}:refresh=${isForceRefresh ? '1' : '0'}`;

  // 1. Singleflight Deduplication: если запрос уже летит в ERP, переиспользуем его
  const existingPromise = upstreamCatalogInFlight.get(inFlightKey);
  if (existingPromise) {
    logger.info('[Catalog Singleflight] Concurrent request coalesced into existing upstream fetch', {
      key: inFlightKey,
      correlationId,
    });
    return existingPromise;
  }

  // 2. Создаем единственный запрос к Synergy ERP
  const fetchPromise = (async () => {
    // 2.1. Circuit Breaker Guard
    const circuit = await checkCircuit('erp_gateway');
    if (!circuit.permitted) {
      logger.warn('[Catalog Singleflight] Circuit OPEN for erp_gateway. Serving stale cache fallback', { correlationId });
      const stale = await getCachedCatalog('catalog_global');
      if (stale?.data) {
        return stale.data;
      }
      throw new Error('Шлюз Synergy ERP временно недоступен (Circuit Breaker OPEN), а локальный кэш пуст.');
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
        return await fetch(url, {
          method: 'GET',
          headers,
          cache: isForceRefresh ? 'no-store' : 'default',
          signal: controller.signal,
        });
      } finally {
        clearTimeout(tid);
      }
    }

    let erpRes: Response | null = null;
    let textData = '';

    try {
      const primaryUrl = buildErpCatalogUrl(targetErpUrl, {
        dealerId: options.dealerId,
        forceRefresh: isForceRefresh,
      });
      erpRes = await sendFetch(primaryUrl, effectiveTimeoutMs);
      const isHtml = (erpRes.headers.get('content-type') || '').includes('text/html');

      if ((erpRes.status >= 500 || isHtml) && fallbackErpUrl && fallbackErpUrl !== targetErpUrl) {
        logger.warn('[Catalog Singleflight] Primary returned error, switching to fallback ERP', {
          status: erpRes.status,
          correlationId,
        });
        const fallbackUrl = buildErpCatalogUrl(fallbackErpUrl, {
          dealerId: options.dealerId,
          forceRefresh: isForceRefresh,
        });
        erpRes = await sendFetch(fallbackUrl, effectiveTimeoutMs);
      }
      textData = await erpRes.text();
    } catch (primaryErr: any) {
      if (fallbackErpUrl && fallbackErpUrl !== targetErpUrl) {
        logger.warn('[Catalog Singleflight] Primary network error, attempting fallback ERP', {
          error: primaryErr?.message,
          correlationId,
        });
        const fallbackUrl = buildErpCatalogUrl(fallbackErpUrl, {
          dealerId: options.dealerId,
          forceRefresh: isForceRefresh,
        });
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
      throw new Error(`Synergy ERP вернула ошибку ${erpRes?.status || 'UNKNOWN'}`);
    }

    await recordSuccess('erp_gateway');

    const upstreamXCache = erpRes.headers.get('x-cache') || erpRes.headers.get('X-Cache') || 'UNKNOWN';
    logger.info('[Catalog Singleflight] Upstream ERP catalog received', {
      xCache: upstreamXCache,
      forceRefresh: isForceRefresh,
      dealerId: options.dealerId || null,
      correlationId,
    });

    let parsedJson: any = null;
    try {
      parsedJson = JSON.parse(textData);
    } catch (parseErr) {
      logger.error('[Catalog Singleflight] Failed to parse ERP JSON response', { correlationId });
      const stale = await getCachedCatalog('catalog_global');
      if (stale?.data) return stale.data;
      throw new Error('Некорректный JSON от шлюза Synergy ERP');
    }

    if (parsedJson && typeof parsedJson === 'object') {
      Object.defineProperty(parsedJson, '_xCache', {
        value: upstreamXCache,
        enumerable: false,
        configurable: true,
        writable: true,
      });
    }

    if (parsedJson?.success) {
      normalizeErpDesigns(parsedJson);
      const targetCacheKey = options.dealerId ? `catalog_dealer_${options.dealerId}` : 'catalog_global';
      // Асинхронно сохраняем в L1 Memory, L2 Redis и L2 PostgreSQL
      saveCachedCatalog(parsedJson, targetCacheKey).catch(e => {
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
