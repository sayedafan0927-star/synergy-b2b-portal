import { erpFetch, deduplicateRequest } from '@/lib/erp/core';
import { triggerFileDownload } from '@/lib/erp/suppliersApi';
import {
  calculateContractPrice,
  formatPriceType,
  normalizeToErpPriceType,
  resolveContractPriceType,
} from '@/lib/pricingEngine';
import type { Product } from '@/types';
import { parseSizeDimensions } from '@/types';

const PRICE_LIST_CACHE_TTL_MS = 5 * 60 * 1000;
const priceTypeProductsCache = new Map<string, { timestamp: number; products: any[] }>();
const priceListRowsCache = new Map<string, { timestamp: number; rows: CollectionPriceRow[] }>();

async function fetchLightweightCatalogByPriceType(priceType: string): Promise<any[]> {
  const normalizedPt = normalizeToErpPriceType(priceType);
  const cached = priceTypeProductsCache.get(normalizedPt);
  if (cached && Date.now() - cached.timestamp < PRICE_LIST_CACHE_TTL_MS && cached.products.length > 0) {
    return cached.products;
  }

  return deduplicateRequest(`pricelist_catalog_${normalizedPt}`, async () => {
    const res = await erpFetch('catalog', {
      method: 'GET',
      params: { price_type: normalizedPt },
    });
    if (!res || !res.ok) return cached?.products || [];
    const data = await res.json();
    const list = Array.isArray(data?.products)
      ? data.products
      : Array.isArray(data?.designs)
      ? data.designs
      : [];
    if (list.length > 0) {
      priceTypeProductsCache.set(normalizedPt, { timestamp: Date.now(), products: list });
    }
    return list;
  });
}

export function getCachedPriceListRows(priceType: string, isStaff: boolean): CollectionPriceRow[] | null {
  const cacheKey = isStaff && priceType === 'all' ? 'staff_all' : normalizeToErpPriceType(priceType);
  const cached = priceListRowsCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < PRICE_LIST_CACHE_TTL_MS && cached.rows.length > 0) {
    return cached.rows;
  }
  return null;
}

export interface ErpSellingPriceTypeOption {
  code: string;
  label: string;
  shortLabel: string;
  description: string;
}

/**
 * Продажные виды цен, отдаваемые из ERP
 */
export const ERP_SELLING_PRICE_TYPES: ErpSellingPriceTypeOption[] = [
  {
    code: 'price_deferred',
    label: 'Цена с отсрочкой (Отсрочка)',
    shortLabel: 'С отсрочкой',
    description: 'Отгрузка по договору с отсрочкой платежа',
  },
  {
    code: 'price_commission',
    label: 'Цена Комиссия (Под реализацию)',
    shortLabel: 'Комиссионная',
    description: 'Договор комиссии / передача товара под реализацию',
  },
  {
    code: 'price_cash',
    label: 'Цена По факту (Предоплата / Опт)',
    shortLabel: 'По факту / Опт',
    description: 'Оплата по факту отгрузки / 100% предоплата',
  },
];

export interface CollectionPriceRow {
  collection: string;
  manufacturer: string;
  country: string;
  material: string;
  density: string;
  pileHeight: string;
  designsCount: number;
  pricePerSqm: number;
  pricesByType: Record<string, number>;
}

/**
 * Форматирование цены за 1 м² строго в у.е. (без знака доллара $ и без USD)
 */
export function formatSqmPriceUe(amount: number): string {
  const num = Number(amount) || 0;
  if (num <= 0) return 'По запросу';
  return `${num.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} у.е.`;
}

function extractProductPricePerSqm(p: any): number {
  const directSqm = Number(p.price_per_sqm || 0);
  if (directSqm > 0) return directSqm;

  const variants = Array.isArray(p.variants) ? p.variants : (Array.isArray(p.sizes) ? p.sizes : []);
  for (const v of variants) {
    const vSqm = Number(v.price_per_sqm || 0);
    if (vSqm > 0) return vSqm;
  }
  for (const v of variants) {
    const base = Number(v.price || v.base_price || v.piece_price || 0);
    const area = Number(v.area_sqm || 0) || (() => {
      const { w, h } = parseSizeDimensions(String(v.size || ''));
      return w * h;
    })();
    if (base > 0 && area > 0) {
      return Math.round((base / area) * 100) / 100;
    }
  }
  return 0;
}

