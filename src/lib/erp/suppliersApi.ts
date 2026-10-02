import { erpFetch, getAuthHeaders } from './core';
import type {
  SupplierNetworkStockResponse,
  SupplierReleasesReport,
  SupplierInboundShipmentsResponse,
  SupplierDefectsResponse,
  SupplierInfo,
  DiscrepancyActResponse,
} from './types';

/**
 * Запрос данных личного кабинета фабрики / поставщика (Merinos и др.)
 * subAction = 'stock' (география распределения остатков)
 * subAction = 'releases' (отчет о проданных и выпущенных в оплату объемах ковров за период)
 */
export async function fetchSupplierNetworkStock(
  supplierId: number | string,
  subAction: 'stock' | 'releases' = 'stock',
  params: { startDate?: string; endDate?: string } = {}
): Promise<SupplierNetworkStockResponse & SupplierReleasesReport> {
  const response = await erpFetch('supplier_network_stock', {
    method: 'GET',
    params: {
      supplier_id: String(supplierId),
      sub_action: subAction,
      start_date: params.startDate,
      end_date: params.endDate,
    },
  });

  if (!response.ok) {
    throw new Error(`Ошибка загрузки данных поставщика (${response.status})`);
  }

  return await response.json();
}

/**
 * Запрос реестра входящих поставок от фабрики и актов расхождений (ТТН vs Факт)
 * action = 'supplier_inbound_shipments'
 */
export async function fetchSupplierInboundShipments(
  supplierId?: number | string | null,
  options?: {
    status?: string;
    page?: number;
    limit?: number;
  } | string
): Promise<SupplierInboundShipmentsResponse> {
  let status = 'all';
  let page: number | undefined;
  let limit: number | undefined;

  if (typeof options === 'string') {
    status = options;
  } else if (options) {
    status = options.status || 'all';
    page = options.page;
    limit = options.limit;
  }

  const params: Record<string, string | number> = {
    _t: Date.now(),
  };

  if (supplierId !== undefined && supplierId !== null && supplierId !== 'all' && supplierId !== 0 && supplierId !== '0') {
    params.supplier_id = String(supplierId);
  }

  if (status) {
    params.status = status;
  }

  if (page) params.page = page;
  if (limit) params.limit = limit;

  const response = await erpFetch('supplier_inbound_shipments', {
    method: 'GET',
    params,
  });

  if (!response.ok) {
    throw new Error(`Ошибка загрузки реестра поставок (${response.status})`);
  }

  return await response.json();
}

/**
 * Запрос реестра бракованной продукции и рекламаций по фабрике
 * action = 'supplier_defects'
 */
export async function fetchSupplierDefects(
  supplierId: number | string,
  params: { status?: string; defectType?: string } = {}
): Promise<SupplierDefectsResponse> {
  const response = await erpFetch('supplier_defects', {
    method: 'GET',
    params: {
      supplier_id: String(supplierId),
      status: params.status,
      defect_type: params.defectType,
      _t: Date.now(),
    },
  });

  if (!response.ok) {
    throw new Error(`Ошибка загрузки рекламаций (${response.status})`);
  }

  return await response.json();
}

/**
 * Получение динамического списка фабрик и производителей из ERP (action=suppliers).
 */
export async function fetchSuppliersFromErp(): Promise<SupplierInfo[]> {
  try {
    const response = await erpFetch('suppliers', { method: 'GET' });
    if (!response.ok) {
      throw new Error(`Ошибка загрузки фабрик (${response.status})`);
    }

    const data = await response.json();
    if (data?.success && Array.isArray(data.suppliers)) {
      return data.suppliers;
    }
  } catch (err) {
    console.warn('[fetchSuppliersFromErp] Fallback on error:', err);
  }
  return [];
}

/**
 * Запрос электронного акта расхождений при приёмке (ТТН vs Факт ТСД)
 * action = 'supplier_discrepancy_act'
 */
