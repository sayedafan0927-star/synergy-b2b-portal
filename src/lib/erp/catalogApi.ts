import { erpFetch, deduplicateRequest, pingErp } from './core';
import { fetchCounterpartiesFromErp, fetchRegionalManagersFromErp } from './counterpartiesApi';
import { normalizeToErpPriceType } from '@/lib/pricingEngine';
import type { PaginatedCatalogParams, PaginatedCatalogResult, ErpSyncReport } from './types';

// ─── Stale-While-Revalidate Catalog Cache (60s fresh TTL, 300s stale TTL; 5m normalized metadata cache) ───
const CATALOG_TTL_MS = 60 * 1000;
const CATALOG_STALE_TTL_MS = 5 * 60 * 1000;
const NORMALIZED_TTL_MS = 5 * 60 * 1000;
const catalogMemoryCache = new Map<string, { timestamp: number; data: any }>();
let normalizedVariantCache: { timestamp: number; map: Map<string, any> } | null = null;

export function invalidateClientCatalogCache(): void {
  catalogMemoryCache.clear();
  normalizedVariantCache = null;
}

async function getNormalizedVariantMap(queryParams: Record<string, string | undefined>, bypassCache: boolean): Promise<Map<string, any>> {
  if (!bypassCache && normalizedVariantCache && Date.now() - normalizedVariantCache.timestamp < NORMALIZED_TTL_MS) {
    return normalizedVariantCache.map;
  }
  return deduplicateRequest(`catalog_normalized_map_${bypassCache ? 'refresh' : 'cached'}`, async () => {
    const map = new Map<string, any>();
    try {
      const normResponse = await erpFetch('catalog_normalized', {
        method: 'GET',
        params: queryParams,
      });
    if (normResponse && normResponse.ok) {
      const normData = await normResponse.json();
      const normDesigns = normData?.designs || normData?.products || [];
      if (Array.isArray(normDesigns)) {
        for (const d of normDesigns) {
          const dColl = String(d.collection || '').trim().toUpperCase();
          const dArt = String(d.article || '').trim().toUpperCase();
          const rawVars = d.variants || d.sizes || [];
          for (const sv of rawVars) {
            const enrichedSv = {
              ...sv,
              _designEta: d.production_eta || null,
            };
            const vId = String(sv.item_id ?? sv.id ?? '').trim();
            const vSku = String(sv.sku ?? '').trim();
            const vSizeNorm = String(sv.size || '').replace(/[\s*xXхХ×]+/g, 'x').toLowerCase();
            if (vId) map.set(`id:${vId}`, enrichedSv);
            if (vSku) map.set(`sku:${vSku}`, enrichedSv);
            if (dColl && vSizeNorm) map.set(`key:${dColl}__${dArt}__${vSizeNorm}`, enrichedSv);
          }
        }
      }
      if (map.size > 0) {
        normalizedVariantCache = { timestamp: Date.now(), map };
      }
    }
    } catch {
      if (normalizedVariantCache) return normalizedVariantCache.map;
    }
    return map;
  });
}

/**
 * Получение актуального каталога и остатков по складам из ERP.
 * Использует Stale-While-Revalidate (SWR) кэширование, поддержку ?refresh=1 и дедупликацию параллельных запросов.
 */