/**
 * Сбор сводной таблицы коллекций из списка товаров каталога
 */
export function buildCollectionPriceRows(
  products: any[],
  rawPriceType?: string | null,
  multiTypeProductsMap?: Record<string, any[]>
): CollectionPriceRow[] {
  const map = new Map<string, CollectionPriceRow>();

  const processList = (list: any[], typeCode: string, isPrimary: boolean) => {
    for (const p of list || []) {
      const coll = String(p.collection || '').trim().toUpperCase();
      if (!coll) continue;

      const rawSqm = extractProductPricePerSqm(p);
      const calcSqm = rawSqm > 0 ? calculateContractPrice(rawSqm, typeCode).finalPrice : 0;

      let existing = map.get(coll);
      if (!existing) {
        existing = {
          collection: coll,
          manufacturer: String(p.manufacturer || '').trim() || '—',
          country: String(p.country || '').trim() || 'Турция',
          material: String(p.material || '').trim() || '—',
          density: String(p.density || '').trim() || '—',
          pileHeight: String(p.pile_height || '').trim() || '—',
          designsCount: 0,
          pricePerSqm: calcSqm,
          pricesByType: {},
        };
        map.set(coll, existing);
      }

      if (isPrimary) {
        existing.designsCount += 1;
        if (calcSqm > 0 && (existing.pricePerSqm <= 0 || calcSqm < existing.pricePerSqm)) {
          existing.pricePerSqm = calcSqm;
        }
      }

      if (calcSqm > 0) {
        const prevTypePrice = existing.pricesByType[typeCode] || 0;
        if (prevTypePrice <= 0 || calcSqm < prevTypePrice) {
          existing.pricesByType[typeCode] = calcSqm;
        }
      }

      if (existing.manufacturer === '—' && p.manufacturer) existing.manufacturer = String(p.manufacturer).trim();
      if (existing.material === '—' && p.material) existing.material = String(p.material).trim();
      if (existing.density === '—' && p.density) existing.density = String(p.density).trim();
      if (existing.pileHeight === '—' && p.pile_height) existing.pileHeight = String(p.pile_height).trim();
    }
  };

  const primaryType = normalizeToErpPriceType(rawPriceType);
  processList(products, primaryType, true);

  if (multiTypeProductsMap) {
    for (const [ptCode, ptProducts] of Object.entries(multiTypeProductsMap)) {
      processList(ptProducts, ptCode, false);
    }
  }

  return Array.from(map.values())
    .filter(r => r.pricePerSqm > 0 || Object.values(r.pricesByType).some(v => v > 0))
    .sort((a, b) => a.collection.localeCompare(b.collection, 'ru'));
}

/**
 * Загрузка прайс-листа коллекций напрямую из ERP по виду цены (или всем продажным видам цен для ЛМ/РМ)
 */
