import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { applyCorsHeaders } from '../lib/cors';
import { getErpApiKey } from '../lib/erpKey';
import { recordAuditLog } from '../audit/logs';
import { handleStockChanged } from './handlers/stockHandler';
import { handleOrderStatusChanged } from './handlers/orderStatusHandler';
import { handlePaymentReceived } from './handlers/paymentHandler';
import {
  handleClientDeactivated,
  handleClientSynced,
  handlePartnerStockReleased,
} from './handlers/clientLifecycleHandler';
import { handleDiscountRulesUpdated } from './handlers/discountRulesHandler';
import { handleCurrencyRateUpdated } from './handlers/currencyRateHandler';

function getAllowedKeys(): Set<string> {
  return new Set([
    process.env.PORTAL_SECRET_KEY?.trim(),
    process.env.ERP_API_KEY?.trim(),
    process.env.ERP_PORTAL_SECRET?.trim(),
    getErpApiKey(),
  ].filter(Boolean) as string[]);
}

const SECRET_KEY = process.env.PORTAL_SECRET_KEY || process.env.ERP_PORTAL_SECRET || '';
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

const supabaseServer = (SUPABASE_URL && SUPABASE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })
  : null as any;

/**
 * Отправка сообщения в Supabase Realtime Broadcast Channel
 */
async function broadcastLiveUpdate(event: string, payload: any) {
  if (!supabaseServer) return;
  try {
    const channel = supabaseServer.channel('portal_live_updates');
    await channel.send({
      type: 'broadcast',
      event,
      payload,
    });
  } catch (err) {
    console.warn('[Webhook ERP] Failed to broadcast realtime event:', err);
  }
}

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
  const rawPortalKey = (
    req.headers['x-portal-key'] ||
    req.headers['X-Portal-Key'] ||
    req.query?.portal_key ||
    req.body?.portal_key
  ) as string | undefined;

  const portalKey = rawPortalKey ? String(rawPortalKey).trim() : '';
  const allowedKeys = getAllowedKeys();

  if (!portalKey || !allowedKeys.has(portalKey)) {
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
    const rawBuffer = (req as any).rawBody || rawBody;
    const expectedSigPortal = SECRET_KEY ? crypto.createHmac('sha256', SECRET_KEY).update(rawBuffer).digest('hex') : '';
    const expectedSigKey = portalKey ? crypto.createHmac('sha256', portalKey).update(rawBuffer).digest('hex') : '';

    const sigMatched =
      (expectedSigPortal && receivedSig.toLowerCase() === expectedSigPortal.toLowerCase()) ||
      (expectedSigKey && receivedSig.toLowerCase() === expectedSigKey.toLowerCase());

    if (!sigMatched) {
      if (isProd) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized: Invalid X-Webhook-Signature HMAC signature.',
          code: 'INVALID_HMAC_SIGNATURE',
        });
      }
      console.warn(`[Webhook ERP] HMAC signature mismatch (raw/serialized payload format). Authenticated securely via verified X-Portal-Key.`);
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
    const payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { event } = payload || {};

    if (!event) {
      await recordAuditLog({
        eventType: 'webhook_quarantined',
        direction: 'inbound',
        status: 'error',
        statusCode: 400,
        source: 'ERP Webhook',
        errorMessage: 'Missing required field: "event" in payload',
        payload: { rawBody: String(req.body).slice(0, 500) },
      }).catch(() => {});

      return res.status(400).json({
        success: false,
        error: 'Missing required field: "event" is required in payload.',
      });
    }

    const incomingEventId = String(
      req.headers['x-webhook-event-id'] ||
      req.headers['X-Webhook-Event-ID'] ||
      payload.event_id ||
      payload.id ||
      '',
    ).trim();

    // T-18: Дедупликация входящих вебхуков через PostgreSQL
    if (incomingEventId && supabaseServer) {
      try {
        const { data: existingEvent } = await supabaseServer
          .from('webhook_events')
          .select('event_id')
          .eq('event_id', incomingEventId)
          .maybeSingle();

        if (existingEvent) {
          console.log(`[Webhook ERP] Duplicate event ignored (deduplicated): ${incomingEventId}`);
          return res.status(200).json({
            success: true,
            deduplicated: true,
            event_id: incomingEventId,
            message: 'Webhook event already processed previously.',
          });
        }

        await supabaseServer.from('webhook_events').insert({
          event_id: incomingEventId,
          event_type: String(event),
          processed_at: new Date().toISOString(),
        });
      } catch (dedupErr) {
        console.warn('[Webhook ERP] Deduplication check notice:', dedupErr);
      }
    }

    const timestamp = payload.timestamp || new Date().toISOString();
    console.log(`[Webhook ERP] Received event '${event}' (EventID: ${incomingEventId || 'n/a'}, Timestamp: ${timestamp})`);

    // 1. Смена остатков
    if (event === 'stock_changed') {
      const result = await handleStockChanged(payload, supabaseServer, eventId, timestamp, broadcastLiveUpdate);
      return res.status(200).json(result);
    }

    // 2. Статус заказа WMS / отмена Hold TTL
    if (event === 'order_status_changed') {
      const result = await handleOrderStatusChanged(payload, supabaseServer, eventId, timestamp, broadcastLiveUpdate);
      return res.status(200).json(result);
    }

    // 3. Поступление оплаты
    if (event === 'payment_received') {
      const result = await handlePaymentReceived(payload, supabaseServer, eventId, timestamp, broadcastLiveUpdate);
      return res.status(200).json(result);
    }

    // 4. Списание дилера
    if (event === 'partner_stock_released') {
      const result = await handlePartnerStockReleased(payload, eventId, timestamp, broadcastLiveUpdate);
      return res.status(200).json(result);
    }

    // 5. Мгновенный отзыв доступа клиента (деактивация)
    if (
      event === 'client_deactivated' ||
      payload.access === 'disabled' ||
      payload.status === 'inactive' ||
      payload.status === 'archived' ||
      payload.is_active === 0 ||
      payload.is_active === false
    ) {
      const result = await handleClientDeactivated(payload, supabaseServer, eventId, broadcastLiveUpdate);
      return res.status(200).json(result);
    }

    // 6. Активация / синхронизация клиента
    if (event === 'client_synced') {
      const result = await handleClientSynced(payload, supabaseServer, eventId, broadcastLiveUpdate);
      return res.status(200).json(result);
    }

    // 7. Обновление сетки скидок / типов цен
    if (event === 'discount_rules_updated') {
      const result = await handleDiscountRulesUpdated(payload, supabaseServer, eventId, timestamp, broadcastLiveUpdate);
      return res.status(200).json(result);
    }

    // 8. Обновление официального курса валюты (USD/KZT) от 1C CDC
    if (event === 'currency_rate_updated' || event === 'exchange_rate_updated') {
      const result = await handleCurrencyRateUpdated(payload, supabaseServer, eventId, timestamp, broadcastLiveUpdate);
      return res.status(result.success ? 200 : 422).json(result);
    }

    // Неизвестное событие
    return res.status(200).json({
      success: true,
      event,
      message: `Event '${event}' acknowledged.`,
      processed_at: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('[Webhook ERP] Error processing request:', err);
    await recordAuditLog({
      eventType: 'webhook_quarantined',
      direction: 'inbound',
      status: 'error',
      statusCode: 500,
      source: 'ERP Webhook',
      errorMessage: err?.message || 'Internal server error processing webhook payload',
      payload: { rawBody: String(req.body).slice(0, 500) },
    }).catch(() => {});

    return res.status(500).json({
      success: false,
      error: 'Internal server error processing webhook payload.',
      details: err?.message,
    });
  }
}
