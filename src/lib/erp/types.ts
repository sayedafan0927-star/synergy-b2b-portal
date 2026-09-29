export type {
  SupplierNetworkStockResponse,
  SupplierReleasesReport,
  SupplierInfo,
  ErpDisplaySettings,
  SupplierInboundShipmentsResponse,
  InboundShipment,
  SupplierDefectItem,
  SupplierDefectsResponse
} from '@/types';

export interface CreateOrderPayload {
  user_id?: string;
  client_id?: number | string;
  warehouse_id?: number;
  buyer?: {
    name: string;
    phone: string;
  };
  client_name?: string;
  client_phone?: string;
  client_company?: string;
  city?: string;
  comment?: string;
  contract_id?: number;
  manager_id?: number;
  price_type?: string;
  currency?: string;
  items: Array<{
    item_id?: number;
    productId?: string;
    size?: string;
    sku?: string;
    warehouse?: string;
    warehouse_id?: number;
    price: number;
    price_per_sqm?: number;
    quantity: number;
    width?: number;
    length?: number;
    area_sqm?: number;
    cell?: never;
    cell_code?: never;
    rack?: never;
    location?: never;
  }>;
}

export interface SplitSubOrder {
  doc_number: string;
  warehouse: string;
  amount: number;
  items_count: number;
}

export interface ErpOrderResponse {
  success: boolean;
  order?: {
    order_id: number;
    doc_number: string;
    client_id: number;
    warehouse_id: number;
    contract_id?: number | null;
    manager_id?: number | null;
    price_type?: string;
    total_amount: number;
    currency: string;
    status: string;
    items_count: number;
    is_buffered?: boolean;
    split_orders?: SplitSubOrder[];
  };
  split_orders?: SplitSubOrder[];
  message?: string;
  error?: string;
  code?: string;
  details?: any;
}

export interface PaginatedCatalogParams {
  page?: number;
  limit?: number;
  search?: string;
  category?: string;
  collection?: string;
  inStockOnly?: boolean;
}

export interface PaginatedCatalogResult {
  success: boolean;
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  items: any[];
  source?: string;
  error?: string;
}

export interface ErpClientAuthResult {
  success: boolean;
  code?: 'CLIENT_DEACTIVATED' | 'AUTH_FAILED' | 'NETWORK_ERROR' | string;
  error?: string;
  token?: string;
  user_type?: 'client' | 'employee';
  employee?: {
    id: number;
    name: string;
    role: 'admin' | 'manager_rm' | 'manager_lm';
    phone: string;
  };
  client?: {
    id: number;
    name: string;
    phone: string;
    city?: string;
    address?: string;
    bin?: string;
    is_active?: number | boolean;
    portal_access_enabled?: number | boolean;
    status?: string;
    price_type?: string;
    debt_usd?: number;
    balance_usd?: number;
    showroom_warehouse_id?: number | null;
    showroom_warehouse_name?: string | null;
    financials?: {
      balance_usd?: number;
      debt_usd?: number;
      credit_limit_usd?: number;
      payment_delay_days?: number;
    };
    regional_manager?: {
      id: number;
      name: string;
      phone: string;
    };
    contracts?: Array<{
      id: number;
      contract_number: string;
      price_type: string;
      currency: string;
    }>;
  };
}

export interface PingResult {
  success: boolean;
  message: string;
  server_time: string;
  version: string;
  latencyMs: number;
}

export interface ErpSyncReport {
  timestamp: string;
  ping: PingResult;
  catalog: any;
  counterparties: any;
  regionalManagers: any;
  totalProducts: number;
  totalStockPcs: number;
  cities: string[];
  totalCounterparties: number;
  activeCounterpartiesCount?: number;
  archivedCounterpartiesCount?: number;
  totalManagers: number;
  warnings: string[];
}

export interface ClientDebtReport {
  success: boolean;
  found: boolean;
  client?: {
    id: number;
    name: string;
    city: string;
    address: string;
    phone: string;
    bin: string;
    cooperation_type: string;
    credit_limit_usd: number;
    payment_delay_days: number;
    is_blocked_for_shipment: boolean;
  };
  regional_manager?: {
    id: number;
    name: string;
    phone: string;
  };
  financials?: {
    currency: string;
    balance_usd: number;
    total_debt_usd: number;
    total_paid_usd: number;
    overdue_usd: number;
    max_overdue_days: number;
    unpaid_docs_count: number;
    is_overdue: boolean;
    available_credit_usd: number;
  };
  contracts?: Array<{
    id: number;
    name: string;
    limit_days: number;
    limit_sum_usd: number;
    debt_usd: number;
    overdue_usd: number;
    overdue_days: number;
    unpaid_docs_count: number;
  }>;
  unpaid_invoices?: Array<{
    id: number;
    document_number: string;
    contract_name: string;
    amount_usd: number;
    debt_usd: number;
    paid_usd: number;
    overdue_usd: number;
    overdue_days: number;
    date_due: string;
    is_overdue: boolean;
  }>;
  error?: string;
}

export interface ReconciliationReport {
  partner_id: string;
  start_date: string;
  end_date: string;
  initial_balance: number;
  total_debit: number;
  total_credit: number;
  final_balance: number;
  transactions: Array<{
    date: string;
    doc_type: string;
    doc_number: string;
    debit: number;
    credit: number;
    comment?: string;
  }>;
}

export interface ErpOrderItem {
  id: number;
  item_id: number;
  name: string;
  sku: string;
  size: string;
  width: number;
  length: number;
  area_sqm: number;
  total_sqm: number;
  quantity: number;
  price: number;
  price_per_sqm: number;
  total: number;
  image: string;
}

export interface ErpClientOrder {
  id: number;
  doc_number: string;
  date: string;
  client_id: number;
  client_name: string;
  client_phone: string;
  warehouse_id: number;
  warehouse_name: string;
  total_amount: number;
  total_sqm: number;
  currency: string;
  is_posted: boolean;
  status_code: 'pending' | 'reserved' | 'picking' | 'shipped' | 'delivered' | 'cancelled';
  status: string;
  comment: string;
  items_count: number;
  items: ErpOrderItem[];
}

export interface ErpOrdersResponse {
  success: boolean;
  count: number;
  orders: ErpClientOrder[];
  error?: string;
}

export interface LeadPayload {
  name: string;
  phone: string;
  company?: string;
  email?: string;
  message?: string;
  source?: string;
  kanban_stage?: string;
}

export interface LeadResponse {
  success: boolean;
  lead_id?: number | string;
  message?: string;
  error?: string;
}

export interface UpdateOrderStatusParams {
  orderId: number | string;
  status: 'pending' | 'confirmed' | 'picking' | 'assembled' | 'shipped' | 'delivered' | 'cancelled' | string;
  comment?: string;
  trackCode?: string;
}
