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

export const DEFAULT_CHECKOUT_PHONE = '+7 (778) 580-68-66';
export const CHECKOUT_PHONE_STORAGE_KEY = 'synergy:last_checkout_phone';

/**
 * Валидация телефонного номера: содержит не менее 10 значащих цифр
 */
export function isValidPhone(value: string | null | undefined): value is string {
  if (!value) return false;
  const digits = value.replace(/\D/g, '');
  return digits.length >= 10;
}

/**
 * Graceful форматирование телефонного номера по стандарту Казахстана/СНГ (+7 (XXX) XXX-XX-XX)
 */
export function formatPhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (!digits || (digits === '7' && value.trim().length <= 2)) return '';

  let rest = digits;
  if (rest.startsWith('7') || rest.startsWith('8')) {
    rest = rest.substring(1);
  }
  if (!rest) return '+7';

  let res = '+7';
  if (rest.length > 0) {
    res += ` (${rest.substring(0, 3)}`;
  }
  if (rest.length >= 4) {
    res += `) ${rest.substring(3, 6)}`;
  }
  if (rest.length >= 7) {
    res += `-${rest.substring(6, 8)}`;
  }
  if (rest.length >= 9) {
    res += `-${rest.substring(8, 10)}`;
  }
  return res;
}
