import type { CartItem } from '@/types';
import { calcSqm, parseSizeDimensions } from '@/types';

export function sizeArea(size: string): number {
  const { w, h } = parseSizeDimensions(size);
  return w * h;
}

export function pluralPositions(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'позиция';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'позиции';
  return 'позиций';
}

export function fmt2(n: number): string {
  return n.toFixed(2);
}

export interface SizeSubtotal {
  size: string;
  qty: number;
  sqm: number;
  sum: number;
  area: number;
}

export interface StockConflictItem {
  sku?: string;
  item_id?: number | string;
  productId?: string;
  warehouse_id?: number;
  warehouse?: string;
  available_qty?: number;
  requested_qty?: number;
  productName?: string;
  collection?: string;
  size?: string;
}

export function matchCartItemConflict(
  item: CartItem,
  conflicts?: StockConflictItem[] | null,
  totalCartItemsCount?: number
): StockConflictItem | null {
  if (Array.isArray(conflicts) && conflicts.length > 0) {
    const itSku = String(item.sku || '').trim().toLowerCase();
    const itProdId = String(item.productId || '').trim().toLowerCase();
    const itItemId = Number(item.item_id) || 0;

    const found = conflicts.find(c => {
      const cSku = String(c.sku || '').trim().toLowerCase();
      const cProdId = String(c.productId || '').trim().toLowerCase();
      const cItemId = Number(c.item_id) || 0;
      if (itItemId > 0 && cItemId > 0 && itItemId === cItemId) return true;
      if (itSku && cSku && (itSku === cSku || itProdId === cSku)) return true;
      if (itProdId && cProdId && itProdId === cProdId && (!c.size || c.size === item.size)) return true;
      if (totalCartItemsCount === 1 && conflicts.length === 1) return true;
      return false;
    });

    if (found) {
      return {
        ...found,
        sku: found.sku || item.sku,
        productName: found.productName || item.productName,
        collection: found.collection || item.collection,
        size: found.size || item.size,
        warehouse: found.warehouse || item.warehouse,
        available_qty: typeof found.available_qty === 'number' ? found.available_qty : (item.maxStock ?? 0),
        requested_qty: typeof found.requested_qty === 'number' ? found.requested_qty : item.quantity,
      };
    }
  }

  if (item.maxStock === 0 || (typeof item.maxStock === 'number' && item.quantity > item.maxStock)) {
    return {
      sku: item.sku,
      item_id: item.item_id,
      productId: item.productId,
      warehouse: item.warehouse,
      warehouse_id: item.warehouse_id,
      available_qty: item.maxStock,
      requested_qty: item.quantity,
      productName: item.productName,
      collection: item.collection,
      size: item.size,
    };
  }

  return null;
}

export function buildEnrichedConflictItems(
  items: CartItem[],
  rawConflicts?: StockConflictItem[] | null
): StockConflictItem[] {
  const result: StockConflictItem[] = [];
  const seenKeys = new Set<string>();

  for (const item of items) {
    const matched = matchCartItemConflict(item, rawConflicts, items.length);
    if (matched) {
      const key = `${item.productId}::${item.size}::${item.warehouse}`;
      seenKeys.add(key);
      result.push(matched);
    }
  }

  if (Array.isArray(rawConflicts) && result.length === 0) {
    for (const rc of rawConflicts) {
      result.push(rc);
    }
  }

  return result;
}

