import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { fetchCatalogFromErp } from '@/lib/erpApi';
import type { Product, ProductVariant, Warehouse, CollectionPrice } from '@/types';

export const STANDARD_SIZES = ['0.8 × 1.5', '1.6 × 2.3', '2 × 3', '2.5 × 3.5', '3 × 4'];

export function calculateArea(sizeStr: string): number {
  if (!sizeStr) return 3.68;
  const cleaned = sizeStr.replace(',', '.');
  const parts = cleaned.split(/[*×xX]/).map(s => parseFloat(s.trim()));
  if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
    return Math.round(parts[0] * parts[1] * 100) / 100;
  }
  return 3.68;
}

/**
 * Парсер номенклатуры 1С (ERP):
 * Преобразует сырую строку вида:
 * "CELESTE <KARMEN HALI(Турция)> (VE001G, 1.6*2.3, STAN, KREM-KREM)"
 * в структурированные данные:
 * - Коллекция: CELESTE
 * - Бренд / Фабрика: KARMEN HALI
 * - Страна: Турция
 * - Артикул (Дизайн / SKU): VE001G
 * - Размер: 1.6 × 2.3
 * - Тип: Стандарт / Рулон
 * - Цвет: Krem-Krem
 * - Презентабельное название: "CELESTE VE001G (Krem-Krem)"
 */
export function parse1CNomenclature(rawName: string, fallbackCollection = ''): {
  collection: string;
  manufacturer: string;
  country: string;
  sku: string;
  size: string;
  type: string;
  color: string;
  cleanName: string;
} {
  let collection = fallbackCollection || '';
  let manufacturer = 'Karmen Hali';
  let country = 'Турция';
  let sku = '';
  let size = '';
  let type = 'Стандарт';
  let color = '';

  // 1. Извлекаем параметры в последних круглых скобках (артикул, размер, тип, цвет)
  const pm = rawName.match(/\(([^)]+)\)\s*$/);
  let nameWithoutParams = rawName;
  if (pm) {
    nameWithoutParams = rawName.slice(0, pm.index).trim();
    const parts = pm[1].split(/,\s+/);
    if (parts.length >= 1) sku = parts[0].trim();
    if (parts.length >= 2) size = parts[1].replace('*', ' × ').trim();
    if (parts.length >= 3) {
      type = parts[2] === 'R' ? 'Рулон' : 'Стандарт';
    }
    if (parts.length >= 4) {
      color = parts[3].replace(/[-/]/g, ' ').trim();
    }
  }

  // 2. Извлекаем производителя и страну из угловых скобок <...>
  const mfgMatch = nameWithoutParams.match(/<([^>]+)>/);
  if (mfgMatch) {
    const rawMfg = mfgMatch[1];
    const cntryMatch = rawMfg.match(/\(([^)]+)\)/);
    if (cntryMatch) {
      country = cntryMatch[1].trim();
      manufacturer = rawMfg.replace(/\([^)]+\)/, '').trim();
    } else {
      manufacturer = rawMfg.trim();
    }
  }

  // 3. Коллекция — текст до знака '<' или '('
  const collMatch = nameWithoutParams.split(/[<(]/)[0].trim();
  if (collMatch) {
    collection = collMatch;
  }

  const cleanName = sku ? `${collection} ${sku}${color ? ` (${color})` : ''}` : (collection || rawName);

  return {
    collection,
    manufacturer,
    country,
    sku,
    size,
    type,
    color,
    cleanName,
  };
}

const COLLECTION_PHOTOS: Record<string, string[]> = {
  'CELESTE': [
    'https://images.unsplash.com/photo-1600121848594-d8644e57abab?auto=format&fit=crop&q=80&w=800',
    'https://images.unsplash.com/photo-1579656381226-5fc0f0100c3b?auto=format&fit=crop&q=80&w=800',
  ],
  'FLORA': [
    'https://images.unsplash.com/photo-1594040226829-7f251ab46d80?auto=format&fit=crop&q=80&w=800',
    'https://images.unsplash.com/photo-1584100936595-c0654b55a2e2?auto=format&fit=crop&q=80&w=800',
  ],
  'OCTAVIA': [
    'https://images.unsplash.com/photo-1618221195710-dd6b41faaea6?auto=format&fit=crop&q=80&w=800',
    'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&q=80&w=800',
  ],
  'OSLO': [
    'https://images.unsplash.com/photo-1586023492125-27b2c045efd7?auto=format&fit=crop&q=80&w=800',
    'https://images.unsplash.com/photo-1616486338812-3dadae4b4ace?auto=format&fit=crop&q=80&w=800',
  ],
  'SALOON': [
    'https://images.unsplash.com/photo-1616046229478-9901c5536a45?auto=format&fit=crop&q=80&w=800',
    'https://images.unsplash.com/photo-1618219908412-a29a1bb7b86e?auto=format&fit=crop&q=80&w=800',
  ],
  'HYPNOSE': [
    'https://images.unsplash.com/photo-1615873968403-89e068629265?auto=format&fit=crop&q=80&w=800',
  ],
  'HYPNOSE DOTLU': [
    'https://images.unsplash.com/photo-1615873968403-89e068629265?auto=format&fit=crop&q=80&w=800',
  ],
  'AFGAN': [
    'https://images.unsplash.com/photo-1579656381226-5fc0f0100c3b?auto=format&fit=crop&q=80&w=800',
  ],
  'BOBO': [
    'https://images.unsplash.com/photo-1617806118233-18e1de247200?auto=format&fit=crop&q=80&w=800',
  ],
  'ROYAL': [
    'https://images.unsplash.com/photo-1600121848594-d8644e57abab?auto=format&fit=crop&q=80&w=800',
  ],
  'TABRIZ': [
    'https://images.unsplash.com/photo-1594040226829-7f251ab46d80?auto=format&fit=crop&q=80&w=800',
  ],
  'PERSIA': [
    'https://images.unsplash.com/photo-1618221195710-dd6b41faaea6?auto=format&fit=crop&q=80&w=800',
  ],
  'SAMARKAND': [
    'https://images.unsplash.com/photo-1586023492125-27b2c045efd7?auto=format&fit=crop&q=80&w=800',
  ],
};

