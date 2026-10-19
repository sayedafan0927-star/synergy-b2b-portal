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

function encodeDecisionToken(orderId: string | number, decision: 'approve' | 'reject', orderDocNumber?: string): string {
  try {
    const raw = JSON.stringify({
      orderId,
      orderDocNumber,
      decision,
      expiresAt: Date.now() + 24 * 3600 * 1000,
    });
    return btoa(unescape(encodeURIComponent(raw)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  } catch {
    return `${orderId}:${decision}`;
  }
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
}): Promise<{ success: boolean; message?: string; error?: string }> {
  try {
    const res = await erpFetch('request_approval', {
      method: 'POST',
      body: params,
    });
    if (res.ok && (res.headers.get('content-type') || '').includes('application/json')) {
      const data = await res.json();
      if (data && data.success !== false) {
        return data;
      }
    }
  } catch {}

  // Fallback для прямого шлюза api_portal.php (action=send_whatsapp)
  try {
    const baseUrl = typeof window !== 'undefined' && window.location.origin
      ? window.location.origin
      : 'https://synergy-group.kz';
    const docNum = params.orderDocNumber || `ORD-${params.orderId}`;
    const approveToken = encodeDecisionToken(params.orderId, 'approve', docNum);
    const rejectToken = encodeDecisionToken(params.orderId, 'reject', docNum);
    const approveUrl = `${baseUrl}/api/approvals/action?decision=approve&order_id=${encodeURIComponent(String(params.orderId))}&doc=${encodeURIComponent(docNum)}&token=${approveToken}`;
    const rejectUrl = `${baseUrl}/api/approvals/action?decision=reject&order_id=${encodeURIComponent(String(params.orderId))}&doc=${encodeURIComponent(docNum)}&token=${rejectToken}`;
    const rawDigits = (params.managerPhone || '').replace(/\D+/g, '');
    const cleanPhone = rawDigits.length >= 10 ? rawDigits : '77086984543';

    const messageText =
      `🚨 *ТРЕБУЕТСЯ СОГЛАСОВАНИЕ ЗАКАЗА SYNERGY B2B*\n\n` +
      `📄 *Заказ:* №${docNum}\n` +
      `🏢 *Клиент:* ${params.clientName} (${params.clientPhone || 'тел. не указан'})\n` +
      `💰 *Сумма:* $${Number(params.totalAmount || 0).toLocaleString('en-US')} (${Number(params.totalSqm || 0).toFixed(2)} м², ${params.itemsCount || 1} поз.)\n` +
      `⚠️ *Причина аппрува:* ${params.reason}\n\n` +
      `👇 *Выберите решение в один клик:*\n\n` +
      `✅ *ОДОБРИТЬ ОТГРУЗКУ:*\n${approveUrl}\n\n` +
      `❌ *ОТКЛОНИТЬ ЗАКАЗ:*\n${rejectUrl}\n\n` +
      `_Ссылка действительна 24 часа. Автоматическая система Synergy B2B._`;

    const waRes = await erpFetch('send_whatsapp', {
      method: 'POST',
      body: {
        phone: cleanPhone,
        message: messageText,
        event_type: 'order_approval',
        order_id: params.orderId,
        order_doc_number: docNum,
        client_name: params.clientName,
      },
    });
    const waData = await waRes.json().catch(() => ({}));
    if (waRes.ok && waData?.success !== false) {
      return {
        success: true,
        message: 'Запрос на согласование успешно отправлен ответственному менеджеру в WhatsApp.',
      };
    }
    return {
      success: false,
      error: waData?.error || 'Не удалось отправить запрос в WhatsApp',
    };
  } catch {
    return { success: false, message: 'Сетевой сбой при отправке в WhatsApp' };
  }
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
  const hasPreorder = Boolean(payload.is_preorder || payload.items?.some(it => it.is_preorder));

  const normalizedPayload: Record<string, any> = {
    idempotency_key: idempotencyKey,
    user_id: payload.user_id,
    partner_id: (payload as any).partner_id || numClientId || payload.client_id,
    client_id: numClientId || payload.client_id,
    warehouse_id: defaultWarehouseId,
    ...(hasPreorder ? { is_preorder: true } : {}),
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
      const resolvedQty = item.quantity ?? item.qty ?? 1;
      const itemObj: Record<string, any> = {
        item_id: item.item_id || (Number(item.productId) > 0 ? Number(item.productId) : undefined),
        sku: item.sku,
        size: item.size,
        warehouse: item.warehouse || 'Основной Склад Астана',
        warehouse_id: item.warehouse_id || defaultWarehouseId,
        quantity: resolvedQty,
        qty: resolvedQty,
        price: item.price,
        price_per_sqm: item.price_per_sqm,
        width,
        length,
        area_sqm,
        ...(item.is_preorder ? { is_preorder: true } : {}),
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

      let details = errorData?.details ? { ...errorData.details } : {};
      if (!details.sku) {
        const msg = String(errorData?.error || '');
        const m1 = msg.match(/SKU\s*"?([^"\s]+)"?\s*\(доступно:\s*(\d+),\s*запрошено:\s*(\d+)\)/i);
        const m2 = msg.match(/SKU\s*"?([^"\s]+)"?.*?only\s*(\d+)\s*free items,\s*requested\s*(\d+)/i);
        const m3 = msg.match(/артикула\s*"?([^"\s]+)"?/i);
        if (m1) {
          details.sku = m1[1];
          details.available_qty = parseInt(m1[2], 10);
          details.requested_qty = parseInt(m1[3], 10);
        } else if (m2) {
          details.sku = m2[1];
          details.available_qty = parseInt(m2[2], 10);
          details.requested_qty = parseInt(m2[3], 10);
        } else if (m3) {
          details.sku = m3[1];
          details.available_qty = 0;
        }
      }
      if (details.available_qty === undefined && (details.free_stock !== undefined || details.stock !== undefined)) {
        details.available_qty = Number(details.free_stock ?? details.stock);
      }

      (err as any).details = details;
      throw err;
    }
    throw new Error(data.error || (data as any)?.message || `Ошибка сервера (${lastResponse.status})`);
  }

  // Normalize order response when ERP accepts into processing buffer (HTTP 202 or ingest_uuid)
  const isBuffered = Boolean(
    data.status === 'accepted' ||
    lastResponse.status === 202 ||
    (data as any).http_code === 202 ||
    data.ingest_uuid ||
    data.is_buffered ||
    data.order?.is_buffered
  );

  const rawIngestUuid = data.ingest_uuid;
  const shortUuid = rawIngestUuid ? String(rawIngestUuid).replace(/^ingest_/, '').slice(0, 8).toUpperCase() : '';
  const resolvedDocNumber =
    data.order?.doc_number ||
    (data as any).doc_number ||
    data.order_number ||
    (data as any).order_id ||
    (shortUuid ? `ORD-BUF-${shortUuid}` : undefined) ||
    `ORD-${Date.now().toString(36).toUpperCase()}`;

  data.order_number = data.order_number || resolvedDocNumber;
  data.is_buffered = isBuffered;

  if (!data.order) {
    data.order = {
      order_id: Number((data as any).order_id) || Date.now(),
      doc_number: resolvedDocNumber,
      client_id: Number(payload.client_id) || 0,
      warehouse_id: payload.warehouse_id || defaultWarehouseId,
      total_amount: payload.items.reduce((sum, it) => sum + (Number(it.price || 0) * Number(it.quantity || 1)), 0),
      currency: (payload as any).currency || 'USD',
      status: isBuffered ? 'accepted' : (data.status || 'pending'),
      items_count: payload.items.length,
      is_buffered: isBuffered,
    };
  } else {
    if (!data.order.doc_number) {
      data.order.doc_number = resolvedDocNumber;
    }
    if (isBuffered) {
      data.order.is_buffered = true;
    }
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
  orderNumber?: string;
  comment?: string;
}): Promise<{ success: boolean; status?: string; cancellation_pending?: boolean; message?: string }> {
  const response = await erpFetch('cancel_order', {
    method: 'POST',
    body: {
      order_id: params.orderId,
      order_number: params.orderNumber,
      comment: params.comment || 'Заказ отменен пользователем через B2B-портал',
    },
  });

  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.success) {
    const err = new Error(data?.error || `Ошибка отмены заказа (${response.status})`);
    (err as any).status = response.status;
    (err as any).code = data?.code;
    throw err;
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

export {
  fetchActiveReservations,
  parseSizeArea,
  clean1CName,
  type ActiveReservation,
  type ActiveReservationItem,
  type ActiveReservationsResponse,
} from './activeReservations';


