/**
 * Synergy B2B Portal — Batch SKU & Carpet Resolution Handler
 * Enables sub-second bulk resolving for Excel / CSV specification uploads (up to 500 items/call).
 * Eliminates N+1 client-side HTTP waterfall requests.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getCachedCatalog } from '../../lib/catalogCache';

export interface BatchItemQuery {
  rawLine?: string;
  article: string;
  size?: string;
  qty?: number;
}

export interface BatchItemResolution {
  rawLine?: string;
  article: string;
  size: string;
  qty: number;
  status: 'matched' | 'insufficient_stock' | 'not_found';
  availableStock: number;
  price: number;
  product?: any;
  variant?: any;
  error?: string;
}

function normalizeDimensionStr(str: string): string {
  if (!str) return '';
  return str
    .replace(/([0-9]+(?:[\.,][0-9]+)?)\s*[xхXХ*×]\s*([0-9]+(?:[\.,][0-9]+)?)/gi, (_, w, l) => {
      const cleanW = w.replace(',', '.').replace(/\.0+$/, '').replace(/(\.[0-9]*[1-9])0+$/, '$1');
      const cleanL = l.replace(',', '.').replace(/\.0+$/, '').replace(/(\.[0-9]*[1-9])0+$/, '$1');
      return `${cleanW}x${cleanL}`;
    })
    .toLowerCase()
    .replace(/\s+/g, '');
}

function cleanAlphaNumeric(str: string): string {
  if (!str) return '';
  return str.toLowerCase().replace(/[^a-z0-9а-яё]/gi, '');
}

export async function handleResolveCatalogBatch(
  req: VercelRequest,
  res: VercelResponse,
  _supabase?: SupabaseClient
): Promise<void> {
  const items: BatchItemQuery[] = Array.isArray(req.body?.items) ? req.body.items : [];
  if (items.length === 0) {
    res.status(400).json({ success: false, error: 'Поле items должно быть непустым массивом' });
    return;
  }

  // Cap batch size at 500 items per request
  const safeItems = items.slice(0, 500);

  // 1. Извлекаем снимок каталога из L1 RAM или L2 DB
  const cached = await getCachedCatalog('catalog_global');
  const products: any[] = Array.isArray(cached?.data?.products) ? cached.data.products : [];

  if (products.length === 0) {
    const fallbackResults: BatchItemResolution[] = safeItems.map(it => ({
      rawLine: it.rawLine,
      article: it.article,
      size: it.size || '',
      qty: Math.max(1, Number(it.qty || 1)),
      status: 'not_found',
      availableStock: 0,
      price: 0,
    }));
    res.status(200).json({ success: true, count: fallbackResults.length, results: fallbackResults });
    return;
  }

  // 2. Индексируем каталог для O(1) поиска по нормализованным артикулам/коллекциям
  const productIndex = new Map<string, any[]>();
  for (const prod of products) {
    const keys = new Set<string>();
    if (prod.article) keys.add(cleanAlphaNumeric(prod.article));
    if (prod.collection) keys.add(cleanAlphaNumeric(prod.collection));
    if (prod.name) keys.add(cleanAlphaNumeric(prod.name));

    for (const key of keys) {
      if (!key) continue;
      const existing = productIndex.get(key) || [];
      existing.push(prod);
      productIndex.set(key, existing);
    }
  }

  // 3. Пакетное сопоставление строк спецификации
  const results: BatchItemResolution[] = safeItems.map(item => {
    const rawArticle = String(item.article || '').trim();
    const rawSize = String(item.size || '').trim();
    const qty = Math.max(1, parseInt(String(item.qty || 1), 10) || 1);
    const cleanArt = cleanAlphaNumeric(rawArticle);
    const normalizedSize = normalizeDimensionStr(rawSize);

    if (!cleanArt) {
      return {
        rawLine: item.rawLine,
        article: rawArticle,
        size: rawSize,
        qty,
        status: 'not_found',
        availableStock: 0,
        price: 0,
        error: 'Empty article',
      };
    }

    let candidates = productIndex.get(cleanArt);
    if (!candidates || candidates.length === 0) {
      for (const [k, prods] of productIndex.entries()) {
        if (k.includes(cleanArt) || cleanArt.includes(k)) {
          candidates = prods;
          break;
        }
      }
    }

    let matchedProduct: any = null;
    let matchedVariant: any = null;

    if (candidates && candidates.length > 0) {
      for (const prod of candidates) {
        const variants = Array.isArray(prod.variants) ? prod.variants : [];
        if (normalizedSize) {
          const vMatch = variants.find((v: any) => {
            const vNorm = normalizeDimensionStr(v.size || '');
            return vNorm === normalizedSize || vNorm.includes(normalizedSize) || normalizedSize.includes(vNorm);
          });
          if (vMatch) {
            matchedProduct = prod;
            matchedVariant = vMatch;
            break;
          }
        } else {
          if (variants.length > 0) {
            matchedProduct = prod;
            matchedVariant = variants[0];
            break;
          }
        }
      }
    }

    if (matchedProduct && matchedVariant) {
      const stock = Number(matchedVariant.free_stock ?? matchedVariant.stock ?? 0);
      const price = Number(matchedVariant.base_price || matchedVariant.price_per_sqm || 0);

      return {
        rawLine: item.rawLine,
        article: matchedProduct.collection || matchedProduct.article || rawArticle,
        size: matchedVariant.size || rawSize,
        qty,
        product: {
          id: matchedProduct.id,
          name: matchedProduct.name,
          collection: matchedProduct.collection,
          article: matchedProduct.article,
          category: matchedProduct.category,
          images: matchedProduct.images,
        },
        variant: {
          id: matchedVariant.id,
          sku: matchedVariant.sku,
          size: matchedVariant.size,
          base_price: matchedVariant.base_price,
          free_stock: stock,
        },
        status: stock >= qty ? 'matched' : (stock > 0 ? 'insufficient_stock' : 'not_found'),
        availableStock: stock,
        price,
      };
    }

    return {
      rawLine: item.rawLine,
      article: rawArticle,
      size: rawSize,
      qty,
      status: 'not_found',
      availableStock: 0,
      price: 0,
    };
  });

  res.status(200).json({
    success: true,
    count: results.length,
    matched_count: results.filter(r => r.status === 'matched').length,
    results,
  });
}