export async function fetchErpPriceListRows(options: {
  priceType: string; // 'all' (только для ЛМ/РМ/Админ) или код вида цены ('price_deferred', 'price_commission', 'price_cash')
  isStaff: boolean;
  fallbackProducts?: Product[];
  onPartialRows?: (rows: CollectionPriceRow[]) => void;
}): Promise<CollectionPriceRow[]> {
  const { priceType, isStaff, fallbackProducts = [], onPartialRows } = options;

  const cachedRows = getCachedPriceListRows(priceType, isStaff);
  if (cachedRows) {
    return cachedRows;
  }

  if (isStaff && priceType === 'all') {
    const defPromise = fetchLightweightCatalogByPriceType('price_deferred').catch(() => []);
    const commPromise = fetchLightweightCatalogByPriceType('price_commission').catch(() => []);
    const cashPromise = fetchLightweightCatalogByPriceType('price_cash').catch(() => []);

    if (onPartialRows) {
      defPromise.then(defList => {
        if (defList.length > 0 && !getCachedPriceListRows('all', true)) {
          const partial = buildCollectionPriceRows(defList, 'price_deferred', {
            price_deferred: defList,
            price_commission: defList,
            price_cash: defList,
          });
          if (partial.length > 0) onPartialRows(partial);
        }
      });
    }

    const [defProdsRaw, commProdsRaw, cashProdsRaw] = await Promise.all([
      defPromise,
      commPromise,
      cashPromise,
    ]);

    const defProds = defProdsRaw.length > 0 ? defProdsRaw : fallbackProducts;
    const commProds = commProdsRaw.length > 0 ? commProdsRaw : fallbackProducts;
    const cashProds = cashProdsRaw.length > 0 ? cashProdsRaw : defProds;

    const now = Date.now();
    const allRows = buildCollectionPriceRows(defProds, 'price_deferred', {
      price_deferred: defProds,
      price_commission: commProds,
      price_cash: cashProds,
    });

    if (allRows.length > 0) {
      priceListRowsCache.set('staff_all', { timestamp: now, rows: allRows });
      priceListRowsCache.set('price_deferred', {
        timestamp: now,
        rows: buildCollectionPriceRows(defProds, 'price_deferred', { price_deferred: defProds }),
      });
      priceListRowsCache.set('price_commission', {
        timestamp: now,
        rows: buildCollectionPriceRows(commProds, 'price_commission', { price_commission: commProds }),
      });
      priceListRowsCache.set('price_cash', {
        timestamp: now,
        rows: buildCollectionPriceRows(cashProds, 'price_cash', { price_cash: cashProds }),
      });
    }

    return allRows;
  }

  const normalizedPt = normalizeToErpPriceType(priceType);
  const fetchedProds = await fetchLightweightCatalogByPriceType(normalizedPt).catch(() => []);
  const prods = fetchedProds.length > 0 ? fetchedProds : fallbackProducts;
  const rows = buildCollectionPriceRows(prods, normalizedPt, { [normalizedPt]: prods });
  if (rows.length > 0) {
    priceListRowsCache.set(normalizedPt, { timestamp: Date.now(), rows });
  }
  return rows;
}