function getCollectionPhotos(collection: string, rawImages: string[]): string[] {
  if (rawImages && rawImages.length > 0 && rawImages[0].startsWith('http')) {
    return rawImages;
  }
  const upper = (collection || '').toUpperCase();
  for (const [key, photos] of Object.entries(COLLECTION_PHOTOS)) {
    if (upper.includes(key)) return photos;
  }
  return [
    'https://images.unsplash.com/photo-1600121848594-d8644e57abab?auto=format&fit=crop&q=80&w=800',
    'https://images.unsplash.com/photo-1579656381226-5fc0f0100c3b?auto=format&fit=crop&q=80&w=800'
  ];
}

/**
 * Иерархический группировщик:
 * Коллекция -> Артикул (Дизайн) -> Все доступные размеры с остатками по складам.
 * Карточка в каталоге представляет именно АРТИКУЛ, а не единичный размер!
 */
export function mergeProducts(rawProducts: Product[]): Product[] {
  const map = new Map<string, Product>();

  for (const raw of rawProducts) {
    const parsed = parse1CNomenclature(raw.name, raw.collection);
    const sku = parsed.sku || raw.variants?.[0]?.sku || raw.id;
    const collection = parsed.collection || raw.collection || 'Ковры';
    const groupKey = `${collection.toUpperCase()}__${sku.toUpperCase()}`;

    const baseSqmPrice = raw.price_per_sqm || raw.variants?.[0]?.price_per_sqm || 15;
    const itemSize = parsed.size || raw.variants?.[0]?.size || '1.6 × 2.3';

    const itemVariants: ProductVariant[] = (raw.variants && raw.variants.length > 0)
      ? raw.variants.map(v => {
          const s = v.size && v.size !== 'Стандарт' ? v.size : itemSize;
          const area = calculateArea(s);
          const vPricePerSqm = v.price_per_sqm || baseSqmPrice;
          return {
            ...v,
            size: s,
            sku: v.sku || sku,
            price_per_sqm: vPricePerSqm,
            base_price: v.base_price > 0 ? v.base_price : Math.round(vPricePerSqm * area * 100) / 100,
          };
        })
      : [{
          id: `var-${sku}-${itemSize}`,
          size: itemSize,
          sku: sku,
          price_per_sqm: baseSqmPrice,
          base_price: Math.round(baseSqmPrice * calculateArea(itemSize) * 100) / 100,
          warehouses: [],
        }];

    const existing = map.get(groupKey);
    if (!existing) {
      const photos = getCollectionPhotos(collection, raw.images);
      map.set(groupKey, {
        ...raw,
        id: `carpet-${groupKey.toLowerCase().replace(/[^a-z0-9_-]/g, '-')}`,
        name: parsed.cleanName,
        collection: collection,
        article: sku,
        color: parsed.color,
        manufacturer: parsed.manufacturer || raw.manufacturer || 'Karmen Hali',
        country: parsed.country || raw.country || 'Турция',
        price_per_sqm: baseSqmPrice,
        images: photos,
        image_thumb: photos[0],
        variants: [...itemVariants],
      });
    } else {
      // Сливаем размеры в один артикул
      const existingSizes = new Set(existing.variants.map(v => v.size));
      for (const v of itemVariants) {
        if (!existingSizes.has(v.size)) {
          existing.variants.push(v);
          existingSizes.add(v.size);
        } else {
          // Если размер уже есть — объединяем остатки складов
          const targetVariant = existing.variants.find(ev => ev.size === v.size);
          if (targetVariant) {
            const whMap = new Map(targetVariant.warehouses.map(w => [w.city, w]));
            for (const w of v.warehouses) {
              const exWh = whMap.get(w.city);
              if (exWh) {
                exWh.stock += w.stock;
              } else {
                targetVariant.warehouses.push({ ...w });
              }
            }
          }
        }
      }
    }
  }

  // Для каждого артикула гарантируем наличие стандартной размерной сетки
  const result: Product[] = [];
  for (const prod of map.values()) {
    const existingSizes = new Set(prod.variants.map(v => v.size));
    const baseSqm = prod.price_per_sqm || 15;
    for (const stdSize of STANDARD_SIZES) {
      if (!existingSizes.has(stdSize)) {
        const area = calculateArea(stdSize);
        prod.variants.push({
          id: `var-${prod.id}-${stdSize}`,
          size: stdSize,
          sku: `${prod.variants[0]?.sku || 'SKU'}-${stdSize.replace(/\s+/g, '')}`,
          price_per_sqm: baseSqm,
          base_price: Math.round(baseSqm * area * 100) / 100,
          warehouses: [
            { city: 'Алматы', stock: 0 },
            { city: 'Астана', stock: 0 },
            { city: 'Шымкент', stock: 0 },
          ],
        });
      }
    }

    // Сортируем размеры по возрастанию площади
    prod.variants.sort((a, b) => calculateArea(a.size) - calculateArea(b.size));
    result.push(prod);
  }

  return result;
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
            const merged = mergeProducts(erpData.products as Product[]);
            setProducts(merged);
            setLoading(false);
            return;
          }
        } catch (erpErr) {
          console.warn('[useProducts] ERP catalog fetch fallback:', erpErr);
        }

        // 2. Резервный источник: Supabase (с защитой от сбоев)
        try {
          const [prodRes, varRes, stockRes] = await Promise.all([
            supabase.from('products').select('*'),
            supabase.from('product_variants').select('*'),
            supabase.from('warehouse_stock').select('variant_id, city, stock'),
          ]);

          if (cancelled) return;

          if (!prodRes.error && prodRes.data && prodRes.data.length > 0) {
            const stockByVariant = new Map<string, Warehouse[]>();
            for (const s of stockRes.data ?? []) {
              const arr = stockByVariant.get(s.variant_id) ?? [];
              arr.push({ city: s.city, stock: s.stock });
              stockByVariant.set(s.variant_id, arr);
            }

            const variantsByProduct = new Map<string, ProductVariant[]>();
            for (const v of varRes.data ?? []) {
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

            const assembled = prodRes.data.map(p => ({
              ...p,
              variants: variantsByProduct.get(p.id) ?? [],
            }));

            setProducts(mergeProducts(assembled));
            setLoading(false);
            return;
          }
        } catch (sbErr) {
          console.warn('[useProducts] Supabase fallback error:', sbErr);
        }

        if (!cancelled) {
          setLoading(false);
        }
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
        // 1. Поиск в каталоге ERP
        try {
          const erpData = await fetchCatalogFromErp();
          if (!cancelled && erpData && erpData.success && Array.isArray(erpData.products)) {
            const merged = mergeProducts(erpData.products as Product[]);
            const found = merged.find(p => p.id === id || p.variants.some(v => v.id === id || v.sku === id));
            if (found) {
              setProduct(found);
              setLoading(false);
              return;
            }
          }
        } catch (erpErr) {
          console.warn('[useProduct] ERP single product fallback:', erpErr);
        }

        // 2. Резервный поиск
        try {
          const prodRes = await supabase.from('products').select('*').eq('id', id).maybeSingle();
          if (prodRes.data) {
            const varRes = await supabase.from('product_variants').select('*').eq('product_id', id);
            const variantIds = (varRes.data ?? []).map(v => v.id);
            let stockData: Array<{ variant_id: string; city: string; stock: number }> = [];
            if (variantIds.length > 0) {
              const stockRes = await supabase.from('warehouse_stock').select('variant_id, city, stock').in('variant_id', variantIds);
              if (stockRes.data) stockData = stockRes.data;
            }
            const stockByVariant = new Map<string, Warehouse[]>();
            for (const s of stockData) {
              const arr = stockByVariant.get(s.variant_id) ?? [];
              arr.push({ city: s.city, stock: s.stock });
              stockByVariant.set(s.variant_id, arr);
            }
            const variants = (varRes.data ?? []).map(v => ({
              id: v.id,
              size: v.size,
              sku: v.sku,
              base_price: Number(v.base_price),
              warehouses: stockByVariant.get(v.id) ?? [],
            }));
            const assembled = mergeProducts([{ ...prodRes.data, variants }]);
            setProduct(assembled[0] ?? null);
          }
        } catch (sbErr) {
          console.warn('[useProduct] Supabase lookup error:', sbErr);
        }
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
