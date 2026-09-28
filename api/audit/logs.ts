import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://sjvvoxxwevwgziuxjvcy.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZmY2dscW5qaHl1Ynh1aGZ0cndvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDMwMzQ1MDUsImV4cCI6MjA1ODYxMDUwNX0.z0Vw3tJ4372iY-qC52dZ_Yl-kC46M25jH3_P9z3G30w';

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
  // CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Correlation-ID');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
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
