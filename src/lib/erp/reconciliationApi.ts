import { erpFetch } from './core';
import { fetchClientDebtFromErp } from './counterpartiesApi';
import { triggerFileDownload } from './suppliersApi';
import type { ReconciliationReport } from './types';

/**
 * Получение и нормализация официального акта сверки взаиморасчетов из Synergy ERP (api_portal.php)
 */
export async function fetchReconciliationReportFromErp(params: {
  partnerId: string | number;
  startDate?: string;
  endDate?: string;
}): Promise<{ success: boolean; report?: ReconciliationReport; [key: string]: any }> {
  const rawPartner = String(params.partnerId || '').trim();
  const numericId = Number(rawPartner.replace(/\D+/g, '')) || undefined;
  const resolvedId = numericId ? String(numericId) : rawPartner;
  const startDate = params.startDate || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
  const endDate = params.endDate || new Date().toISOString().split('T')[0];

  const [response, debtData] = await Promise.all([
    erpFetch('get_reconciliation_report', {
      method: 'GET',
      params: {
        counterparty_id: resolvedId,
        client_id: resolvedId,
        partner_id: resolvedId,
        date_from: startDate,
        date_to: endDate,
        start_date: startDate,
        end_date: endDate,
      },
    }),
    numericId
      ? fetchClientDebtFromErp({ counterpartyId: numericId, includeInvoices: true }).catch(() => null)
      : Promise.resolve(null),
  ]);

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    let errMsg = `Ошибка загрузки акта сверки (${response.status})`;
    try {
      const errJson = JSON.parse(errText);
      if (errJson?.error) errMsg = errJson.error;
    } catch {}
    throw new Error(errMsg);
  }

  const rawReport = await response.json();
  if (!rawReport || rawReport.success === false) {
    return rawReport || { success: false, error: 'Не удалось сформировать акт сверки' };
  }

  const source = rawReport.report || rawReport;
  const rawOps: any[] = Array.isArray(source.operations)
    ? source.operations
    : (Array.isArray(source.transactions) ? source.transactions : []);

  const rawInvoices: any[] = Array.isArray(source.invoices) && source.invoices.length > 0
    ? source.invoices
    : (Array.isArray((debtData as any)?.unpaid_invoices) ? (debtData as any).unpaid_invoices : []);

  const rawPayments: any[] = Array.isArray(source.payments) ? source.payments : [];

  const existingDocs = new Set(rawOps.map((op: any) => String(op.doc_number || op.number || '').trim()).filter(Boolean));

  const invoiceTxs = rawInvoices
    .filter((inv: any) => {
      const docNum = String(inv.document_number || inv.doc_number || '').trim();
      if (docNum && existingDocs.has(docNum)) return false;
      const invDate = String(inv.invoice_date || inv.date || '').slice(0, 10);
      return !invDate || (invDate >= startDate && invDate <= endDate);
    })
    .map((inv: any) => {
      const docNum = String(inv.document_number || inv.doc_number || `INV-${inv.id || ''}`);
      existingDocs.add(docNum);
      return {
        date: String(inv.invoice_date || inv.date || startDate).slice(0, 10),
        doc_type: inv.is_overdue ? 'Реализация (просрочено)' : 'Реализация товаров',
        doc_number: docNum,
        description: inv.contract_name || '',
        debit: Number(inv.amount_usd ?? inv.total_usd ?? inv.debt_usd ?? 0),
        credit: Number(inv.paid_usd ?? 0),
      };
    });

  const paymentTxs = rawPayments
    .filter((pay: any) => {
      const docNum = String(pay.document_number || pay.doc_number || pay.id || '').trim();
      if (docNum && existingDocs.has(docNum)) return false;
      const payDate = String(pay.payment_date || pay.date || '').slice(0, 10);
      return !payDate || (payDate >= startDate && payDate <= endDate);
    })
    .map((pay: any) => ({
      date: String(pay.payment_date || pay.date || startDate).slice(0, 10),
      doc_type: pay.type || 'Оплата от покупателя',
      doc_number: String(pay.document_number || pay.doc_number || `PAY-${pay.id || ''}`),
      description: pay.comment || '',
      debit: 0,
      credit: Number(pay.amount_usd ?? pay.amount ?? pay.credit ?? 0),
    }));

  const mergedTransactions = [
    ...rawOps.map((op: any) => ({
      date: String(op.date || op.operation_date || startDate).slice(0, 10),
      doc_type: op.doc_type || op.type || 'Операция ERP',
      doc_number: op.doc_number || op.number || '—',
      description: op.description || op.comment || '',
      debit: Number(op.debit ?? op.amount_debit ?? 0),
      credit: Number(op.credit ?? op.amount_credit ?? 0),
    })),
    ...invoiceTxs,
    ...paymentTxs,
  ].sort((a, b) => String(b.date).localeCompare(String(a.date)));

  const calcDebit = mergedTransactions.reduce((acc, tx) => acc + Number(tx.debit || 0), 0);
  const calcCredit = mergedTransactions.reduce((acc, tx) => acc + Number(tx.credit || 0), 0);

  const initialBalNum = Number(source.initial_balance ?? source.balance_start ?? 0);
  const totalDebitNum = Number(source.total_debit || 0) > 0 ? Number(source.total_debit) : calcDebit;
  const totalCreditNum = Number(source.total_credit || 0) > 0 ? Number(source.total_credit) : calcCredit;
  const finalBalNum = Number(
    source.final_balance ??
    source.balance_end ??
    source.saldo ??
    (debtData as any)?.financials?.balance_usd ??
    (debtData as any)?.total_debt_usd ??
    0
  );

  const normalizedReport: any = {
    ...source,
    partner_id: resolvedId,
    counterparty: source.counterparty || (debtData as any)?.client || null,
    period: source.period || { date_from: startDate, date_to: endDate },
    initial_balance: initialBalNum.toFixed(2),
    total_debit: totalDebitNum.toFixed(2),
    total_credit: totalCreditNum.toFixed(2),
    final_balance: finalBalNum.toFixed(2),
    transactions: mergedTransactions,
  };

  return {
    ...rawReport,
    ...normalizedReport,
    success: true,
    report: normalizedReport,
  };
}

