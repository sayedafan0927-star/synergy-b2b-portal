import { fetchCatalogFromErp } from './catalogApi';
import type {
  SupplierNetworkStockResponse,
  SupplierStockItem,
  SupplierDistribution,
  SupplierReleasesReport,
  SupplierInfo,
} from './types';

export function matchesProductToSupplier(product: any, supplierId: number, supplierName?: string): boolean {
  if (!supplierId || supplierId <= 0) return true;
  if (Number(product.supplier_id) === supplierId) return true;

  const mfr = String(product.manufacturer || '').toLowerCase();
  const col = String(product.collection || '').toLowerCase();
  const name = String(product.name || '').toLowerCase();
  const country = String(product.country || '').toLowerCase();

  if (supplierId === 11 || supplierId === 26) {
    return mfr.includes('saydam') || col.includes('flora') || name.includes('saydam') || name.includes('flora');
  }
  if (supplierId === 1 || supplierId === 7) {
    return (
      mfr.includes('merinos') ||
      col.includes('octavia') ||
      col.includes('oslo') ||
      ((supplierId === 1 ? country.includes('россия') : !country.includes('россия')) && mfr.includes('merinos'))
    );
  }
  if (supplierId === 6) {
    return mfr.includes('ismen') || mfr.includes('linea') || col.includes('hypnose') || col.includes('saloon') || col.includes('bobo');
  }
  if (supplierId === 10) {
    return mfr.includes('karmen') || col.includes('celeste');
  }
  if (supplierId === 8 || supplierId === 9 || supplierId === 31) {
    return mfr.includes('afgan') || mfr.includes('iran') || mfr.includes('gheytaran') || country.includes('иран');
  }
  if (supplierId === 12) {
    return mfr.includes('lysandra') || col.includes('lysandra');
  }
  if (supplierName) {
    const cleanSup = supplierName.replace(/\(.*\)/, '').trim().toLowerCase();
    if (cleanSup && (mfr.includes(cleanSup) || col.includes(cleanSup) || name.includes(cleanSup))) {
      return true;
    }
  }
  return false;
}

export function normalizeReleasesPayload(
  data: any,
  supplierId: number | string,
  params: { startDate?: string; endDate?: string }
): SupplierNetworkStockResponse & SupplierReleasesReport {
  const rawReleases: any[] = Array.isArray(data?.releases) ? data.releases : [];
  let sumPcs = 0;
  let sumSqm = 0;
  let sumUsd = 0;

  const normalizedReleases = rawReleases.map((rel: any, idx: number) => {
    const releasedQty = Number(rel.released_qty ?? rel.qty_released ?? 0);
    const releasedSqm = Number(rel.released_sqm ?? rel.sqm_released ?? 0);
    const totalUsd = Number(rel.total_usd ?? rel.amount_usd ?? 0);
    sumPcs += releasedQty;
    sumSqm += releasedSqm;
    sumUsd += totalUsd;

    return {
      ...rel,
      doc_number: rel.doc_number || rel.sale_doc_number || rel.release_id || `ACT-${idx + 1}`,
      date: rel.date || rel.release_date || (rel.released_at ? String(rel.released_at).slice(0, 10) : ''),
      city: rel.city || rel.client_city || 'Казахстан',
      client_name: rel.client_name || 'Оптовый партнер',
      released_qty: releasedQty,
      released_sqm: releasedSqm,
      total_usd: totalUsd,
    };
  });

  return {
    ...data,
    success: true,
    supplier_id: Number(supplierId) || 0,
    period: data?.period || {
      start_date: params.startDate || '2026-01-01',
      end_date: params.endDate || '2026-12-31',
    },
    total_released_pcs: Number(data?.total_released_pcs ?? sumPcs),
    total_released_sqm: Number(data?.total_released_sqm ?? Math.round(sumSqm * 100) / 100),
    total_amount_usd: Number(data?.total_amount_usd ?? Math.round(sumUsd * 100) / 100),
    releases: normalizedReleases,
  };
}

