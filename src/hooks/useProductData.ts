import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { fetchCatalogFromErp } from '@/lib/erpApi';
import type { Product, ProductVariant, Warehouse, CollectionPrice } from '@/types';

interface DbProduct {
  id: string;
  name: string;
  category: string;
  collection: string;
  manufacturer: string;
  material: string;
  style: string;
  country: string;
  density: string;
  pile_height: string;
  images: string[];
  supplier_id: number | null;
}

interface DbVariant {
  id: string;
  product_id: string;
  size: string;
  sku: string;
  base_price: number;
}

interface DbStock {
  variant_id: string;
  city: string;
  stock: number;
}

function assembleProducts(
  dbProducts: DbProduct[],
  dbVariants: DbVariant[],
  dbStock: DbStock[],
): Product[] {
  const stockByVariant = new Map<string, Warehouse[]>();
  for (const s of dbStock) {
    const arr = stockByVariant.get(s.variant_id) ?? [];
    arr.push({ city: s.city, stock: s.stock });
    stockByVariant.set(s.variant_id, arr);
  }

  const variantsByProduct = new Map<string, ProductVariant[]>();
  for (const v of dbVariants) {
    const arr = variantsByProduct.get(v.product_id) ?? [];
    arr.push({
      id: v.id,
      size: v.size,
      sku: v.sku,
      base_price: Number(v.base_price),
      warehouses: stockByVariant.get(v.id) ?? [],
    });
    variantsByProduct.set(v.product_id, arr);
  }

  const assembled = dbProducts.map(p => ({
    ...p,
    variants: variantsByProduct.get(p.id) ?? [],
  }));

  return mergeProducts(assembled);
}

/**
 * Объединяет товары с одинаковым артикулом (collection + name) в одну карточку.
 * Все размерные варианты из разных записей сливаются в один список variants,
 * дубликаты размеров устраняются (оставляется первый с остатком).
 */
function mergeProducts(products: Product[]): Product[] {
  const map = new Map<string, Product>();
  for (const p of products) {
    const key = `${p.collection}::${p.name}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...p, variants: [...p.variants] });
      continue;
    }
    const seenSizes = new Set(existing.variants.map(v => v.size));
    for (const v of p.variants) {
      if (!seenSizes.has(v.size)) {
        existing.variants.push(v);
        seenSizes.add(v.size);
      }
    }
    if (existing.images.length === 0 && p.images.length > 0) {
      existing.images = p.images;
    }
  }
  return Array.from(map.values());
}

export function triggerCatalogReload() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('synergy:reload-catalog'));
  }
}

export function useProducts() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadCounter, setReloadCounter] = useState(0);

  useEffect(() => {
    const handler = () => {
      setLoading(true);
      setReloadCounter(c => c + 1);
    };
    window.addEventListener('synergy:reload-catalog', handler);
    return () => window.removeEventListener('synergy:reload-catalog', handler);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        // 1. Приоритетный источник: реальные ковры и остатки складов из Synergy ERP
        try {
          const erpData = await fetchCatalogFromErp();
          if (!cancelled && erpData && erpData.success && Array.isArray(erpData.products) && erpData.products.length > 0) {
            setProducts(mergeProducts(erpData.products as Product[]));
            setLoading(false);
            return;
          }
        } catch (erpErr) {
          console.warn('[useProducts] ERP catalog fetch fallback:', erpErr);
        }

        // 2. Резервный источник: локальная база Supabase
        const [prodRes, varRes, stockRes] = await Promise.all([
          supabase.from('products').select('*'),
          supabase.from('product_variants').select('*'),
          supabase.from('warehouse_stock').select('variant_id, city, stock'),
        ]);

        if (cancelled) return;

        if (prodRes.error || varRes.error || stockRes.error) {
          setError(prodRes.error?.message ?? varRes.error?.message ?? stockRes.error?.message ?? 'Unknown error');
          setLoading(false);
          return;
        }

        setProducts(assembleProducts(prodRes.data ?? [], varRes.data ?? [], stockRes.data ?? []));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Network error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [reloadCounter]);

  return { products, loading, error };
}

export function useProduct(id: string | undefined) {
  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function load() {
      try {
        // 1. Ищем товар в каталоге ERP
        try {
          const erpData = await fetchCatalogFromErp();
          if (!cancelled && erpData && erpData.success && Array.isArray(erpData.products)) {
            const merged = mergeProducts(erpData.products as Product[]);
            const found = merged.find((p: Product) => String(p.id) === String(id));
            if (found) {
              setProduct(found);
              setLoading(false);
              return;
            }
          }
        } catch (erpErr) {
          console.warn('[useProduct] ERP single product fallback:', erpErr);
        }

        // 2. Резервный поиск в Supabase
        const [prodRes, varRes] = await Promise.all([
          supabase.from('products').select('*').eq('id', id).maybeSingle(),
          supabase.from('product_variants').select('*').eq('product_id', id),
        ]);

        if (cancelled) return;

        if (prodRes.error || !prodRes.data) {
          setError(prodRes.error?.message ?? 'Product not found');
          setLoading(false);
          return;
        }

        const variantIds = (varRes.data ?? []).map(v => v.id);
        let stockData: DbStock[] = [];
        if (variantIds.length > 0) {
          const stockRes = await supabase
            .from('warehouse_stock')
            .select('variant_id, city, stock')
            .in('variant_id', variantIds);
          if (!cancelled && stockRes.data) stockData = stockRes.data;
        }

        if (cancelled) return;

        const assembled = assembleProducts([prodRes.data], varRes.data ?? [], stockData);
        setProduct(assembled[0] ?? null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Network error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [id]);

  return { product, loading, error };
}

let cachedPrices: CollectionPrice[] | null = null;
let fetchingPrices = false;

export function useCollectionPrices() {
  const [prices, setPrices] = useState<CollectionPrice[]>(cachedPrices ?? []);

  useEffect(() => {
    if (cachedPrices) {
      setPrices(cachedPrices);
      return;
    }
    if (fetchingPrices) return;
    fetchingPrices = true;

    let cancelled = false;
    supabase
      .from('collection_prices')
      .select('collection, price_type_id, price_per_sqm')
      .then(({ data, error }) => {
        if (!cancelled && !error && data) {
          const parsed = data.map(d => ({ ...d, price_per_sqm: Number(d.price_per_sqm) }));
          cachedPrices = parsed;
          setPrices(parsed);
        }
      })
      .catch(() => {
        // Silently catch network or DNS errors if Supabase is offline
      })
      .finally(() => {
        fetchingPrices = false;
      });

    return () => { cancelled = true; };
  }, []);

  return prices;
}
