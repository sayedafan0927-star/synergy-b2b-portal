import crypto from 'crypto';

const SECRET_KEY = process.env.PORTAL_SECRET_KEY || process.env.ERP_PORTAL_SECRET || 'SynergySecretKey2025';
const WHATSAPP_GATEWAY_URL = process.env.WHATSAPP_API_URL || process.env.GREEN_API_URL;
const WHATSAPP_TOKEN = process.env.WHATSAPP_API_TOKEN;
const PORTAL_BASE_URL = process.env.PORTAL_BASE_URL || 'https://synergy-b2b-portal.vercel.app';

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
 * Отправка сообщения через WhatsApp Gateway
 */
export async function sendWhatsAppMessage(phone: string, text: string): Promise<boolean> {
  const cleanPhone = phone.replace(/\D+/g, '');
  if (!cleanPhone || cleanPhone.length < 10) {
    console.warn(`[WhatsApp Service] Invalid phone number provided: "${phone}"`);
    return false;
  }

  console.log(`[WhatsApp Service] 💬 Dispatching message to +${cleanPhone}:\n${text}\n-------------------`);

  if (!WHATSAPP_GATEWAY_URL) {
    console.log('[WhatsApp Service] Notice: WHATSAPP_API_URL not configured. Message logged to console.');
    return true;
  }

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

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      console.warn(`[WhatsApp Service] Gateway returned status ${res.status}: ${errBody}`);
      return false;
    }

    console.log(`[WhatsApp Service] ✅ Successfully delivered to +${cleanPhone}`);
    return true;
  } catch (err: any) {
    console.warn(`[WhatsApp Service] Network delivery error for +${cleanPhone}:`, err?.message);
    return false;
  }
}

/**
 * Отправка запроса на согласование заказа в WhatsApp РМ или Администратора
 */
export async function dispatchApprovalRequest(params: ApprovalPayload): Promise<boolean> {
  const approveToken = generateSignedDecisionToken(params.orderId, 'approve');
  const rejectToken = generateSignedDecisionToken(params.orderId, 'reject');

  const approveUrl = `${PORTAL_BASE_URL}/api/approvals/action?decision=approve&token=${approveToken}`;
  const rejectUrl = `${PORTAL_BASE_URL}/api/approvals/action?decision=reject&token=${rejectToken}`;

  const targetPhone = params.managerPhone || process.env.ADMIN_WHATSAPP_PHONE || '+77017770000';
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

  return await sendWhatsAppMessage(targetPhone, messageText);
}
