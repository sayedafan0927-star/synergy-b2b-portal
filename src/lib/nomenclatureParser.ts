import { parseSizeDimensions } from '@/types';

export const STANDARD_SIZES = ['0.8 × 1.5', '1.6 × 2.3', '2 × 3', '2.5 × 3.5', '3 × 4'];

export function calculateArea(sizeStr: string): number {
  if (!sizeStr) return 3.68;
  const cleaned = sizeStr.replace(',', '.');
  const parts = cleaned.split(/[*×xXхХ]/).map(s => parseFloat(s.trim()));
  if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
    return Math.round(parts[0] * parts[1] * 100) / 100;
  }
  return 3.68;
}

/**
 * Парсер номенклатуры 1С (ERP):
 * Преобразует сырую строку вида:
 * "CELESTE <KARMEN HALI(Турция)> (VE001G, 1.6*2.3, STAN, KREM-KREM)"
 * в структурированные данные:
 * - Коллекция: CELESTE
 * - Бренд / Фабрика: KARMEN HALI
 * - Страна: Турция
 * - Артикул (Дизайн / SKU): VE001G
 * - Размер: 1.6 × 2.3
 * - Тип: Стандарт / Рулон
 * - Цвет: Krem-Krem
 * - Презентабельное название: "CELESTE VE001G (Krem-Krem)"
 */
export function parse1CNomenclature(rawName: string, fallbackCollection = ''): {
  collection: string;
  manufacturer: string;
  country: string;
  sku: string;
  size: string;
  type: string;
  color: string;
  cleanName: string;
} {
  let collection = fallbackCollection || '';
  let manufacturer = 'Karmen Hali';
  let country = 'Турция';
  let sku = '';
  let size = '';
  let type = 'Стандарт';
  let color = '';

  // 1. Извлекаем параметры в последних круглых скобках (артикул, размер, тип, цвет)
  const pm = rawName.match(/\(([^)]+)\)\s*$/);
  let nameWithoutParams = rawName;
  if (pm) {
    nameWithoutParams = rawName.slice(0, pm.index).trim();
    const parts = pm[1].split(/,\s+/);
    if (parts.length >= 1) sku = parts[0].trim();
    if (parts.length >= 2) size = parts[1].replace('*', ' × ').trim();
    if (parts.length >= 3) {
      type = parts[2] === 'R' ? 'Рулон' : 'Стандарт';
    }
    if (parts.length >= 4) {
      color = parts[3].replace(/[-/]/g, ' ').trim();
    } else if (parts.length === 1 && (parts[0].includes('/') || /^[a-zа-я\s/]+$/i.test(parts[0]))) {
      color = parts[0].trim();
      sku = '';
    }
  }

  // 2. Извлекаем производителя и страну из угловых скобок <...>
  const mfgMatch = nameWithoutParams.match(/<([^>]+)>/);
  if (mfgMatch) {
    const rawMfg = mfgMatch[1];
    const cntryMatch = rawMfg.match(/\(([^)]+)\)/);
    if (cntryMatch) {
      country = cntryMatch[1].trim();
      manufacturer = rawMfg.replace(/\([^)]+\)/, '').trim();
    } else {
      manufacturer = rawMfg.trim();
    }
  }

  // 3. Коллекция — текст до знака '<' или '('
  const collMatch = nameWithoutParams.split(/[<(]/)[0].trim();
  if (collMatch) {
    const cleanCollStr = collMatch.replace(/^(ковер|дорожка)\s+/i, '').trim();
    if (fallbackCollection) {
      collection = fallbackCollection;
      const afterColl = cleanCollStr.replace(new RegExp(`^${fallbackCollection}\\s*`, 'i'), '').trim();
      if (afterColl && !sku) {
        sku = afterColl;
      }
    } else {
      const tokens = cleanCollStr.split(/\s+/);
      collection = tokens[0] || 'Ковры';
      if (!sku && tokens.length > 1) {
        sku = tokens.slice(1).join(' ');
      }
    }
  }

  const cleanName = sku ? `${collection} ${sku}${color ? ` (${color})` : ''}` : (collection || rawName);

  return {
    collection,
    manufacturer,
    country,
    sku,
    size,
    type,
    color,
    cleanName,
  };
}

export function getValidImages(rawImages?: string[] | null): string[] {
  if (!rawImages || !Array.isArray(rawImages)) return [];
  return rawImages
    .filter(img => typeof img === 'string' && img.trim().length > 0 && !img.includes('unsplash.com'))
    .map(img => img.replace(/^https?:\/\/(?:crm\.)?kilem-khan\.kz\/api\/sin\/public\/image\.php/i, 'https://erp.synergy-tech.kz/image.php'));
}
