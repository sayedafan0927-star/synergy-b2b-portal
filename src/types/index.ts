export interface Warehouse {
  city: string;
  stock: number;
  warehouse_name?: string;
  warehouse_id?: number;
  is_hub?: boolean;
}

export interface DealerStock {
  in_showroom_qty: number;
  in_showroom_sqm: number;
  in_transit_qty: number;
  in_transit_sqm: number;
  available_hub_qty: number;
}

export interface ProductCharacteristic {
  name: string;
  value: string;
}

export interface ProductVariant {
  id: string;
  item_id?: number;
  sku: string;
  article?: string;
  design_article?: string;
  size: string;
  width?: number;
  length?: number;
  area_sqm?: number;
  shape?: string;
  shape_label?: string;
  price_per_sqm?: number;
  base_price: number;
  currency?: string;
  warehouses: Warehouse[];
  dealer_stock?: DealerStock;
}

export interface SupplierDistribution {
  type: 'central_hub' | 'partner_consignment_showroom' | string;
  warehouse_id?: number;
  warehouse_name?: string;
  location_name?: string;
  partner_name?: string;
  city: string;
  qty_pcs?: number;
  qty?: number;
  area_sqm?: number;
  sqm?: number;
}

export interface SupplierStockItem {
  carpet_id: number;
  collection: string;
  article: string;
  name?: string;
  size?: string;
  width?: number;
  length?: number;
  area_sqm?: number;
  total_network_qty?: number;
  total_qty?: number;
  total_network_sqm?: number;
  total_sqm?: number;
  distribution: SupplierDistribution[];
}

export interface SupplierNetworkStockResponse {
  success: boolean;
  supplier_id: number;
  supplier_name: string;
  generated_at: string;
  total_network_qty: number;
  total_sqm_in_network: number;
  items_count: number;
  items: SupplierStockItem[];
  error?: string;
}

export interface SupplierReleaseDocItem {
  carpet_id: number;
  article: string;
  size: string;
  released_qty: number;
  released_sqm: number;
  price_per_sqm_usd: number;
  total_usd: number;
}

export interface SupplierReleaseDoc {
  doc_number: string;
  date: string;
  counterparty_name: string;
  city: string;
  released_qty: number;
  released_sqm: number;
  total_usd: number;
  items?: SupplierReleaseDocItem[];
}

export interface SupplierReleasesReport {
  success: boolean;
  supplier_id: number;
  supplier_name: string;
  report_type: string;
  period: {
    start_date: string;
    end_date: string;
  };
  total_released_pcs: number;
  total_released_sqm: number;
  total_amount_usd: number;
  items_count: number;
  releases: SupplierReleaseDoc[];
  error?: string;
}

export interface Product {
  id: string;
  name: string;
  category: string;
  collection: string;
  article?: string;
  color?: string;
  shape?: string;
  shape_label?: string;
  manufacturer: string;
  material: string;
  style: string;
  country: string;
  density: string;
  pile_height: string;
  price_per_sqm?: number;
  currency?: string;
  images: string[];
  image_thumb?: string;
  supplier_id?: number | null;
  characteristics?: ProductCharacteristic[];
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
