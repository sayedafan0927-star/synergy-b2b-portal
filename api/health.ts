import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { applyCorsHeaders } from './lib/cors';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
const SERVER_ERP_KEY = process.env.ERP_API_KEY || '';
const TARGET_ERP_URL = process.env.ERP_API_URL || 'https://kilem-khan.kz/api/sin/public/api_portal.php';

const supabase = SUPABASE_URL && SUPABASE_KEY ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!applyCorsHeaders(req, res)) {
    return;
  }

  const startTime = Date.now();
  const checks: Record<string, { status: 'healthy' | 'unhealthy' | 'unknown'; latencyMs?: number; error?: string }> = {
    database: { status: 'unknown' },
    erp_gateway: { status: 'unknown' },
  };

  // 1. Проверка доступности PostgreSQL (Supabase)
  const dbStart = Date.now();
  if (!supabase) {
    checks.database = { status: 'unhealthy', latencyMs: 0, error: 'Database credentials not configured in environment' };
  } else {
    try {
      const { error } = await supabase.from('profiles').select('id').limit(1);
      if (error) {
        checks.database = { status: 'unhealthy', latencyMs: Date.now() - dbStart, error: error.message };
      } else {
        checks.database = { status: 'healthy', latencyMs: Date.now() - dbStart };
      }
    } catch (err: any) {
      checks.database = { status: 'unhealthy', latencyMs: Date.now() - dbStart, error: err?.message };
    }
  }

  // 2. Проверка доступности шлюза собственной ERP
  const erpStart = Date.now();
  if (!SERVER_ERP_KEY) {
    checks.erp_gateway = { status: 'unhealthy', latencyMs: 0, error: 'ERP_API_KEY not configured in environment' };
  } else {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);
      const pingUrl = `${TARGET_ERP_URL}?action=ping&portal_key=${encodeURIComponent(SERVER_ERP_KEY)}`;
      
      const erpRes = await fetch(pingUrl, {
        method: 'GET',
        headers: { 'X-Portal-Key': SERVER_ERP_KEY },
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    if (erpRes.ok) {
      checks.erp_gateway = { status: 'healthy', latencyMs: Date.now() - erpStart };
    } else {
      checks.erp_gateway = { status: 'unhealthy', latencyMs: Date.now() - erpStart, error: `HTTP ${erpRes.status}` };
    }
  } catch (err: any) {
    checks.erp_gateway = {
      status: 'unhealthy',
      latencyMs: Date.now() - erpStart,
      error: err?.name === 'AbortError' ? 'Timeout (4s)' : err?.message,
    };
  }
  }

  const isDbHealthy = checks.database.status === 'healthy';
  const isErpHealthy = checks.erp_gateway.status === 'healthy';

  const overallStatus = isDbHealthy && isErpHealthy ? 'ok' : isDbHealthy ? 'degraded' : 'down';
  const httpCode = overallStatus === 'down' ? 503 : 200;

  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  const CRON_SECRET = process.env.CRON_SECRET || '';
  const PORTAL_SECRET_KEY = process.env.PORTAL_SECRET_KEY || process.env.ERP_PORTAL_SECRET || '';
  const isAuthenticated = Boolean(token && (token === CRON_SECRET || token === PORTAL_SECRET_KEY));

  if (!isAuthenticated) {
    return res.status(httpCode).json({
      status: overallStatus,
    });
  }

  return res.status(httpCode).json({
    status: overallStatus,
    timestamp: new Date().toISOString(),
    totalLatencyMs: Date.now() - startTime,
    version: '2.5.0-enterprise',
    checks,
  });
}
