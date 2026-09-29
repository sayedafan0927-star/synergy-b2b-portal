import { sendWhatsAppMessage } from '../approvals/whatsapp';
import { logger } from '../lib/logger';
import { sendSystemAlert } from '../lib/alerting';

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
  const alertPhone = process.env.ADMIN_WHATSAPP_PHONE || '';
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
    await sendWhatsAppMessage(alertPhone, text);
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
        const parts = String(sizeStr).replace(',', '.').split(/[*×xX]/).map(s => parseFloat(s.trim()));
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

  return {
    idempotency_key: order.idempotency_key || `outbox-${order.id}`,
    partner_id: order.partner_id || 'guest',
    client_name: order.client_name || 'Оптовый клиент',
    warehouse_id: primaryWarehouseId,
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
 * Расчет следующего времени повторной попытки по схеме экспоненциального отката
 * 1 мин, 2 мин, 4 мин, 8 мин, 16 мин (макс 60 мин)
 */
export function computeBackoffNextRetry(nextRetries: number): { nextRetryAt: string; isDlq: boolean } {
  const isDlq = nextRetries >= MAX_RETRIES;
  const backoffMinutes = Math.min(60, Math.pow(2, nextRetries - 1));
  const nextRetryAt = new Date(Date.now() + backoffMinutes * 60000).toISOString();
  return { nextRetryAt, isDlq };
}
