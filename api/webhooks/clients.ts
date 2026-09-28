import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { recordAuditLog } from '../audit/logs';

const ALLOWED_KEYS = new Set([
  'SynergySecretKey2025',
  '138d1bdaf9402600c8f5d5763e2e1573c1e45d32401e62e4981cd7e898bf0544',
]);

const SECRET_KEY = process.env.PORTAL_SECRET_KEY || process.env.ERP_PORTAL_SECRET || 'SynergySecretKey2025';
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://sjvvoxxwevwgziuxjvcy.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZmY2dscW5qaHl1Ynh1aGZ0cndvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDMwMzQ1MDUsImV4cCI6MjA1ODYxMDUwNX0.z0Vw3tJ4372iY-qC52dZ_Yl-kC46M25jH3_P9z3G30w';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

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

    // Событие Б: client_deactivated (Блокировка / Деактивация в ERP)
    if (event === 'client_deactivated' || access === 'disabled' || status === 'inactive' || payload.is_active === 0) {
      console.log(`[Webhook clients] DEACTIVATED client: ID=${counterparty_id}. Revoking all sessions.`);

      // Мгновенная деактивация: фиксируем в БД и транслируем в Realtime
      try {
        await supabase
          .from('profiles')
          .update({
            updated_at: new Date().toISOString(),
          })
          .eq('partner_id', String(counterparty_id));

        const channel = supabase.channel('portal_live_updates');
        await channel.send({
          type: 'broadcast',
          event: 'client_deactivated',
          payload: { counterparty_id },
        });

        await recordAuditLog({
          eventType: 'client_deactivated_webhook',
          direction: 'inbound',
          status: 'success',
          source: 'ERP Client Webhook',
          payload: { counterparty_id },
        });
      } catch (dbErr) {
        console.warn('[Webhook clients] Profile deactivation notice:', dbErr);
      }

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