export function exportReconciliationToCsv(data: any, counterpartyName?: string): void {
  if (!data) return;
  const cpName = counterpartyName || data.counterparty?.name || 'Оптовый партнер';
  const dateFrom = data.period?.date_from || '';
  const dateTo = data.period?.date_to || '';
  const rows: string[] = [];
  rows.push(`"Акт сверки взаимных расчетов";"${cpName.replace(/"/g, '""')}"`);
  rows.push(`"Период:";"${dateFrom} — ${dateTo}"`);
  rows.push(`"Входящее сальдо:";"${data.initial_balance ?? '0.00'}";"Отгрузки (Дебет):";"${data.total_debit ?? '0.00'}";"Оплаты (Кредит):";"${data.total_credit ?? '0.00'}";"Конечное сальдо:";"${data.final_balance ?? '0.00'}"`);
  rows.push('');
  rows.push('"№";"Дата";"Документ";"Номер документа";"Отгрузка (Дебет)";"Оплата (Кредит)"');

  const txs: any[] = Array.isArray(data.transactions) ? data.transactions : [];
  txs.forEach((tx, idx) => {
    const debit = Number(tx.debit || 0) > 0 ? Number(tx.debit).toFixed(2) : '0.00';
    const credit = Number(tx.credit || 0) > 0 ? Number(tx.credit).toFixed(2) : '0.00';
    rows.push(`"${idx + 1}";"${tx.date || ''}";"${String(tx.doc_type || '').replace(/"/g, '""')}";"${String(tx.doc_number || '').replace(/"/g, '""')}";"${debit}";"${credit}"`);
  });

  const csvContent = '\uFEFF' + rows.join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const safeName = cpName.replace(/[^a-zA-Z0-9А-Яа-я_\-]/g, '_').slice(0, 30) || 'partner';
  triggerFileDownload(blob, `Akt_sverki_${safeName}_${dateFrom || 'report'}.csv`);
}
