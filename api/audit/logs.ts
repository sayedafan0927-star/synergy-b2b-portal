import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { applyCorsHeaders } from '../lib/cors';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

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
 * Логирование интеграционного события в базу данных Supabase
 */
export async function recordAuditLog(entry: AuditLogEntry): Promise<void> {
  try {
    const payloadObj = entry.payload ? { ...entry.payload } : {};
    if (entry.correlationId) {
      payloadObj.correlation_id = entry.correlationId;
    }
    if (entry.ip) {
      payloadObj.client_ip = entry.ip;
    }

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
    console.warn('[Audit Log] Failed to persist log entry:', err);
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
