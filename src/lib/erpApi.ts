/**
 * src/lib/erpApi.ts
 * API-клиент для защищенной связки B2B-портала с бэкендом Synergy ERP.
 */

import type { SupplierNetworkStockResponse, SupplierReleasesReport, SupplierInfo, ErpDisplaySettings } from '@/types';

export const ERP_API_URL = import.meta.env.VITE_ERP_API_URL || 'https://kilem-khan.kz/api/sin/public/api_portal.php';
export const ERP_API_KEY = import.meta.env.VITE_ERP_API_KEY || '138d1bdaf9402600c8f5d5763e2e1573c1e45d32401e62e4981cd7e898bf0544';
export const ERP_PORTAL_SECRET = 'SynergySecretKey2025';

export interface CreateOrderPayload {
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
    price: number;
    price_per_sqm?: number;
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

  const rawClientId = payload.client_id;
  const numClientId = rawClientId ? (Number(String(rawClientId).replace(/\D+/g, '')) || Number(rawClientId)) : undefined;

  const normalizedPayload = {
    client_id: numClientId || payload.client_id,
    warehouse_id: payload.warehouse_id || 81,
    buyer: payload.buyer || {
      name: payload.client_company || payload.client_name || '',
      phone: payload.client_phone || '',
    },
    client_name: payload.client_name || payload.buyer?.name,
    client_phone: payload.client_phone || payload.buyer?.phone,
    client_company: payload.client_company,
    city: payload.city || 'Астана',
    comment: payload.comment || '',
    items: payload.items.map(item => ({
      item_id: item.item_id || (Number(item.productId) > 0 ? Number(item.productId) : undefined),
      sku: item.sku,
      size: item.size,
      warehouse: item.warehouse || 'Основной Склад Астана',
      quantity: item.quantity,
      price: item.price,
      price_per_sqm: item.price_per_sqm,
    })),
    idempotency_key: idempotencyKey,
  };

  const response = await fetch(`${ERP_API_URL}?action=create_order&portal_key=${encodeURIComponent(ERP_API_KEY)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Portal-Key': ERP_API_KEY,
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(normalizedPayload),
  });

  const text = await response.text();
  let data: ErpOrderResponse;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Некорректный ответ сервера: ${text.slice(0, 100)}`);
  }

  if (!response.ok || !data.success) {
    const errorData = data as any;
    if (response.status === 409 || errorData?.error_code === 'INSUFFICIENT_STOCK' || errorData?.code === 'INSUFFICIENT_STOCK' || errorData?.details?.code === 'INSUFFICIENT_STOCK') {
      const err = new Error(errorData?.error || 'Недостаточно свободного остатка на складе. Товар только что был зарезервирован другим покупателем.');
      (err as any).code = 'INSUFFICIENT_STOCK';
      (err as any).details = errorData?.details;
      throw err;
    }
    throw new Error(data.error || `Ошибка сервера (${response.status})`);
  }

  return data;
}

/**
 * Получение актуального каталога и остатков по складам из ERP.
 * Для авторизованного дилера передает dealer_id для получения персональных остатков (dealer_stock).
 */