function escapeHtml(val: string | number): string {
  return String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface ExportPriceListOptions {
  rows: CollectionPriceRow[];
  priceType: string; // 'all' или конкретный вид цены
  isStaff: boolean;
  clientName?: string;
  contractNumber?: string;
}

/**
 * Выгрузка красиво оформленного читаемого Excel-файла (.xls)
 * Строго: Коллекция и Цена за 1 м² в у.е. (вместо долларов пишется у.е.)
 */
export function exportPriceListToExcel(options: ExportPriceListOptions): void {
  const { rows, priceType, isStaff, clientName, contractNumber } = options;
  const exportAllTypes = isStaff && priceType === 'all';
  const dateStr = new Date().toLocaleDateString('ru-RU');
  const priceTypeLabel = exportAllTypes
    ? 'Все продажные виды цен ERP (По факту / Отсрочка / Комиссия)'
    : formatPriceType(priceType);

  const colCount = exportAllTypes ? 7 : 5;

  const tableRowsHtml = rows
    .map((r, idx) => {
      const bg = idx % 2 === 0 ? '#FFFFFF' : '#F8FAFC';
      const specsParts = [
        r.density && r.density !== '—' ? `${r.density}${String(r.density).includes('точек') ? '' : ' точек/м²'}` : '',
        r.pileHeight && r.pileHeight !== '—' ? `ворс ${r.pileHeight}${String(r.pileHeight).includes('мм') ? '' : ' мм'}` : '',
        r.material && r.material !== '—' ? r.material : '',
      ].filter(Boolean);
      const specsStr = specsParts.length > 0 ? specsParts.join(' • ') : '—';
      const originStr = r.manufacturer && r.manufacturer !== '—' ? `${r.manufacturer} (${r.country})` : r.country;

      if (exportAllTypes) {
        const pCash = formatSqmPriceUe(r.pricesByType['price_cash'] || r.pricePerSqm);
        const pDef = formatSqmPriceUe(r.pricesByType['price_deferred'] || r.pricePerSqm);
        const pComm = formatSqmPriceUe(r.pricesByType['price_commission'] || r.pricePerSqm);
        return `<tr style="background:${bg};">
          <td style="border:1px solid #CBD5E1;padding:8px 10px;text-align:center;color:#475569;font-size:11pt;">${idx + 1}</td>
          <td style="border:1px solid #CBD5E1;padding:8px 12px;font-weight:bold;color:#0F172A;font-size:11pt;">${escapeHtml(r.collection)}</td>
          <td style="border:1px solid #CBD5E1;padding:8px 10px;color:#334155;font-size:10pt;">${escapeHtml(originStr)}</td>
          <td style="border:1px solid #CBD5E1;padding:8px 10px;color:#475569;font-size:10pt;">${escapeHtml(specsStr)}</td>
          <td style="border:1px solid #CBD5E1;padding:8px 12px;text-align:right;font-weight:bold;color:#003365;font-size:11pt;background:#F0F9FF;">${escapeHtml(pCash)}</td>
          <td style="border:1px solid #CBD5E1;padding:8px 12px;text-align:right;font-weight:bold;color:#003365;font-size:11pt;background:#F0FDF4;">${escapeHtml(pDef)}</td>
          <td style="border:1px solid #CBD5E1;padding:8px 12px;text-align:right;font-weight:bold;color:#7C2D12;font-size:11pt;background:#FFFBEB;">${escapeHtml(pComm)}</td>
        </tr>`;
      }

      const singlePrice = formatSqmPriceUe(r.pricePerSqm);
      return `<tr style="background:${bg};">
        <td style="border:1px solid #CBD5E1;padding:8px 10px;text-align:center;color:#475569;font-size:11pt;">${idx + 1}</td>
        <td style="border:1px solid #CBD5E1;padding:8px 12px;font-weight:bold;color:#0F172A;font-size:12pt;">${escapeHtml(r.collection)}</td>
        <td style="border:1px solid #CBD5E1;padding:8px 10px;color:#334155;font-size:10pt;">${escapeHtml(originStr)}</td>
        <td style="border:1px solid #CBD5E1;padding:8px 10px;color:#475569;font-size:10pt;">${escapeHtml(specsStr)}</td>
        <td style="border:1px solid #CBD5E1;padding:8px 14px;text-align:right;font-weight:bold;color:#003365;font-size:12pt;background:#F0F9FF;">${escapeHtml(singlePrice)}</td>
      </tr>`;
    })
    .join('\n');

  const headersHtml = exportAllTypes
    ? `<tr style="background:#003365;color:#FFFFFF;font-weight:bold;">
        <th style="border:1px solid #002244;padding:10px;width:50px;text-align:center;">№</th>
        <th style="border:1px solid #002244;padding:10px;width:220px;text-align:left;">Коллекция</th>
        <th style="border:1px solid #002244;padding:10px;width:210px;text-align:left;">Фабрика / Страна</th>
        <th style="border:1px solid #002244;padding:10px;width:260px;text-align:left;">Характеристики</th>
        <th style="border:1px solid #002244;padding:10px;width:165px;text-align:right;">Цена за 1 м² — По факту (у.е.)</th>
        <th style="border:1px solid #002244;padding:10px;width:165px;text-align:right;">Цена за 1 м² — Отсрочка (у.е.)</th>
        <th style="border:1px solid #002244;padding:10px;width:165px;text-align:right;">Цена за 1 м² — Комиссия (у.е.)</th>
      </tr>`
    : `<tr style="background:#003365;color:#FFFFFF;font-weight:bold;">
        <th style="border:1px solid #002244;padding:10px;width:50px;text-align:center;">№</th>
        <th style="border:1px solid #002244;padding:10px;width:240px;text-align:left;">Коллекция</th>
        <th style="border:1px solid #002244;padding:10px;width:220px;text-align:left;">Фабрика / Страна</th>
        <th style="border:1px solid #002244;padding:10px;width:280px;text-align:left;">Характеристики</th>
        <th style="border:1px solid #002244;padding:10px;width:190px;text-align:right;">Цена за 1 м² (у.е.)</th>
      </tr>`;

  const clientMetaRow = clientName
    ? `<tr><td colspan="${colCount}" style="padding:4px 10px;font-size:10pt;color:#334155;"><b>Партнёр / Контрагент:</b> ${escapeHtml(clientName)}${contractNumber ? ` (${escapeHtml(contractNumber)})` : ''}</td></tr>`
    : '';

  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
<!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>Прайс-лист Synergy</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
<style>
  body, table { font-family: Arial, Calibri, sans-serif; }
</style>
</head>
<body>
  <table cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
    <tr>
      <td colspan="${colCount}" style="padding:12px 10px 4px 10px;font-size:15pt;font-weight:bold;color:#003365;">
        ПРАЙС-ЛИСТ КОЛЛЕКЦИЙ — SYNERGY GROUP
      </td>
    </tr>
    <tr>
      <td colspan="${colCount}" style="padding:4px 10px;font-size:10pt;color:#334155;">
        <b>Вид цены:</b> ${escapeHtml(priceTypeLabel)} &nbsp;|&nbsp; <b>Единица расчёта:</b> за 1 м² (в у.е.) &nbsp;|&nbsp; <b>Дата актуальности:</b> ${escapeHtml(dateStr)}
      </td>
    </tr>
    ${clientMetaRow}
    <tr><td colspan="${colCount}" style="height:10px;"></td></tr>
    ${headersHtml}
    ${tableRowsHtml}
    <tr><td colspan="${colCount}" style="height:10px;"></td></tr>
    <tr>
      <td colspan="${colCount}" style="padding:6px 10px;font-size:9pt;color:#64748B;">
        * Все цены указаны за 1 м² в условных единицах (у.е.). Выгружено автоматически из системы ERP Synergy Group (${escapeHtml(dateStr)}).
      </td>
    </tr>
  </table>
</body>
</html>`;

  const blob = new Blob(['\uFEFF' + html], { type: 'application/vnd.ms-excel;charset=utf-8;' });
  const suffix = exportAllTypes ? 'Vse_vidy_tsen_ERP' : normalizeToErpPriceType(priceType);
  const safeDate = new Date().toISOString().split('T')[0];
  triggerFileDownload(blob, `Price_List_Synergy_${suffix}_${safeDate}.xls`);
}

/**
 * Выгрузка прайс-листа в формате CSV (разделитель точка с запятой, кодировка UTF-8 с BOM для Excel)
 */
export function exportPriceListToCsv(options: ExportPriceListOptions): void {
  const { rows, priceType, isStaff, clientName } = options;
  const exportAllTypes = isStaff && priceType === 'all';
  const dateStr = new Date().toLocaleDateString('ru-RU');
  const priceTypeLabel = exportAllTypes ? 'Все продажные виды цен ERP' : formatPriceType(priceType);

  const lines: string[] = [];
  lines.push(`"ПРАЙС-ЛИСТ КОЛЛЕКЦИЙ SYNERGY GROUP";""`);
  lines.push(`"Вид цены:";"${priceTypeLabel.replace(/"/g, '""')}"`);
  if (clientName) {
    lines.push(`"Контрагент:";"${clientName.replace(/"/g, '""')}"`);
  }
  lines.push(`"Валюта и единица:";"за 1 м² (у.е.)"`);
  lines.push(`"Дата выгрузки:";"${dateStr}"`);
  lines.push('');

  if (exportAllTypes) {
    lines.push('"№";"Коллекция";"Фабрика / Страна";"Цена за 1 м² — По факту (у.е.)";"Цена за 1 м² — Отсрочка (у.е.)";"Цена за 1 м² — Комиссия (у.е.)"');
    rows.forEach((r, idx) => {
      const origin = r.manufacturer && r.manufacturer !== '—' ? `${r.manufacturer} (${r.country})` : r.country;
      const pCash = formatSqmPriceUe(r.pricesByType['price_cash'] || r.pricePerSqm);
      const pDef = formatSqmPriceUe(r.pricesByType['price_deferred'] || r.pricePerSqm);
      const pComm = formatSqmPriceUe(r.pricesByType['price_commission'] || r.pricePerSqm);
      lines.push(`"${idx + 1}";"${r.collection.replace(/"/g, '""')}";"${origin.replace(/"/g, '""')}";"${pCash}";"${pDef}";"${pComm}"`);
    });
  } else {
    lines.push('"№";"Коллекция";"Фабрика / Страна";"Цена за 1 м² (у.е.)"');
    rows.forEach((r, idx) => {
      const origin = r.manufacturer && r.manufacturer !== '—' ? `${r.manufacturer} (${r.country})` : r.country;
      const pVal = formatSqmPriceUe(r.pricePerSqm);
      lines.push(`"${idx + 1}";"${r.collection.replace(/"/g, '""')}";"${origin.replace(/"/g, '""')}";"${pVal}"`);
    });
  }

  const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const suffix = exportAllTypes ? 'Vse_vidy_tsen_ERP' : normalizeToErpPriceType(priceType);
  const safeDate = new Date().toISOString().split('T')[0];
  triggerFileDownload(blob, `Price_List_Synergy_${suffix}_${safeDate}.csv`);
}

export { resolveContractPriceType };
