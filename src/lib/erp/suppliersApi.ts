import { erpFetch } from './core';
import type {
  SupplierNetworkStockResponse,
  SupplierReleasesReport,
  SupplierInboundShipmentsResponse,
  SupplierDefectsResponse,
  SupplierInfo,
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