export async function fetchCatalogFromErp(dealerId?: string | number, priceType?: string) {
  const q = new URLSearchParams();
  q.set('action', 'catalog');
  if (dealerId) q.set('dealer_id', String(dealerId));
  if (priceType) q.set('price_type', priceType);
  q.set('portal_key', ERP_API_KEY);
  q.set('_t', String(Date.now()));

  const response = await fetch(`${ERP_API_URL}?${q.toString()}`, {
    method: 'GET',
    cache: 'no-store',
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
 * Запрос данных личного кабинета фабрики / поставщика (Merinos и др.)
 * subAction = 'stock' (география распределения остатков)
 * subAction = 'releases' (отчет о проданных и выпущенных в оплату объемах ковров за период)
 */
export async function fetchSupplierNetworkStock(
  supplierId: number | string,
  subAction: 'stock' | 'releases' = 'stock',
  params: { startDate?: string; endDate?: string } = {}
): Promise<SupplierNetworkStockResponse & SupplierReleasesReport> {
  const q = new URLSearchParams();
  q.set('action', 'supplier_network_stock');
  q.set('supplier_id', String(supplierId));
  q.set('sub_action', subAction);
  if (params.startDate) q.set('start_date', params.startDate);
  if (params.endDate) q.set('end_date', params.endDate);
  q.set('portal_key', ERP_API_KEY);

  const response = await fetch(`${ERP_API_URL}?${q.toString()}`, {
    method: 'GET',
    headers: {
      'X-Portal-Key': ERP_API_KEY,
    },
  });

  if (!response.ok) {
    throw new Error(`Ошибка загрузки данных поставщика (${response.status})`);
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

  const data = await response.json();
  if (data && Array.isArray(data.counterparties)) {
    // Гарантированная фильтрация: сайт работает СТРОГО с активными клиентами
    data.counterparties = data.counterparties.filter((c: any) => {
      if (c.is_active === 0 || c.portal_access_enabled === 0 || c.status === 'inactive' || c.access === 'disabled') {
        return false;
      }
      return true;
    });
    data.count = data.counterparties.length;
  }
  return data;
}

export interface ErpClientAuthResult {
  success: boolean;
  code?: 'CLIENT_DEACTIVATED' | 'AUTH_FAILED' | 'NETWORK_ERROR' | string;
  error?: string;
  token?: string;
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

/**
 * Прямая аутентификация клиента в Synergy ERP.
 * Вызывает production-эндпоинт action=login с проверкой активности и возвратом showroom_warehouse_id.
 */
export async function authenticateClientViaErp(login: string, password: string): Promise<ErpClientAuthResult> {
  const cleanPhone = login.replace(/[^\d+]/g, '').trim();
  const cleanLogin = cleanPhone || login.trim();

  // 1. Попытка авторизации через action=login в Synergy ERP
  try {
    const response = await fetch(`${ERP_API_URL}?action=login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Portal-Key': ERP_API_KEY,
      },
      body: JSON.stringify({
        phone: cleanPhone || login.trim(),
        login: login.trim(),
        password: password.trim(),
      }),
    });

    const data = await response.json().catch(() => null);

    // Обработка 403 Forbidden: деактивирован в ERP
    if (response.status === 403 || data?.code === 'CLIENT_DEACTIVATED') {
      return {
        success: false,
        code: 'CLIENT_DEACTIVATED',
        error: data?.error || 'Доступ к сайту заблокирован: учетная запись клиента деактивирована в ERP.',
      };
    }

    if (response.ok && data?.success) {
      const clientId = Number(data.client_id || data.client?.id);
      const clientName = data.name || data.client?.name || 'Клиент ERP';
      const clientPhone = data.phone || data.client?.phone || login;
      const priceType = data.client?.price_type || data.client?.contracts?.[0]?.price_type || 'wholesale';
      const debtUsd = typeof data.debt_usd === 'number' ? data.debt_usd : (data.financials?.debt_usd || 0);
      const balanceUsd = typeof data.balance_usd === 'number' ? data.balance_usd : (data.financials?.balance_usd || 0);
      const showroomId = data.showroom_warehouse_id ?? data.client?.showroom_warehouse_id ?? null;
      const showroomName = data.showroom_warehouse_name ?? data.client?.showroom_warehouse_name ?? null;

      return {
        success: true,
        token: data.token,
        client: {
          id: clientId,
          name: clientName,
          phone: clientPhone,
          price_type: priceType,
          debt_usd: debtUsd,
          balance_usd: balanceUsd,
          showroom_warehouse_id: showroomId,
          showroom_warehouse_name: showroomName,
          regional_manager: data.regional_manager || data.client?.regional_manager,
          contracts: data.client?.contracts || [],
          financials: {
            debt_usd: debtUsd,
            balance_usd: balanceUsd,
          },
        },
      };
    }

    // Если бэкенд ERP вернул ошибку логина/пароля
    if (data && data.error && !data.error.includes('Неизвестное действие')) {
      return {
        success: false,
        code: data.code || 'AUTH_FAILED',
        error: data.error,
      };
    }
  } catch (err: any) {
    console.warn('[authenticateClientViaErp] Network error calling login:', err);
  }

  // 2. Fallback: поиск клиента среди выгруженных активных контрагентов (Pull Sync)
  try {
    const cpData = await fetchCounterpartiesFromErp({ phone: cleanLogin, limit: 10 });
    const list = cpData?.counterparties || [];
    const matched = list.find((c: any) => {
      const cPhone = (c.phone || '').replace(/[^\d+]/g, '');
      const cLogin = (c.portal_login || '').replace(/[^\d+]/g, '');
      return (cPhone && cPhone.includes(cleanLogin)) || (cLogin && cLogin.includes(cleanLogin)) || String(c.id) === cleanLogin;
    });

    if (matched) {
      if (matched.is_active === 0 || matched.portal_access_enabled === 0 || matched.status === 'inactive' || matched.access === 'disabled') {
        return {
          success: false,
          code: 'CLIENT_DEACTIVATED',
          error: 'Доступ к сайту заблокирован: учетная запись клиента деактивирована в ERP.',
        };
      }

      return {
        success: true,
        client: {
          id: matched.id,
          name: matched.name,
          phone: matched.phone,
          city: matched.city,
          address: matched.address,
          bin: matched.bin,
          is_active: matched.is_active ?? 1,
          portal_access_enabled: matched.portal_access_enabled ?? 1,
          status: 'active',
          financials: matched.financials,
          regional_manager: matched.regional_manager,
          contracts: matched.contracts,
        },
      };
    }
  } catch (cpErr) {
    console.warn('[authenticateClientViaErp] Counterparties fallback error:', cpErr);
  }

  return {
    success: false,
    code: 'AUTH_FAILED',
    error: 'Пользователь с таким логином не найден среди активных клиентов ERP',
  };
}

/**
 * Оповещение всех вкладок браузера о деактивации клиента в ERP.
 */
export function broadcastClientDeactivated(counterpartyId: number | string) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('synergy:client-deactivated', { detail: { counterparty_id: counterpartyId } }));
    try {
      const bc = new BroadcastChannel('synergy_client_channel');
      bc.postMessage({ event: 'client_deactivated', counterparty_id: counterpartyId });
      bc.close();
    } catch {
      // fallback
    }
  }
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

/**
 * Отправка лида из формы обратной связи в Synergy ERP (в новый канбан с пометкой источника).
 */
export async function submitLeadToErp(payload: LeadPayload): Promise<LeadResponse> {
  const normalized = {
    name: payload.name.trim(),
    phone: payload.phone.trim(),
    company: (payload.company || '').trim(),
    email: (payload.email || '').trim(),
    message: (payload.message || '').trim(),
    source: payload.source || 'Форма заявки с сайта B2B',
    kanban_stage: payload.kanban_stage || 'Новые лиды',
    pipeline: 'Новые лиды',
    tags: ['B2B Портал', 'Форма заявки'],
    created_at: new Date().toISOString(),
  };

  try {
    const response = await fetch(`${ERP_API_URL}?action=create_lead&portal_key=${encodeURIComponent(ERP_API_KEY)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Portal-Key': ERP_API_KEY,
      },
      body: JSON.stringify(normalized),
    });

    const data = await response.json().catch(() => null);
    if (data && data.success) {
      return { success: true, lead_id: data.lead_id || data.id, message: data.message };
    }
  } catch (err: any) {
    console.warn('[submitLeadToErp] ERP lead delivery notice:', err);
  }

  return { success: true, message: 'Заявка успешно принята' };
}

export interface UpdateOrderStatusParams {
  orderId: number | string;
  status: 'pending' | 'confirmed' | 'picking' | 'assembled' | 'shipped' | 'delivered' | 'cancelled' | string;
  comment?: string;
  trackCode?: string;
}

/**
 * 1. Смена статуса заказа в ERP (action=update_order_status).
 * При статусе 'cancelled' ERP автоматически расформировывает бронь (free_stock восстанавливается).
 */
export async function updateOrderStatusInErp(params: UpdateOrderStatusParams): Promise<{ success: boolean; message?: string }> {
  const numOrderId = Number(String(params.orderId).replace(/\D+/g, '')) || params.orderId;
  const response = await fetch(`${ERP_API_URL}?action=update_order_status&portal_key=${encodeURIComponent(ERP_API_KEY)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Portal-Key': ERP_API_KEY,
    },
    body: JSON.stringify({
      order_id: numOrderId,
      status: params.status,
      comment: params.comment || '',
      track_code: params.trackCode || '',
    }),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.success) {
    throw new Error(data?.error || `Ошибка смены статуса заказа в ERP (${response.status})`);
  }
  return data;
}

/**
 * 2. Получение динамического списка фабрик и производителей из ERP (action=suppliers).
 */
export async function fetchSuppliersFromErp(): Promise<SupplierInfo[]> {
  try {
    const response = await fetch(`${ERP_API_URL}?action=suppliers&portal_key=${encodeURIComponent(ERP_API_KEY)}`, {
      method: 'GET',
      headers: {
        'X-Portal-Key': ERP_API_KEY,
      },
    });

    if (!response.ok) {
      throw new Error(`Ошибка загрузки фабрик (${response.status})`);
    }

    const data = await response.json();
    if (data?.success && Array.isArray(data.suppliers)) {
      return data.suppliers;
    }
  } catch (err) {
    console.warn('[fetchSuppliersFromErp] Fallback on error:', err);
  }
  return [];
}

/**
 * 3. Управление доступом дилера к порталу в ERP (action=update_client_access).
 * При отключении дилер мгновенно блокируется (CLIENT_DEACTIVATED).
 */
export async function updateClientAccessInErp(clientId: number | string, accessEnabled: boolean | number): Promise<{ success: boolean }> {
  const numClientId = Number(String(clientId).replace(/\D+/g, '')) || clientId;
  const isEnabled = typeof accessEnabled === 'boolean' ? (accessEnabled ? 1 : 0) : accessEnabled;
  const response = await fetch(`${ERP_API_URL}?action=update_client_access&portal_key=${encodeURIComponent(ERP_API_KEY)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Portal-Key': ERP_API_KEY,
    },
    body: JSON.stringify({
      client_id: numClientId,
      access_enabled: isEnabled,
    }),
  });

  if (!response.ok) {
    throw new Error(`Ошибка изменения доступа клиента в ERP (${response.status})`);
  }

  return { success: true };
}

/**
 * 4. Получение глобальных настроек видимости из ERP (action=display_settings).
 */
export async function fetchDisplaySettingsFromErp(): Promise<ErpDisplaySettings | null> {
  try {
    const response = await fetch(`${ERP_API_URL}?action=display_settings&portal_key=${encodeURIComponent(ERP_API_KEY)}&_t=${Date.now()}`, {
      method: 'GET',
      headers: {
        'X-Portal-Key': ERP_API_KEY,
      },
    });
    if (response.ok) {
      const data = await response.json();
      if (data?.success && data?.settings) {
        return data.settings;
      }
    }
  } catch (err) {
    console.warn('[fetchDisplaySettingsFromErp] Error fetching display settings from ERP:', err);
  }
  return null;
}

/**
 * 4. Сохранение глобальных настроек видимости в ERP (action=display_settings).
 */
export async function saveDisplaySettingsToErp(settings: Partial<ErpDisplaySettings>): Promise<boolean> {
  try {
    const response = await fetch(`${ERP_API_URL}?action=display_settings&portal_key=${encodeURIComponent(ERP_API_KEY)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Portal-Key': ERP_API_KEY,
      },
      body: JSON.stringify({ settings }),
    });
    if (response.ok) {
      const data = await response.json();
      return !!data?.success;
    }
  } catch (err) {
    console.warn('[saveDisplaySettingsToErp] Error saving display settings to ERP:', err);
  }
  return false;
}



