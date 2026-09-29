import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authenticateRequest } from '../lib/authGuard';
import { recordAuditLog } from '../audit/logs';

export async function handleReconciliationReport(
  req: VercelRequest,
  res: VercelResponse,
  targetErpUrl: string,
  serverErpKey: string
) {
  const authCtx = await authenticateRequest(req, { allowServerKey: true });
  if (!authCtx.isAuthenticated) {
    return res.status(401).json({ success: false, error: authCtx.error || 'Требуется авторизация' });
  }

  let partnerId = String(req.query.partner_id || req.query.counterpartyId || '');
  if (authCtx.role === 'client') {
    partnerId = String(authCtx.partnerId || '');
    req.query.partner_id = partnerId;
  }

  const startDate = (req.query.start_date as string) || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
  const endDate = (req.query.end_date as string) || new Date().toISOString().split('T')[0];

  try {
    const erpUrl = `${targetErpUrl}?action=get_reconciliation_report&partner_id=${encodeURIComponent(partnerId)}&start_date=${startDate}&end_date=${endDate}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const erpRes = await fetch(erpUrl, { headers: { 'X-Portal-Key': serverErpKey }, signal: controller.signal }).finally(() => clearTimeout(timeout));
    
    if (erpRes.ok) {
      const report = await erpRes.json();
      await recordAuditLog({
        eventType: 'reconciliation_report',
        direction: 'inbound',
        status: 'success',
        source: '1C ERP Reconciliation',
        payload: { partner_id: partnerId, startDate, endDate },
      });
      return res.status(200).json(report);
    } else {
      throw new Error(`ERP status ${erpRes.status}`);
    }
  } catch (erpNetErr: any) {
    console.warn('[API Proxy ERP] Direct reconciliation ERP fetch failed:', erpNetErr?.message);
    return res.status(503).json({
      success: false,
      error: 'Сервер 1С:ERP временно недоступен для формирования официального акта сверки взаиморасчетов. Пожалуйста, повторите попытку позже.',
      details: erpNetErr?.message,
    });
  }
}
