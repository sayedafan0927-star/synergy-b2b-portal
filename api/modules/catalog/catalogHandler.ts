/**
 * Enterprise Paginated & Cached Catalog Handler
 * Mitigates N+1 and Memory Leaks with PostgREST query pushdown and sanitized filters.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getCachedCatalog, saveCachedCatalog } from '../../lib/catalogCache';
import { sanitizePostgrestFilter } from '../../lib/security';
import { getErpApiKey } from '../../lib/erpKey';
import { fetchUpstreamCatalogSingleflight } from './catalogSingleflight';

function normalizeImageUrl(url: any): string {
  if (typeof url !== 'string' || !url) return '';
  return url
    .replace(/^https?:\/\/kilem-khan\.kz\/api\/sin\/public\/image\.php/i, 'https://erp.synergy-tech.kz/image.php')
    .replace(/^https?:\/\/crm\.kilem-khan\.kz\/api\/sin\/public\/image\.php/i, 'https://erp.synergy-tech.kz/image.php')
    .replace(/^https?:\/\/erp\.synergy-tech\.kz\/api\/sin\/public\/image\.php/i, 'https://erp.synergy-tech.kz/image.php');
}

/**
 * Очистка и компактизация снимка каталога для предотвращения превышения
 * лимита тела ответа Vercel Serverless Function (4.5 MB Payload Limit).
 */
export function compactCatalogPayload(data: any): any {
  if (!data || typeof data !== 'object') return data;
  const rawList = Array.isArray(data.products) ? data.products : (Array.isArray(data.items) ? data.items : null);
  if (!rawList) return data;

  const compacted = rawList.map((p: any) => ({
    id: p.id,
    name: p.name,
    category: p.category,
    collection: p.collection,
    manufacturer: p.manufacturer,
    material: p.material,
    country: p.country,
    density: p.density,
    pile_height: p.pile_height,
    // Ссылки на фото весят ~60 байт — держим всю галерею (до 12), чтобы карточка каталога совпадала со страницей товара
    images: (Array.isArray(p.images) ? p.images.slice(0, 12) : (p.image ? [p.image] : [])).map(normalizeImageUrl).filter(Boolean),
    image_thumb: p.image_thumb ? normalizeImageUrl(p.image_thumb) : undefined,
    variants: (p.variants || []).map((v: any) => ({
      id: v.id,
      size: v.size,
      sku: v.sku,
      base_price: Number(v.base_price || 0),
      price_per_sqm: Number(v.price_per_sqm || 0),
      area_sqm: Number(v.area_sqm || 0),
      free_stock: Number(v.free_stock ?? v.stock ?? 0),
      reserved_stock: Number(v.reserved_stock ?? 0),
      total_stock: Number(v.total_stock ?? (v.free_stock ?? 0)),
      warehouses: v.warehouses,
    })),
  }));

  return {
    ...data,
    products: compacted,
    is_compacted: true,
  };
}

