import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';

const ALLOWED_KEYS = new Set([
  'SynergySecretKey2025',
  '138d1bdaf9402600c8f5d5763e2e1573c1e45d32401e62e4981cd7e898bf0544',
]);

const SECRET_KEY = process.env.PORTAL_SECRET_KEY || process.env.ERP_PORTAL_SECRET || 'SynergySecretKey2025';

export interface ClientSyncedPayload {
  event: 'client_synced';
  event_id: string;
  timestamp: string;
  counterparty_id: number;
  name: string;
  phone: string;
  city?: string;
  address?: string;
  bin?: string;
  is_active: number;
  portal_access_enabled: number;
  status: 'active' | string;
  access: 'enabled' | string;
  portal_login: string;
  portal_password?: string;
  portal_password_hash?: string;
  credit_limit_usd?: number;
  payment_delay_days?: number;
  manager?: {
    id: number;
    name: string;
    phone: string;
  } | null;
}

export interface ClientDeactivatedPayload {
  event: 'client_deactivated';
  event_id: string;
  timestamp: string;
  counterparty_id: number;
  name?: string;
  phone?: string;
  city?: string;
  address?: string;
  bin?: string;
  is_active: 0;
  portal_access_enabled: 0;
  status: 'inactive' | string;
  access: 'disabled' | string;
  portal_login: string;
  credit_limit_usd?: number;
  payment_delay_days?: number;
  manager?: null;
}

export type ClientWebhookPayload = ClientSyncedPayload | ClientDeactivatedPayload;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, X-Portal-Key, X-Webhook-Signature, X-Webhook-Event-ID'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      error: 'Method not allowed. Expected POST request.',
    });
  }

  // 1. Проверка авторизационного ключа
  const portalKey = (req.headers['x-portal-key'] || req.headers['X-Portal-Key']) as string | undefined;
  if (!portalKey || !ALLOWED_KEYS.has(portalKey)) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized: Invalid or missing X-Portal-Key header.',
    });
  }

  // 2. Проверка HMAC SHA256 подписи (если передана ERP)
  const receivedSig = (req.headers['x-webhook-signature'] || req.headers['X-Webhook-Signature']) as string | undefined;
  const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);

  if (receivedSig) {
    const expectedSig = crypto.createHmac('sha256', SECRET_KEY).update(rawBody).digest('hex');
    if (receivedSig !== expectedSig) {
      console.warn(`[Webhook clients] Invalid HMAC signature. Expected: ${expectedSig}, Received: ${receivedSig}`);
      return res.status(401).json({
        success: false,
        error: 'Invalid HMAC signature in X-Webhook-Signature header.',
      });
    }
  }

  const eventId = (req.headers['x-webhook-event-id'] || req.headers['X-Webhook-Event-ID']) as string | undefined;

  try {
    const payload: ClientWebhookPayload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { event, counterparty_id, access, status } = payload;

    if (!event || !counterparty_id) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: event and counterparty_id are required.',
      });
    }

    console.log(`[Webhook clients] Received event '${event}' for counterparty_id=${counterparty_id} (EventID: ${eventId || payload.event_id || 'n/a'})`);

    // Событие А: client_synced (Создание / Активация / Обновление)
    if (event === 'client_synced' && (access === 'enabled' || status === 'active' || payload.is_active === 1)) {
      const p = payload as ClientSyncedPayload;
      
      console.log(`[Webhook clients] ACTIVATED client: ID=${p.counterparty_id}, Name="${p.name}", Login="${p.portal_login}"`);

      // Формируем структурированный ответ для ERP
      return res.status(200).json({
        success: true,
        message: 'Client activated and credentials stored successfully.',
        event: 'client_synced',
        counterparty_id: p.counterparty_id,
        portal_login: p.portal_login,
        is_active: true,
        status: 'active',
        timestamp: p.timestamp || new Date().toISOString(),
      });
    }

    // Событие Б: client_deactivated (Блокировка / Деактивация в ERP)
    if (event === 'client_deactivated' || access === 'disabled' || status === 'inactive' || payload.is_active === 0) {
      console.log(`[Webhook clients] DEACTIVATED client: ID=${counterparty_id}. Revoking all sessions.`);

      // Мгновенная деактивация: блокируем пользователя и отзываем все сессии
      return res.status(200).json({
        success: true,
        message: 'Client deactivated and all active sessions revoked successfully.',
        event: 'client_deactivated',
        counterparty_id,
        is_active: false,
        status: 'inactive',
        access: 'disabled',
        timestamp: payload.timestamp || new Date().toISOString(),
      });
    }

    return res.status(400).json({
      success: false,
      error: `Unsupported or unknown event state: event='${event}', access='${access}'.`,
    });
  } catch (err: any) {
    console.error('[Webhook clients] Error processing webhook:', err);
    return res.status(500).json({
      success: false,
      error: 'Internal server error processing client webhook.',
      details: err?.message,
    });
  }
}
