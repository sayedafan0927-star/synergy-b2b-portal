import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
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

  return dbProducts.map(p => ({
    ...p,
    variants: variantsByProduct.get(p.id) ?? [],
  }));
}

export function useProducts() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
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
  }, []);

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
      setLoading(false);
    }

    load();
    return () => { cancelled = true; };
  }, [id]);

  return { product, loading, error };
}

export function useCollectionPrices() {
  const [prices, setPrices] = useState<CollectionPrice[]>([]);

  useEffect(() => {
    let cancelled = false;
    supabase
      .from('collection_prices')
      .select('collection, price_type_id, price_per_sqm')
      .then(({ data }) => {
        if (!cancelled && data) setPrices(data.map(d => ({ ...d, price_per_sqm: Number(d.price_per_sqm) })));
      });
    return () => { cancelled = true; };
  }, []);

  return prices;
}
