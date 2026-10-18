import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { applyCorrelationId } from './lib/trace';
import { enforceRateLimit } from './lib/rateLimit';
import { applyCorsHeaders } from './lib/cors';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

const supabase = (SUPABASE_URL && SUPABASE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })
  : null as any;

export interface WarehouseRuleRecord {
  client_id: string;
  mode: 'auto' | 'custom';
  show_central_warehouse: boolean;
  show_showroom_warehouse: boolean;
  show_stock_summary?: boolean;
  allowed_warehouse_ids: number[];
  hidden_warehouse_ids: number[];
  custom_name?: string;
  updated_at?: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!applyCorsHeaders(req, res)) {
    return;
  }

  applyCorrelationId(req, res);

  if (!(await enforceRateLimit(req, res, { limit: 60, windowSeconds: 60, actionPrefix: 'warehouse_rules' }))) {
    return;
  }

  // 1. GET: Получить правила (все для персонала или по конкретному клиенту)
  if (req.method === 'GET') {
    try {
      const { authenticateRequest } = await import('./lib/authGuard');
      const authCtx = await authenticateRequest(req, { allowServerKey: true });
      const clientId = req.query.client_id ? String(req.query.client_id).trim() : null;
      const isStaff = authCtx.isAuthenticated && (authCtx.isServer || authCtx.role === 'admin' || authCtx.role === 'manager_rm' || authCtx.role === 'manager_lm');

      let query = supabase.from('client_warehouse_rules').select('*');
      if (isStaff) {
        if (clientId) {
          query = query.eq('client_id', clientId);
        }
      } else if (authCtx.isAuthenticated && authCtx.role === 'client') {
        const ownKeys = [authCtx.partnerId, authCtx.userId].filter(Boolean).map(String);
        if (ownKeys.length === 0) {
          return res.status(200).json({ success: true, rules: {} });
        }
        query = query.in('client_id', ownKeys);
      } else if (clientId) {
        query = query.eq('client_id', clientId);
      } else {
        return res.status(200).json({ success: true, rules: {} });
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
          showStockSummary: r.show_stock_summary === true,
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

  // 2. POST: Сохранить/обновить правило для контрагента (Только для администраторов и менеджеров)
  if (req.method === 'POST') {
    const { authenticateRequest } = await import('./lib/authGuard');
    const authCtx = await authenticateRequest(req, { requiredRoles: ['admin', 'manager_rm', 'manager_lm'], allowServerKey: true });
    if (!authCtx.isAuthenticated || authCtx.error) {
      return res.status(403).json({
        success: false,
        error: authCtx.error || 'Изменение правил видимости складов доступно только администраторам и менеджерам.',
      });
    }

    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const { clientId, settings } = body || {};

      if (!clientId || !settings) {
        return res.status(400).json({ success: false, error: 'clientId and settings are required' });
      }

      const targetClientId = String(clientId).trim().replace(/^erp-client-/, '');

      // Anti-BOLA: Менеджер может менять правила только для закрепленного за ним контрагента
      if (!authCtx.isServer && (authCtx.role === 'manager_rm' || authCtx.role === 'manager_lm') && authCtx.userId && supabase) {
        const { data: targetProfile } = await supabase
          .from('profiles')
          .select('id, manager_id')
          .or(`partner_id.eq.${targetClientId},id.eq.${targetClientId}`)
          .maybeSingle();

        if (
          targetProfile?.manager_id &&
          String(targetProfile.manager_id) !== String(authCtx.userId) &&
          (!authCtx.managerId || String(targetProfile.manager_id) !== String(authCtx.managerId))
        ) {
          return res.status(403).json({
            success: false,
            code: 'FORBIDDEN_COUNTERPARTY_SCOPE',
            error: 'Доступ запрещен: данный контрагент закреплен за другим менеджером (Anti-BOLA).',
          });
        }
      }

      const record: WarehouseRuleRecord = {
        client_id: String(clientId).trim(),
        mode: settings.mode || 'auto',
        show_central_warehouse: settings.showCentralWarehouse !== false,
        show_showroom_warehouse: settings.showShowroomWarehouse !== false,
        show_stock_summary: Boolean(settings.showStockSummary),
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

  // 3. DELETE: Сбросить правила для контрагента (Удалить кастомное правило)
  if (req.method === 'DELETE') {
    const { authenticateRequest } = await import('./lib/authGuard');
    const authCtx = await authenticateRequest(req, { requiredRoles: ['admin', 'manager_lm'], allowServerKey: true });
    if (!authCtx.isAuthenticated || authCtx.error) {
      return res.status(403).json({
        success: false,
        error: authCtx.error || 'Сброс правил видимости складов доступен только администраторам и ЛМ.',
      });
    }

    try {
      const clientId = req.query.client_id ? String(req.query.client_id).trim() : req.body?.clientId;
      if (!clientId) {
        return res.status(400).json({ success: false, error: 'clientId обязателен' });
      }

      const { error: delErr } = await supabase
        .from('client_warehouse_rules')
        .delete()
        .eq('client_id', String(clientId).trim());

      if (delErr) {
        console.warn('[Warehouse Rules API] Delete error:', delErr.message);
        return res.status(500).json({ success: false, error: delErr.message });
      }

      return res.status(200).json({
        success: true,
        message: `Правила видимости складов для клиента ${clientId} сброшены (удалены).`,
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message });
    }
  }

  return res.status(405).json({ success: false, error: 'Method not allowed' });
}
