import type { CartItem } from '@/types';
import { calcSqm, parseSizeDimensions } from '@/types';

export function sizeArea(size: string): number {
  const { w, h } = parseSizeDimensions(size);
  return w * h;
}

export function pluralPositions(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'позиция';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'позиции';
  return 'позиций';
}

export function fmt2(n: number): string {
  return n.toFixed(2);
}

export interface SizeSubtotal {
  size: string;
  qty: number;
  sqm: number;
  sum: number;
  area: number;
}

export function calcSizeSubtotals(list: CartItem[]): SizeSubtotal[] {
  const map = new Map<string, SizeSubtotal>();
  for (const item of list) {
    const existing = map.get(item.size);
    const sqm = calcSqm(item.size, item.quantity);
    const sum = item.price * item.quantity;
    if (existing) {
      existing.qty += item.quantity;
      existing.sqm += sqm;
      existing.sum += sum;
    } else {
      map.set(item.size, { size: item.size, qty: item.quantity, sqm, sum, area: sizeArea(item.size) });
    }
  }
  return Array.from(map.values()).sort((a, b) => a.area - b.area);
}

export const CITIES = ['Астана', 'Алматы', 'Шымкент'];
