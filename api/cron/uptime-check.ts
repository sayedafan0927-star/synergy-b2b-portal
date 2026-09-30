import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { recordAuditLog } from '../audit/logs';
import { applyCorrelationId } from '../lib/trace';
import { applyCorsHeaders } from '../lib/cors';
import { logger } from '../lib/logger';
import { sendWhatsAppMessage } from '../approvals/whatsapp';
import { getErpApiKey } from '../lib/erpKey';
import { recordSuccess, recordFailure } from '../lib/circuitBreaker';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
const CRON_SECRET = process.env.CRON_SECRET || process.env.PORTAL_SECRET_KEY || '';
const TARGET_ERP_URL = process.env.ERP_API_URL || 'https://kilem-khan.kz/api/sin/public/api_portal.php';
const SERVER_ERP_KEY = getErpApiKey();
const ADMIN_PHONE = process.env.ADMIN_WHATSAPP_PHONE || '';

const supabase = SUPABASE_URL && SUPABASE_KEY ? createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
}) : null;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!applyCorsHeaders(req, res)) {
    return;
  }

  const correlationId = applyCorrelationId(req, res);

  // Проверка авторизации крона (Bearer Secret или x-cron-key)
  const authHeader = req.headers['authorization'] || '';
  const cronKeyHeader = req.headers['x-cron-key'] || req.headers['x-portal-key'];
  const isAuthorized =
    (process.env.NODE_ENV !== 'production' && !CRON_SECRET) ||
    (CRON_SECRET && (cronKeyHeader === CRON_SECRET || authHeader === `Bearer ${CRON_SECRET}`));

  if (!isAuthorized) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized: Invalid or missing cron authorization token.',
    });
  }

  const startTime = Date.now();
  const report: {
    status: 'healthy' | 'degraded' | 'unhealthy';
    database: { status: 'healthy' | 'unhealthy'; latencyMs: number; error?: string };
    erp: { status: 'healthy' | 'unhealthy'; latencyMs: number; error?: string };
    checkedAt: string;
  } = {
    status: 'healthy',
    database: { status: 'healthy', latencyMs: 0 },
    erp: { status: 'healthy', latencyMs: 0 },
    checkedAt: new Date().toISOString(),
  };

  // 1. Проверка доступности базы данных PostgreSQL
  const dbStart = Date.now();
  try {
    if (!supabase) throw new Error('Supabase client not initialized');
    const { error: dbErr } = await supabase.from('profiles').select('id').limit(1);
    report.database.latencyMs = Date.now() - dbStart;
    if (dbErr) {
      report.database.status = 'unhealthy';
      report.database.error = dbErr.message;
      report.status = 'degraded';
    }
  } catch (err: any) {
    report.database.latencyMs = Date.now() - dbStart;
    report.database.status = 'unhealthy';
    report.database.error = err?.message || 'Database connection error';
    report.status = 'degraded';
  }

  // 2. Проверка доступности шлюза 1C:ERP
  const erpStart = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const erpRes = await fetch(`${TARGET_ERP_URL}?action=ping`, {
      method: 'GET',
      headers: {
        'X-Portal-Key': SERVER_ERP_KEY,
        'X-Correlation-ID': correlationId,
      },
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    report.erp.latencyMs = Date.now() - erpStart;
    if (!erpRes.ok) {
      report.erp.status = 'unhealthy';
      report.erp.error = `HTTP ${erpRes.status}`;
      report.status = report.database.status === 'unhealthy' ? 'unhealthy' : 'degraded';
      await recordFailure('erp_gateway').catch(() => {});
    } else {
      // Проактивное самоисцеление: переводим Circuit Breaker из OPEN/HALF_OPEN в CLOSED
      await recordSuccess('erp_gateway').catch(() => {});
    }
  } catch (err: any) {
    report.erp.latencyMs = Date.now() - erpStart;
    report.erp.status = 'unhealthy';
    report.erp.error = err?.name === 'AbortError' ? 'Timeout (5s)' : (err?.message || 'ERP gateway unreachable');
    report.status = report.database.status === 'unhealthy' ? 'unhealthy' : 'degraded';
    await recordFailure('erp_gateway').catch(() => {});
  }

  // 3. Если обнаружен инцидент — отправляем тревожный алерт дежурному инженеру
  if (report.status !== 'healthy') {
    logger.error(`[Uptime Incident] Service status is ${report.status}`, {
      correlationId,
      database: report.database,
      erp: report.erp,
    });

    await recordAuditLog({
      eventType: 'uptime_incident_detected',
      direction: 'inbound',
      status: 'error',
      statusCode: report.status === 'unhealthy' ? 503 : 500,
      latencyMs: Date.now() - startTime,
      source: 'Synthetic Uptime Cron',
      correlationId,
      payload: report,
      errorMessage: `DB: ${report.database.status} (${report.database.error || 'ok'}), ERP: ${report.erp.status} (${report.erp.error || 'ok'})`,
    });

    if (ADMIN_PHONE) {
      const alertMsg = `🚨 *SYNERGY B2B INCIDENT ALERT*\n\nСтатус портала: *${report.status.toUpperCase()}*\n• База данных: ${report.database.status === 'healthy' ? '✅ OK' : '❌ СБОЙ (' + report.database.error + ')'} [${report.database.latencyMs}ms]\n• 1C:ERP Шлюз: ${report.erp.status === 'healthy' ? '✅ OK' : '❌ СБОЙ (' + report.erp.error + ')'} [${report.erp.latencyMs}ms]\n\nВремя: ${new Date().toLocaleTimeString('ru-RU')}\nCorrelation: ${correlationId}`;
      sendWhatsAppMessage(ADMIN_PHONE, alertMsg).catch(err => {
        logger.warn('[Uptime Incident] Failed to send WhatsApp alert', { correlationId }, err as Error);
      });
    }
  } else {
    logger.info('[Uptime Check] All services operational', {
      correlationId,
      dbLatencyMs: report.database.latencyMs,
      erpLatencyMs: report.erp.latencyMs,
    });
  }

  return res.status(report.status === 'unhealthy' ? 503 : 200).json({
    success: report.status === 'healthy',
    report,
    totalDurationMs: Date.now() - startTime,
  });
}
