import { erpFetch } from './core';
import type { ReconciliationReport } from './types';

/**
 * Получение официального акта сверки взаиморасчетов из 1С:ERP
 */
export async function fetchReconciliationReportFromErp(params: {
  partnerId: string | number;
  startDate?: string;
  endDate?: string;
}): Promise<{ success: boolean; report?: ReconciliationReport; error?: string }> {
  const response = await erpFetch('get_reconciliation_report', {
    method: 'GET',
    params: {
      partner_id: params.partnerId,
      start_date: params.startDate,
      end_date: params.endDate,
    },
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    let errMsg = `Ошибка загрузки акта сверки (${response.status})`;
    try {
      const errJson = JSON.parse(errText);
      if (errJson?.error) errMsg = errJson.error;
    } catch {}
    throw new Error(errMsg);
  }

  return await response.json();
}
