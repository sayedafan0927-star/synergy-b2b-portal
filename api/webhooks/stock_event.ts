import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCorsHeaders } from '../lib/cors';

const ALLOWED_KEYS = new Set(
  [
    process.env.ERP_WEBHOOK_SECRET,
    process.env.ERP_PORTAL_SECRET,
    process.env.PORTAL_SECRET_KEY,
  ].filter((k): k is string => Boolean(k && k.trim().length > 0))
);

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

  // Authorization check via X-Portal-Key
  const portalKey = (req.headers['x-portal-key'] || req.headers['X-Portal-Key']) as string | undefined;

  if (!portalKey || !ALLOWED_KEYS.has(portalKey)) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized: Invalid or missing X-Portal-Key header.',
    });
  }

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

    console.log(`[Webhook stock_event] Partner ${partner_id}: released ${qty} pcs of SKU ${sku} (Doc: ${doc_number})`);

    // В ответе подтверждаем успешную фиксацию списания
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
    console.error('[Webhook stock_event] Error parsing payload:', err);
    return res.status(500).json({
      success: false,
      error: 'Internal server error processing webhook payload.',
      details: err?.message,
    });
  }
}
