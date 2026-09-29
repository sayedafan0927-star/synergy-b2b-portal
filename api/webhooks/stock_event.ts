import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { applyCorsHeaders } from '../lib/cors';
import { recordAuditLog } from '../audit/logs';
import { logger } from '../lib/logger';

const ALLOWED_KEYS = new Set(
  [
    process.env.ERP_WEBHOOK_SECRET,
    process.env.ERP_PORTAL_SECRET,
    process.env.PORTAL_SECRET_KEY,
  ].filter((k): k is string => Boolean(k && k.trim().length > 0))
);

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

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

  // Authorization check via X-Portal-Key
  const portalKey = (req.headers['x-portal-key'] || req.headers['X-Portal-Key']) as string | undefined;

  if (!portalKey || !ALLOWED_KEYS.has(portalKey)) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized: Invalid or missing X-Portal-Key header.',
    });
  }

  const startTime = Date.now();

  try {
    const payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { event, partner_id, sku, released_qty, doc_number, timestamp } = payload || {};

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

    const processedAt = timestamp || new Date().toISOString();
    const qty = Number(released_qty);

    logger.info(`[Webhook stock_event] Partner ${partner_id}: released ${qty} pcs of SKU ${sku}`, {
      partner_id,
      sku,
      released_qty: qty,
      doc_number,
    });

    // 1. Оповещаем Realtime-канал portal_live_updates
    try {
      const channel = supabase.channel('portal_live_updates');
      await channel.send({
        type: 'broadcast',
        event: 'stock_changed',
        payload: {
          reason: 'partner_stock_released',
          partner_id: partner_id ? Number(partner_id) : null,
          sku: String(sku),
          released_qty: qty,
          doc_number: doc_number || null,
          timestamp: processedAt,
        },
      });
    } catch (broadcastErr) {
      logger.warn('[Webhook stock_event] Realtime broadcast warning', {}, broadcastErr as Error);
    }

    // 2. Запись в журнал аудита
    await recordAuditLog({
      eventType: 'webhook_stock_event',
      direction: 'inbound',
      status: 'success',
      statusCode: 200,
      latencyMs: Date.now() - startTime,
      source: '1C:ERP Webhook stock_event',
      payload: { partner_id, sku, released_qty: qty, doc_number },
    });

    return res.status(200).json({
      success: true,
      message: `Stock event '${event}' processed successfully.`,
      applied: {
        partner_id: partner_id ? Number(partner_id) : null,
        sku: String(sku),
        released_qty: qty,
        doc_number: doc_number || null,
        timestamp: processedAt,
      },
    });
  } catch (err: any) {
    logger.error('[Webhook stock_event] Error parsing payload', {}, err as Error);

    await recordAuditLog({
      eventType: 'webhook_stock_event',
      direction: 'inbound',
      status: 'error',
      statusCode: 500,
      latencyMs: Date.now() - startTime,
      source: '1C:ERP Webhook stock_event',
      errorMessage: err?.message,
    });

    return res.status(500).json({
      success: false,
      error: 'Internal server error processing webhook payload.',
      details: err?.message,
    });
  }
}
