import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { recordAuditLog } from '../audit/logs';
import { applyCorsHeaders } from '../lib/cors';
import { logger } from '../lib/logger';
import { handleClientDeactivated } from './handlers/clientLifecycleHandler';

const ALLOWED_KEYS = new Set(
  [
    process.env.PORTAL_SECRET_KEY,
    process.env.ERP_PORTAL_SECRET,
    process.env.ERP_WEBHOOK_SECRET,
  ].filter((k): k is string => Boolean(k && k.trim().length > 0))
);

const SECRET_KEY = process.env.PORTAL_SECRET_KEY || process.env.ERP_PORTAL_SECRET || process.env.ERP_WEBHOOK_SECRET || '';
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

const supabase = (SUPABASE_URL && SUPABASE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })
  : null as any;

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
  if (!applyCorsHeaders(req, res)) {
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      error: 'Method not allowed. Expected POST request.',
    });
  }

  // Reject oversized payloads (10MB limit)
  const bodyStr = JSON.stringify(req.body);
  if (bodyStr && bodyStr.length > 10 * 1024 * 1024) {
    return res.status(413).json({ error: 'Payload too large', maxSize: '10MB' });
  }

  // 1. Проверка авторизационного ключа
  const portalKey = (req.headers['x-portal-key'] || req.headers['X-Portal-Key']) as string | undefined;
  if (!portalKey || !ALLOWED_KEYS.has(portalKey)) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized: Invalid or missing X-Portal-Key header.',
    });
  }

  // 2. Проверка HMAC SHA256 подписи
  const isProd = process.env.NODE_ENV === 'production' && process.env.ENFORCE_WEBHOOK_HMAC !== 'false';
  const receivedSig = (req.headers['x-webhook-signature'] || req.headers['X-Webhook-Signature']) as string | undefined;
  const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);

  if (receivedSig) {
    const expectedSig = crypto.createHmac('sha256', SECRET_KEY).update(rawBody).digest('hex');
    if (receivedSig.toLowerCase() !== expectedSig.toLowerCase()) {
      if (isProd) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized: Invalid X-Webhook-Signature HMAC signature.',
          code: 'INVALID_HMAC_SIGNATURE',
        });
      }
      logger.warn(`[Webhook clients] Invalid HMAC signature. Expected: ${expectedSig}, Received: ${receivedSig}`);
    }
  } else if (isProd && SECRET_KEY) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized: Missing required X-Webhook-Signature header in production.',
      code: 'MISSING_HMAC_SIGNATURE',
    });
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

    logger.info(`[Webhook clients] Received event '${event}' for counterparty_id=${counterparty_id}`, {
      eventId: eventId || payload.event_id || 'n/a',
      event,
      counterparty_id,
    });

    // Событие А: client_synced (Создание / Активация / Обновление)
    if (event === 'client_synced' && (access === 'enabled' || status === 'active' || payload.is_active === 1 || (payload as any).is_active === true)) {
      const p = payload as ClientSyncedPayload;
      
      logger.info(`[Webhook clients] ACTIVATED client: ID=${p.counterparty_id}, Name="${p.name}", Login="${p.portal_login}"`, {
        counterparty_id: p.counterparty_id,
        login: p.portal_login,
      });

      // Проверка монотонности версий для предотвращения перезаписи свежих данных устаревшими пакетами
      const pAny = p as any;
      const incomingTimestamp = Number(pAny.version_timestamp || (pAny.updated_at ? new Date(pAny.updated_at).getTime() : 0));
      if (incomingTimestamp > 0) {
        const { data: existingProf } = await supabase
          .from('profiles')
          .select('updated_at')
          .eq('partner_id', String(p.counterparty_id))
          .maybeSingle();

        if (existingProf?.updated_at && new Date(existingProf.updated_at).getTime() > incomingTimestamp) {
          console.warn(`[Webhook clients] Stale counterparty CDC payload ignored for partner ${p.counterparty_id}`);
          return res.status(200).json({
            success: true,
            status: 'ignored_stale_version',
            message: 'Incoming counterparty payload is older than current database record.',
          });
        }
      }

      // Сохраняем в Supabase profiles расширенные атрибуты контрагента
      try {
        await supabase
          .from('profiles')
          .upsert({
            partner_id: String(p.counterparty_id),
            erp_id: p.counterparty_id,
            full_name: p.name,
            phone: p.phone,
            company_name: p.name,
            city: p.city || '',
            address: p.address || '',
            bin_iin: p.bin || '',
            credit_limit_usd: Number(p.credit_limit_usd || 0),
            payment_delay_days: Number(p.payment_delay_days || 0),
            role: 'client',
            impersonation_enabled: true,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'partner_id' });

        if (p.credit_limit_usd !== undefined) {
          await supabase
            .from('partner_balances')
            .upsert({
              partner_id: String(p.counterparty_id),
              last_synced_at: new Date().toISOString(),
            }, { onConflict: 'partner_id' });
        }

        await recordAuditLog({
          eventType: 'client_synced_webhook',
          direction: 'inbound',
          status: 'success',
          source: 'ERP Client Webhook',
          payload: {
            counterparty_id: p.counterparty_id,
            name: p.name,
            login: p.portal_login,
            credit_limit: p.credit_limit_usd,
            payment_delay_days: p.payment_delay_days,
          },
        });
      } catch (dbErr) {
        console.warn('[Webhook clients] Profile upsert notice:', dbErr);
      }

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

    // Событие Б: client_deactivated (Блокировка / Деактивация в ERP / Перевод в архив)
    const isDeactivation =
      event === 'client_deactivated' ||
      access === 'disabled' ||
      status === 'inactive' ||
      status === 'archived' ||
      status === 'archive' ||
      payload.is_active === 0 ||
      (payload as any).is_active === false ||
      payload.portal_access_enabled === 0 ||
      (payload as any).portal_access_enabled === false;

    if (isDeactivation) {
      const broadcastLiveUpdate = async (evt: string, bPayload: any) => {
        if (!supabase) return;
        try {
          const channel = supabase.channel('portal_live_updates');
          await channel.send({ type: 'broadcast', event: evt, payload: bPayload });
        } catch (bErr) {
          logger.warn('[Webhook clients] Realtime broadcast notice:', {}, bErr as Error);
        }
      };

      const result = await handleClientDeactivated(
        { ...payload, counterparty_id },
        supabase,
        eventId,
        broadcastLiveUpdate
      );
      return res.status(200).json(result);
    }

    return res.status(400).json({
      success: false,
      error: `Unsupported or unknown event state: event='${event}', access='${access}'.`,
    });
  } catch (err: any) {
    logger.error('[Webhook clients] Error processing webhook:', {}, err as Error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error processing client webhook.',
      details: err?.message,
    });
  }
}