export async function handleCatalogRequests(
  req: VercelRequest,
  res: VercelResponse,
  action: string,
  supabase: SupabaseClient,
  targetErpUrl?: string,
  fallbackErpUrl?: string,
  serverErpKey?: string,
  correlationId?: string
): Promise<boolean> {
  // 1. Быстрый ответ из L1/L2 кэша для полного каталога (Singleflight + Stale-While-Revalidate)
  if ((action === 'catalog' || action === 'catalog_normalized') && req.method === 'GET') {
    const isRefresh = req.query.refresh === 'true' || req.query.refresh === '1';
    try {
      const cached = await getCachedCatalog('catalog_global');

      // 1.1. Fresh HIT: свежий кэш отдается мгновенно
      if (cached && cached.isFresh && !isRefresh) {
        res.setHeader('X-Cache', 'HIT');
        res.setHeader('X-Cache-Age-Ms', String(cached.ageMs));
        res.setHeader('X-Cache-Source', cached.source);
        const payloadToSend = compactCatalogPayload(cached.data);
        res.status(200).json(payloadToSend);
        return true;
      }

      // 1.2. Stale-While-Revalidate: отдаем имеющийся кэш мгновенно, а свежий запрашиваем фоново через Singleflight
      if (cached && cached.data && !isRefresh) {
        res.setHeader('X-Cache', 'STALE');
        res.setHeader('X-Cache-Age-Ms', String(cached.ageMs));
        res.setHeader('X-Cache-Source', cached.source);
        const payloadToSend = compactCatalogPayload(cached.data);
        res.status(200).json(payloadToSend);

        const refreshPromise = fetchUpstreamCatalogSingleflight({
          targetErpUrl,
          fallbackErpUrl,
          serverErpKey,
          correlationId,
        }).catch(err => {
          console.warn('[Catalog Handler] Background SWR refresh notice:', err?.message);
        });

        const vercelWaitUntil = (req as any).context?.waitUntil || (globalThis as any).waitUntil;
        if (typeof vercelWaitUntil === 'function') {
          vercelWaitUntil(refreshPromise);
        }
        return true;
      }

      // 1.3. Cold Start / Manual Refresh: единый Singleflight запрос в 1C (все параллельные ждут один промис)
      const freshData = await fetchUpstreamCatalogSingleflight({
        targetErpUrl,
        fallbackErpUrl,
        serverErpKey,
        correlationId,
        forceRefresh: isRefresh,
      });

      if (freshData) {
        res.setHeader('X-Cache', isRefresh ? 'REFRESHED' : 'MISS_SINGLEFLIGHT');
        const payloadToSend = compactCatalogPayload(freshData);
        res.status(200).json(payloadToSend);
        return true;
      }
    } catch (cacheLookupErr) {
      console.warn('[Catalog Handler] Cache lookup warning:', cacheLookupErr);
    }
    return false;
  }

  // 2. Точечный эндпоинт товара по ID или SKU
  if (action === 'product' && req.method === 'GET') {
    const targetId = decodeURIComponent(String(req.query.id || req.query.sku || '')).trim().toLowerCase();
    if (!targetId) {
      res.status(400).json({ success: false, error: 'Параметр id или sku обязателен' });
      return true;
    }

    try {
      let catalogData: any = null;
      const cached = await getCachedCatalog('catalog_global');
      if (cached && cached.data && (Array.isArray(cached.data.products) || Array.isArray(cached.data.items))) {
        catalogData = cached.data;
      }

      // Если кэш пуст — загружаем боевой каталог из ERP через Singleflight
      if (!catalogData) {
        try {
          catalogData = await fetchUpstreamCatalogSingleflight({
            targetErpUrl,
            fallbackErpUrl,
            serverErpKey,
            correlationId,
          });
        } catch (fetchErr) {
          console.warn('[Catalog Handler] Notice fetching catalog for product lookup:', fetchErr);
        }
      }

      const productsList = catalogData?.products || catalogData?.items || [];
      if (Array.isArray(productsList) && productsList.length > 0) {
        const found = productsList.find((p: any) => {
          if (String(p.id).toLowerCase() === targetId) return true;
          if (String(p.article || '').toLowerCase() === targetId) return true;
          return (p.variants || []).some((v: any) =>
            String(v.id).toLowerCase() === targetId ||
            String(v.item_id || '').toLowerCase() === targetId ||
            String(v.sku || '').toLowerCase() === targetId ||
            String(v.barcode || '').toLowerCase() === targetId ||
            String(v.article || '').toLowerCase() === targetId
          );
        });

        if (found) {
          res.setHeader('X-Cache', cached ? 'HIT' : 'FETCHED');
          const normalizedFound = {
            ...found,
            images: (Array.isArray(found.images) ? found.images : (found.image ? [found.image] : [])).map(normalizeImageUrl).filter(Boolean),
            image_thumb: found.image_thumb ? normalizeImageUrl(found.image_thumb) : undefined,
          };
          res.status(200).json({ success: true, product: normalizedFound });
          return true;
        }
      }

      // 2.2 Проверка в локальной базе данных Supabase
      if (supabase) {
        try {
          const { data: dbProduct } = await supabase
            .from('products')
            .select(`
              *,
              variants:product_variants(*)
            `)
            .or(`id.eq.${targetId},article.ilike.%${targetId}%`)
            .maybeSingle();

          if (dbProduct) {
            res.setHeader('X-Cache', 'DB_FALLBACK');
            res.status(200).json({ success: true, product: dbProduct });
            return true;
          }
        } catch {}
      }

      // Не отправляем в ERP действие 'product' (ERP не поддерживает action=product и вернет 400)
      res.status(404).json({ success: false, error: `Товар '${targetId}' не найден в каталоге` });
      return true;
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message });
      return true;
    }
  }

  // 3. Серверная пагинация с экранированием фильтров PostgREST
  if (action === 'catalog_paginated' && req.method === 'GET') {
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '24'), 10) || 24));
    const offset = (page - 1) * limit;
    const search = sanitizePostgrestFilter(String(req.query.search || ''));
    const category = sanitizePostgrestFilter(String(req.query.category || ''));
    const collection = sanitizePostgrestFilter(String(req.query.collection || ''));
    const sizeCluster = String(req.query.size_cluster || '').trim().toLowerCase();
    const isRunner = req.query.is_runner === 'true' || req.query.is_runner === '1';
    const inStockOnly = req.query.in_stock === 'true' || req.query.in_stock === '1';

    try {
      // 3.1. Первичный быстрый путь: пагинация по каноническому снимку каталога (Sub-second, 0 DB load)
      const cachedSnapshot = await getCachedCatalog('catalog_global');
      if (cachedSnapshot?.data?.products && Array.isArray(cachedSnapshot.data.products)) {
        let list = cachedSnapshot.data.products;
        if (category) list = list.filter((p: any) => p.category === category);
        if (collection) list = list.filter((p: any) => p.collection?.toLowerCase().includes(collection.toLowerCase()));
        if (search) {
          const sLower = search.toLowerCase();
          list = list.filter((p: any) =>
            p.name?.toLowerCase().includes(sLower) ||
            p.collection?.toLowerCase().includes(sLower) ||
            p.id?.toLowerCase().includes(sLower) ||
            (p.variants || []).some((v: any) => v.sku?.toLowerCase().includes(sLower))
          );
        }
        if (sizeCluster) {
          list = list.filter((p: any) => (p.variants || []).some((v: any) => v.size_cluster === sizeCluster));
        }
        if (isRunner) {
          list = list.filter((p: any) => (p.variants || []).some((v: any) => v.is_runner));
        }
        if (inStockOnly) {
          list = list.filter((p: any) => (p.variants || []).some((v: any) => (v.stock || v.free_stock || v.total_stock || 0) > 0));
        }

        const total = list.length;
        const paginated = list.slice(offset, offset + limit);

        res.setHeader('X-Cache', 'SNAPSHOT_PAGINATED');
        res.status(200).json({
          success: true,
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
          items: paginated,
          source: 'cache_snapshot',
        });
        return true;
      }

      // 3.2. Резервный путь: прямой запрос к PostgREST базы данных
      let query = supabase
        .from('products')
        .select(`
          id,
          name,
          category,
          collection,
          manufacturer,
          material,
          style,
          country,
          density,
          pile_height,
          images,
          product_variants (
            id,
            size,
            sku,
            base_price,
            warehouse_stock (
              city,
              stock
            )
          )
        `, { count: 'estimated' });

      if (category) query = query.eq('category', category);
      if (collection) query = query.ilike('collection', `%${collection}%`);
      if (search) query = query.or(`name.ilike.%${search}%,collection.ilike.%${search}%,id.ilike.%${search}%`);

      query = query.range(offset, offset + limit - 1).order('name', { ascending: true });

      const { data, count, error } = await query;
      if (error) {
        res.status(500).json({ success: false, error: error.message });
        return true;
      }

      let canonicalSkuMap = new Map<string, { free_stock: number; base_price: number; warehouses: any[] }>();
      let items = (data || []).map((p: any) => {
        const variants = (p.product_variants || []).map((v: any) => {
          const vSkuUpper = String(v.sku || '').trim().toUpperCase();
          const canonical = canonicalSkuMap.get(vSkuUpper);
          const stocks = v.warehouse_stock || [];
          const totalStock = canonical ? canonical.free_stock : stocks.reduce((acc: number, s: any) => acc + (Number(s.stock) || 0), 0);
          return {
            id: v.id,
            size: v.size,
            sku: v.sku,
            base_price: canonical?.base_price || Number(v.base_price) || 0,
            stock: totalStock,
            free_stock: totalStock,
            warehouses: canonical?.warehouses || v.warehouses,
            stocks_by_city: stocks.reduce((acc: Record<string, number>, s: any) => {
              acc[s.city] = Number(s.stock) || 0;
              return acc;
            }, {}),
          };
        });

        return {
          id: p.id,
          name: p.name,
          category: p.category,
          collection: p.collection,
          manufacturer: p.manufacturer,
          material: p.material,
          style: p.style,
          country: p.country,
          density: p.density,
          pile_height: p.pile_height,
          images: (p.images || []).map(normalizeImageUrl).filter(Boolean),
          variants,
          total_stock: variants.reduce((acc: number, v: any) => acc + v.stock, 0),
        };
      });

      if (inStockOnly) {
        items = items.filter((p: any) => p.total_stock > 0);
      }

      const total = count || items.length;
      res.status(200).json({
        success: true,
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        items,
        source: 'supabase_db',
      });
      return true;
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message });
      return true;
    }
  }

  return false;
}
