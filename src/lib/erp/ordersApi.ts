import { erpFetch } from './core';
import type {
  CreateOrderPayload,
  ErpOrderResponse,
  ErpOrdersResponse,
  LeadPayload,
  LeadResponse,
  UpdateOrderStatusParams,
} from './types';

export function parseSizeDimensions(sizeStr?: string): { width: number; length: number; area_sqm: number } {
  if (!sizeStr) return { width: 1.6, length: 2.3, area_sqm: 3.68 };
  const cleaned = sizeStr.replace(',', '.');
  const parts = cleaned.split(/[*×xXхХ]/).map(s => parseFloat(s.trim()));
  if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1]) && parts[0] > 0 && parts[1] > 0) {
    const width = Math.round(parts[0] * 100) / 100;
    const length = Math.round(parts[1] * 100) / 100;
    const area_sqm = Math.round(width * length * 100) / 100;
    return { width, length, area_sqm };
  }
  return { width: 1.6, length: 2.3, area_sqm: 3.68 };
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

/**
 * Отправка заказа в Synergy ERP с защитой от дублирования и повторами при сбоях сети (Exponential Backoff).
 */
export async function submitOrderToErp(payload: CreateOrderPayload): Promise<ErpOrderResponse> {
  const idempotencyKey = payload.idempotency_key || (typeof crypto !== 'undefined' && crypto.randomUUID 
    ? crypto.randomUUID() 
    : `order-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`);

  const rawClientId = payload.client_id;
  const numClientId = rawClientId ? (Number(String(rawClientId).replace(/\D+/g, '')) || Number(rawClientId)) : undefined;

  const defaultWarehouseId = payload.warehouse_id || (payload.items?.[0] as any)?.warehouse_id || 81;

  const normalizedPayload = {
    idempotency_key: idempotencyKey,
    user_id: payload.user_id,
    partner_id: (payload as any).partner_id || numClientId || payload.client_id,
    client_id: numClientId || payload.client_id,
    warehouse_id: defaultWarehouseId,
    buyer: payload.buyer || {
      name: payload.client_company || payload.client_name || '',
      phone: payload.client_phone || '',
    },
    client_name: payload.client_name || payload.buyer?.name,
    client_phone: payload.client_phone || payload.buyer?.phone,
    client_company: payload.client_company,
    city: payload.city || 'Астана',
    comment: payload.comment || '',
    items: payload.items.map(item => {
      const dims = parseSizeDimensions(item.size);
      const width = item.width ?? dims.width;
      const length = item.length ?? dims.length;
      const area_sqm = item.area_sqm ?? dims.area_sqm;
      const itemObj: Record<string, any> = {
        item_id: item.item_id || (Number(item.productId) > 0 ? Number(item.productId) : undefined),
        sku: item.sku,
        size: item.size,
        warehouse: item.warehouse || 'Основной Склад Астана',
        warehouse_id: item.warehouse_id || defaultWarehouseId,
        quantity: item.quantity,
        price: item.price,
        price_per_sqm: item.price_per_sqm,
        width,
        length,
        area_sqm,
      };
      // WMS Address Storage: No cell/rack/location stubs from site
      delete itemObj.cell;
      delete itemObj.cell_code;
      delete itemObj.rack;
      delete itemObj.location;
      return itemObj;
    }),
  };

  // Delete cell stubs from root payload
  delete (normalizedPayload as any).cell;
  delete (normalizedPayload as any).cell_code;
  delete (normalizedPayload as any).rack;
  delete (normalizedPayload as any).location;

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
          'X-Idempotency-Key': idempotencyKey,
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
 * Безопасная клиентская и административная отмена заказа через B2B-шлюз.
 * Проводит отмену в 1С:ERP, высвобождает резервы и обновляет локальную базу.
 */
export async function cancelOrderViaPortal(params: {
  orderId: string;
  comment?: string;
}): Promise<{ success: boolean; message?: string }> {
  const response = await erpFetch('cancel_order', {
    method: 'POST',
    body: {
      order_id: params.orderId,
      comment: params.comment || 'Заказ отменен пользователем через B2B-портал',
    },
  });

  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.success) {
    throw new Error(data?.error || `Ошибка отмены заказа (${response.status})`);
  }
  return data;
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

export interface ActiveReservationItem {
  sku: string;
  product_name: string;
  collection: string;
  size: string;
  warehouse: string;
  quantity: number;
  area_sqm: number;
  total_sqm: number;
}

export interface ActiveReservation {
  id: string;
  order_number: string;
  client_name: string;
  client_company: string;
  client_phone: string;
  status: string;
  warehouse: string;
  created_at: string;
  hold_expires_at?: string;
  total_items: number;
  total_sqm: number;
  total_amount: number;
  items: ActiveReservationItem[];
}

export interface ActiveReservationsResponse {
  success: boolean;
  reservations: ActiveReservation[];
  summary: {
    total_reserved_orders: number;
    total_reserved_pcs: number;
    total_reserved_sqm: number;
    clients_count: number;
  };
  error?: string;
}

/**
 * Получить список активных складских резервов с разбивкой по клиентам и позициям
 */
export async function fetchActiveReservations(params?: { sku?: string; q?: string }): Promise<ActiveReservationsResponse> {
  const queryParts: string[] = [];
  if (params?.sku) queryParts.push(`sku=${encodeURIComponent(params.sku)}`);
  if (params?.q) queryParts.push(`q=${encodeURIComponent(params.q)}`);
  const queryStr = queryParts.length > 0 ? `&${queryParts.join('&')}` : '';

  const response = await erpFetch(`active_reservations${queryStr}`);
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.success) {
    throw new Error(data?.error || `Не удалось загрузить данные резервов (${response.status})`);
  }
  return data;
}

