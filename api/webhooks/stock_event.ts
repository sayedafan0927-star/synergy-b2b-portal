import type { VercelRequest, VercelResponse } from '@vercel/node';

const ALLOWED_KEYS = new Set([
  'SynergySecretKey2025',
  '138d1bdaf9402600c8f5d5763e2e1573c1e45d32401e62e4981cd7e898bf0544',
]);

if (process.env.ERP_PORTAL_SECRET) {
  ALLOWED_KEYS.add(process.env.ERP_PORTAL_SECRET);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, X-Portal-Key'
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