export function parseInsufficientStockError(
  err: any,
  items: CartItem[]
): {
  conflicts: StockConflictItem[];
  primaryDetails: StockConflictItem;
  formattedMessage: string;
} {
  const rawList: any[] =
    Array.isArray(err?.insufficient_items) && err.insufficient_items.length > 0
      ? err.insufficient_items
      : Array.isArray(err?.details?.insufficient_items) && err.details.insufficient_items.length > 0
      ? err.details.insufficient_items
      : err?.details
      ? [err.details]
      : [];

  const conflicts: StockConflictItem[] = rawList.map(raw => {
    const cSku = String(raw?.sku || '').trim().toLowerCase();
    const cItemId = Number(raw?.item_id) || 0;
    const matchedItem = items.find(it => {
      const itSku = String(it.sku || '').trim().toLowerCase();
      const itProdId = String(it.productId || '').trim().toLowerCase();
      const itItemId = Number(it.item_id) || 0;
      if (itItemId > 0 && cItemId > 0 && itItemId === cItemId) return true;
      if (cSku && (itSku === cSku || itProdId === cSku)) return true;
      return items.length === 1;
    });

    return {
      sku: matchedItem?.sku || raw?.sku || '',
      item_id: matchedItem?.item_id || raw?.item_id,
      productId: matchedItem?.productId,
      warehouse: matchedItem?.warehouse || raw?.warehouse,
      warehouse_id: matchedItem?.warehouse_id || raw?.warehouse_id,
      available_qty: typeof raw?.available_qty === 'number' ? Math.max(0, raw.available_qty) : 0,
      requested_qty: typeof raw?.requested_qty === 'number' ? raw.requested_qty : (matchedItem?.quantity ?? 1),
      productName: matchedItem?.productName || raw?.product_name || raw?.name,
      collection: matchedItem?.collection || raw?.collection,
      size: matchedItem?.size || raw?.size,
    };
  });

  const primaryDetails: StockConflictItem = conflicts[0] || {
    sku: err?.details?.sku,
    available_qty: typeof err?.details?.available_qty === 'number' ? err.details.available_qty : 0,
    requested_qty: typeof err?.details?.requested_qty === 'number' ? err.details.requested_qty : 1,
  };

  const lines = conflicts.map(c => {
    const title = c.productName ? `«${c.productName}»` : `Артикул ${c.sku || '—'}`;
    const meta = [c.size ? `размер ${c.size}` : '', c.collection ? `колл. ${c.collection}` : '', c.sku ? `SKU: ${c.sku}` : '']
      .filter(Boolean)
      .join(', ');
    return `${title}${meta ? ` (${meta})` : ''} — доступно: ${c.available_qty ?? 0} шт., в заказе: ${c.requested_qty ?? 1} шт.`;
  });

  const formattedMessage =
    lines.length > 0
      ? `Недостаточно свободного остатка на складе для номенклатуры: ${lines.join('; ')}`
      : err?.message || 'Недостаточно свободного остатка на складе для выбранной номенклатуры';

  return { conflicts, primaryDetails, formattedMessage };
}

export function syncCartItemWithProduct(
  item: CartItem,
  products: any[],
  getVariantPrice: (collection: string, size: string, basePrice: number, pricePerSqm?: number) => number,
  getPricePerSqm: (collection: string, size: string, basePrice: number, pricePerSqm?: number) => number,
  conflictOverrides?: Map<string, number>
) {
  const itSku = String(item.sku || '').trim().toLowerCase();
  const itProdId = String(item.productId || '').trim().toLowerCase();
  const itItemId = String(item.item_id || '');
  const overrideAvail =
    (itSku && conflictOverrides?.get(itSku)) ??
    (itProdId && conflictOverrides?.get(itProdId)) ??
    (itItemId && conflictOverrides?.get(itItemId));

  const prod = products.find((p: any) => p.id === item.productId || p.variants.some((v: any) => v.sku === item.sku));
  if (!prod) {
    if (overrideAvail !== undefined) {
      return { price: item.price, price_per_sqm: item.price_per_sqm, maxStock: overrideAvail, keepQuantityOnConflict: true };
    }
    return null;
  }
  const variant = prod.variants.find((v: any) => v.sku === item.sku || v.size === item.size);
  if (!variant) return null;

  const latestPrice = getVariantPrice(prod.collection, variant.size, variant.base_price, variant.price_per_sqm);
  const latestSqmPrice = getPricePerSqm(prod.collection, variant.size, variant.base_price, variant.price_per_sqm);
  const resolvedItemId = Number(variant.item_id) > 0 ? Number(variant.item_id) : item.item_id;

  if (overrideAvail !== undefined) {
    return {
      price: latestPrice,
      price_per_sqm: latestSqmPrice,
      item_id: resolvedItemId,
      maxStock: overrideAvail,
      keepQuantityOnConflict: true,
    };
  }

  const isPreorderItem = Boolean(
    item.is_preorder ||
    String(item.warehouse || '').includes('Предзаказ') ||
    ((variant.free_stock ?? 0) === 0 && Number(variant.in_production_qty ?? 0) > 0)
  );
  const inProd = Number(variant.in_production_qty ?? 0);

  if (isPreorderItem) {
    const preStock = inProd > 0 ? inProd : (item.maxStock && item.maxStock > 0 ? item.maxStock : 999);
    return { price: latestPrice, price_per_sqm: latestSqmPrice, item_id: resolvedItemId, maxStock: Math.max(0, preStock) };
  }

  const wh = variant.warehouses.find(
    (w: any) => (w.warehouse_name || w.city) === item.warehouse || w.warehouse_id === item.warehouse_id
  );
  if (wh) {
    const whStock = typeof wh.free_stock === 'number' ? wh.free_stock : (wh.stock ?? 0);
    return {
      price: latestPrice,
      price_per_sqm: latestSqmPrice,
      item_id: resolvedItemId,
      warehouse_id: wh.warehouse_id || item.warehouse_id,
      maxStock: Math.max(0, whStock),
      keepQuantityOnConflict: whStock === 0,
    };
  }

  const fallbackWh = variant.warehouses.find((w: any) => (typeof w.free_stock === 'number' ? w.free_stock : (w.stock ?? 0)) > 0);
  if (fallbackWh) {
    const fbStock = typeof fallbackWh.free_stock === 'number' ? fallbackWh.free_stock : (fallbackWh.stock ?? 0);
    return {
      price: latestPrice,
      price_per_sqm: latestSqmPrice,
      item_id: resolvedItemId,
      warehouse: fallbackWh.warehouse_name || fallbackWh.city,
      warehouse_id: fallbackWh.warehouse_id,
      maxStock: Math.max(0, fbStock),
    };
  }

  return {
    price: latestPrice,
    price_per_sqm: latestSqmPrice,
    item_id: resolvedItemId,
    maxStock: 0,
    keepQuantityOnConflict: true,
  };
}

