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

  const response = await fetch(`${ERP_API_URL}?action=create_order`, {
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
  const response = await fetch(`${ERP_API_URL}?action=catalog&price_type=${encodeURIComponent(priceType)}`, {
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
  const response = await fetch(`${ERP_API_URL}?action=regional_managers`, {
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
