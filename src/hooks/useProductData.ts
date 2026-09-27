import { useState, useEffect, useContext } from 'react';
import { supabase } from '@/lib/supabase';
import { fetchCatalogFromErp } from '@/lib/erpApi';
import { AuthContext } from '@/contexts/AuthContext';
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

function getValidImages(rawImages?: string[] | null): string[] {
  if (!rawImages || !Array.isArray(rawImages)) return [];
  return rawImages.filter(img => typeof img === 'string' && img.trim().length > 0 && !img.includes('unsplash.com'));
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
    const collection = (raw.collection || parsed.collection || 'Ковры').trim();
    const article = (raw.article || parsed.sku || raw.id).trim();
    const color = (raw.color || parsed.color || '').trim();
    const normalizedColor = color.toUpperCase().replace(/[\s/\\-]+/g, '');
    const groupKey = `${collection.toUpperCase()}__${article.toUpperCase()}${normalizedColor ? `__${normalizedColor}` : ''}`;

    const baseSqmPrice = Number(raw.price_per_sqm) || Number(raw.variants?.[0]?.price_per_sqm) || 15;
    const itemSize = parsed.size || raw.variants?.[0]?.size || '1.6 × 2.3';

    const itemVariants: ProductVariant[] = (raw.variants && raw.variants.length > 0)
      ? raw.variants.map(v => {
          const s = v.size && v.size !== 'Стандарт' ? v.size.replace(/[*xXхХ]/g, ' × ') : itemSize;
          const area = v.area_sqm && v.area_sqm > 0 ? v.area_sqm : calculateArea(s);
          const vPricePerSqm = Number(v.price_per_sqm) || baseSqmPrice;
          const vBasePrice = Number(v.base_price) > 0 ? Number(v.base_price) : Math.round(vPricePerSqm * area * 100) / 100;
          return {
            ...v,
            size: s,
            area_sqm: area,
            sku: v.sku || `${article}-${s.replace(/\s+/g, '')}`,
            price_per_sqm: vPricePerSqm,
            base_price: vBasePrice,
            currency: v.currency || raw.currency || 'USD',
            dealer_stock: v.dealer_stock,
          };
        })
      : [{
          id: `var-${article}-${itemSize}`,
          size: itemSize,
          sku: `${article}-${itemSize.replace(/\s+/g, '')}`,
          area_sqm: calculateArea(itemSize),
          price_per_sqm: baseSqmPrice,
          base_price: Math.round(baseSqmPrice * calculateArea(itemSize) * 100) / 100,
          currency: raw.currency || 'USD',
          warehouses: [],
          dealer_stock: (raw as any).dealer_stock,
        }];

    const existing = map.get(groupKey);
    if (!existing) {
      const photos = getValidImages(raw.images);
      map.set(groupKey, {
        ...raw,
        id: String(raw.id || `carpet-${groupKey.toLowerCase().replace(/[^a-z0-9_-]/g, '-')}`),
        name: raw.name || parsed.cleanName || `${collection} ${article}${color ? ` (${color})` : ''}`,
        collection: collection,
        article: article,
        color: color,
        currency: raw.currency || 'USD',
        price_per_sqm: baseSqmPrice,
        images: photos,
        image_thumb: photos.length > 0 ? photos[0] : (raw.image_thumb && !raw.image_thumb.includes('unsplash.com') ? raw.image_thumb : undefined),
        characteristics: raw.characteristics,
        variants: [...itemVariants],
      });
    } else {
      // Обогащаем медиа и характеристики, если они появились у следующего элемента того же дизайна
      if ((!existing.images || existing.images.length === 0) && raw.images && raw.images.length > 0) {
        const photos = getValidImages(raw.images);
        if (photos.length > 0) {
          existing.images = photos;
          existing.image_thumb = photos[0];
        }
      }
      if (!existing.image_thumb && raw.image_thumb && !raw.image_thumb.includes('unsplash.com')) {
        existing.image_thumb = raw.image_thumb;
      }
      if ((!existing.characteristics || existing.characteristics.length === 0) && raw.characteristics && raw.characteristics.length > 0) {
        existing.characteristics = raw.characteristics;
      }
      if (!existing.density && raw.density) existing.density = raw.density;
      if (!existing.pile_height && raw.pile_height) existing.pile_height = raw.pile_height;
      if (!existing.material && raw.material) existing.material = raw.material;
      if (!existing.shape_label && raw.shape_label) existing.shape_label = raw.shape_label;
      if (!existing.country && raw.country) existing.country = raw.country;
      if (!existing.manufacturer && raw.manufacturer) existing.manufacturer = raw.manufacturer;
      if (!existing.style && raw.style) existing.style = raw.style;

      // Сливаем размеры в один товар
      const existingSizes = new Set(existing.variants.map(v => v.size));
      for (const v of itemVariants) {
        if (!existingSizes.has(v.size)) {
          existing.variants.push(v);
          existingSizes.add(v.size);
        } else {
          // Если размер уже есть — объединяем остатки складов и дилерские остатки
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
            if (v.dealer_stock) {
              if (!targetVariant.dealer_stock) {
                targetVariant.dealer_stock = { ...v.dealer_stock };
              } else {
                targetVariant.dealer_stock = {
                  in_showroom_qty: targetVariant.dealer_stock.in_showroom_qty + v.dealer_stock.in_showroom_qty,
                  in_showroom_sqm: Math.round((targetVariant.dealer_stock.in_showroom_sqm + v.dealer_stock.in_showroom_sqm) * 100) / 100,
                  in_transit_qty: targetVariant.dealer_stock.in_transit_qty + v.dealer_stock.in_transit_qty,
                  in_transit_sqm: Math.round((targetVariant.dealer_stock.in_transit_sqm + v.dealer_stock.in_transit_sqm) * 100) / 100,
                  available_hub_qty: Math.max(targetVariant.dealer_stock.available_hub_qty, v.dealer_stock.available_hub_qty),
                };
              }
            }
          }
        }
      }
    }
  }

  // Сортируем размеры каждого товара по возрастанию площади (без добавления фиктивных нулей)
  const result: Product[] = [];
  for (const prod of map.values()) {
    prod.variants.sort((a, b) => {
      const areaA = a.area_sqm || calculateArea(a.size);
      const areaB = b.area_sqm || calculateArea(b.size);
      return areaA - areaB;
    });
    result.push(prod);
  }

  return result;
}

