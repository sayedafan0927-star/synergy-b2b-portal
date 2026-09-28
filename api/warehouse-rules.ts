import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { applyCorrelationId } from './lib/trace';
import { enforceRateLimit } from './lib/rateLimit';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://sjvvoxxwevwgziuxjvcy.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZmY2dscW5qaHl1Ynh1aGZ0cndvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDMwMzQ1MDUsImV4cCI6MjA1ODYxMDUwNX0.z0Vw3tJ4372iY-qC52dZ_Yl-kC46M25jH3_P9z3G30w';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

export interface WarehouseRuleRecord {
  client_id: string;
  mode: 'auto' | 'custom';
  show_central_warehouse: boolean;
  show_showroom_warehouse: boolean;
  allowed_warehouse_ids: number[];
  hidden_warehouse_ids: number[];
  custom_name?: string;
  updated_at?: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Correlation-ID');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  applyCorrelationId(req, res);

  if (!enforceRateLimit(req, res, { limit: 60, windowSeconds: 60, actionPrefix: 'warehouse_rules' })) {
    return;
  }

  // 1. GET: Получить правила (все или по конкретному клиенту)
  if (req.method === 'GET') {
    try {
      const clientId = req.query.client_id ? String(req.query.client_id).trim() : null;

      let query = supabase.from('client_warehouse_rules').select('*');
      if (clientId) {
        query = query.eq('client_id', clientId);
      }

      const { data, error } = await query;
      if (error) {
        console.warn('[Warehouse Rules API] Supabase select error:', error.message);
        return res.status(200).json({ success: true, rules: {} });
      }

      // Форматируем в Record<string, ClientWarehouseSettings>
      const rulesMap: Record<string, any> = {};
      for (const r of data || []) {
        rulesMap[r.client_id] = {
          mode: r.mode || 'auto',
          showCentralWarehouse: r.show_central_warehouse !== false,
          showShowroomWarehouse: r.show_showroom_warehouse !== false,
          allowedWarehouseIds: r.allowed_warehouse_ids || [],
          hiddenWarehouseIds: r.hidden_warehouse_ids || [],
          customName: r.custom_name,
          updatedAt: r.updated_at,
        };
      }

      return res.status(200).json({
        success: true,
        rules: rulesMap,
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message });
    }
  }

  // 2. POST: Сохранить/обновить правило для контрагента
  if (req.method === 'POST') {
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const { clientId, settings } = body || {};

      if (!clientId || !settings) {
        return res.status(400).json({ success: false, error: 'clientId and settings are required' });
      }

      const record: WarehouseRuleRecord = {
        client_id: String(clientId).trim(),
        mode: settings.mode || 'auto',
        show_central_warehouse: settings.showCentralWarehouse !== false,
        show_showroom_warehouse: settings.showShowroomWarehouse !== false,
        allowed_warehouse_ids: Array.isArray(settings.allowedWarehouseIds) ? settings.allowedWarehouseIds : [],
        hidden_warehouse_ids: Array.isArray(settings.hiddenWarehouseIds) ? settings.hiddenWarehouseIds : [],
        custom_name: settings.customName || null,
        updated_at: new Date().toISOString(),
      };

      const { error: upsertErr } = await supabase
        .from('client_warehouse_rules')
        .upsert(record, { onConflict: 'client_id' });

      if (upsertErr) {
        console.warn('[Warehouse Rules API] Upsert error:', upsertErr.message);
        return res.status(500).json({ success: false, error: upsertErr.message });
      }

      return res.status(200).json({
        success: true,
        message: `Правила видимости складов для клиента ${clientId} успешно сохранены в PostgreSQL.`,
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message });
    }
  }

  return res.status(405).json({ success: false, error: 'Method not allowed' });
}