export async function fetchSupplierDiscrepancyAct(
  receiptId: number | string,
  options?: { onlyDiscrepancies?: boolean }
): Promise<DiscrepancyActResponse> {
  const params: Record<string, string | number> = {
    receipt_id: String(receiptId),
    _t: Date.now(),
  };

  if (options?.onlyDiscrepancies) {
    params.only_discrepancies = 1;
  }

  const response = await erpFetch('supplier_discrepancy_act', {
    method: 'GET',
    params,
  });

  if (!response.ok) {
    throw new Error(`Ошибка загрузки акта расхождений (${response.status})`);
  }

  return await response.json();
}

/**
 * Надежное прямое скачивание официального файла акта расхождений (.xlsx) из ERP
 * Без открытия пустых вкладок (about:blank) и без блокировок Chrome cross-origin.
 */
export async function downloadDiscrepancyAct(
  receiptId: number | string,
  actNumber?: string | null,
  fallbackActData?: DiscrepancyActResponse | null
): Promise<void> {
  const downloadUrl = `/api/erp?action=download_discrepancy_act&receipt_id=${encodeURIComponent(receiptId)}`;

  try {
    const headers = await getAuthHeaders();
    const response = await fetch(downloadUrl, {
      method: 'GET',
      headers,
    });

    if (!response.ok) {
      throw new Error(`Ошибка выгрузки файла (${response.status})`);
    }

    const blob = await response.blob();
    if (blob.size < 64) {
      throw new Error('Получен пустой файл акта расхождений');
    }

    let filename = `Akt_rasxozhdeniya_${actNumber ? actNumber.replace(/[^a-zA-Z0-9А-Яа-я_\-]/g, '_') : receiptId}.xlsx`;
    const rawDisp = response.headers.get('content-disposition');
    if (rawDisp && rawDisp.includes('filename=')) {
      const match = rawDisp.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
      if (match && match[1]) {
        try {
          const decoded = decodeURIComponent(match[1].trim());
          if (decoded && !decoded.includes('???') && !decoded.includes('_______')) {
            filename = decoded;
          }
        } catch {}
      }
    }

    triggerFileDownload(blob, filename);
  } catch (err: any) {
    console.warn('[downloadDiscrepancyAct] Direct download failed, trying client export fallback:', err);
    if (fallbackActData) {
      exportDiscrepancyActToCsv(fallbackActData);
      return;
    }
    throw err;
  }
}

/**
 * Инициировать нативное сохранение Blob в браузере без открытия вкладок about:blank
 */
export function triggerFileDownload(blob: Blob, filename: string): void {
  const blobUrl = URL.createObjectURL(blob);
  const tempLink = document.createElement('a');
  tempLink.style.display = 'none';
  tempLink.href = blobUrl;
  tempLink.setAttribute('download', filename);
  document.body.appendChild(tempLink);
  tempLink.click();
  document.body.removeChild(tempLink);
  setTimeout(() => URL.revokeObjectURL(blobUrl), 2000);
}

/**
 * Резервный экспорт акта расхождений в Excel-совместимый CSV с кодировкой UTF-8 BOM
 */
