import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';

const ALLOWED_KEYS = new Set([
  'SynergySecretKey2025',
  '138d1bdaf9402600c8f5d5763e2e1573c1e45d32401e62e4981cd7e898bf0544',
]);

const SECRET_KEY = process.env.PORTAL_SECRET_KEY || process.env.ERP_PORTAL_SECRET || 'SynergySecretKey2025';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Content-Type, X-Portal-Key, X-Webhook-Signature, X-Webhook-Event-ID'
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
      console.warn(`[Webhook ERP] Invalid HMAC signature. Expected: ${expectedSig}, Received: ${receivedSig}`);
      return res.status(401).json({
        success: false,
        error: 'Invalid HMAC signature in X-Webhook-Signature header.',
      });
    }
  }

  const eventId = (req.headers['x-webhook-event-id'] || req.headers['X-Webhook-Event-ID']) as string | undefined;

  try {
    const payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { event } = payload || {};

    if (!event) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: "event" is required in payload.',
      });
    }

    const timestamp = payload.timestamp || new Date().toISOString();
    console.log(`[Webhook ERP] Received event '${event}' (EventID: ${eventId || payload.event_id || 'n/a'}, Timestamp: ${timestamp})`);

    // ───────────────────────────────────────────────
    // 1. Событие: stock_changed (Смена остатков)
    // ───────────────────────────────────────────────
    if (event === 'stock_changed') {
      const items = Array.isArray(payload.items) ? payload.items : [];
      console.log(`[Webhook ERP: stock_changed] Reason: ${payload.reason || 'manual'}, Updated items count: ${items.length}`);

      for (const item of items) {
        console.log(`  -> SKU: ${item.sku}, Free stock: ${item.free_stock}, Reserved: ${item.reserved_stock}, Total: ${item.total_stock}`);
      }

      return res.status(200).json({
        success: true,
        event: 'stock_changed',
        event_id: eventId || payload.event_id,
        items_processed: items.length,
        message: `Successfully processed stock update for ${items.length} item(s).`,
        processed_at: new Date().toISOString(),
      });
    }

    // ───────────────────────────────────────────────
    // 2. Событие: order_status_changed (Статус заказа WMS)
    // ───────────────────────────────────────────────
    if (event === 'order_status_changed') {
      const { order_id, order_doc_number, client_name, client_phone, new_status, track_code, comment } = payload;
      console.log(`[Webhook ERP: order_status_changed] Order: ${order_doc_number || order_id} -> ${new_status} (Client: ${client_name}, Phone: ${client_phone}, Track: ${track_code || 'none'})`);

      // Если заказ перешел в статус отгружен — фиксируем для отправки WhatsApp трек-номера
      if (new_status === 'shipped') {
        console.log(`  [WhatsApp Trigger] Shipping notification ready for ${client_phone}: Order ${order_doc_number} shipped with track ${track_code}`);
      }

      return res.status(200).json({
        success: true,
        event: 'order_status_changed',
        event_id: eventId || payload.event_id,
        order_id,
        new_status,
        track_code: track_code || null,
        message: `Order ${order_doc_number || order_id} status updated to '${new_status}'.`,
        processed_at: new Date().toISOString(),
      });
    }

    // ───────────────────────────────────────────────
    // 3. Событие: payment_received (Поступление оплаты)
    // ───────────────────────────────────────────────
    if (event === 'payment_received') {
      const { client_id, client_name, amount, currency, payment_doc_number, balance_usd, debt_usd } = payload;
      console.log(`[Webhook ERP: payment_received] Client: ${client_name} (ID ${client_id}) paid ${amount} ${currency || 'USD'} (Doc: ${payment_doc_number}). New balance: ${balance_usd}, Debt: ${debt_usd}`);

      return res.status(200).json({
        success: true,
        event: 'payment_received',
        event_id: eventId || payload.event_id,
        client_id,
        amount,
        balance_usd,
        debt_usd,
        message: `Payment of ${amount} ${currency || 'USD'} recorded for client ${client_id}.`,
        processed_at: new Date().toISOString(),
      });
    }

    // ───────────────────────────────────────────────
    // 4. Событие: partner_stock_released (Списание дилера)
    // ───────────────────────────────────────────────
    if (event === 'partner_stock_released') {
      const { partner_id, sku, released_qty, doc_number } = payload;
      console.log(`[Webhook ERP: partner_stock_released] Partner ${partner_id}: released ${released_qty} pcs of SKU ${sku} (Doc: ${doc_number})`);

      return res.status(200).json({
        success: true,
        event: 'partner_stock_released',
        event_id: eventId || payload.event_id,
        partner_id,
        sku,
        released_qty,
        processed_at: new Date().toISOString(),
      });
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
    return res.status(500).json({
      success: false,
      error: 'Internal server error processing webhook payload.',
      details: err?.message,
    });
  }
}
