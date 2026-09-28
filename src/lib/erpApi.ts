/**
 * src/lib/erpApi.ts
 * API-клиент для защищенной связки B2B-портала с бэкендом Synergy ERP.
 */

import type {
  SupplierNetworkStockResponse,
  SupplierReleasesReport,
  SupplierInfo,
  ErpDisplaySettings,
  SupplierInboundShipmentsResponse,
  InboundShipment,
  SupplierDefectItem,
  SupplierDefectsResponse
} from '@/types';

export const ERP_PROXY_URL = '/api/erp';
export const ERP_DIRECT_URL = ERP_PROXY_URL;
export const ERP_API_URL = ERP_PROXY_URL; // alias for backwards compatibility

// ─── 1. In-Flight Request Deduplication Pool ───
const inFlightRequests = new Map<string, Promise<any>>();

export function deduplicateRequest<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inFlightRequests.get(key);
  if (existing) {
    return existing;
  }
  const promise = fn().finally(() => {
    inFlightRequests.delete(key);
  });
  inFlightRequests.set(key, promise);
  return promise;
}

// ─── 2. Unified Transport (Strictly via Server-Side Proxy /api/erp) ───
export async function erpFetch(
  action: string,
  options: {
    method?: 'GET' | 'POST';
    params?: Record<string, string | number | undefined | null>;
    body?: any;
    headers?: Record<string, string>;
  } = {}
): Promise<Response> {
  const method = options.method || 'GET';
  const q = new URLSearchParams();
  q.set('action', action);
  if (options.params) {
    for (const [k, v] of Object.entries(options.params)) {
      if (v !== undefined && v !== null) {
        q.set(k, String(v));
      }
    }
  }

  const proxyEndpoint = `${ERP_PROXY_URL}?${q.toString()}`;

  // Генерация сквозного Correlation-ID для трассировки транзакции
  const correlationId = `trc_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;

  const requestHeaders: Record<string, string> = {
    'Accept': 'application/json',
    'X-Correlation-ID': correlationId,
    ...(options.headers || {}),
  };

  // Автоматическая передача Bearer JWT токена текущей сессии
  if (typeof window !== 'undefined') {
    try {
      // 1. Ищем токен сессии Supabase Auth в localStorage
      const sbKey = Object.keys(localStorage).find(k => k.startsWith('sb-') && k.endsWith('-auth-token'));
      if (sbKey) {
        const item = localStorage.getItem(sbKey);
        if (item) {
          const parsed = JSON.parse(item);
          const accessToken = parsed?.access_token || parsed?.currentSession?.access_token;
          if (accessToken) {
            requestHeaders['Authorization'] = `Bearer ${accessToken}`;
          }
        }
      }

      // 2. Fallback на токен кастомной сессии
      const sessionStr = sessionStorage.getItem('synergy:auth_session');
      if (sessionStr) {
        const parsedSession = JSON.parse(sessionStr);
        if (parsedSession?.token && !requestHeaders['Authorization']) {
          requestHeaders['Authorization'] = `Bearer ${parsedSession.token}`;
        }
      }
    } catch {}
  }

  if (options.body && method === 'POST') {
    requestHeaders['Content-Type'] = 'application/json';
  }

  // Все обращения осуществляются строго через защищенный серверный шлюз
  return await fetch(proxyEndpoint, {
    method,
    headers: requestHeaders,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
}

/**
 * Запрос WhatsApp-согласования заказа для РМ / Администратора
 */
export async function requestOrderApprovalViaWhatsApp(params: {
  orderId: string | number;
  orderDocNumber?: string;
  clientName: string;
  clientPhone?: string;
  totalAmount: number;
  totalSqm: number;
  itemsCount: number;
  reason: string;
  managerPhone?: string;
}): Promise<{ success: boolean; message?: string }> {
  const res = await erpFetch('request_approval', {
    method: 'POST',
    body: params,
  });
  return await res.json().catch(() => ({ success: false, message: 'Сетевой сбой при отправке в WhatsApp' }));
}

// ─── 3. Stale-While-Revalidate Catalog Cache (60s TTL) ───
const CATALOG_TTL_MS = 60 * 1000;
const catalogMemoryCache = new Map<string, { timestamp: number; data: any }>();

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
    price: number;
    price_per_sqm?: number;
    quantity: number;
    width?: number;
    length?: number;
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

/**
 * Отправка заказа в Synergy ERP с защитой от дублирования и повторами при сбоях сети (Exponential Backoff).
 */
export async function submitOrderToErp(payload: CreateOrderPayload): Promise<ErpOrderResponse> {
  const idempotencyKey = typeof crypto !== 'undefined' && crypto.randomUUID 
    ? crypto.randomUUID() 
    : `order-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

  const rawClientId = payload.client_id;
  const numClientId = rawClientId ? (Number(String(rawClientId).replace(/\D+/g, '')) || Number(rawClientId)) : undefined;

  const normalizedPayload = {
    user_id: payload.user_id,
    partner_id: (payload as any).partner_id || numClientId || payload.client_id,
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
      warehouse_id: (item as any).warehouse_id || (item.warehouse && (item.warehouse.includes('Астана') || item.warehouse.includes('Основной')) ? 81 : 81),
      quantity: item.quantity,
      price: item.price,
      price_per_sqm: item.price_per_sqm,
    })),
    idempotency_key: idempotencyKey,
  };

  // Выполняем до 3 попыток при кратковременных сбоях сети
  let attempt = 0;
  const maxAttempts = 3;
  let lastResponse: Response | null = null;
  let text = '';

  while (attempt < maxAttempts) {
    attempt++;
    try {
      lastResponse = await erpFetch('create_order', {
        method: 'POST',
        headers: {
          'Idempotency-Key': idempotencyKey,
        },
        body: normalizedPayload,
      });

      text = await lastResponse.text();

      // Если 502, 503, 504 — временная ошибка шлюза, пробуем повторить
      if ([502, 503, 504].includes(lastResponse.status) && attempt < maxAttempts) {
        await new Promise(r => setTimeout(r, attempt * 800));
        continue;
      }
      break;
    } catch (netErr) {
      if (attempt < maxAttempts) {
        await new Promise(r => setTimeout(r, attempt * 800));
      } else {
        throw netErr;
      }
    }
  }

  if (!lastResponse) {
    throw new Error('Не удалось связаться с сервером заказов ERP');
  }

  let data: ErpOrderResponse;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Некорректный ответ сервера: ${text.slice(0, 100)}`);
  }

  if (!lastResponse.ok || !data.success) {
    const errorData = data as any;
    if (lastResponse.status === 409 || errorData?.error_code === 'INSUFFICIENT_STOCK' || errorData?.code === 'INSUFFICIENT_STOCK' || errorData?.details?.code === 'INSUFFICIENT_STOCK') {
      const err = new Error(errorData?.error || 'Недостаточно свободного остатка на складе. Товар только что был зарезервирован другим покупателем.');
      (err as any).code = 'INSUFFICIENT_STOCK';
      (err as any).details = errorData?.details;
      throw err;
    }
    throw new Error(data.error || `Ошибка сервера (${lastResponse.status})`);
  }

  return data;
}

/**
 * Получение актуального каталога и остатков по складам из ERP.
 * Использует Stale-While-Revalidate (SWR) кэширование и дедупликацию параллельных запросов.
 */
export async function fetchCatalogFromErp(dealerId?: string | number, priceType?: string, bypassCache = false) {
  const cacheKey = `catalog_${dealerId || 'public'}_${priceType || 'default'}`;

  // 1. Проверяем свежий кэш в памяти
  if (!bypassCache) {
    const cached = catalogMemoryCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CATALOG_TTL_MS) {
      return cached.data;
    }
  }

  // 2. Дедупликация параллельных запросов
  return deduplicateRequest(cacheKey, async () => {
    const response = await erpFetch('catalog', {
      method: 'GET',
      params: {
        dealer_id: dealerId ? String(dealerId) : undefined,
        price_type: priceType || undefined,
        refresh: bypassCache ? 'true' : undefined,
      },
    });

    const xCache = response.headers.get('x-cache');
    const xAge = response.headers.get('x-cache-age-ms');
    if (xCache) {
      console.log(`[Catalog Gateway] Status: ${xCache}${xAge ? ` (${xAge}ms)` : ''}`);
    }

    if (!response.ok) {
      throw new Error(`Ошибка загрузки каталога (${response.status})`);
    }

    const data = await response.json();
    if (data && data.success) {
      catalogMemoryCache.set(cacheKey, { timestamp: Date.now(), data });
    }
    return data;
  });
}

/**
 * Точечная загрузка одного товара по ID или артикулу (исключает скачивание всего каталога)
 */
export async function fetchSingleProductFromErp(id: string) {
  const response = await erpFetch('product', {
    method: 'GET',
    params: { id },
  });

  if (!response.ok) {
    return null;
  }

  const data = await response.json();
  return data?.product || null;
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

/**
 * Серверная пагинация, фильтрация и поиск каталога (масштабирование до 50k+ SKU)
 */
export async function fetchPaginatedCatalogFromErp(params: PaginatedCatalogParams = {}): Promise<PaginatedCatalogResult> {
  const response = await erpFetch('catalog_paginated', {
    method: 'GET',
    params: {
      page: params.page ? String(params.page) : '1',
      limit: params.limit ? String(params.limit) : '24',
      search: params.search || undefined,
      category: params.category || undefined,
      collection: params.collection || undefined,
      in_stock: params.inStockOnly ? 'true' : undefined,
    },
  });

  if (!response.ok) {
    throw new Error(`Ошибка загрузки каталога (${response.status})`);
  }

  return response.json();
}

/**
 * Проверка здоровья контуров интеграции (PostgreSQL, 1C:ERP)
 */
export async function checkSystemHealth(): Promise<{
  status: 'ok' | 'degraded' | 'down';
  timestamp?: string;
  totalLatencyMs?: number;
  checks?: {
    database: { status: string; latencyMs?: number; error?: string };
    erp_gateway: { status: string; latencyMs?: number; error?: string };
  };
}> {
  try {
    const res = await fetch('/api/health');
    if (!res.ok) {
      return { status: 'degraded' };
    }
    return await res.json();
  } catch (err: any) {
    return { status: 'down' };
  }
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
  const response = await erpFetch('supplier_network_stock', {
    method: 'GET',
    params: {
      supplier_id: String(supplierId),
      sub_action: subAction,
      start_date: params.startDate,
      end_date: params.endDate,
    },
  });

  if (!response.ok) {
    throw new Error(`Ошибка загрузки данных поставщика (${response.status})`);
  }

  return await response.json();
}

/**
 * Запрос реестра входящих поставок от фабрики и актов расхождений (ТТН vs Факт)
 * action = 'supplier_inbound_shipments'
 */
export async function fetchSupplierInboundShipments(
  supplierId?: number | string | null,
  options?: {
    status?: string;
    page?: number;
    limit?: number;
  } | string
): Promise<SupplierInboundShipmentsResponse> {
  let status = 'all';
  let page: number | undefined;
  let limit: number | undefined;

  if (typeof options === 'string') {
    status = options;
  } else if (options) {
    status = options.status || 'all';
    page = options.page;
    limit = options.limit;
  }

  const params: Record<string, string | number> = {
    _t: Date.now(),
  };

  if (supplierId !== undefined && supplierId !== null && supplierId !== 'all' && supplierId !== 0 && supplierId !== '0') {
    params.supplier_id = String(supplierId);
  }

  if (status) {
    params.status = status;
  }

  if (page) params.page = page;
  if (limit) params.limit = limit;

  const response = await erpFetch('supplier_inbound_shipments', {
    method: 'GET',
    params,
  });

  if (!response.ok) {
    throw new Error(`Ошибка загрузки реестра поставок (${response.status})`);
  }

  return await response.json();
}

/**
 * Запрос реестра бракованной продукции и рекламаций по фабрике
 * action = 'supplier_defects'
 */
export async function fetchSupplierDefects(
  supplierId: number | string,
  params: { status?: string; defectType?: string } = {}
): Promise<SupplierDefectsResponse> {
  const response = await erpFetch('supplier_defects', {
    method: 'GET',
    params: {
      supplier_id: String(supplierId),
      status: params.status,
      defect_type: params.defectType,
      _t: Date.now(),
    },
  });

  if (!response.ok) {
    throw new Error(`Ошибка загрузки рекламаций (${response.status})`);
  }

  return await response.json();
}

/**
 * Получение списка активных региональных менеджеров (РМ) и логистов (ЛМ).
 */
export async function fetchRegionalManagersFromErp() {
  const response = await erpFetch('regional_managers', { method: 'GET' });

  if (!response.ok) {
    throw new Error(`Ошибка загрузки регионалов (${response.status})`);
  }

  return await response.json();
}

/**
 * Проверка, является ли контрагент архивным, рассылочным (dummy) или деактивированным.
 */
export function isCounterpartyArchivedOrMailing(c: any): boolean {
  if (!c) return true;
  const name = String(c.name || '').toLowerCase().trim();
  const city = String(c.city || '').toLowerCase().trim();
  const status = String(c.status || '').toLowerCase().trim();
  const access = String(c.access || '').toLowerCase().trim();

  // 1. Формальные флаги деактивации / архива
  if (
    status === 'inactive' ||
    status === 'archived' ||
    status === 'archive' ||
    status === 'disabled' ||
    status === 'deleted' ||
    access === 'disabled' ||
    c.is_active === 0 ||
    c.is_active === false ||
    c.is_active === '0' ||
    c.portal_access_enabled === 0 ||
    c.portal_access_enabled === false ||
    c.portal_access_enabled === '0' ||
    c.is_archived === true ||
    c.is_archived === 1 ||
    c.archived === true ||
    c.archived === 1
  ) {
    return true;
  }

  // 2. Семантическая фильтрация недействующих / рассылочных контактов
  if (
    name.includes('рассылк') ||
    city.includes('заполним позже') ||
    name.includes('архив') ||
    name.includes('[архив]') ||
    name.includes('(архив)') ||
    name.startsWith('для рассылки')
  ) {
    return true;
  }

  return false;
}

/**
 * Проверка, является ли контрагент реально действующим активным клиентом B2B.
 */
export function isCounterpartyActive(c: any): boolean {
  return !isCounterpartyArchivedOrMailing(c);
}

/**
 * Получение списка контрагентов и их договоров (с возможностью поиска по телефону/названию).
 * По умолчанию возвращает СТРОГО действующих активных клиентов (без архива и рассылок).
 */
export async function fetchCounterpartiesFromErp(params: {
  search?: string;
  phone?: string;
  managerId?: number;
  limit?: number;
  includeArchived?: boolean;
} = {}) {
  const response = await erpFetch('counterparties', {
    method: 'GET',
    params: {
      search: params.search,
      phone: params.phone,
      manager_id: params.managerId,
      limit: params.limit,
    },
  });

  if (!response.ok) {
    throw new Error(`Ошибка загрузки контрагентов (${response.status})`);
  }

  const data = await response.json();
  if (data && Array.isArray(data.counterparties)) {
    // Размечаем каждого контрагента метаданными активности
    const tagged = data.counterparties.map((c: any) => {
      const isArchived = isCounterpartyArchivedOrMailing(c);
      return {
        ...c,
        is_archived_or_mailing: isArchived,
        is_acting_client: !isArchived,
      };
    });

    if (params.includeArchived) {
      data.counterparties = tagged;
    } else {
      // По умолчанию фильтруем строго действующих клиентов
      data.counterparties = tagged.filter((c: any) => c.is_acting_client);
    }
    data.count = data.counterparties.length;
    data.total_raw_count = tagged.length;
    data.active_count = tagged.filter((c: any) => c.is_acting_client).length;
    data.archived_count = tagged.filter((c: any) => c.is_archived_or_mailing).length;
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
    const response = await erpFetch('login', {
      method: 'POST',
      body: {
        phone: cleanPhone || login.trim(),
        login: login.trim(),
        password: password.trim(),
      },
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
  const response = await erpFetch('ping', { method: 'GET' });
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
  activeCounterpartiesCount?: number;
  archivedCounterpartiesCount?: number;
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
    fetchCounterpartiesFromErp({ limit: 300, includeArchived: true }).catch(err => ({ success: false, error: err.message, counterparties: [] })),
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

  const cpList = counterpartiesRes?.counterparties || [];
  const activeCount = counterpartiesRes?.active_count ?? cpList.filter((c: any) => c.is_acting_client).length;
  const archivedCount = counterpartiesRes?.archived_count ?? cpList.filter((c: any) => c.is_archived_or_mailing).length;

  return {
    timestamp: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    ping: pingRes,
    catalog: catalogRes,
    counterparties: counterpartiesRes,
    regionalManagers: managersRes,
    totalProducts: products.length,
    totalStockPcs,
    cities,
    totalCounterparties: cpList.length,
    activeCounterpartiesCount: activeCount,
    archivedCounterpartiesCount: archivedCount,
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
  const response = await erpFetch('client_debt', {
    method: 'GET',
    params: {
      phone: params.phone,
      counterparty_id: params.counterpartyId,
      search: params.search,
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
  const response = await erpFetch('sync_bundle', { method: 'GET' });

  if (!response.ok) {
    throw new Error(`Ошибка загрузки пакета синхронизации (${response.status})`);
  }

  return await response.json();
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

/**
 * Получение официального акта сверки взаиморасчетов из 1С:ERP
 */
export async function fetchReconciliationReportFromErp(params: {
  partnerId: string | number;
  startDate?: string;
  endDate?: string;
}): Promise<{ success: boolean; report?: ReconciliationReport; error?: string }> {
  const response = await erpFetch('get_reconciliation_report', {
    method: 'GET',
    params: {
      partner_id: params.partnerId,
      start_date: params.startDate,
      end_date: params.endDate,
    },
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    let errMsg = `Ошибка загрузки акта сверки (${response.status})`;
    try {
      const errJson = JSON.parse(errText);
      if (errJson?.error) errMsg = errJson.error;
    } catch {}
    throw new Error(errMsg);
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
  const response = await erpFetch('orders', {
    method: 'GET',
    params: {
      phone: params.phone,
      client_id: params.clientId,
      status: params.status,
      limit: params.limit,
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
    const response = await erpFetch('create_lead', {
      method: 'POST',
      body: normalized,
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
  const response = await erpFetch('update_order_status', {
    method: 'POST',
    body: {
      order_id: numOrderId,
      status: params.status,
      comment: params.comment || '',
      track_code: params.trackCode || '',
    },
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
    const response = await erpFetch('suppliers', { method: 'GET' });
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
  const response = await erpFetch('update_client_access', {
    method: 'POST',
    body: {
      client_id: numClientId,
      access_enabled: isEnabled,
    },
  });

  if (!response.ok) {
    throw new Error(`Ошибка изменения доступа клиента в ERP (${response.status})`);
  }

  return { success: true };
}

let cachedDisplaySettings: { settings: ErpDisplaySettings; expiry: number } | null = null;

export async function fetchDisplaySettingsFromErp(bypassCache = false): Promise<ErpDisplaySettings | null> {
  if (!bypassCache && cachedDisplaySettings && cachedDisplaySettings.expiry > Date.now()) {
    return cachedDisplaySettings.settings;
  }

  return deduplicateRequest('display_settings', async () => {
    try {
      const response = await erpFetch('display_settings', {
        method: 'GET',
      });
      if (response.ok) {
        const data = await response.json();
        if (data?.success && data?.settings) {
          cachedDisplaySettings = { settings: data.settings, expiry: Date.now() + 60000 };
          return data.settings;
        }
      }
    } catch (err) {
      console.warn('[fetchDisplaySettingsFromErp] Error fetching display settings from ERP:', err);
    }
    return cachedDisplaySettings ? cachedDisplaySettings.settings : null;
  });
}

/**
 * 4. Сохранение глобальных настроек видимости в ERP (action=display_settings).
 */
export async function saveDisplaySettingsToErp(settings: Partial<ErpDisplaySettings>): Promise<boolean> {
  cachedDisplaySettings = null;
  try {
    const response = await erpFetch('display_settings', {
      method: 'POST',
      body: { settings },
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



