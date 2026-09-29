import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { applyCorsHeaders } from '../lib/cors';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

const supabase = (SUPABASE_URL && SUPABASE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_KEY)
  : null as any;

import { logger } from '../lib/logger';

export interface AuditLogEntry {
  eventType: string;
  direction: 'inbound' | 'outbound';
  status: 'success' | 'warning' | 'error';
  statusCode?: number;
  latencyMs?: number;
  source: string;
  payload?: any;
  errorMessage?: string;
  correlationId?: string;
  ip?: string;
}

/**
 * Рекурсивное маскирование конфиденциальных данных и PII в аудит-логах
 */
export function sanitizeAuditPayload(data: any): any {
  if (!data || typeof data !== 'object') return data;
  if (Array.isArray(data)) return data.map(sanitizeAuditPayload);
  const sanitized: Record<string, any> = {};
  for (const [key, value] of Object.entries(data)) {
    const k = key.toLowerCase();
    if (
      k.includes('password') ||
      k.includes('token') ||
      k.includes('secret') ||
      k.includes('key') ||
      k.includes('authorization') ||
      k.includes('pin') ||
      k.includes('pass')
    ) {
      sanitized[key] = '***REDACTED***';
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeAuditPayload(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

/**
 * Логирование интеграционного события в базу данных Supabase и Structured Logger
 */
export async function recordAuditLog(entry: AuditLogEntry): Promise<void> {
  // 1. Потоковое структурированное JSON-логирование (Vercel Log Drains / Datadog / Grafana)
  const logCtx = {
    correlationId: entry.correlationId,
    action: entry.eventType,
    direction: entry.direction,
    statusCode: entry.statusCode,
    durationMs: entry.latencyMs,
    source: entry.source,
    ip: entry.ip,
  };
  if (entry.status === 'error') {
    logger.error(`[IntegrationAudit] ${entry.eventType} ${entry.direction} failed: ${entry.errorMessage || 'Unknown error'}`, logCtx);
  } else if (entry.status === 'warning') {
    logger.warn(`[IntegrationAudit] ${entry.eventType} ${entry.direction} warning`, logCtx);
  } else {
    logger.info(`[IntegrationAudit] ${entry.eventType} ${entry.direction} success`, logCtx);
  }

  // 2. Персистенция в БД Supabase с обязательной санитизацией секретов
  if (!supabase) return;
  try {
    const rawPayloadObj = entry.payload ? { ...entry.payload } : {};
    if (entry.correlationId) {
      rawPayloadObj.correlation_id = entry.correlationId;
    }
    if (entry.ip) {
      rawPayloadObj.client_ip = entry.ip;
    }
    const payloadObj = sanitizeAuditPayload(rawPayloadObj);

    await supabase.from('integration_audit_logs').insert({
      event_type: entry.eventType,
      direction: entry.direction,
      status: entry.status,
      status_code: entry.statusCode || null,
      latency_ms: entry.latencyMs || null,
      source: entry.source,
      payload: JSON.parse(JSON.stringify(payloadObj).slice(0, 10000)),
      error_message: entry.errorMessage || null,
    });
  } catch (err) {
    logger.warn('[Audit Log] Failed to persist log entry to database', { correlationId: entry.correlationId }, err as Error);
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!applyCorsHeaders(req, res)) {
    return;
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  // Защита ИБ: доступ к журналу транзакций строго для администраторов
  const { authenticateRequest } = await import('../lib/authGuard');
  const authCtx = await authenticateRequest(req, { requiredRoles: ['admin'], allowServerKey: true });
  if (!authCtx.isAuthenticated || authCtx.error) {
    return res.status(200).json({
      success: true,
      count: 0,
      logs: [],
    });
  }

  try {
    const limit = Math.min(Number(req.query.limit || 50), 100);

    const { data: logs, error } = await supabase
      .from('integration_audit_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.warn('[Audit API] Supabase query notice:', error.message);
      return res.status(200).json({
        success: true,
        count: 0,
        logs: [],
      });
    }

    return res.status(200).json({
      success: true,
      count: logs?.length || 0,
      logs: logs || [],
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: 'Ошибка получения журнала аудита',
      details: err?.message,
    });
  }
}
