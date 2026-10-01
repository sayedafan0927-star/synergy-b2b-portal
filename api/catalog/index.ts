import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { applyCorsHeaders } from '../lib/cors';
import { applyCorrelationId } from '../lib/trace';
import { enforceRateLimit } from '../lib/rateLimit';
import { handleCatalogRequests } from '../modules/catalog/catalogHandler';
import { getErpApiKey } from '../lib/erpKey';

const TARGET_ERP_URL = process.env.ERP_API_URL || 'https://erp.synergy-tech.kz/api_portal.php';
const ERP_FALLBACK_URL = process.env.ERP_FALLBACK_URL || 'https://erp.synergy-tech.kz/api_portal.php';
const SERVER_ERP_KEY = getErpApiKey();
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

const supabase = (SUPABASE_URL && SUPABASE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })
  : null as any;

/**
 * Isolated Domain Micro-Endpoint: High-Throughput Catalog Service
 * Route: GET /api/catalog
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!applyCorsHeaders(req, res)) return;
  const correlationId = applyCorrelationId(req, res);

  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ success: false, error: 'Метод не поддерживается. Ожидается GET или POST.' });
  }

  // Rate Limiting (600 запросов в минуту на IP для каталога)
  if (!(await enforceRateLimit(req, res, { limit: 600, windowSeconds: 60, actionPrefix: 'catalog_direct' }))) {
    return;
  }

  const action = String(req.query.action || req.body?.action || 'catalog_paginated');
  const handled = await handleCatalogRequests(
    req,
    res,
    action,
    supabase,
    TARGET_ERP_URL,
    ERP_FALLBACK_URL,
    SERVER_ERP_KEY,
    correlationId
  );

  if (!handled && !res.writableEnded) {
    res.status(404).json({
      success: false,
      error: `Действие каталога '${action}' не поддерживается или данные временно недоступны.`,
    });
  }
}
