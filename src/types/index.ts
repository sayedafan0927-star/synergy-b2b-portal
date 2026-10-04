export interface Warehouse {
  city: string;
  stock: number;
  free_stock?: number;
  reserved_stock?: number;
  to_ship_stock?: number;
  to_ship_sqm?: number;
  total_stock?: number;
  warehouse_name?: string;
  warehouse_id?: number;
  is_hub?: boolean;
}

export interface StockSummary {
  total_items: number;
  free_stock_qty: number;
  free_stock_sqm: number;
  reserved_stock_qty: number;
  reserved_stock_sqm: number;
  to_ship_qty: number;
  to_ship_sqm: number;
  total_stock_qty: number;
  total_stock_sqm: number;
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
  barcode?: string;
  code?: string;
  design_article?: string;
  size: string;
  width?: number;
  length?: number;
  area_sqm?: number;
  size_cluster?: SizeCluster;
  is_runner?: boolean;
  design_id?: string;
  shape?: string;
  shape_label?: string;
  price_per_sqm?: number;
  price?: number;
  piece_price?: number;
  base_price: number;
  currency?: string;
  is_on_sale?: boolean;
  old_price?: number | null;
  old_price_per_sqm?: number | null;
  sale_discount_percent?: number;
  free_stock?: number;
  reserved_stock?: number;
  to_ship_stock?: number;
  to_ship_sqm?: number;
  total_stock?: number;
  stock?: number;
  showroom_qty?: number;
  showroom_sqm?: number;
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

export interface InboundShipmentItem {
  article: string;
  name: string;
  barcode?: string | null;
  declared_qty: number;
  actual_qty: number;
  discrepancy_qty: number;
  status: 'shortage' | 'missing' | 'surplus' | 'unplanned' | 'matched' | string;
  reason?: string | null;
}

export interface InboundShipment {
  receipt_id: number;
  receipt_doc_number: string;
  incoming_doc_number: string;
  incoming_doc_date: string | null;
  receipt_date: string;
  supplier_id?: number | null;
  supplier_name?: string | null;
  warehouse_id: number;
  warehouse_name: string;
  city: string;
  status: string;
  reconciliation_status: 'matched' | 'discrepancy' | 'none' | 'pending' | string;
  reconciliation_status_label: string;
  declared: {
    qty_pcs: number;
    area_sqm: number;
  };
  actual: {
    qty_pcs: number;
    area_sqm: number;
  };
  discrepancy: {
    qty_pcs: number;
    area_sqm: number;
  };
  has_discrepancy: boolean;
  has_discrepancy_act?: boolean;
  discrepancy_act_number?: string | null;
  excel_download_url?: string | null;
  act_api_url?: string | null;
  comment?: string | null;
  items_count?: number;
  items?: InboundShipmentItem[];
}

export interface DiscrepancyActItem {
  line_num: number;
  article: string;
  name: string;
  barcode?: string | null;
  plan_qty: number;
  fact_qty: number;
  diff_qty: number;
  plan_sqm: number;
  fact_sqm: number;
  diff_sqm: number;
  status: 'shortage' | 'surplus' | 'unplanned' | 'matched' | string;
  status_label: string;
  reason?: string | null;
  cells?: string[];
}

export interface DiscrepancyActSummary {
  plan_qty: number;
  fact_qty: number;
  diff_qty: number;
  plan_sqm: number;
  fact_sqm: number;
  diff_sqm: number;
  shortage_count: number;
  surplus_count: number;
  unplanned_count?: number;
  matched_count: number;
  total_positions: number;
}

export interface DiscrepancyActParty {
  id?: number;
  name: string;
  bin?: string;
  country?: string;
  phone?: string;
  address?: string;
  city?: string;
}

export interface DiscrepancyActResponse {
  success: boolean;
  act_id?: number;
  act_number: string;
  act_date?: string;
  act_date_formatted: string;
  has_discrepancy: boolean;
  status?: string;
  status_label: string;
  company?: DiscrepancyActParty;
  supplier?: DiscrepancyActParty;
  warehouse?: DiscrepancyActParty;
  documents?: {
    receipt_id?: number;
    receipt_doc_number: string;
    receipt_date?: string;
    incoming_doc_number?: string;
    incoming_doc_date?: string | null;
    packing_doc_number?: string;
  };
  auditor?: {
    name: string;
    role: string;
  };
  summary: DiscrepancyActSummary;
  items: DiscrepancyActItem[];
  excel_download_url: string;
  error?: string;
}

export interface SupplierInboundShipmentsResponse {
  success: boolean;
  supplier_id?: number | null;
  supplier_name?: string | null;
  filter_status?: string;
  pagination?: {
    page: number;
    limit: number;
    total_items: number;
    total_pages: number;
  };
  total_shipments: number;
  shipments: InboundShipment[];
  error?: string;
}

export interface SupplierDefectItem {
  defect_id: string;
  carpet_id?: number;
  supplier_id?: number;
  supplier_name?: string;
  article: string;
  collection: string;
  size: string;
  warehouse_id?: number;
  warehouse_name: string;
  city: string;
  defect_type: 'factory_defect' | 'transit_damage' | 'client_return' | string;
  defect_type_label: string;
  qty_pcs: number;
  area_sqm: number;
  status: 'inspecting' | 'discounted' | 'written_off' | 'returned_to_factory' | string;
  status_label: string;
  photo_urls?: string[];
  act_number: string;
  act_date: string;
  responsible_party: 'Поставщик (фабрика)' | 'Логистика / Перевозчик' | 'Склад' | string;
  comment?: string;
}

export interface SupplierDefectsResponse {
  success: boolean;
  supplier_id: number;
  supplier_name: string;
  total_defects: number;
  defects: SupplierDefectItem[];
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
  old_price_per_sqm?: number | null;
  is_on_sale?: boolean;
  price?: number;
  min_price?: number;
  max_price?: number;
  currency?: string;
  images: string[];
  image_thumb?: string;
  supplier_id?: number | null;
  characteristics?: ProductCharacteristic[];
  variants: ProductVariant[];
}

export interface CartItem {
  productId: string;
  item_id?: number;
  productName: string;
  collection: string;
  image: string;
  size: string;
  sku: string;
  warehouse: string;
  warehouse_id?: number;
  price: number;
  price_per_sqm?: number;
  area_sqm?: number;
  quantity: number;
  maxStock?: number;
}

export type PageId =
  | 'home'
  | 'catalog'
  | 'product'
  | 'cart'
  | 'contacts'
  | 'login'
  | 'profile'
  | 'delivery'
  | 'returns'
  | 'privacy'
  | 'terms';

export interface Category {
  id: string;
  name: string;
  image: string;
  video?: string;
  poster?: string;
  count: number;
}

export interface CollectionPrice {
  collection: string;
  price_type_id: string;
  price_per_sqm: number;
}

export type SizeCluster = 'small' | 'medium' | 'large' | 'oversize';

export function getSizeCluster(areaSqm: number): SizeCluster {
  if (areaSqm < 2.5) return 'small';
  if (areaSqm <= 5.5) return 'medium';
  if (areaSqm <= 10.0) return 'large';
  return 'oversize';
}

export function isRunnerDimension(w: number, l: number, category = ''): boolean {
  if (category && category.toLowerCase().includes('дорожк')) return true;
  if (w <= 0 || l <= 0) return false;
  const ratio = Math.max(w, l) / Math.min(w, l);
  return ratio >= 2.4;
}

export function parseSizeDimensions(size: string): { w: number; h: number } {
  if (!size) return { w: 0, h: 0 };
  const normalized = String(size).replace(',', '.').replace(/[*xXхХ]/g, '×');
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

export interface SupplierInfo {
  id: number;
  name: string;
  country: string;
  bin?: string | null;
  cooperation_type?: string;
}

export interface ErpDisplaySettings {
  show_free_stock: boolean;
  show_reserved_stock: boolean;
  show_to_ship_stock: boolean;
  show_total_stock: boolean;
  show_prices: boolean;
  show_price_per_sqm: boolean;
  show_discounts: boolean;
  show_dealer_showroom: boolean;
  allow_orders_when_zero_stock: boolean;
}
