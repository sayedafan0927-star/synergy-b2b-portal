import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { dispatchApprovalRequest } from '../../approvals/whatsapp';
import { recordAuditLog } from '../../audit/logs';
import { authenticateRequest } from '../../lib/authGuard';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
const supabase = (SUPABASE_URL && SUPABASE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })
  : null as any;

export async function handleRequestApproval(req: VercelRequest, res: VercelResponse, correlationId: string) {
  const callerAuth = await authenticateRequest(req, { allowServerKey: true });
  if (!callerAuth.isAuthenticated) {
    return res.status(401).json({
      success: false,
      error: callerAuth.error || 'Требуется авторизация для отправки запроса на согласование.',
    });
  }

  try {
    const payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const targetOrderId = String(payload?.order_id || payload?.orderId || '').trim();
    if (!targetOrderId) {
      return res.status(400).json({
        success: false,
        error: 'Параметр order_id обязателен для запроса согласования.',
      });
    }

    const isPrivileged = callerAuth.isServer || ['admin', 'manager_rm', 'manager_lm'].includes(String(callerAuth.role || ''));
    let dbOrder: any = null;
    if (supabase) {
      try {
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(targetOrderId);
        const q = supabase.from('orders').select('id, order_number, user_id, partner_id, total_amount, total_sqm, total_items');
        const { data } = await (isUuid ? q.or(`id.eq.${targetOrderId},order_number.eq.${targetOrderId}`) : q.eq('order_number', targetOrderId)).maybeSingle();
        dbOrder = data;
      } catch {}
    }

    // Anti-BOLA Guard: Клиент может запрашивать аппрув только по своему заказу
    if (!isPrivileged && dbOrder) {
      const ownsByUser = callerAuth.userId && String(dbOrder.user_id) === String(callerAuth.userId);
      const ownsByPartner = callerAuth.partnerId && String(dbOrder.partner_id) === String(callerAuth.partnerId);
      if (!ownsByUser && !ownsByPartner) {
        return res.status(403).json({
          success: false,
          error: 'Forbidden: Вы не можете запрашивать согласование для чужого заказа (Anti-BOLA Guard).',
        });
      }
    }

    // Anti-Self-Approval Privilege Escalation: Запрещаем клиенту подменять номер телефона согласующего менеджера на свой!
    const safeManagerPhone = isPrivileged ? (payload.manager_phone || payload.managerPhone) : undefined;

    const sent = await dispatchApprovalRequest({
      orderId: dbOrder?.id || targetOrderId,
      orderDocNumber: dbOrder?.order_number || payload.order_doc_number || payload.orderDocNumber,
      clientName: (!isPrivileged ? (callerAuth.companyName || callerAuth.fullName) : null) || payload.client_name || payload.clientName || 'Клиент B2B',
      clientPhone: (!isPrivileged ? callerAuth.phone : null) || payload.client_phone || payload.clientPhone,
      totalAmount: Number(dbOrder?.total_amount ?? payload.total_amount ?? payload.totalAmount ?? 0),
      totalSqm: Number(dbOrder?.total_sqm ?? payload.total_sqm ?? payload.totalSqm ?? 0),
      itemsCount: Number(dbOrder?.total_items ?? payload.items_count ?? payload.itemsCount ?? 1),
      reason: payload.reason || 'Превышение кредитного лимита / стоп-лист',
      managerPhone: safeManagerPhone,
    });

    await recordAuditLog({
      eventType: 'request_approval',
      direction: 'outbound',
      status: sent ? 'success' : 'warning',
      source: 'WhatsApp Approvals',
      correlationId,
      payload: { order_id: targetOrderId, client: callerAuth.companyName || payload.client_name, role: callerAuth.role },
    });

    return res.status(200).json({
      success: true,
      dispatched: sent,
      message: 'Запрос на согласование успешно отправлен ответственному менеджеру в WhatsApp.',
    });
  } catch (apprErr: any) {
    console.error('[API Proxy ERP] Error dispatching approval:', apprErr);
    return res.status(500).json({
      success: false,
      error: 'Не удалось отправить запрос в WhatsApp',
      details: apprErr?.message,
    });
  }
}
