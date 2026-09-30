import crypto from 'crypto';
import { getErpApiKey } from '../lib/erpKey';

const SECRET_KEY = process.env.PORTAL_SECRET_KEY || process.env.ERP_PORTAL_SECRET || '';
const TARGET_ERP_URL = process.env.ERP_API_URL || 'https://kilem-khan.kz/api/sin/public/api_portal.php';
const ERP_FALLBACK_URL = 'https://kilem-khan.kz/api/sin/api_portal.php';
const WHATSAPP_GATEWAY_URL = process.env.WHATSAPP_API_URL || process.env.GREEN_API_URL;
const WHATSAPP_TOKEN = process.env.WHATSAPP_API_TOKEN;
const PORTAL_BASE_URL = process.env.PORTAL_BASE_URL || 'https://synergy-b2b-portal.vercel.app';
const DEFAULT_DUTY_PHONE = process.env.ADMIN_WHATSAPP_PHONE || process.env.MANAGER_WHATSAPP_PHONE || '77086984543';

export interface ApprovalPayload {
  orderId: string | number;
  orderDocNumber?: string;
  clientName: string;
  clientPhone?: string;
  totalAmount: number;
  totalSqm: number;
  itemsCount: number;
  reason: string;
  managerPhone?: string;
}

export interface SendWhatsAppOptions {
  eventType?: 'dealer_registration' | 'order_approval' | 'dlq_sync_error' | 'booking_expired' | string;
  orderId?: string | number;
  orderDocNumber?: string;
  clientName?: string;
}

/**
 * Создание криптографически подписанного токена решения (HMAC SHA-256)
 */
export function generateSignedDecisionToken(orderId: string | number, decision: 'approve' | 'reject', expMs = 24 * 3600 * 1000): string {
  const expiresAt = Date.now() + expMs;
  const rawData = `${orderId}:${decision}:${expiresAt}`;
  const hmac = crypto.createHmac('sha256', SECRET_KEY).update(rawData).digest('hex');
  const payloadJson = JSON.stringify({ orderId, decision, expiresAt, hmac });
  return Buffer.from(payloadJson).toString('base64url');
}

/**
 * Верификация токена решения
 */
export function verifySignedDecisionToken(tokenStr: string): { valid: boolean; orderId?: string | number; decision?: 'approve' | 'reject'; error?: string } {
  try {
    const rawJson = Buffer.from(tokenStr, 'base64url').toString('utf8');
    const { orderId, decision, expiresAt, hmac } = JSON.parse(rawJson);

    if (!orderId || !decision || !expiresAt || !hmac) {
      return { valid: false, error: 'Неполные данные токена' };
    }

    if (Date.now() > Number(expiresAt)) {
      return { valid: false, error: 'Срок действия ссылки согласования истек' };
    }

    const expectedData = `${orderId}:${decision}:${expiresAt}`;
    const expectedHmac = crypto.createHmac('sha256', SECRET_KEY).update(expectedData).digest('hex');

    if (hmac !== expectedHmac) {
      return { valid: false, error: 'Недействительная цифровая подпись токена' };
    }

    return { valid: true, orderId, decision };
  } catch (err: any) {
    return { valid: false, error: `Ошибка декодирования токена: ${err?.message}` };
  }
}

/**
 * Отправка сообщения через единый шлюз ERP (kilem-khan.kz api_portal.php?action=send_whatsapp)
 * с автоматическим фоллбэком на дежурный корпоративный номер и прямой шлюз.
 */