export function normalizeStockPayload(
  data: any,
  supplierId: number | string
): SupplierNetworkStockResponse & SupplierReleasesReport {
  const items: any[] = Array.isArray(data?.items) ? data.items : [];
  items.forEach((item: any) => {
    if (Array.isArray(item.distribution)) {
      item.distribution.forEach((dist: any) => {
        if (
          Number(dist.warehouse_id) === 81 ||
          (dist.warehouse_name && String(dist.warehouse_name).includes('Астана')) ||
          dist.type === 'central_hub'
        ) {
          dist.city = 'Астана';
          if (!dist.warehouse_name || String(dist.warehouse_name).includes('Алматы')) {
            dist.warehouse_name = 'Основной Склад Астана';
          }
        }
      });
    }
  });
  return {
    ...data,
    success: true,
    supplier_id: Number(supplierId) || 0,
    items,
  };
}

export async function buildSupplierStockFromCatalog(
  supplierId: number,
  suppliersList: SupplierInfo[]
): Promise<SupplierNetworkStockResponse & SupplierReleasesReport> {
  const catalogData = await fetchCatalogFromErp();
  const supplierObj = suppliersList.find(s => Number(s.id) === supplierId);
  const supplierName = supplierId === 0 ? 'Основной Склад Астана (все)' : (supplierObj?.name || `Фабрика #${supplierId}`);
  const products: any[] = Array.isArray(catalogData?.products) ? catalogData.products : [];

  const matchedProducts = products.filter(p => matchesProductToSupplier(p, supplierId, supplierObj?.name));
  const items: SupplierStockItem[] = [];

  for (const p of matchedProducts) {
    const variants: any[] = Array.isArray(p.variants) ? p.variants : [];
    for (const v of variants) {
      const warehouses: any[] = Array.isArray(v.warehouses) ? v.warehouses : [];
      const areaPerUnit = Number(v.area_sqm) || (Number(v.width || 0) * Number(v.length || 0)) || 1;
      const distribution: SupplierDistribution[] = [];
      let varTotalQty = 0;
      let varTotalSqm = 0;

      for (const w of warehouses) {
        const qty = Number(w.stock ?? w.total_stock ?? w.free_stock ?? 0);
        if (qty <= 0) continue;
        const sqm = Math.round(qty * areaPerUnit * 100) / 100;
        const isHub = Boolean(
          w.is_hub ||
          Number(w.warehouse_id) === 81 ||
          String(w.warehouse_name || '').toLowerCase().includes('основной') ||
          String(w.warehouse_name || '').toLowerCase().includes('астана')
        );

        varTotalQty += qty;
        varTotalSqm += sqm;

        distribution.push({
          warehouse_id: Number(w.warehouse_id || 81),
          warehouse_name: isHub ? 'Основной Склад Астана' : (w.warehouse_name || 'Партнерский магазин'),
          partner_name: isHub ? undefined : (w.warehouse_name || 'Партнерский шоурум'),
          city: isHub ? 'Астана' : (w.city || 'Астана'),
          type: isHub ? 'central_hub' : 'consignment',
          qty_pcs: qty,
          area_sqm: sqm,
        });
      }

      if (varTotalQty > 0) {
        items.push({
          carpet_id: Number(v.item_id || v.id || p.id),
          article: String(v.article || p.article || p.name || ''),
          collection: String(p.collection || p.manufacturer || ''),
          name: String(p.name || ''),
          size: String(v.size || (v.width && v.length ? `${v.width} × ${v.length}` : 'Стандарт')),
          width: Number(v.width || 0) || undefined,
          length: Number(v.length || 0) || undefined,
          area_sqm: areaPerUnit,
          total_network_qty: varTotalQty,
          total_network_sqm: Math.round(varTotalSqm * 100) / 100,
          distribution,
        });
      }
    }
  }

  return {
    success: true,
    supplier_id: supplierId,
    supplier_name: supplierName,
    items,
    period: { start_date: '2026-01-01', end_date: '2026-12-31' },
    total_released_pcs: 0,
    total_released_sqm: 0,
    total_amount_usd: 0,
    releases: [],
  };
}
