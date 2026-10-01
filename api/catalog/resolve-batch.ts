import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { applyCorsHeaders } from '../lib/cors';
import { applyCorrelationId } from '../lib/trace';
import { enforceRateLimit } from '../lib/rateLimit';
import { handleResolveCatalogBatch } from '../modules/catalog/resolveBatchHandler';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

const supabase = (SUPABASE_URL && SUPABASE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })
  : null as any;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!applyCorsHeaders(req, res)) {
    return;
  }

  applyCorrelationId(req, res);

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'Метод не поддерживается (ожидается POST)' });
  }

  // Rate Limiting (120 запросов в минуту на IP)
  if (!(await enforceRateLimit(req, res, { limit: 120, windowSeconds: 60, actionPrefix: 'catalog_resolve_batch' }))) {
    return;
  }

  return await handleResolveCatalogBatch(req, res, supabase);
}