/**
 * Фильтрация складов для отображения клиенту:
 * Клиенты видят только склады с реальным наличием (> 0), либо центральный хаб (Основной Склад Астана).
 * 50+ пустых партнерских шоурумов скрываются, чтобы не создавать бардак.
 */
export function filterClientWarehouses(warehouses: Warehouse[] = []): Warehouse[] {
  if (!warehouses || warehouses.length === 0) {
    return [{ city: 'Алматы', warehouse_name: 'Основной Склад Астана', stock: 0 }];
  }

  // 1. Склады с реальным остатком
  const withStock = warehouses.filter(w => w.stock > 0);
  if (withStock.length > 0) {
    return withStock;
  }

  // 2. Если остатка нет нигде, отдаем только одну строку центрального склада с 0 шт. (под заказ)
  const mainHub = warehouses.find(w =>
    (w.warehouse_name && (w.warehouse_name.toLowerCase().includes('основной') || w.warehouse_name.toLowerCase().includes('астана'))) ||
    (w.city && w.city.toLowerCase().includes('астана'))
  );

  if (mainHub) {
    return [{ ...mainHub, stock: 0 }];
  }

  return [{ city: 'Алматы', warehouse_name: 'Основной Склад Астана', stock: 0 }];
}

export function triggerCatalogReload() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('synergy:reload-catalog'));
  }
}

export function useProducts(customDealerId?: string | number) {
  const authContext = useContext(AuthContext);
  const effectiveDealerId = customDealerId ?? authContext?.profile?.partner_id ?? undefined;

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

  // Слушатель событий реального времени по вебхуку (списание остатка дилера)
  useEffect(() => {
    const handleStockEvent = (e: CustomEvent<{ partner_id?: number | string; sku?: string; released_qty?: number }>) => {
      const data = e.detail;
      if (!data || !data.sku || !data.released_qty) return;
      if (data.partner_id && effectiveDealerId && String(data.partner_id) !== String(effectiveDealerId)) {
        return; // Событие для другого партнёра
      }

      setProducts(prev => prev.map(prod => {
        let changed = false;
        const newVariants = prod.variants.map(v => {
          if ((v.sku === data.sku || v.id.includes(data.sku!)) && v.dealer_stock) {
            changed = true;
            const newQty = Math.max(0, v.dealer_stock.in_showroom_qty - Number(data.released_qty));
            const area = calculateArea(v.size);
            return {
              ...v,
              dealer_stock: {
                ...v.dealer_stock,
                in_showroom_qty: newQty,
                in_showroom_sqm: Math.round(newQty * area * 10) / 10,
              }
            };
          }
          return v;
        });
        return changed ? { ...prod, variants: newVariants } : prod;
      }));
    };

    window.addEventListener('synergy:stock-event', handleStockEvent as EventListener);

    let bc: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        bc = new BroadcastChannel('synergy_stock_channel');
        bc.onmessage = (event) => {
          if (event.data?.event === 'partner_stock_released') {
            window.dispatchEvent(new CustomEvent('synergy:stock-event', { detail: event.data }));
          }
        };
      } catch {
        // fallback
      }
    }

    return () => {
      window.removeEventListener('synergy:stock-event', handleStockEvent as EventListener);
      if (bc) bc.close();
    };
  }, [effectiveDealerId]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        // 1. Приоритетный источник: реальные ковры и остатки складов из Synergy ERP
        try {
          const erpData = await fetchCatalogFromErp(undefined, effectiveDealerId);
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
  }, [reloadCounter, effectiveDealerId]);

  return { products, loading, error };
}

export function useProduct(id: string | undefined, customDealerId?: string | number) {
  const authContext = useContext(AuthContext);
  const effectiveDealerId = customDealerId ?? authContext?.profile?.partner_id ?? undefined;

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
          const erpData = await fetchCatalogFromErp(undefined, effectiveDealerId);
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
  }, [id, effectiveDealerId]);

  return { product, loading, error };
}

export function useCollectionPrices() {
  const [prices] = useState<CollectionPrice[]>([]);
  return prices;
}
