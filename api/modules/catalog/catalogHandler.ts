/**
 * Enterprise Paginated & Cached Catalog Handler
 * Mitigates N+1 and Memory Leaks with PostgREST query pushdown and sanitized filters.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getCachedCatalog, saveCachedCatalog } from '../../lib/catalogCache';
import { sanitizePostgrestFilter } from '../../lib/security';
import { getErpApiKey } from '../../lib/erpKey';

export async function handleCatalogRequests(
  req: VercelRequest,
  res: VercelResponse,
  action: string,
  supabase: SupabaseClient
): Promise<boolean> {
  // 1. Быстрый ответ из L1/L2 кэша для полного каталога
  if ((action === 'catalog' || action === 'catalog_normalized') && req.method === 'GET') {
    const isRefresh = req.query.refresh === 'true' || req.query.refresh === '1';
    if (!isRefresh) {
      try {
        const cached = await getCachedCatalog('catalog_global');
        if (cached && cached.isFresh) {
          res.setHeader('X-Cache', 'HIT');
          res.setHeader('X-Cache-Age-Ms', String(cached.ageMs));
          res.setHeader('X-Cache-Source', cached.source);
          res.status(200).json(cached.data);
          return true;
        }
      } catch (cacheLookupErr) {
        console.warn('[Catalog Handler] Cache lookup warning:', cacheLookupErr);
      }
    }
    return false; // Позволяем диспетчеру обратиться к ERP при кэш-миссе
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

      // Если кэш пуст — загружаем боевой каталог из ERP и кэшируем
      if (!catalogData) {
        const ERP_API_URL = process.env.ERP_API_URL || 'https://kilem-khan.kz/api/sin/public/api_portal.php';
        const apiKey = getErpApiKey();
        const headers: Record<string, string> = { Accept: 'application/json' };
        if (apiKey) headers['X-Portal-Key'] = apiKey;

        try {
          const erpRes = await fetch(`${ERP_API_URL}?action=catalog`, { headers });
          if (erpRes.ok) {
            const fetched = await erpRes.json().catch(() => null);
            if (fetched && fetched.success) {
              const rawItems = fetched.items || fetched.products || [];
              catalogData = {
                success: true,
                products: rawItems,
              };
              saveCachedCatalog(catalogData, 'catalog_global').catch(() => {});
            }
          }
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
          res.status(200).json({ success: true, product: found });
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
        `, { count: 'exact' });

      if (category) {
        query = query.eq('category', category);
      }
      if (collection) {
        query = query.ilike('collection', `%${collection}%`);
      }
      if (search) {
        query = query.or(`name.ilike.%${search}%,collection.ilike.%${search}%,id.ilike.%${search}%`);
      }

      query = query.range(offset, offset + limit - 1).order('name', { ascending: true });

      const { data, count, error } = await query;

      if (error) {
        // Fallback к кэшированному снепшоту каталога
        const cached = await getCachedCatalog('catalog_global');
        if (cached && cached.data && Array.isArray(cached.data.products)) {
          let list = cached.data.products;
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
            list = list.filter((p: any) => (p.variants || []).some((v: any) => (v.stock || v.total_stock || 0) > 0));
          }
          const total = list.length;
          const paginated = list.slice(offset, offset + limit);
          res.status(200).json({
            success: true,
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
            items: paginated,
            source: 'cache_fallback',
          });
          return true;
        }
        res.status(500).json({ success: false, error: error.message });
        return true;
      }

      let items = (data || []).map((p: any) => {
        const variants = (p.product_variants || []).map((v: any) => {
          const stocks = v.warehouse_stock || [];
          const totalStock = stocks.reduce((acc: number, s: any) => acc + (Number(s.stock) || 0), 0);
          return {
            id: v.id,
            size: v.size,
            sku: v.sku,
            base_price: Number(v.base_price) || 0,
            stock: totalStock,
            stocks_by_city: stocks.reduce((acc: Record<string, number>, s: any) => {
              acc[s.city] = Number(s.stock) || 0;
              return acc;
            }, {}),
          };
        });

        const totalProductStock = variants.reduce((acc: number, v: any) => acc + v.stock, 0);

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
          images: p.images || [],
          variants,
          total_stock: totalProductStock,
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
