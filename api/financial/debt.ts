import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { applyCorsHeaders } from '../lib/cors';
import { applyCorrelationId } from '../lib/trace';
import { enforceRateLimit } from '../lib/rateLimit';
import { authenticateRequest } from '../lib/authGuard';
import { handleCachedClientDebt } from '../modules/financial/debtHandler';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

const supabase = (SUPABASE_URL && SUPABASE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })
  : null as any;

/**
 * Isolated Domain Micro-Endpoint: Client Financial Debt Service
 * Route: GET /api/financial/debt
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!applyCorsHeaders(req, res)) return;
  applyCorrelationId(req, res);

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ success: false, error: 'Метод не поддерживается. Ожидается GET.' });
  }

  if (!(await enforceRateLimit(req, res, { limit: 120, windowSeconds: 60, actionPrefix: 'financial_debt' }))) {
    return;
  }

  const callerAuth = await authenticateRequest(req, { allowServerKey: true });
  if (!callerAuth.isAuthenticated) {
    return res.status(401).json({ success: false, error: callerAuth.error || 'Требуется авторизация.' });
  }

  return await handleCachedClientDebt(req, res, supabase, callerAuth);
}
