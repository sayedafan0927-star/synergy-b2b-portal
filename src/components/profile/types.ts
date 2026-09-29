import type { UserRole } from '@/contexts/AuthContext';
import { calcSqm, parseSizeDimensions } from '@/types';
import { formatCurrency } from '@/lib/currency';

export interface OrderItem {
  id?: string;
  productName: string;
  collection: string;
  size: string;
  sku?: string;
  warehouse: string;
  price: number;
  quantity: number;
}

export interface RepeatResult {
  orderNumber: string;
  added: Array<{ name: string; size: string; requestedQty: number; addedQty: number }>;
  missing: Array<{ name: string; size: string; requestedQty: number; reason: string }>;
}

export interface Order {
  id: string;
  orderNumber: string;
  userId?: string;
  placedById?: string;
  date: string;
  rawDate?: string;
  status: string;
  statusRaw: string;
  statusColor: string;
  warehouse: string;
  notes?: string;
  clientName?: string;
  clientCompany?: string;
  clientPhone?: string;
  totalAmount: number;
  totalSqm: number;
  totalItems: number;
  items: OrderItem[];
}

export const ORDER_STATUS_MAP: Record<string, { label: string; color: string }> = {
  pending: { label: 'В авторезерве', color: 'bg-amber-50 text-amber-700 border-amber-200' },
  reserved: { label: 'В авторезерве', color: 'bg-amber-50 text-amber-700 border-amber-200' },
  confirmed: { label: 'В авторезерве', color: 'bg-amber-50 text-amber-700 border-amber-200' },
  processing: { label: 'На сборке', color: 'bg-blue-50 text-blue-700 border-blue-200' },
  picking: { label: 'На сборке', color: 'bg-blue-50 text-blue-700 border-blue-200' },
  assembled: { label: 'Готов к отгрузке', color: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  ready: { label: 'Готов к отгрузке', color: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  shipped: { label: 'Отгружен', color: 'bg-purple-50 text-purple-700 border-purple-200' },
  delivered: { label: 'Доставлен', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  cancelled: { label: 'Отменён', color: 'bg-rose-50 text-rose-700 border-rose-200' },
  draft: { label: 'Черновик', color: 'bg-slate-100 text-slate-600 border-slate-200' },
};

/**
 * Расчет оставшегося времени действия складской брони (WMS Hold TTL 24ч)
 */
export function getReservationTtlRemaining(rawDate?: string, ttlHours = 24): { hours: number; minutes: number; isExpired: boolean; label: string } | null {
  if (!rawDate) return null;
  const created = new Date(rawDate).getTime();
  if (isNaN(created)) return null;
  const deadline = created + ttlHours * 3600 * 1000;
  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) {
    return { hours: 0, minutes: 0, isExpired: true, label: 'Бронь истекла' };
  }
  const hours = Math.floor(remainingMs / (3600 * 1000));
  const minutes = Math.floor((remainingMs % (3600 * 1000)) / (60 * 1000));
  return {
    hours,
    minutes,
    isExpired: false,
    label: `${hours} ч ${minutes} мин`,
  };
}

export interface DisplaySettings {
  show_stock: boolean;
  show_reserve: boolean;
  show_total_pcs: boolean;
  show_sqm: boolean;
  show_price: boolean;
}

export function fmt2(n: number) {
  return n.toFixed(2);
}

export function fmtPrice(n: number) {
  try {
    const cur = typeof localStorage !== 'undefined' ? localStorage.getItem('synergy_preferred_currency') : 'USD';
    const session = typeof localStorage !== 'undefined' ? localStorage.getItem('synergy_auth_session') : null;
    const isImp = typeof sessionStorage !== 'undefined' && Boolean(sessionStorage.getItem('synergy:impersonated_profile'));
    let isAdminUser = false;
    if (session && !isImp) {
      try {
        const parsed = JSON.parse(session);
        isAdminUser = parsed?.profile?.role === 'admin' || parsed?.role === 'admin';
      } catch {}
    }
    if (cur === 'KZT' && isAdminUser) {
      return formatCurrency(n, 'KZT');
    }
  } catch {}
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export function sizeArea(size: string) {
  const { w, h } = parseSizeDimensions(size);
  return w * h;
}

export function roleName(role: UserRole) {
  const map: Record<UserRole, string> = {
    admin: 'Администратор',
    manager_rm: 'Региональный менеджер',
    manager_lm: 'Локальный менеджер',
    supplier: 'Поставщик',
    client: 'Клиент',
  };
  return map[role] ?? role;
}

export function roleColor(role: UserRole) {
  const map: Record<UserRole, string> = {
    admin: 'bg-red-50 text-red-700',
    manager_rm: 'bg-blue-50 text-blue-700',
    manager_lm: 'bg-sky-50 text-sky-700',
    supplier: 'bg-amber-50 text-amber-700',
    client: 'bg-slate-100 text-slate-600',
  };
  return map[role] ?? 'bg-slate-100 text-slate-600';
}

export function orderTotals(items: OrderItem[]) {
  let qty = 0, sqm = 0, sum = 0;
  for (const i of items) {
    qty += i.quantity;
    sqm += calcSqm(i.size, i.quantity);
    sum += i.price * i.quantity;
  }
  return { qty, sqm, sum };
}