export async function sendWhatsAppMessage(
  phone: string,
  text: string,
  options?: SendWhatsAppOptions
): Promise<boolean> {
  const rawDigits = (phone || '').replace(/\D+/g, '');
  const cleanPhone = rawDigits.length >= 10 ? rawDigits : DEFAULT_DUTY_PHONE;
  const eventType = options?.eventType || 'dealer_registration';

  console.log(`[WhatsApp Service] 💬 Dispatching ${eventType} message to +${cleanPhone}:\n${text}\n-------------------`);

  // 1. Приоритетный путь: Единый защищенный роутер ERP
  const erpApiKey = getErpApiKey();
  const erpUrls = [TARGET_ERP_URL, ERP_FALLBACK_URL];

  for (const baseErpUrl of erpUrls) {
    const erpEndpoint = baseErpUrl.includes('?')
      ? `${baseErpUrl}&action=send_whatsapp`
      : `${baseErpUrl}?action=send_whatsapp`;

    try {
      const erpRes = await fetch(erpEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Portal-Key': erpApiKey,
          ...(erpApiKey ? { Authorization: `Bearer ${erpApiKey}` } : {}),
        },
        body: JSON.stringify({
          phone: cleanPhone,
          message: text,
          event_type: eventType,
          order_id: options?.orderId,
          order_doc_number: options?.orderDocNumber,
          client_name: options?.clientName,
        }),
      });

      if (erpRes.ok) {
        const erpData = await erpRes.json().catch(() => ({}));
        if (erpData && erpData.success !== false) {
          console.log(`[WhatsApp Service] ✅ Delivered via ERP (${erpEndpoint}) to +${cleanPhone}:`, erpData);
          return true;
        }
      }
    } catch (erpErr: any) {
      console.warn(`[WhatsApp Service] Notice: ERP route ${erpEndpoint} error:`, erpErr?.message);
    }
  }

  // 2. Резервный канал: Прямой коннектор (Green-API / Chat-API), если указан в переменных
  if (WHATSAPP_GATEWAY_URL) {
    try {
      const res = await fetch(WHATSAPP_GATEWAY_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(WHATSAPP_TOKEN ? { Authorization: `Bearer ${WHATSAPP_TOKEN}` } : {}),
        },
        body: JSON.stringify({
          phone: cleanPhone,
          chatId: `${cleanPhone}@c.us`,
          message: text,
        }),
      });

      if (res.ok) {
        console.log(`[WhatsApp Service] ✅ Successfully delivered via Fallback Gateway to +${cleanPhone}`);
        return true;
      }
    } catch (err: any) {
      console.warn(`[WhatsApp Service] Fallback gateway error for +${cleanPhone}:`, err?.message);
    }
  }

  return true; // Мягкий возврат для фоновых оповещений
}

/**
 * Отправка запроса на согласование заказа в WhatsApp РМ или Администратора
 */
export async function dispatchApprovalRequest(params: ApprovalPayload): Promise<boolean> {
  const approveToken = generateSignedDecisionToken(params.orderId, 'approve');
  const rejectToken = generateSignedDecisionToken(params.orderId, 'reject');

  const approveUrl = `${PORTAL_BASE_URL}/api/approvals/action?decision=approve&token=${approveToken}`;
  const rejectUrl = `${PORTAL_BASE_URL}/api/approvals/action?decision=reject&token=${rejectToken}`;

  const targetPhone = params.managerPhone || process.env.ADMIN_WHATSAPP_PHONE || DEFAULT_DUTY_PHONE;
  const docNum = params.orderDocNumber || `ORD-${params.orderId}`;

  const messageText = 
    `🚨 *ТРЕБУЕТСЯ СОГЛАСОВАНИЕ ЗАКАЗА SYNERGY B2B*\n\n` +
    `📄 *Заказ:* №${docNum}\n` +
    `🏢 *Клиент:* ${params.clientName} (${params.clientPhone || 'тел. не указан'})\n` +
    `💰 *Сумма:* $${params.totalAmount.toLocaleString('en-US')} (${params.totalSqm.toFixed(2)} м², ${params.itemsCount} поз.)\n` +
    `⚠️ *Причина аппрува:* ${params.reason}\n\n` +
    `👇 *Выберите решение в один клик:*\n\n` +
    `✅ *ОДОБРИТЬ ОТГРУЗКУ:*\n${approveUrl}\n\n` +
    `❌ *ОТКЛОНИТЬ ЗАКАЗ:*\n${rejectUrl}\n\n` +
    `_Ссылка действительна 24 часа. Автоматическая система Synergy B2B._`;

  return await sendWhatsAppMessage(targetPhone, messageText, {
    eventType: 'order_approval',
    orderId: params.orderId,
    orderDocNumber: docNum,
    clientName: params.clientName,
  });
}

