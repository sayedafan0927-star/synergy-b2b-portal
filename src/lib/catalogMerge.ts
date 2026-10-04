import type { Product, ProductVariant, Warehouse } from '@/types';
import type { Profile } from '@/contexts/AuthContext';
import { getSizeCluster, isRunnerDimension, parseSizeDimensions } from '@/types';
import { filterWarehousesForClient } from '@/lib/warehouseVisibility';
import { calculateArea, parse1CNomenclature, getValidImages } from '@/lib/nomenclatureParser';

/**
 * Resolves authentic carpet photography with ancient steppe petroglyphs,
 * stallions, and solar tamgas matching the thematic reference design.
 */
export function getThematicCarpetImage(collection?: string, article?: string, color?: string): string | undefined {
  const coll = (collection || '').toUpperCase();
  const art = (article || '').toUpperCase();
  const col = (color || '').toUpperCase();

  // 1. FLORA 9568B — L.VIZON / L.VIZON (horses, deer, and suns)
  if (coll.includes('FLORA') && (art.includes('9568B') || art.includes('9568-B'))) {
    return '/carpets/flora-9568b.png';
  }
  // 2. AFGAN 123D / 123Д CREAM (steppe warriors and diamond medallions)
  if (coll.includes('AFGAN') && (art.includes('123') || col.includes('CREAM'))) {
    return '/carpets/afgan-123d.png';
  }
  // 3. HYPNOSE DOTLU P1010 MULTI / MULTI (solar tamgas and fine geometric weave)
  if (coll.includes('HYPNOSE') && (art.includes('P1010') || art.includes('1010'))) {
    return '/carpets/hypnose-p1010.png';
  }
  // 4. OCTAVIA 75488 071 BEIGE (ancient solar wheel petroglyphs)
  if (coll.includes('OCTAVIA') && (art.includes('75488') || col.includes('071'))) {
    return '/carpets/octavia-75488.png';
  }
  // 5. FLORA 9568G — GREY / GREY (golden running steppe stallions and golden suns)
  if (coll.includes('FLORA') && (art.includes('9568G') || (art.includes('9114G') && col.includes('GREY')))) {
    return '/carpets/flora-9568g.png';
  }

  // Graceful thematic fallbacks when ERP image is missing
  if (coll.includes('FLORA')) return '/carpets/flora-9568b.png';
  if (coll.includes('AFGAN')) return '/carpets/afgan-123d.png';
  if (coll.includes('HYPNOSE')) return '/carpets/hypnose-p1010.png';
  if (coll.includes('OCTAVIA')) return '/carpets/octavia-75488.png';
  if (coll.includes('BOBO')) return '/carpets/flora-9568g.png';
  if (coll.includes('OSLO')) return '/carpets/octavia-75488.png';
  if (coll.includes('SALOON')) return '/carpets/flora-9568b.png';
  if (coll.includes('CELESTE')) return '/carpets/afgan-123d.png';

  return undefined;
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
          const dims = parseSizeDimensions(s);
          const vWidth = dims.w > 0 ? dims.w : (v.width || 0);
          const vLength = dims.h > 0 ? dims.h : (v.length || 0);
          const sizeCluster = v.size_cluster || getSizeCluster(area);
          const isRunner = v.is_runner !== undefined ? v.is_runner : isRunnerDimension(vWidth, vLength, category);
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

          return {
            ...v,
            size: s,
            width: vWidth,
            length: vLength,
            size_cluster: sizeCluster,
            is_runner: isRunner,
            area_sqm: area,
            article: varArticle,
            barcode: varBarcode,
            code: varCode,
            base_price: rawVariantPrice,
            price_per_sqm: vPricePerSqm,
            old_price: oldPrice,
            old_price_per_sqm: oldPricePerSqm,
            is_on_sale: isOnSale,
            warehouses: cleanedWarehouses,
            stock: cleanedWarehouses.reduce((sum, w) => sum + w.stock, 0),
            free_stock: cleanedWarehouses.reduce((sum, w) => sum + (w.free_stock ?? w.stock), 0),
            dealer_stock: v.dealer_stock ? {
              in_showroom_qty: Number(v.dealer_stock.in_showroom_qty || 0),
              in_showroom_sqm: Number(v.dealer_stock.in_showroom_sqm || 0),
              in_transit_qty: Number(v.dealer_stock.in_transit_qty || 0),
              in_transit_sqm: Number(v.dealer_stock.in_transit_sqm || 0),
              available_hub_qty: Number(v.dealer_stock.available_hub_qty || hubStock),
            } : undefined,
          };
        })
      : [];

    const existing = map.get(groupKey);
    if (!existing) {
      let photos = getValidImages(raw.images);
      const thematic = getThematicCarpetImage(collection, article, color);
      if (thematic) {
        if (photos.length === 0) {
          photos = [thematic];
        } else if (!photos.includes(thematic)) {
          photos.push(thematic);
        }
      }
      const rawPrice = Number(raw.price) > 0 ? Number(raw.price) : (itemVariants[0]?.base_price || 0);
      const rawMinPrice = itemVariants.length > 0 ? Math.min(...itemVariants.map(v => v.base_price)) : rawPrice;
      const rawMaxPrice = itemVariants.length > 0 ? Math.max(...itemVariants.map(v => v.base_price)) : rawPrice;

      const rawThumb = raw.image_thumb && !raw.image_thumb.includes('unsplash.com')
        ? raw.image_thumb.replace(/^https?:\/\/(?:crm\.)?kilem-khan\.kz\/api\/sin\/public\/image\.php/i, 'https://erp.synergy-tech.kz/image.php')
        : undefined;

      map.set(groupKey, {
        ...raw,
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
        image_thumb: photos[0] || rawThumb || thematic,
        characteristics: raw.characteristics,
        variants: [...itemVariants],
      });
    } else {
      // Обогащаем медиа и характеристики, если они появились у следующего элемента того же дизайна
      const thematic = getThematicCarpetImage(collection, article, color);
      const rawPhotos = getValidImages(raw.images);
      if (rawPhotos.length > 0) {
        const currentPhotos = (existing.images || []).filter(p => !p.startsWith('/carpets/'));
        const combined = Array.from(new Set([...currentPhotos, ...rawPhotos]));
        if (thematic && !combined.includes(thematic)) {
          combined.push(thematic);
        }
        existing.images = combined;
        existing.image_thumb = combined[0];
      } else if (!existing.images || existing.images.length === 0) {
        if (thematic) {
          existing.images = [thematic];
          existing.image_thumb = thematic;
        }
      }
      if (!existing.image_thumb && raw.image_thumb && !raw.image_thumb.includes('unsplash.com')) {
        existing.image_thumb = raw.image_thumb.replace(/^https?:\/\/(?:crm\.)?kilem-khan\.kz\/api\/sin\/public\/image\.php/i, 'https://erp.synergy-tech.kz/image.php');
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
