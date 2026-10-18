import type { VercelRequest, VercelResponse } from '@vercel/node';
import { dispatchApprovalRequest } from '../../approvals/whatsapp';
import { recordAuditLog } from '../../audit/logs';
import { authenticateRequest } from '../../lib/authGuard';

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

    const sent = await dispatchApprovalRequest({
      orderId: targetOrderId,
      orderDocNumber: payload.order_doc_number || payload.orderDocNumber,
      clientName: payload.client_name || payload.clientName || callerAuth.companyName || callerAuth.fullName || 'Клиент B2B',
      clientPhone: payload.client_phone || payload.clientPhone || callerAuth.phone,
      totalAmount: Number(payload.total_amount || payload.totalAmount || 0),
      totalSqm: Number(payload.total_sqm || payload.totalSqm || 0),
      itemsCount: Number(payload.items_count || payload.itemsCount || 1),
      reason: payload.reason || 'Превышение кредитного лимита / стоп-лист',
      managerPhone: payload.manager_phone || payload.managerPhone,
    });

    await recordAuditLog({
      eventType: 'request_approval',
      direction: 'outbound',
      status: sent ? 'success' : 'warning',
      source: 'WhatsApp Approvals',
      correlationId,
      payload: { order_id: payload.order_id, client: payload.client_name },
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