export function exportDiscrepancyActToCsv(act: DiscrepancyActResponse): void {
  const rows: string[] = [];
  rows.push(`"Акт о расхождениях при приёмке";"${act.act_number || ''}";"Дата: ${act.act_date_formatted || ''}"`);
  rows.push(`"Склад:";"${act.warehouse?.name || 'Основной Склад'}";"Город:";"${act.warehouse?.city || 'Астана'}"`);
  rows.push(`"Поставщик:";"${act.supplier?.name || 'Фабрика'}";"Документ поступления:";"${act.documents?.receipt_doc_number || ''}"`);
  rows.push('');
  rows.push('"№";"Артикул";"Наименование";"Штрихкод";"По ТТН (шт)";"Факт ТСД (шт)";"Дельта (шт)";"Статус";"Причина"');

  const items = act.items || [];
  items.forEach((it, idx) => {
    const diff = it.diff_qty;
    const diffStr = diff > 0 ? `+${diff}` : String(diff);
    const statusStr = it.status === 'matched' ? 'Совпадает' : it.status === 'shortage' ? 'Недостача' : it.status === 'surplus' ? 'Излишек' : it.status === 'missing' ? 'Не поступило' : it.status;
    const declaredQty = (it as any).declared_qty ?? it.plan_qty ?? 0;
    const actualQty = (it as any).actual_qty ?? it.fact_qty ?? 0;
    rows.push(`"${idx + 1}";"${it.article || ''}";"${(it.name || '').replace(/"/g, '""')}";"${it.barcode || ''}";"${declaredQty}";"${actualQty}";"${diffStr}";"${statusStr}";"${(it.reason || '').replace(/"/g, '""')}"`);
  });

  rows.push('');
  const totalDeclared = act.summary?.plan_qty ?? (act.summary as any)?.total_declared_pcs ?? 0;
  const totalActual = act.summary?.fact_qty ?? (act.summary as any)?.total_actual_pcs ?? 0;
  const totalDiff = act.summary?.diff_qty ?? (act.summary as any)?.total_diff_pcs ?? 0;
  const totalDiscrepant = (act.summary as any)?.total_discrepant_positions ?? ((act.summary?.shortage_count ?? 0) + (act.summary?.surplus_count ?? 0));
  rows.push(`"Итого заявлено (ТТН):";"${totalDeclared} шт";"Итого принято (Факт):";"${totalActual} шт";"Расхождение:";"${totalDiff} шт"`);
  rows.push(`"Всего позиций:";"${act.summary?.total_positions ?? items.length}";"Позиций с расхождениями:";"${totalDiscrepant}"`);
  if (act.auditor?.name) {
    rows.push(`"Комиссия / Приемщик:";"${act.auditor.name} (${act.auditor.role || 'WMS'})"`);
  }

  const csvContent = '\uFEFF' + rows.join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const filename = `Akt_rasxozhdeniya_${(act.act_number || 'export').replace(/[^a-zA-Z0-9А-Яа-я_\-]/g, '_')}.csv`;
  triggerFileDownload(blob, filename);
}

/**
 * Экспорт реестра реализации фабрики в Excel-совместимый CSV с UTF-8 BOM
 */
export function exportSupplierReleasesToCsv(
  releases: any[],
  meta: { supplierName?: string; startDate?: string; endDate?: string; totalAmountUsd?: number; totalPcs?: number; totalSqm?: number }
): void {
  const rows: string[] = [];
  rows.push(`"Акт реализации продукции (выпуск с консигнации)";"Фабрика: ${meta.supplierName || 'Поставщик'}"`);
  rows.push(`"Период:";"${meta.startDate || ''} — ${meta.endDate || ''}"`);
  rows.push(`"К выплате фабрике:";"$${(meta.totalAmountUsd ?? 0).toFixed(2)}";"Реализовано ковров:";"${meta.totalPcs ?? 0} шт";"Общая площадь:";"${(meta.totalSqm ?? 0).toFixed(1)} м²"`);
  rows.push('');
  rows.push('"№";"Номер документа";"Дата";"Покупатель / Партнер";"Город";"Количество (шт)";"Площадь (м²)";"Сумма ($)"');

  (releases || []).forEach((rel, idx) => {
    rows.push(`"${idx + 1}";"${rel.doc_number || ''}";"${rel.date || ''}";"Оптовый партнер";"${rel.city || 'Казахстан'}";"${rel.released_qty || 0}";"${(rel.released_sqm || 0).toFixed(1)}";"${(rel.total_usd || 0).toFixed(2)}"`);
  });

  const csvContent = '\uFEFF' + rows.join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const filename = `Akt_realizatsii_${(meta.supplierName || 'supplier').replace(/[^a-zA-Z0-9А-Яа-я_\-]/g, '_')}_${meta.startDate}_${meta.endDate}.csv`;
  triggerFileDownload(blob, filename);
}
