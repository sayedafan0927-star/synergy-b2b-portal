import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://sjvvoxxwevwgziuxjvcy.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZmY2dscW5qaHl1Ynh1aGZ0cndvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDMwMzQ1MDUsImV4cCI6MjA1ODYxMDUwNX0.z0Vw3tJ4372iY-qC52dZ_Yl-kC46M25jH3_P9z3G30w';
const SERVER_ERP_KEY = process.env.ERP_API_KEY || '138d1bdaf9402600c8f5d5763e2e1573c1e45d32401e62e4981cd7e898bf0544';
const TARGET_ERP_URL = process.env.ERP_API_URL || 'https://kilem-khan.kz/api/sin/public/api_portal.php';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const startTime = Date.now();
  const checks: Record<string, { status: 'healthy' | 'unhealthy' | 'unknown'; latencyMs?: number; error?: string }> = {
    database: { status: 'unknown' },
    erp_gateway: { status: 'unknown' },
  };

  // 1. Проверка доступности PostgreSQL (Supabase)
  const dbStart = Date.now();
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

  // 2. Проверка доступности шлюза собственной ERP
  const erpStart = Date.now();
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

  const isDbHealthy = checks.database.status === 'healthy';
  const isErpHealthy = checks.erp_gateway.status === 'healthy';

  const overallStatus = isDbHealthy && isErpHealthy ? 'ok' : isDbHealthy ? 'degraded' : 'down';
  const httpCode = overallStatus === 'down' ? 503 : 200;

  return res.status(httpCode).json({
    status: overallStatus,
    timestamp: new Date().toISOString(),
    totalLatencyMs: Date.now() - startTime,
    version: '2.5.0-enterprise',
    checks,
  });
}