export async function fetchCatalogFromErp(dealerId?: string | number, priceType?: string, bypassCache = false) {
  const normalizedPriceType = priceType ? normalizeToErpPriceType(priceType) : undefined;
  const cacheKey = `catalog_${dealerId || 'public'}_${normalizedPriceType || 'default'}`;

  // 1. Проверяем свежий кэш в памяти (SWR: мгновенный возврат и тихое фоновое обновление после 60с)
  if (!bypassCache) {
    const cached = catalogMemoryCache.get(cacheKey);
    if (cached) {
      const age = Date.now() - cached.timestamp;
      if (age < CATALOG_TTL_MS) {
        return cached.data;
      }
      if (age < CATALOG_STALE_TTL_MS) {
        void fetchCatalogFromErp(dealerId, normalizedPriceType, true).catch(() => {});
        return cached.data;
      }
    }
  } else {
    catalogMemoryCache.delete(cacheKey);
  }

  const requestKey = bypassCache ? `${cacheKey}_refresh` : cacheKey;

  // 2. Дедупликация параллельных запросов
  return deduplicateRequest(requestKey, async () => {
    const queryParams = {
      partner_id: dealerId ? String(dealerId) : undefined,
      price_type: normalizedPriceType || undefined,
      refresh: bypassCache ? '1' : undefined,
    };

    const hasWarmNormalizedCache = Boolean(
      !bypassCache && normalizedVariantCache && Date.now() - normalizedVariantCache.timestamp < NORMALIZED_TTL_MS
    );

    const response = await erpFetch('catalog', {
      method: 'GET',
      params: queryParams,
    });

    const normVariantMap = hasWarmNormalizedCache
      ? normalizedVariantCache!.map
      : await Promise.race([
          getNormalizedVariantMap(queryParams, bypassCache),
          new Promise<Map<string, any>>(resolve => setTimeout(() => resolve(normalizedVariantCache?.map || new Map()), 250)),
        ]);

    const xCache = response.headers.get('x-cache') || response.headers.get('x-erp-cache');
    const xAge = response.headers.get('x-cache-age-ms');
    if (xCache) {
      console.log(`[Catalog Gateway] X-Cache: ${xCache}${xAge ? ` (${xAge}ms)` : ''}`);
    }

    if (!response.ok) {
      throw new Error(`Ошибка загрузки каталога (${response.status})`);
    }

    const data = await response.json();

    // Если основной ответ вернул designs[] вместо products[] (например, при прямом вызове catalog_normalized)
    if (data && !Array.isArray(data.products) && Array.isArray(data.designs)) {
      data.products = data.designs.map((d: any) => ({
        ...d,
        id: String(d.design_id || d.id || `design-${d.article}`),
        variants: (d.variants || d.sizes || []).map((sv: any) => ({
          ...sv,
          id: String(sv.id ?? sv.item_id ?? `var-${sv.sku || sv.size}`),
          free_stock: Number(sv.free_stock ?? sv.stock_free ?? sv.stock ?? 0),
          stock: Number(sv.free_stock ?? sv.stock_free ?? sv.stock ?? 0),
        })),
      }));
    }

    if (data && Array.isArray(data.products)) {
      for (const p of data.products) {
        const pColl = String(p.collection || '').trim().toUpperCase();
        const pArt = String(p.article || '').trim().toUpperCase();
        const rawVars = p.variants || p.sizes || [];
        p.variants = rawVars.map((v: any) => {
          const vId = String(v.item_id ?? v.id ?? '').trim();
          const vSku = String(v.sku ?? '').trim();
          const vSizeNorm = String(v.size || '').replace(/[\s*xXхХ×]+/g, 'x').toLowerCase();
          const sv =
            (vId && normVariantMap.get(`id:${vId}`)) ||
            (vSku && normVariantMap.get(`sku:${vSku}`)) ||
            normVariantMap.get(`key:${pColl}__${pArt}__${vSizeNorm}`) ||
            null;

          const inProdQty = Number(sv?.in_production_qty ?? v.in_production_qty ?? 0);
          const prodEta = sv?.production_eta ?? v.production_eta ?? sv?._designEta ?? p.production_eta ?? null;
          const freeStockVal =
            v.free_stock !== undefined
              ? Number(v.free_stock)
              : v.stock_free !== undefined
              ? Number(v.stock_free)
              : sv?.stock_free !== undefined
              ? Number(sv.stock_free)
              : sv?.free_stock !== undefined
              ? Number(sv.free_stock)
              : Number(v.stock ?? 0);

          const stockStatus =
            sv?.stock_status ||
            v.stock_status ||
            (freeStockVal > 0 ? 'in_stock' : inProdQty > 0 ? 'in_production' : 'out_of_stock');

          return {
            ...v,
            item_id: v.item_id ?? sv?.item_id ?? (Number(v.id) || undefined),
            free_stock: freeStockVal,
            stock_status: stockStatus,
            in_production_qty: inProdQty,
            planned_qty: sv?.planned_qty !== undefined ? Number(sv.planned_qty) : v.planned_qty,
            preordered_qty: sv?.preordered_qty !== undefined ? Number(sv.preordered_qty) : v.preordered_qty,
            production_eta: prodEta,
            production_order_no: sv?.production_order_no ?? v.production_order_no ?? null,
            is_preorder_available: Boolean(sv?.is_preorder_available ?? v.is_preorder_available ?? inProdQty > 0),
          };
        });

        p.in_production_total_qty = p.variants.reduce(
          (sum: number, iv: any) => sum + (Number(iv.in_production_qty) || 0),
          0
        );
        p.has_preorder = Boolean(p.has_preorder || p.in_production_total_qty > 0);
        p.production_eta =
          p.production_eta || p.variants.find((iv: any) => iv.production_eta)?.production_eta || null;
      }
    }

    if (data && typeof data === 'object' && xCache) {
      data._xCache = xCache;
    }
    if (data && data.success) {
      catalogMemoryCache.set(cacheKey, { timestamp: Date.now(), data });
    }
    return data;
  });
}

/**
 * Точечная загрузка одного товара по ID или артикулу.
 * Ищет товар в кэшированном каталоге ERP (с 60s Stale-While-Revalidate TTL),
 * предотвращая лишние запросы к неподдерживаемым эндпоинтам и ошибки 401.
 */
