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
    // Клиент может запрашивать акт сверки ТОЛЬКО по своему подтвержденному partner_id (Anti-IDOR)
    partnerId = String(authCtx.partnerId || '');
    if (!partnerId) {
      return res.status(403).json({ success: false, error: 'Доступ запрещен: партнерский ID клиента не привязан к профилю.' });
    }
    req.query.partner_id = partnerId;
  } else if (!authCtx.isServer && authCtx.role !== 'admin') {
    // Для менеджеров: обязательное наличие partner_id
    if (!partnerId) {
      return res.status(400).json({ success: false, error: 'Параметр partner_id обязателен для формирования акта сверки.' });
    }
  }

  const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
  const rawStartDate = String(req.query.start_date || '').trim();
  const rawEndDate = String(req.query.end_date || '').trim();

  const defaultEnd = new Date().toISOString().split('T')[0];
  const defaultStart = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];

  const startDate = (rawStartDate && ISO_DATE_REGEX.test(rawStartDate)) ? rawStartDate : defaultStart;
  const endDate = (rawEndDate && ISO_DATE_REGEX.test(rawEndDate)) ? rawEndDate : defaultEnd;

  const startMs = new Date(startDate).getTime();
  const endMs = new Date(endDate).getTime();

  if (isNaN(startMs) || isNaN(endMs)) {
    return res.status(400).json({
      success: false,
      error: 'Некорректный формат дат. Ожидается формат YYYY-MM-DD.',
    });
  }

  if (startMs > endMs) {
    return res.status(400).json({
      success: false,
      error: 'Дата начала периода не может быть позже даты окончания.',
    });
  }

  const daysDiff = (endMs - startMs) / (1000 * 86400);
  if (daysDiff > 365) {
    return res.status(400).json({
      success: false,
      error: 'Диапазон дат для формирования акта сверки не может превышать 365 дней во избежание перегрузки ERP.',
    });
  }

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
        source: 'Synergy ERP Reconciliation',
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
      error: 'Сервер Synergy ERP временно недоступен для формирования официального акта сверки взаиморасчетов. Пожалуйста, повторите попытку позже.',
      details: erpNetErr?.message,
    });
  }
}
