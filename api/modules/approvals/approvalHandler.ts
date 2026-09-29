import type { VercelRequest, VercelResponse } from '@vercel/node';
import { dispatchApprovalRequest } from '../../approvals/whatsapp';
import { recordAuditLog } from '../../audit/logs';

export async function handleRequestApproval(req: VercelRequest, res: VercelResponse, correlationId: string) {
  try {
    const payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const sent = await dispatchApprovalRequest({
      orderId: payload.order_id || payload.orderId || `tmp-${Date.now()}`,
      orderDocNumber: payload.order_doc_number || payload.orderDocNumber,
      clientName: payload.client_name || payload.clientName || 'Клиент B2B',
      clientPhone: payload.client_phone || payload.clientPhone,
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