export async function fetchSingleProductFromErp(id: string, dealerId?: string | number) {
  if (!id) return null;
  const cleanId = decodeURIComponent(String(id)).trim().toLowerCase();
  if (!cleanId) return null;

  try {
    const catalogData = await fetchCatalogFromErp(dealerId);
    const products: any[] = catalogData?.products || [];
    const found = products.find((p: any) => {
      if (String(p.id).toLowerCase() === cleanId) return true;
      if (String(p.article || '').toLowerCase() === cleanId) return true;
      return (p.variants || []).some(
        (v: any) =>
          String(v.id).toLowerCase() === cleanId ||
          String(v.sku || '').toLowerCase() === cleanId ||
          String(v.barcode || '').toLowerCase() === cleanId ||
          String(v.article || '').toLowerCase() === cleanId ||
          String((v as any).code || '').toLowerCase() === cleanId
      );
    });
    return found || null;
  } catch (err) {
    console.warn('[Catalog API] fetchSingleProductFromErp notice:', err);
    return null;
  }
}

/**
 * Пагинация, фильтрация и поиск каталога на основе кэшированного каталога ERP
 */
export async function fetchPaginatedCatalogFromErp(params: PaginatedCatalogParams = {}): Promise<PaginatedCatalogResult> {
  const catalogData = await fetchCatalogFromErp();
  let items: any[] = catalogData?.products || [];

  if (params.search) {
    const q = params.search.toLowerCase();
    items = items.filter((p: any) =>
      (p.name || '').toLowerCase().includes(q) ||
      (p.article || '').toLowerCase().includes(q) ||
      (p.collection || '').toLowerCase().includes(q)
    );
  }
  if (params.category) {
    items = items.filter((p: any) => (p.category || '').toLowerCase() === params.category?.toLowerCase());
  }
  if (params.collection) {
    items = items.filter((p: any) => (p.collection || '').toLowerCase() === params.collection?.toLowerCase());
  }
  if (params.inStockOnly) {
    items = items.filter((p: any) => {
      const totalStock = (p.variants || []).reduce((sum: number, v: any) => {
        const whStock = (v.warehouses || []).reduce((wSum: number, w: any) => wSum + (w.stock || 0), 0);
        return sum + whStock;
      }, 0);
      return totalStock > 0;
    });
  }

  const page = Number(params.page) || 1;
  const limit = Number(params.limit) || 24;
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const pagedItems = items.slice((page - 1) * limit, page * limit);

  return {
    success: true,
    page,
    limit,
    total,
    totalPages,
    items: pagedItems,
  };
}

/**
 * Полная синхронизация и диагностический опрос всех узлов ERP.
 */
export async function syncAllErpData(forceRefresh = false): Promise<ErpSyncReport> {
  const [pingRes, catalogRes, counterpartiesRes, managersRes] = await Promise.all([
    pingErp(),
    fetchCatalogFromErp(undefined, undefined, forceRefresh),
    fetchCounterpartiesFromErp({ limit: 300, includeArchived: true }).catch(err => ({ success: false, error: err.message, counterparties: [] })),
    fetchRegionalManagersFromErp().catch(err => ({ success: false, error: err.message, managers: [] })),
  ]);

  const products = catalogRes?.products || [];
  const cities = catalogRes?.cities || [];
  let totalStockPcs = 0;
  const warnings: string[] = [];

  for (const p of products) {
    let pStock = 0;
    for (const v of p.variants || []) {
      for (const w of v.warehouses || []) {
        totalStockPcs += (w.stock || 0);
        pStock += (w.stock || 0);
      }
    }
    if (pStock === 0) {
      warnings.push(`Коллекция "${p.collection || p.name}" (ID ${p.id}): нулевой остаток на всех складах.`);
    }
  }

  const cpList = counterpartiesRes?.counterparties || [];
  const activeCount = counterpartiesRes?.active_count ?? cpList.filter((c: any) => c.is_acting_client).length;
  const archivedCount = counterpartiesRes?.archived_count ?? cpList.filter((c: any) => c.is_archived_or_mailing).length;

  return {
    timestamp: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    ping: pingRes,
    catalog: catalogRes,
    counterparties: counterpartiesRes,
    regionalManagers: managersRes,
    totalProducts: products.length,
    totalStockPcs,
    cities,
    totalCounterparties: cpList.length,
    activeCounterpartiesCount: activeCount,
    archivedCounterpartiesCount: archivedCount,
    totalManagers: managersRes?.managers?.length || managersRes?.count || 0,
    warnings,
  };
}

/**
 * Получение полного пакета синхронизации всех клиентов, балансов и РМ.
 */
export async function fetchSyncBundleFromErp() {
  const response = await erpFetch('sync_bundle', { method: 'GET' });

  if (!response.ok) {
    throw new Error(`Ошибка загрузки пакета синхронизации (${response.status})`);
  }

  return await response.json();
}
