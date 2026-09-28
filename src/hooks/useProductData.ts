import { useState, useEffect, useContext } from 'react';
import { fetchCatalogFromErp } from '@/lib/erpApi';
import { AuthContext, type Profile } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import type { Product, ProductVariant, Warehouse, StockSummary } from '@/types';
import {
  filterWarehousesForClient,
  getClientWarehouseSettings,
  isCentralWarehouse,
  CENTRAL_WAREHOUSE_ID,
  CENTRAL_WAREHOUSE_NAME
} from '@/lib/warehouseVisibility';

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
    const category = (raw.category || (raw.name?.toLowerCase().includes('дорожк') ? 'Дорожки' : 'Ковры')).trim();
    const collection = (raw.collection || parsed.collection || 'Ковры').trim();
    const article = (raw.article || parsed.sku || raw.id).trim();
    const color = (raw.color || parsed.color || '').trim();
    const normalizedColor = color.toUpperCase().replace(/[\s/\\-]+/g, '');
    const groupKey = `${category.toUpperCase()}__${collection.toUpperCase()}__${article.toUpperCase()}${normalizedColor ? `__${normalizedColor}` : ''}`;

    const baseSqmPrice = Number(raw.price_per_sqm) || Number(raw.variants?.[0]?.price_per_sqm) || 15;
    const itemSize = parsed.size || raw.variants?.[0]?.size || '1.6 × 2.3';

    const itemVariants: ProductVariant[] = (raw.variants && raw.variants.length > 0)
      ? raw.variants.map(v => {
          const s = v.size && v.size !== 'Стандарт' ? v.size.replace(/[*xXхХ]/g, ' × ') : itemSize;
          const area = v.area_sqm && v.area_sqm > 0 ? Number(v.area_sqm) : calculateArea(s);
          const vPricePerSqm = Number(v.price_per_sqm) > 0 ? Number(v.price_per_sqm) : baseSqmPrice;
          const rawVariantPrice = Number((v as any).price) > 0
            ? Number((v as any).price)
            : (Number(v.base_price) > 0 ? Number(v.base_price) : Math.round(vPricePerSqm * area * 100) / 100);

          // Ищем центральный хаб (ID 81 / Основной Склад Астана)
          const hubWh = (v.warehouses || []).find(w => w.warehouse_id === 81)
            || (v.warehouses || []).find(w => (w.warehouse_name && w.warehouse_name.includes('Астана')) || (w.city && w.city.includes('Астана')))
            || (v.warehouses || []).find(w => w.is_hub && ((w.free_stock ?? w.stock ?? 0) > 0));

          const freeStock = hubWh?.free_stock !== undefined
            ? Number(hubWh.free_stock)
            : (v.free_stock !== undefined ? Number(v.free_stock) : Number(hubWh?.stock ?? v.stock ?? 0));
          const hubStock = freeStock;

          // Партнерские шоурумы сохраняем только с реальным ненулевым остатком
          const otherWarehouses = (v.warehouses || []).filter(w =>
            w.warehouse_id !== 81 &&
            w.warehouse_id !== 33 &&
            w.warehouse_id !== 46 &&
            !(w.warehouse_name && w.warehouse_name.includes('Астана')) &&
            !(w.city && w.city.includes('Астана')) &&
            Number(w.free_stock ?? w.stock ?? 0) > 0
          );

          const cleanedWarehouses: Warehouse[] = [];
          if (hubStock > 0) {
            cleanedWarehouses.push({
              warehouse_id: 81,
              warehouse_name: 'Основной Склад Астана',
              city: 'Основной Склад Астана',
              is_hub: true,
              stock: hubStock,
              free_stock: freeStock,
              reserved_stock: hubWh?.reserved_stock !== undefined ? Number(hubWh.reserved_stock) : (v.reserved_stock !== undefined ? Number(v.reserved_stock) : 0),
              to_ship_stock: hubWh?.to_ship_stock !== undefined ? Number(hubWh.to_ship_stock) : (v.to_ship_stock !== undefined ? Number(v.to_ship_stock) : 0),
              to_ship_sqm: hubWh?.to_ship_sqm !== undefined ? Number(hubWh.to_ship_sqm) : (v.to_ship_sqm !== undefined ? Number(v.to_ship_sqm) : 0),
              total_stock: hubWh?.total_stock !== undefined ? Number(hubWh.total_stock) : (v.total_stock !== undefined ? Number(v.total_stock) : hubStock),
            });
          }
          for (const w of otherWarehouses) {
            if (Number(w.free_stock ?? w.stock ?? 0) > 0) {
              cleanedWarehouses.push({
                ...w,
                stock: Number(w.free_stock ?? w.stock ?? 0),
                free_stock: w.free_stock !== undefined ? Number(w.free_stock) : Number(w.stock),
                to_ship_stock: w.to_ship_stock !== undefined ? Number(w.to_ship_stock) : 0,
                to_ship_sqm: w.to_ship_sqm !== undefined ? Number(w.to_ship_sqm) : 0,
                is_hub: false,
              });
            }
          }

          const varArticle = v.article || (v as any).design_article || raw.article || article;
          const varBarcode = v.barcode || (v as any).barcode;
          const varCode = v.code || (v as any).code;

          const isOnSale = Boolean(v.is_on_sale || (v.old_price && Number(v.old_price) > rawVariantPrice) || (v.old_price_per_sqm && Number(v.old_price_per_sqm) > vPricePerSqm));
          const oldPrice = v.old_price ? Number(v.old_price) : null;
          const oldPricePerSqm = v.old_price_per_sqm ? Number(v.old_price_per_sqm) : null;
          const saleDiscountPercent = Number(v.sale_discount_percent) || 0;
          const toShipStock = v.to_ship_stock !== undefined ? Number(v.to_ship_stock) : 0;
          const toShipSqm = v.to_ship_sqm !== undefined ? Number(v.to_ship_sqm) : Math.round(toShipStock * area * 100) / 100;

          return {
            ...v,
            size: s,
            area_sqm: area,
            sku: v.sku || `${article}-${s.replace(/\s+/g, '')}`,
            article: varArticle,
            barcode: varBarcode,
            code: varCode,
            is_on_sale: isOnSale,
            old_price: oldPrice,
            old_price_per_sqm: oldPricePerSqm,
            sale_discount_percent: saleDiscountPercent,
            free_stock: freeStock,
            reserved_stock: v.reserved_stock !== undefined ? Number(v.reserved_stock) : 0,
            to_ship_stock: toShipStock,
            to_ship_sqm: toShipSqm,
            total_stock: v.total_stock !== undefined ? Number(v.total_stock) : hubStock,
            stock: freeStock,
            showroom_qty: v.showroom_qty !== undefined ? Number(v.showroom_qty) : (v.dealer_stock?.in_showroom_qty || 0),
            showroom_sqm: v.showroom_sqm !== undefined ? Number(v.showroom_sqm) : (v.dealer_stock?.in_showroom_sqm || 0),
            price_per_sqm: vPricePerSqm,
            price: rawVariantPrice,
            piece_price: (v as any).piece_price || rawVariantPrice,
            base_price: rawVariantPrice,
            currency: v.currency || raw.currency || 'USD',
            warehouses: cleanedWarehouses,
            dealer_stock: v.dealer_stock,
          };
        })
      : [{
          id: `var-${article}-${itemSize}`,
          size: itemSize,
          sku: `${article}-${itemSize.replace(/\s+/g, '')}`,
          article: raw.article || article,
          barcode: (raw as any).barcode,
          code: (raw as any).code,
          area_sqm: calculateArea(itemSize),
          price_per_sqm: baseSqmPrice,
          price: Math.round(baseSqmPrice * calculateArea(itemSize) * 100) / 100,
          piece_price: Math.round(baseSqmPrice * calculateArea(itemSize) * 100) / 100,
          base_price: Math.round(baseSqmPrice * calculateArea(itemSize) * 100) / 100,
          currency: raw.currency || 'USD',
          warehouses: [],
          dealer_stock: (raw as any).dealer_stock,
        }];

    const existing = map.get(groupKey);
    if (!existing) {
      const photos = getValidImages(raw.images);
      const rawPrice = Number((raw as any).price) > 0 ? Number((raw as any).price) : undefined;
      const rawMinPrice = Number((raw as any).min_price) > 0 ? Number((raw as any).min_price) : undefined;
      const rawMaxPrice = Number((raw as any).max_price) > 0 ? Number((raw as any).max_price) : undefined;

      map.set(groupKey, {
        ...raw,
        id: String(raw.id || `carpet-${groupKey.toLowerCase().replace(/[^a-z0-9_-]/g, '-')}`),
        name: raw.name || parsed.cleanName || `${category === 'Дорожки' ? 'Дорожка' : 'Ковер'} ${collection} ${article}${color ? ` (${color})` : ''}`,
        category: category,
        collection: collection,
        article: article,
        color: color,
        currency: raw.currency || 'USD',
        price_per_sqm: baseSqmPrice,
        old_price_per_sqm: itemVariants.find(iv => iv.is_on_sale && iv.old_price_per_sqm)?.old_price_per_sqm || (raw as any).old_price_per_sqm || null,
        is_on_sale: itemVariants.some(iv => iv.is_on_sale) || Boolean((raw as any).is_on_sale),
        price: rawPrice,
        min_price: rawMinPrice,
        max_price: rawMaxPrice,
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
          // Если размер уже есть — обновляем остатки хаба и дилерские остатки
          const targetVariant = existing.variants.find(ev => ev.size === v.size);
          if (targetVariant) {
            const existingHub = targetVariant.warehouses.find(w => w.warehouse_id === 81 || w.is_hub);
            const incomingHub = v.warehouses.find(w => w.warehouse_id === 81 || w.is_hub);
            if (existingHub && incomingHub) {
              existingHub.stock = Math.max(existingHub.stock, incomingHub.stock);
            }
            for (const w of v.warehouses) {
              if (w.warehouse_id !== 81 && !w.is_hub && w.stock > 0) {
                const exWh = targetVariant.warehouses.find(tw => tw.warehouse_id === w.warehouse_id);
                if (exWh) {
                  exWh.stock = Math.max(exWh.stock, w.stock);
                } else {
                  targetVariant.warehouses.push({ ...w });
                }
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

  // Сортируем размеры каждого товара по возрастанию площади
  const result: Product[] = [];
  for (const prod of map.values()) {
    prod.variants.sort((a, b) => {
      const areaA = a.area_sqm || calculateArea(a.size);
      const areaB = b.area_sqm || calculateArea(b.size);
      return areaA - areaB;
    });
    // Финальная нормализация склада хаба: имя и город строго «Основной Склад Астана», только с stock > 0
    for (const v of prod.variants) {
      v.warehouses = (v.warehouses || [])
        .filter(w => Number(w.stock) > 0)
        .map(w => {
          if (w.warehouse_id === 81 || w.is_hub || (w.warehouse_name && w.warehouse_name.includes('Астана'))) {
            return {
              ...w,
              warehouse_id: 81,
              warehouse_name: 'Основной Склад Астана',
              city: 'Основной Склад Астана',
              is_hub: true,
              stock: Number(w.stock),
            };
          }
          return {
            ...w,
            stock: Number(w.stock),
          };
        });
    }
    result.push(prod);
  }

  return result;
}

/**
 * Склад для клиентов:
 * 1. В ответе ERP приходят только склады, где товар реально есть в наличии (stock > 0).
 * 2. Автоматический режим: клиент видит свой склад и центральный склад Астана (ID 81).
 *    Если своего склада нет — видит ТОЛЬКО центральный склад Астана.
 * 3. Администратор может в любой момент скрыть или включить видимость любых складов для клиента.
 */
export function filterClientWarehouses(
  warehouses: Warehouse[] = [],
  showroomWarehouseId?: number | null,
  showroomWarehouseName?: string | null,
  clientOrIsAdmin?: boolean | Partial<Profile> | string | number | null,
  displaySettings?: { show_hub_warehouse?: boolean; show_showroom_warehouse?: boolean; hidden_warehouses?: string[] } | null
): Warehouse[] {
  if (!warehouses || warehouses.length === 0) {
    return [];
  }

  // Если явно указано isAdmin === true
  const isAdmin = clientOrIsAdmin === true;
  if (isAdmin) {
    const hidden = new Set(displaySettings?.hidden_warehouses || []);
    return warehouses.filter(w => {
      const name = w.warehouse_name || w.city;
      return !hidden.has(name) && !hidden.has(String(w.warehouse_id)) && (Number(w.stock) > 0 || Number(w.free_stock ?? 0) > 0);
    });
  }

  // Определяем ID клиента, если передан профиль или строка/число
  let clientProfile: Partial<Profile> | null = null;
  if (clientOrIsAdmin && typeof clientOrIsAdmin === 'object') {
    clientProfile = clientOrIsAdmin as Partial<Profile>;
  } else if (typeof clientOrIsAdmin === 'string' || typeof clientOrIsAdmin === 'number') {
    clientProfile = { partner_id: String(clientOrIsAdmin), showroom_warehouse_id: showroomWarehouseId };
  } else if (showroomWarehouseId) {
    clientProfile = { showroom_warehouse_id: showroomWarehouseId, showroom_warehouse_name: showroomWarehouseName };
  }

  return filterWarehousesForClient(warehouses, clientProfile, showroomWarehouseName);
}

export function triggerCatalogReload() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('synergy:reload-catalog'));
  }
}

export function useProducts(customDealerId?: string | number) {
  const authContext = useContext(AuthContext);
  const effectiveDealerId = customDealerId ?? authContext?.impersonatedProfile?.partner_id ?? authContext?.profile?.partner_id ?? undefined;

  const [products, setProducts] = useState<Product[]>([]);
  const [summary, setSummary] = useState<StockSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadCounter, setReloadCounter] = useState(0);

  useEffect(() => {
    const handler = () => {
      setLoading(true);
      setReloadCounter(c => c + 1);
    };
    window.addEventListener('synergy:reload-catalog', handler);
    window.addEventListener('synergy:reload-warehouse-settings', handler);
    return () => {
      window.removeEventListener('synergy:reload-catalog', handler);
      window.removeEventListener('synergy:reload-warehouse-settings', handler);
    };
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

  // Сквозная подписка на Supabase Realtime канал portal_live_updates
  useEffect(() => {
    const channel = supabase
      .channel('portal_live_updates')
      .on('broadcast', { event: 'stock_changed' }, (payload) => {
        console.log('[Realtime: stock_changed] Updating catalog in-flight:', payload);
        fetchCatalogFromErp(effectiveDealerId, undefined, true).then(res => {
          if (res && res.products) {
            setProducts(mergeProducts(res.products));
            if (res.summary) setSummary(res.summary);
          }
        }).catch(() => {});
      })
      .on('broadcast', { event: 'partner_stock_released' }, (payload: any) => {
        const data = payload?.payload;
        if (!data || !data.sku) return;
        window.dispatchEvent(new CustomEvent('synergy:stock-event', { detail: data }));
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [effectiveDealerId]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const erpData = await fetchCatalogFromErp(effectiveDealerId);
        if (!cancelled && erpData && erpData.success && Array.isArray(erpData.products) && erpData.products.length > 0) {
          const merged = mergeProducts(erpData.products as Product[]);
          setProducts(merged);
          if (erpData.summary) {
            setSummary(erpData.summary);
          }
          setLoading(false);
          return;
        }
        if (!cancelled) {
          if (erpData?.summary) setSummary(erpData.summary);
          setLoading(false);
        }
      } catch (erpErr) {
        console.warn('[useProducts] ERP catalog fetch error:', erpErr);
        if (!cancelled) setError(erpErr instanceof Error ? erpErr.message : 'Ошибка загрузки каталога ERP');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [reloadCounter, effectiveDealerId]);

  return { products, summary, loading, error };
}

export function useProduct(id: string | undefined, customDealerId?: string | number) {
  const authContext = useContext(AuthContext);
  const effectiveDealerId = customDealerId ?? authContext?.impersonatedProfile?.partner_id ?? authContext?.profile?.partner_id ?? undefined;

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
        const erpData = await fetchCatalogFromErp(effectiveDealerId);
        if (!cancelled && erpData && erpData.success && Array.isArray(erpData.products)) {
          const merged = mergeProducts(erpData.products as Product[]);
          const found = merged.find(p => p.id === id || p.variants.some(v => v.id === id || v.sku === id));
          if (found) {
            setProduct(found);
            setLoading(false);
            return;
          }
        }
        if (!cancelled) {
          setLoading(false);
        }
      } catch (erpErr) {
        console.warn('[useProduct] ERP single product fetch error:', erpErr);
        if (!cancelled) setError(erpErr instanceof Error ? erpErr.message : 'Ошибка загрузки товара ERP');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [id, effectiveDealerId]);

  return { product, loading, error };
}
