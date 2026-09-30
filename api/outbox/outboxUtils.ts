import { sendWhatsAppMessage } from '../approvals/whatsapp';
import { logger } from '../lib/logger';
import { sendSystemAlert } from '../lib/alerting';
import { recordAuditLog } from '../audit/logs';

export const MAX_RETRIES = 5;

export interface DlqAlertParams {
  orderId: string;
  orderNumber: string;
  amount: number;
  retries: number;
  error: string;
}

/**
 * Отправка экстренного уведомления во все каналы (WhatsApp, Telegram, Alerting)
 * при переводе заказа в Dead Letter Queue (DLQ).
 */
export async function dispatchDlqEmergencyAlert(params: DlqAlertParams): Promise<void> {
  const alertPhone = process.env.ADMIN_WHATSAPP_PHONE || process.env.MANAGER_WHATSAPP_PHONE || process.env.WHATSAPP_MANAGER_PHONE || '';
  const text = `🚨 *КРИТИЧЕСКИЙ СБОЙ OUTBOX / 1C:ERP*\n\n` +
    `Заказ *№${params.orderNumber}* переведен в *Dead Letter Queue (DLQ)* после ${params.retries} неудачных попыток синхронизации!\n\n` +
    `💰 Сумма заказа: $${params.amount}\n` +
    `❌ Ошибка: ${params.error}\n\n` +
    `_Требуется ручное вмешательство дежурного инженера или проверка доступности 1С._`;

  logger.error(`[DLQ Alert] Order ${params.orderNumber} placed in DLQ after ${params.retries} retries`, {
    orderId: params.orderId,
    orderNumber: params.orderNumber,
    amount: params.amount,
    retries: params.retries,
    error: params.error,
  });

  try {
    await sendWhatsAppMessage(alertPhone, text, {
      eventType: 'dlq_sync_error',
      orderId: params.orderId,
      orderDocNumber: String(params.orderNumber),
    });
  } catch (e) {
    logger.warn('[DLQ Alert WhatsApp notice]', { orderNumber: params.orderNumber }, e as Error);
  }

  const tgWebhook = process.env.TELEGRAM_ALERT_WEBHOOK_URL;
  if (tgWebhook) {
    try {
      await fetch(tgWebhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
    } catch (e) {
      logger.warn('[DLQ Alert Telegram notice]', { orderNumber: params.orderNumber }, e as Error);
    }
  }

  sendSystemAlert({
    level: 'CRITICAL',
    title: `Order #${params.orderNumber} Moved to DLQ`,
    description: `Заказ #${params.orderNumber} исчерпал 5 попыток синхронизации и перемещен в Dead Letter Queue.\nСумма: $${params.amount}\nОшибка: ${params.error}`,
    metadata: { orderId: params.orderId, orderNumber: params.orderNumber, retries: params.retries },
  }).catch(() => {});
}

/**
 * Подготовка нормализованного payload заказа для ERP из записей orders и order_items
 */
export function buildOutboxErpPayload(order: any, dbItems: any[] | null) {
  const itemsList = (dbItems && dbItems.length > 0)
    ? dbItems.map(it => {
        const sizeStr = it.size || '1.6x2.3';
        const parts = String(sizeStr).replace(',', '.').split(/[*×xXхХ]/).map(s => parseFloat(s.trim()));
        const width = (parts.length >= 2 && !isNaN(parts[0])) ? parts[0] : 1.6;
        const length = (parts.length >= 2 && !isNaN(parts[1])) ? parts[1] : 2.3;
        const area_sqm = Math.round(width * length * 100) / 100;
        return {
          item_id: Number(it.product_id) > 0 ? Number(it.product_id) : undefined,
          sku: it.sku || it.product_name,
          quantity: Number(it.quantity) || 1,
          price: Number(it.price) || 10,
          width,
          length,
          area_sqm,
          warehouse_id: it.warehouse_id || (it.warehouse && it.warehouse.includes('Астана') ? 1 : 1),
        };
      })
    : [
        {
          sku: 'OUTBOX-ITEM',
          quantity: order.total_items || 1,
          price: order.total_amount || 10,
          width: 1.6,
          length: 2.3,
          area_sqm: 3.68,
          warehouse_id: 1,
        }
      ];

  const primaryWarehouseId = (itemsList[0] as any)?.warehouse_id || 1;

  // Определение мультискладского состава позиций
  const warehouseMap = new Map<number | string, { warehouse: string; amount: number; items_count: number }>();
  for (const it of itemsList) {
    const whKey = (it as any).warehouse_id || 1;
    const existing = warehouseMap.get(whKey) || {
      warehouse: String((it as any).warehouse || 'Склад'),
      amount: 0,
      items_count: 0,
    };
    existing.amount += Number(it.price || 0) * Number(it.quantity || 1);
    existing.items_count += Number(it.quantity || 1);
    warehouseMap.set(whKey, existing);
  }

  const isMultiWarehouse = warehouseMap.size > 1;
  const splitOrdersSummary = isMultiWarehouse
    ? Array.from(warehouseMap.entries()).map(([whId, info]) => ({
        warehouse_id: typeof whId === 'number' ? whId : 1,
        warehouse: info.warehouse,
        amount: Math.round(info.amount * 100) / 100,
        items_count: info.items_count,
      }))
    : [];

  return {
    idempotency_key: order.idempotency_key || `outbox-${order.id}`,
    partner_id: order.partner_id || 'guest',
    client_name: order.client_name || 'Оптовый клиент',
    warehouse_id: primaryWarehouseId,
    is_multi_warehouse: isMultiWarehouse,
    split_orders: splitOrdersSummary.length > 0 ? splitOrdersSummary : undefined,
    buyer: {
      name: order.client_name || 'Оптовый клиент',
      phone: order.client_phone || '',
    },
    customer: {
      name: order.client_name || 'Оптовый клиент',
      phone: order.client_phone || '',
    },
    comment: `[Outbox Auto-Sync] ${order.notes || ''}`,
    total_amount: order.total_amount,
    items: itemsList,
  };
}

/**
 * Проверка, является ли ошибка 1С фатальной бизнес-ошибкой (Poison Pill).
 * Для фатальных ошибок (400, 404, 422, некорректный артикул, заблокированный клиент)
 * повторные ретраи бессмысленны — заказ должен сразу перемещаться в DLQ.
 */
export function isFatalBusinessError(status: number, errText?: string): boolean {
  if (status === 400 || status === 404 || status === 422) {
    return true;
  }
  const txt = String(errText || '').toUpperCase();
  const fatalKeywords = [
    'INVALID_PAYLOAD',
    'PRODUCT_DELETED',
    'CONTRACT_TERMINATED',
    'CLIENT_BLOCKED',
    'UNKNOWN_COUNTERPARTY',
    'NON_RETRYABLE',
  ];
  return fatalKeywords.some(keyword => txt.includes(keyword));
}

/**
 * Расчет следующего времени повторной попытки по схеме экспоненциального отката
 * 1 мин, 2 мин, 4 мин, 8 мин, 16 мин (макс 60 мин)
 */
export function computeBackoffNextRetry(nextRetries: number): { nextRetryAt: string; isDlq: boolean } {
  const isDlq = nextRetries >= MAX_RETRIES;
  const backoffMinutes = Math.min(60, Math.pow(2, nextRetries - 1));
  const nextRetryAt = new Date(Date.now() + backoffMinutes * 60000).toISOString();
  return { nextRetryAt, isDlq };
}

export type DlqErrorCategory =
  | 'ERP_TIMEOUT'
  | 'STOCK_UNAVAILABLE'
  | 'INVALID_PAYLOAD'
  | 'AUTH_FAILED'
  | 'ERP_SERVER_ERROR'
  | 'NETWORK_ERROR';

export interface CategorizedError {
  category: DlqErrorCategory;
  label: string;
  recommendedAction: string;
  badgeColor: string;
}

/**
 * Парсинг сырого текста ошибки 1С в структурированную категорию с рекомендацией инженеру
 */
export function categorizeDlqError(errorText?: string | null): CategorizedError {
  const err = String(errorText || '').toLowerCase();

  if (err.includes('timeout') || err.includes('таймаут') || err.includes('aborterror')) {
    return {
      category: 'ERP_TIMEOUT',
      label: 'Таймаут 1C',
      recommendedAction: 'Повторить отправку (шлюз 1С перегружен)',
      badgeColor: 'bg-amber-100 text-amber-800 border-amber-200',
    };
  }

  if (err.includes('409') || err.includes('insufficient') || err.includes('остат') || err.includes('недостаточно')) {
    return {
      category: 'STOCK_UNAVAILABLE',
      label: 'Нехватка остатка',
      recommendedAction: 'Согласовать замену размера или снять бронь',
      badgeColor: 'bg-rose-100 text-rose-800 border-rose-200',
    };
  }

  if (err.includes('401') || err.includes('403') || err.includes('unauthorized') || err.includes('forbidden') || err.includes('token')) {
    return {
      category: 'AUTH_FAILED',
      label: 'Ошибка авторизации',
      recommendedAction: 'Проверить X-Portal-Key в настройках 1С',
      badgeColor: 'bg-purple-100 text-purple-800 border-purple-200',
    };
  }

  if (err.includes('400') || err.includes('validation') || err.includes('invalid') || err.includes('некоррект')) {
    return {
      category: 'INVALID_PAYLOAD',
      label: 'Ошибка валидации',
      recommendedAction: 'Проверить реквизиты клиента и артикулы',
      badgeColor: 'bg-orange-100 text-orange-800 border-orange-200',
    };
  }

  if (err.includes('500') || err.includes('502') || err.includes('503') || err.includes('bad gateway') || err.includes('сервер')) {
    return {
      category: 'ERP_SERVER_ERROR',
      label: 'Сбой сервера 1C',
      recommendedAction: 'Проверить доступность базы 1С у администратора',
      badgeColor: 'bg-red-100 text-red-800 border-red-200',
    };
  }

  return {
    category: 'NETWORK_ERROR',
    label: 'Сетевой сбой',
    recommendedAction: 'Повторить отправку (временная потеря связи)',
    badgeColor: 'bg-slate-100 text-slate-800 border-slate-200',
  };
}

/**
 * Диспетчеризация критического оповещения при переводе заказа в DLQ
 */
export async function dispatchDlqAlert(
  order: any,
  errorMessage: string,
  category: CategorizedError,
  correlationId?: string,
): Promise<void> {
  const alertPayload = {
    order_id: order.id,
    order_number: order.order_number,
    total_amount: order.total_amount,
    retry_count: order.retry_count,
    last_error: errorMessage,
    category: category.category,
    label: category.label,
    recommendedAction: category.recommendedAction,
    timestamp: new Date().toISOString(),
  };

  // 1. Фиксация в журнале аудита с критическим приоритетом
  await recordAuditLog({
    eventType: 'dlq_poison_alert',
    direction: 'outbound',
    status: 'error',
    statusCode: 500,
    source: 'DLQ Alert Dispatcher',
    correlationId,
    payload: alertPayload,
  });

  // 2. Внешний webhook (Telegram / Slack / Monitoring), если задан в переменных окружения
  const alertPhone = process.env.ADMIN_WHATSAPP_PHONE || process.env.MANAGER_WHATSAPP_PHONE || process.env.WHATSAPP_MANAGER_PHONE || '';
  if (alertPhone) {
    const waText = `🚨 *КРИТИЧЕСКИЙ СБОЙ OUTBOX / 1C:ERP*\n\n` +
      `Заказ *№${order.order_number}* переведен в *DLQ*!\n` +
      `Категория: *${category.label}*\n` +
      `Ошибка: ${errorMessage}\n` +
      `Рекомендация: _${category.recommendedAction}_`;
    sendWhatsAppMessage(alertPhone, waText, {
      eventType: 'dlq_sync_error',
      orderId: order.id,
      orderDocNumber: order.order_number,
    }).catch(waErr => {
      logger.warn('[DLQ Alert WhatsApp notice]', { orderNumber: order.order_number }, waErr as Error);
    });
  }

  const alertWebhookUrl = process.env.DLQ_ALERT_WEBHOOK_URL;
  if (alertWebhookUrl) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      await fetch(alertWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `🚨 [Synergy B2B DLQ Alert] Заказ ${order.order_number} исчерпал лимит попыток отправки в ERP!\nКатегория: ${category.label}\nОшибка: ${errorMessage}\nРекомендация: ${category.recommendedAction}`,
          details: alertPayload,
        }),
        signal: controller.signal,
      }).finally(() => clearTimeout(timeout));
    } catch (e) {
      console.warn('[DLQ Alert] External webhook dispatch notice:', e);
    }
  }
}