export interface CollectionSubtotal {
  collection: string;
  qty: number;
  sqm: number;
  sum: number;
  positionsCount: number;
  sizes: SizeSubtotal[];
}

export function calcSizeSubtotals(list: CartItem[]): SizeSubtotal[] {
  const map = new Map<string, SizeSubtotal>();
  for (const item of list) {
    const existing = map.get(item.size);
    const sqm = calcSqm(item.size, item.quantity);
    const sum = item.price * item.quantity;
    if (existing) {
      existing.qty += item.quantity;
      existing.sqm += sqm;
      existing.sum += sum;
    } else {
      map.set(item.size, { size: item.size, qty: item.quantity, sqm, sum, area: sizeArea(item.size) });
    }
  }
  return Array.from(map.values()).sort((a, b) => a.area - b.area);
}

export function calcCollectionSubtotals(list: CartItem[], sizeAsc = true): CollectionSubtotal[] {
  const grouped = new Map<string, CartItem[]>();
  for (const item of list) {
    const col = item.collection || 'Без коллекции';
    const arr = grouped.get(col) || [];
    arr.push(item);
    grouped.set(col, arr);
  }
  const result: CollectionSubtotal[] = [];
  for (const [collection, colItems] of grouped.entries()) {
    const rawSizes = calcSizeSubtotals(colItems);
    const sizes = sizeAsc ? rawSizes : [...rawSizes].reverse();
    const qty = colItems.reduce((acc, it) => acc + it.quantity, 0);
    const sqm = colItems.reduce((acc, it) => acc + calcSqm(it.size, it.quantity), 0);
    const sum = colItems.reduce((acc, it) => acc + it.price * it.quantity, 0);
    result.push({
      collection,
      qty,
      sqm,
      sum,
      positionsCount: colItems.length,
      sizes,
    });
  }
  return result;
}

export const CITIES = ['Астана', 'Алматы', 'Шымкент'];

export const DEFAULT_CHECKOUT_PHONE = '+7 (778) 580-68-66';
export const CHECKOUT_PHONE_STORAGE_KEY = 'synergy:last_checkout_phone';

/**
 * Валидация телефонного номера: содержит не менее 10 значащих цифр
 */
export function isValidPhone(value: string | null | undefined): value is string {
  if (!value) return false;
  const digits = value.replace(/\D/g, '');
  return digits.length >= 10;
}

/**
 * Graceful форматирование телефонного номера по стандарту Казахстана/СНГ (+7 (XXX) XXX-XX-XX)
 */
export function formatPhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (!digits || (digits === '7' && value.trim().length <= 2)) return '';

  let rest = digits;
  if (rest.startsWith('7') || rest.startsWith('8')) {
    rest = rest.substring(1);
  }
  if (!rest) return '+7';

  let res = '+7';
  if (rest.length > 0) {
    res += ` (${rest.substring(0, 3)}`;
  }
  if (rest.length >= 4) {
    res += `) ${rest.substring(3, 6)}`;
  }
  if (rest.length >= 7) {
    res += `-${rest.substring(6, 8)}`;
  }
  if (rest.length >= 9) {
    res += `-${rest.substring(8, 10)}`;
  }
  return res;
}
