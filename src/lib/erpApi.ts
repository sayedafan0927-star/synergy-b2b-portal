/**
 * src/lib/erpApi.ts
 * API-клиент для защищенной связки B2B-портала с бэкендом Synergy ERP.
 */

export const ERP_API_URL = import.meta.env.VITE_ERP_API_URL || 'https://kilem-khan.kz/api/sin/public/api_portal.php';
export const ERP_API_KEY = import.meta.env.VITE_ERP_API_KEY || '138d1bdaf9402600c8f5d5763e2e1573c1e45d32401e62e4981cd7e898bf0544';

export interface CreateOrderPayload {
  client_name: string;
  client_phone: string;
  client_company?: string;
  city: string;
  comment?: string;
  contract_id?: number;
  manager_id?: number;
  price_type?: string;
  currency?: string;
  items: Array<{
    productId: string;
    size: string;
    sku: string;
    warehouse: string;
    price: number;
    quantity: number;
    width?: number;
    length?: number;
  }>;
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
  };
  message?: string;
  error?: string;
}

/**
 * Отправка заказа в Synergy ERP с защитой от дублирования (Idempotency Key).
 */
export async function submitOrderToErp(payload: CreateOrderPayload): Promise<ErpOrderResponse> {
  const idempotencyKey = typeof crypto !== 'undefined' && crypto.randomUUID 
    ? crypto.randomUUID() 
    : `order-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

  const response = await fetch(`${ERP_API_URL}?action=create_order&portal_key=${encodeURIComponent(ERP_API_KEY)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Portal-Key': ERP_API_KEY,
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({
      ...payload,
      idempotency_key: idempotencyKey,
    }),
  });

  const text = await response.text();
  let data: ErpOrderResponse;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Некорректный ответ сервера: ${text.slice(0, 100)}`);
  }

  if (!response.ok || !data.success) {
    throw new Error(data.error || `Ошибка сервера (${response.status})`);
  }

  return data;
}

/**
 * Получение актуального каталога и остатков по складам из ERP.
 */
export async function fetchCatalogFromErp(priceType = 'price_commission') {
  const response = await fetch(`${ERP_API_URL}?action=catalog&price_type=${encodeURIComponent(priceType)}&portal_key=${encodeURIComponent(ERP_API_KEY)}`, {
    method: 'GET',
    headers: {
      'X-Portal-Key': ERP_API_KEY,
    },
  });

  if (!response.ok) {
    throw new Error(`Ошибка загрузки каталога (${response.status})`);
  }

  return await response.json();
}

/**
 * Получение списка активных региональных менеджеров (РМ) и логистов (ЛМ).
 */
export async function fetchRegionalManagersFromErp() {
  const response = await fetch(`${ERP_API_URL}?action=regional_managers&portal_key=${encodeURIComponent(ERP_API_KEY)}`, {
    method: 'GET',
    headers: {
      'X-Portal-Key': ERP_API_KEY,
    },
  });

  if (!response.ok) {
    throw new Error(`Ошибка загрузки регионалов (${response.status})`);
  }

  return await response.json();
}

/**
 * Получение списка контрагентов и их договоров (с возможностью поиска по телефону/названию).
 */
export async function fetchCounterpartiesFromErp(params: { search?: string; phone?: string; managerId?: number; limit?: number } = {}) {
  const q = new URLSearchParams();
  q.set('portal_key', ERP_API_KEY);
  if (params.search) q.set('search', params.search);
  if (params.phone) q.set('phone', params.phone);
  if (params.managerId) q.set('manager_id', String(params.managerId));
  if (params.limit) q.set('limit', String(params.limit));

  const response = await fetch(`${ERP_API_URL}?action=counterparties&${q.toString()}`, {
    method: 'GET',
    headers: {
      'X-Portal-Key': ERP_API_KEY,
    },
  });

  if (!response.ok) {
    throw new Error(`Ошибка загрузки контрагентов (${response.status})`);
  }

  return await response.json();
}

export interface PingResult {
  success: boolean;
  message: string;
  server_time: string;
  version: string;
  latencyMs: number;
}

/**
 * Проверка соединения с ERP (health check) и измерение задержки.
 */
export async function pingErp(): Promise<PingResult> {
  const start = performance.now();
  const response = await fetch(`${ERP_API_URL}?action=ping&portal_key=${encodeURIComponent(ERP_API_KEY)}`, {
    method: 'GET',
    headers: {
      'X-Portal-Key': ERP_API_KEY,
    },
  });

  const latencyMs = Math.round(performance.now() - start);

  if (!response.ok) {
    throw new Error(`Ошибка пинга ERP (${response.status})`);
  }

  const data = await response.json();
  return {
    success: !!data.success,
    message: data.message || '',
    server_time: data.server_time || '',
    version: data.version || '1.0.0',
    latencyMs,
  };
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
  totalManagers: number;
  warnings: string[];
}

/**
 * Полная синхронизация и диагностический опрос всех узлов ERP.
 */
export async function syncAllErpData(): Promise<ErpSyncReport> {
  const [pingRes, catalogRes, counterpartiesRes, managersRes] = await Promise.all([
    pingErp(),
    fetchCatalogFromErp(),
    fetchCounterpartiesFromErp({ limit: 100 }).catch(err => ({ success: false, error: err.message, counterparties: [] })),
    fetchRegionalManagersFromErp().catch(err => ({ success: false, error: err.message, managers: [] })),
  ]);

  const products = catalogRes?.products || [];
  const cities = catalogRes?.cities || [];
  let totalStockPcs = 0;
  const warnings: string[] = [];

  for (const p of products) {
    let pStock = 0;
    for (const v of p.variants || []) {
      for (const w of v.warehouses || []) {
        totalStockPcs += (w.stock || 0);
        pStock += (w.stock || 0);
      }
    }
    if (pStock === 0) {
      warnings.push(`Коллекция "${p.collection || p.name}" (ID ${p.id}): нулевой остаток на всех складах.`);
    }
  }

  return {
    timestamp: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    ping: pingRes,
    catalog: catalogRes,
    counterparties: counterpartiesRes,
    regionalManagers: managersRes,
    totalProducts: products.length,
    totalStockPcs,
    cities,
    totalCounterparties: counterpartiesRes?.counterparties?.length || counterpartiesRes?.count || 0,
    totalManagers: managersRes?.managers?.length || managersRes?.count || 0,
    warnings,
  };
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

/**
 * Получение персональной задолженности и неоплаченных накладных клиента из ERP.
 */
export async function fetchClientDebtFromErp(params: { phone?: string; counterpartyId?: number; search?: string }): Promise<ClientDebtReport> {
  const q = new URLSearchParams();
  q.set('portal_key', ERP_API_KEY);
  if (params.phone) q.set('phone', params.phone);
  if (params.counterpartyId) q.set('counterparty_id', String(params.counterpartyId));
  if (params.search) q.set('search', params.search);

  const response = await fetch(`${ERP_API_URL}?action=client_debt&${q.toString()}`, {
    method: 'GET',
    headers: {
      'X-Portal-Key': ERP_API_KEY,
    },
  });

  if (!response.ok) {
    throw new Error(`Ошибка загрузки задолженности (${response.status})`);
  }

  return await response.json();
}

/**
 * Получение полного пакета синхронизации всех клиентов, балансов и РМ.
 */
export async function fetchSyncBundleFromErp() {
  const response = await fetch(`${ERP_API_URL}?action=sync_bundle&portal_key=${encodeURIComponent(ERP_API_KEY)}`, {
    method: 'GET',
    headers: {
      'X-Portal-Key': ERP_API_KEY,
    },
  });

  if (!response.ok) {
    throw new Error(`Ошибка загрузки пакета синхронизации (${response.status})`);
  }

  return await response.json();
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

/**
 * Получение истории заказов клиента из Synergy ERP (1C / WMS).
 */
export async function fetchClientOrdersFromErp(params: { phone?: string; clientId?: number; status?: string; limit?: number } = {}): Promise<ErpOrdersResponse> {
  const q = new URLSearchParams();
  q.set('portal_key', ERP_API_KEY);
  if (params.phone) q.set('phone', params.phone);
  if (params.clientId) q.set('client_id', String(params.clientId));
  if (params.status) q.set('status', params.status);
  if (params.limit) q.set('limit', String(params.limit));

  const response = await fetch(`${ERP_API_URL}?action=orders&${q.toString()}`, {
    method: 'GET',
    headers: {
      'X-Portal-Key': ERP_API_KEY,
    },
  });

  if (!response.ok) {
    throw new Error(`Ошибка загрузки заказов (${response.status})`);
  }

  return await response.json();
}


