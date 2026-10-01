import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { applyCorsHeaders } from '../lib/cors';
import { applyCorrelationId } from '../lib/trace';
import { enforceRateLimit } from '../lib/rateLimit';
import { authenticateRequest } from '../lib/authGuard';
import { handleCancelOrder } from '../modules/orders/cancelOrderHandler';
import { getErpApiKey } from '../lib/erpKey';

const TARGET_ERP_URL = process.env.ERP_API_URL || 'https://kilem-khan.kz/api/sin/public/api_portal.php';
const SERVER_ERP_KEY = getErpApiKey();
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

const supabase = (SUPABASE_URL && SUPABASE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })
  : null as any;

/**
 * Isolated Domain Micro-Endpoint: Order Cancellation Service
 * Route: POST /api/orders/cancel
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!applyCorsHeaders(req, res)) return;
  const correlationId = applyCorrelationId(req, res);

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'Метод не поддерживается. Ожидается POST.' });
  }

  if (!(await enforceRateLimit(req, res, { limit: 30, windowSeconds: 60, actionPrefix: 'orders_cancel' }))) {
    return;
  }

  const callerAuth = await authenticateRequest(req, { allowServerKey: true });
  if (!callerAuth.isAuthenticated) {
    return res.status(401).json({ success: false, error: callerAuth.error || 'Требуется авторизация.' });
  }

  return await handleCancelOrder({
    req,
    res,
    callerAuth,
    correlationId,
    supabase,
    targetErpUrl: TARGET_ERP_URL,
    serverErpKey: SERVER_ERP_KEY,
  });
}
