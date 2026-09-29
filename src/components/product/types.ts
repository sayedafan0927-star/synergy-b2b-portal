import type { Product, ProductVariant, Warehouse } from '@/types';
import { parseSizeDimensions } from '@/types';

export function rowKey(sku: string, city: string): string {
  return `${sku}::${city}`;
}

export function getVariantShape(v: ProductVariant, productName = '', productCategory = ''): string {
  const s = (v.size || '').toLowerCase();
  const name = (productName + ' ' + (v.name || '')).toLowerCase();
  const { w, h } = parseSizeDimensions(v.size);

  if (name.includes('овал') || s.includes('овал')) return 'Овальный';
  if (name.includes('круг') || s.includes('круг')) return 'Круглый';
  if (v.type === 'Рулон' || productCategory.toLowerCase().includes('дорожк') || name.includes('дорожк')) {
    return 'Дорожка';
  }
  if (w > 0 && h > 0) {
    const ratio = Math.max(w, h) / Math.min(w, h);
    if (ratio >= 2.5) return 'Дорожка';
    if (Math.abs(w - h) < 0.05) return 'Квадратный';
  }
  return 'Прямоугольный';
}

export interface SpecItem {
  label: string;
  value: string;
}
