import { erpFetch, deduplicateRequest, pingErp } from './core';
import { fetchCounterpartiesFromErp, fetchRegionalManagersFromErp } from './counterpartiesApi';
import type { PaginatedCatalogParams, PaginatedCatalogResult, ErpSyncReport } from './types';

// ─── Stale-While-Revalidate Catalog Cache (60s TTL) ───
const CATALOG_TTL_MS = 60 * 1000;
const catalogMemoryCache = new Map<string, { timestamp: number; data: any }>();

/**
 * Получение актуального каталога и остатков по складам из ERP.
 * Использует Stale-While-Revalidate (SWR) кэширование и дедупликацию параллельных запросов.
 */
export async function fetchCatalogFromErp(dealerId?: string | number, priceType?: string, bypassCache = false) {
  const cacheKey = `catalog_${dealerId || 'public'}_${priceType || 'default'}`;

  // 1. Проверяем свежий кэш в памяти
  if (!bypassCache) {
    const cached = catalogMemoryCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CATALOG_TTL_MS) {
      return cached.data;
    }
  }

  // 2. Дедупликация параллельных запросов
  return deduplicateRequest(cacheKey, async () => {
    const response = await erpFetch('catalog', {
      method: 'GET',
      params: {
        dealer_id: dealerId ? String(dealerId) : undefined,
        price_type: priceType || undefined,
        refresh: bypassCache ? 'true' : undefined,
      },
    });

    const xCache = response.headers.get('x-cache');
    const xAge = response.headers.get('x-cache-age-ms');
    if (xCache) {
      console.log(`[Catalog Gateway] Status: ${xCache}${xAge ? ` (${xAge}ms)` : ''}`);
    }

    if (!response.ok) {
      throw new Error(`Ошибка загрузки каталога (${response.status})`);
    }

    const data = await response.json();
    if (data && data.success) {
      catalogMemoryCache.set(cacheKey, { timestamp: Date.now(), data });
    }
    return data;
  });
}

/**
 * Точечная загрузка одного товара по ID или артикулу (исключает скачивание всего каталога)
 */
export async function fetchSingleProductFromErp(id: string) {
  const response = await erpFetch('product', {
    method: 'GET',
    params: { id },
  });

  if (!response.ok) {
    return null;
  }

  const data = await response.json();
  return data?.product || null;
}

/**
 * Серверная пагинация, фильтрация и поиск каталога (масштабирование до 50k+ SKU)
 */
export async function fetchPaginatedCatalogFromErp(params: PaginatedCatalogParams = {}): Promise<PaginatedCatalogResult> {
  const response = await erpFetch('catalog_paginated', {
    method: 'GET',
    params: {
      page: params.page ? String(params.page) : '1',
      limit: params.limit ? String(params.limit) : '24',
      search: params.search || undefined,
      category: params.category || undefined,
      collection: params.collection || undefined,
      in_stock: params.inStockOnly ? 'true' : undefined,
    },
  });

  if (!response.ok) {
    throw new Error(`Ошибка загрузки каталога (${response.status})`);
  }

  return response.json();
}

/**
 * Полная синхронизация и диагностический опрос всех узлов ERP.
 */
export async function syncAllErpData(): Promise<ErpSyncReport> {
  const [pingRes, catalogRes, counterpartiesRes, managersRes] = await Promise.all([
    pingErp(),
    fetchCatalogFromErp(),
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
