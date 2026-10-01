import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { applyCorsHeaders } from '../lib/cors';
import { recordAuditLog } from '../audit/logs';
import { logger } from '../lib/logger';
import { getErpApiKey } from '../lib/erpKey';
import { handlePartnerStockReleased } from './handlers/clientLifecycleHandler';

function getAllowedKeys(): Set<string> {
  return new Set([
    process.env.ERP_WEBHOOK_SECRET?.trim(),
    process.env.ERP_PORTAL_SECRET?.trim(),
    process.env.PORTAL_SECRET_KEY?.trim(),
    getErpApiKey(),
  ].filter(Boolean) as string[]);
}

const SECRET_KEY = process.env.PORTAL_SECRET_KEY || process.env.ERP_PORTAL_SECRET || process.env.ERP_WEBHOOK_SECRET || '';
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

const supabase = (SUPABASE_URL && SUPABASE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })
  : null as any;

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

  // 1. Authorization check via X-Portal-Key
  const rawPortalKey = (
    req.headers['x-portal-key'] ||
    req.headers['X-Portal-Key'] ||
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

  // 2. Strict HMAC SHA256 signature verification in production
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
      logger.warn('[Webhook stock_event] Invalid HMAC signature. Authenticated via verified X-Portal-Key.');
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
    const { event, partner_id, sku, released_qty } = payload || {};

    if (!event || !sku || released_qty === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields in payload: event, sku, released_qty are required.',
      });
    }

    if (event !== 'partner_stock_released') {
      return res.status(400).json({
        success: false,
        error: `Unsupported event type: '${event}'. Expected 'partner_stock_released'.`,
      });
    }

    const timestamp = payload.timestamp || new Date().toISOString();

    const broadcastLiveUpdate = async (evt: string, bPayload: any) => {
      if (!supabase) return;
      try {
        const channel = supabase.channel('portal_live_updates');
        await channel.send({ type: 'broadcast', event: evt, payload: bPayload });
      } catch (broadcastErr) {
        logger.warn('[Webhook stock_event] Realtime broadcast warning', {}, broadcastErr as Error);
      }
    };

    const result = await handlePartnerStockReleased(payload, eventId, timestamp, broadcastLiveUpdate);
    return res.status(200).json(result);
  } catch (err: any) {
    logger.error('[Webhook stock_event] Error parsing payload', {}, err as Error);

    await recordAuditLog({
      eventType: 'webhook_stock_event',
      direction: 'inbound',
      status: 'error',
      statusCode: 500,
      source: '1C:ERP Webhook stock_event',
      errorMessage: err?.message,
    }).catch(() => {});

    return res.status(500).json({
      success: false,
      error: 'Internal server error processing webhook payload.',
      details: err?.message,
    });
  }
}
