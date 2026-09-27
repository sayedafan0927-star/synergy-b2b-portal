export interface Warehouse {
  city: string;
  stock: number;
}

export interface ProductVariant {
  id: string;
  size: string;
  sku: string;
  base_price: number;
  price_per_sqm?: number;
  area_sqm?: number;
  warehouses: Warehouse[];
}

export interface Product {
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
  price_per_sqm?: number;
  images: string[];
  image_thumb?: string;
  supplier_id: number | null;
  variants: ProductVariant[];
}

export interface CartItem {
  productId: string;
  productName: string;
  collection: string;
  image: string;
  size: string;
  sku: string;
  warehouse: string;
  price: number;
  quantity: number;
}

export type PageId =
  | 'home'
  | 'catalog'
  | 'product'
  | 'cart'
  | 'contacts'
  | 'login'
  | 'profile';

export interface Category {
  id: string;
  name: string;
  image: string;
  count: number;
}

export interface CollectionPrice {
  collection: string;
  price_type_id: string;
  price_per_sqm: number;
}

export function parseSizeDimensions(size: string): { w: number; h: number } {
  const normalized = size.replace(/[*xXхХ]/g, '×');
  const parts = normalized.split('×').map(s => parseFloat(s.trim()));
  if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
    return { w: parts[0], h: parts[1] };
  }
  return { w: 0, h: 0 };
}

export function calcSqm(size: string, qty: number): number {
  const { w, h } = parseSizeDimensions(size);
  return w * h * qty;
}

export function calcPricePerSqm(size: string, price: number): number {
  const { w, h } = parseSizeDimensions(size);
  const area = w * h;
  if (area <= 0) return 0;
  return price / area;
}

export function calcPriceFromSqm(size: string, pricePerSqm: number): number {
  const { w, h } = parseSizeDimensions(size);
  return w * h * pricePerSqm;
}
