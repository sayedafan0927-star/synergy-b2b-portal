import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { authenticateRequest } from '../lib/authGuard';
import { recordAuditLog } from '../audit/logs';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
const supabaseServer = (SUPABASE_URL && SUPABASE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })
  : null as any;

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

  let partnerId = String(req.query.partner_id || req.query.counterpartyId || req.body?.partner_id || req.body?.counterpartyId || '');
  if (authCtx.role === 'client') {
    if (authCtx.b2bRole === 'buyer') {
      return res.status(403).json({
        success: false,
        code: 'FORBIDDEN_FINANCIAL_ACCESS',
        error: 'Доступ к актам сверки взаиморасчетов ограничен для роли закупщика. Обратитесь к бухгалтеру или руководителю компании.',
      });
    }
    // Клиент может запрашивать акт сверки ТОЛЬКО по своему подтвержденному partner_id (Anti-IDOR)
    partnerId = String(authCtx.partnerId || '');
    if (!partnerId) {
      return res.status(403).json({ success: false, error: 'Доступ запрещен: партнерский ID клиента не привязан к профилю.' });
    }
    req.query.partner_id = partnerId;
  } else if (!authCtx.isServer && authCtx.role !== 'admin') {
    // Для менеджеров: обязательное наличие partner_id и проверка прикрепления контрагента
    if (!partnerId) {
      return res.status(400).json({ success: false, error: 'Параметр partner_id обязателен для формирования акта сверки.' });
    }
    if ((authCtx.role === 'manager_rm' || authCtx.role === 'manager_lm') && supabaseServer && authCtx.userId) {
      const allowedMgrIds = [String(authCtx.userId), authCtx.managerId ? String(authCtx.managerId) : ''].filter(Boolean);
      const { data: managedProfile } = await supabaseServer
        .from('profiles')
        .select('id, manager_id')
        .eq('partner_id', partnerId)
        .in('manager_id', allowedMgrIds)
        .maybeSingle();

      if (!managedProfile) {
        return res.status(403).json({
          success: false,
          error: 'Доступ запрещен: данный контрагент не относится к вашей региональной зоне ответственности.',
          code: 'FORBIDDEN_COUNTERPARTY_SCOPE',
        });
      }
    }
  }

  const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
  const rawStartDate = String(req.query.start_date || req.body?.start_date || '').trim();
  const rawEndDate = String(req.query.end_date || req.body?.end_date || '').trim();

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
    const qp = new URLSearchParams({
      action: 'get_reconciliation_report',
      counterparty_id: partnerId,
      client_id: partnerId,
      partner_id: partnerId,
      date_from: startDate,
      date_to: endDate,
      start_date: startDate,
      end_date: endDate,
    });
    const erpUrl = `${targetErpUrl}?${qp.toString()}`;
    const debtUrl = `${targetErpUrl}?action=client_debt&counterparty_id=${encodeURIComponent(partnerId)}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const [erpRes, debtRes] = await Promise.all([
      fetch(erpUrl, { headers: { 'X-Portal-Key': serverErpKey }, signal: controller.signal }),
      fetch(debtUrl, { headers: { 'X-Portal-Key': serverErpKey }, signal: controller.signal }).catch(() => null),
    ]).finally(() => clearTimeout(timeout));

    if (erpRes.ok) {
      const rawReport = await erpRes.json();
      const debtData = debtRes && debtRes.ok ? await debtRes.json().catch(() => null) : null;

      const rawOps: any[] = Array.isArray(rawReport.operations)
        ? rawReport.operations
        : (Array.isArray(rawReport.transactions) ? rawReport.transactions : []);

      const unpaidInvoices: any[] = Array.isArray(debtData?.unpaid_invoices)
        ? debtData.unpaid_invoices
        : (Array.isArray(rawReport.invoices) ? rawReport.invoices : []);

      const existingDocNumbers = new Set(rawOps.map((op: any) => String(op.doc_number || '').trim()).filter(Boolean));
      const invoiceTransactions = unpaidInvoices
        .filter((inv: any) => {
          const invDate = String(inv.invoice_date || inv.date || '').trim();
          const docNum = String(inv.document_number || inv.doc_number || '').trim();
          if (docNum && existingDocNumbers.has(docNum)) return false;
          if (!invDate) return true;
          return invDate >= startDate && invDate <= endDate;
        })
        .map((inv: any) => ({
          date: inv.invoice_date || inv.date || startDate,
          doc_type: inv.is_overdue ? 'Реализация (просрочено)' : 'Реализация товаров',
          doc_number: inv.document_number || inv.doc_number || `INV-${inv.id || ''}`,
          description: inv.contract_name || '',
          debit: Number(inv.amount_usd ?? inv.debt_usd ?? 0),
          credit: Number(inv.paid_usd ?? 0),
          debt_usd: Number(inv.debt_usd ?? 0),
          due_date: inv.due_date || null,
          is_overdue: Boolean(inv.is_overdue),
          overdue_days: Number(inv.overdue_days || 0),
        }));

      const mergedTransactions = [
        ...rawOps.map((op: any) => ({
          date: op.date || startDate,
          doc_type: op.doc_type || op.type || 'Операция',
          doc_number: op.doc_number || op.number || '—',
          description: op.description || '',
          debit: Number(op.debit || 0),
          credit: Number(op.credit || 0),
          running_balance: op.running_balance !== undefined ? Number(op.running_balance) : undefined,
        })),
        ...invoiceTransactions,
      ].sort((a, b) => String(b.date).localeCompare(String(a.date)));

      const calcDebit = mergedTransactions.reduce((acc, tx) => acc + Number(tx.debit || 0), 0);
      const calcCredit = mergedTransactions.reduce((acc, tx) => acc + Number(tx.credit || 0), 0);

      const initialBalNum = Number(rawReport.initial_balance ?? rawReport.balance_start ?? 0);
      const totalDebitNum = Number(rawReport.total_debit || 0) > 0 ? Number(rawReport.total_debit) : calcDebit;
      const totalCreditNum = Number(rawReport.total_credit || 0) > 0 ? Number(rawReport.total_credit) : calcCredit;
      const finalBalNum = Number(
        rawReport.final_balance ??
        rawReport.balance_end ??
        rawReport.saldo ??
        debtData?.financials?.balance_usd ??
        0
      );
      const debtUsdNum = Number(
        rawReport.debt ??
        debtData?.financials?.total_debt_usd ??
        (finalBalNum < 0 ? Math.abs(finalBalNum) : 0)
      );

      const normalizedReportPayload = {
        partner_id: partnerId,
        counterparty: rawReport.counterparty || debtData?.client || null,
        period: rawReport.period || { date_from: startDate, date_to: endDate },
        initial_balance: initialBalNum.toFixed(2),
        total_debit: totalDebitNum.toFixed(2),
        total_credit: totalCreditNum.toFixed(2),
        final_balance: finalBalNum.toFixed(2),
        debt_usd: debtUsdNum.toFixed(2),
        prepayment_usd: Number(rawReport.prepayment || (finalBalNum > 0 ? finalBalNum : 0)).toFixed(2),
        transactions: mergedTransactions,
        unpaid_invoices: unpaidInvoices,
      };

      const responseBody = {
        ...rawReport,
        success: true,
        ...normalizedReportPayload,
        report: normalizedReportPayload,
      };

      await recordAuditLog({
        eventType: 'reconciliation_report',
        direction: 'inbound',
        status: 'success',
        source: 'Synergy ERP Reconciliation',
        payload: { partner_id: partnerId, startDate, endDate, txCount: mergedTransactions.length },
      });
      return res.status(200).json(responseBody);
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
