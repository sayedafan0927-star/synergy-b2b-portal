import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { applyCorsHeaders } from '../lib/cors';
import { applyCorrelationId } from '../lib/trace';
import { enforceRateLimit } from '../lib/rateLimit';
import { authenticateRequest } from '../lib/authGuard';
import { handleFinancialBalanceSheet } from '../modules/financial/balanceHandler';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

const supabase = (SUPABASE_URL && SUPABASE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })
  : null as any;

/**
 * Isolated Domain Micro-Endpoint: Financial Balance Sheet Service
 * Route: GET /api/financial/balance
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!applyCorsHeaders(req, res)) return;
  const correlationId = applyCorrelationId(req, res);

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ success: false, error: 'Метод не поддерживается. Ожидается GET.' });
  }

  if (!(await enforceRateLimit(req, res, { limit: 60, windowSeconds: 60, actionPrefix: 'financial_balance' }))) {
    return;
  }

  const callerAuth = await authenticateRequest(req, { allowServerKey: true });
  if (!callerAuth.isAuthenticated) {
    return res.status(401).json({ success: false, error: callerAuth.error || 'Требуется авторизация.' });
  }

  if (callerAuth.role !== 'admin' && !callerAuth.isServer) {
    return res.status(403).json({ success: false, error: 'Доступ разрешен только администраторам.' });
  }

  return await handleFinancialBalanceSheet(req, res, supabase);
}
