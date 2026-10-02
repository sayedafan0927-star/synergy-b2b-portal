import { useState, useEffect } from 'react';
import {
  ArrowLeft,
  Package,
  DollarSign,
  AlertTriangle,
  Eye,
} from 'lucide-react';
import { calcSqm } from '@/types';
import { fetchClientOrdersFromErp, fetchClientDebtFromErp, type ClientDebtReport } from '@/lib/erpApi';
import { formatCurrency } from '@/lib/pricingEngine';

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

function fmt2(n: number) {
  return n.toFixed(2);
}

function fmtPrice(n: number) {
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

function orderTotals(items: OrderItem[]) {
  let qty = 0, sqm = 0, sum = 0;
  for (const i of items) {
    qty += i.quantity;
    sqm += calcSqm(i.size, i.quantity);
    sum += i.price * i.quantity;
  }
  return { qty, sqm, sum };
}

export interface ClientDemoPanelProps {
  client: {
    id: string;
    full_name: string;
    company_name: string;
    phone: string;
    partner_id: string | null;
    price_type: string;
  };
}

export function ClientDemoPanel({ client }: ClientDemoPanelProps) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(true);
  const [debt, setDebt] = useState<ClientDebtReport | null>(null);
  const [loadingDebt, setLoadingDebt] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadingOrders(true);

    async function loadClientOrders() {
      try {
        const erpData = await fetchClientOrdersFromErp({ phone: client.phone, clientId: Number(client.partner_id) || undefined });
        if (!cancelled && erpData && erpData.success && Array.isArray(erpData.orders)) {
          const mapped: Order[] = erpData.orders.map((o) => {
            const st = o.status_code || 'pending';
            const meta = ORDER_STATUS_MAP[st] || { label: o.status || st, color: 'bg-amber-50 text-amber-700 border-amber-200' };
            const d = o.date ? new Date(o.date) : new Date();
            return {
              id: String(o.id),
              orderNumber: o.doc_number || `ORD-${o.id}`,
              userId: String(o.client_id || client.id),
              date: d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
              status: o.status || meta.label,
              statusRaw: st,
              statusColor: meta.color,
              warehouse: o.warehouse_name || 'Основной склад',
              notes: o.comment || '',
              clientName: client.full_name,
              clientCompany: client.company_name,
              clientPhone: client.phone,
              totalAmount: Number(o.total_amount) || 0,
              totalSqm: Number(o.total_sqm) || 0,
              totalItems: o.items_count || (o.items || []).reduce((s, it) => s + (it.quantity || 1), 0),
              items: (o.items || []).map((it) => ({
                id: String(it.id),
                item_id: it.item_id ? String(it.item_id) : undefined,
                productId: it.item_id ? String(it.item_id) : undefined,
                productName: it.name || 'Ковер',
                collection: (it.name || '').split(' ')[0] || 'Коллекция',
                size: it.size || 'Стандарт',
                sku: it.sku || '',
                warehouse: it.warehouse || o.warehouse_name || 'Основной Склад Астана',
                warehouse_id: it.warehouse_id || o.warehouse_id,
                price: Number(it.price) || 0,
                quantity: Number(it.quantity) || 1,
              })),
            };
          });
          if (!cancelled) setOrders(mapped);
        } else {
          if (!cancelled) setOrders([]);
        }
      } catch (erpErr) {
        console.warn('[ClientDemoPanel] ERP orders fetch error:', erpErr);
        if (!cancelled) setOrders([]);
      } finally {
        if (!cancelled) setLoadingOrders(false);
      }
    }

    loadClientOrders();
    return () => { cancelled = true; };
  }, [client]);

  useEffect(() => {
    let cancelled = false;
    setLoadingDebt(true);
    fetchClientDebtFromErp({
      phone: client.phone,
      search: client.company_name || client.full_name,
    })
      .then(res => { if (!cancelled && res.success && res.found) setDebt(res); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoadingDebt(false); });

    return () => { cancelled = true; };
  }, [client.id, client.phone, client.company_name, client.full_name]);

  if (selectedOrder) {
    return (
      <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50/50 p-4">
        <div className="flex items-center gap-2 mb-4">
          <button onClick={() => setSelectedOrder(null)} className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 cursor-pointer">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <h4 className="text-sm font-bold text-slate-900">Заказ {selectedOrder.orderNumber}</h4>
          <span className={`badge border ${selectedOrder.statusColor}`}>{selectedOrder.status}</span>
        </div>
        <div className="grid grid-cols-3 gap-2 mb-3">
          <div className="card px-3 py-2 text-center">
            <p className="text-[10px] uppercase text-slate-400">Кол-во</p>
            <p className="text-sm font-bold text-slate-900">{selectedOrder.totalItems} шт.</p>
          </div>
          <div className="card px-3 py-2 text-center">
            <p className="text-[10px] uppercase text-slate-400">Площадь</p>
            <p className="text-sm font-bold text-slate-900">{fmt2(selectedOrder.totalSqm)} м²</p>
          </div>
          <div className="card px-3 py-2 text-center">
            <p className="text-[10px] uppercase text-slate-400">Сумма</p>
            <p className="text-sm font-bold text-brand-700">{fmtPrice(selectedOrder.totalAmount)}</p>
          </div>
        </div>
        <div className="space-y-1.5">
          {selectedOrder.items.map((item, idx) => {
            const sqm = calcSqm(item.size, item.quantity);
            const total = item.price * item.quantity;
            return (
              <div key={idx} className="flex items-center gap-3 rounded-lg bg-white border border-slate-100 px-3 py-2">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-slate-900 truncate">{item.productName}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="badge text-[10px]">{item.size}</span>
                    <span className="text-[11px] text-slate-400">{item.warehouse}</span>
                  </div>
                </div>
                <div className="flex gap-3 text-right text-xs shrink-0">
                  <span className="text-slate-500">{item.quantity} шт.</span>
                  <span className="text-slate-500">{fmt2(sqm)} м²</span>
                  <span className="font-bold text-slate-900">{fmtPrice(total)}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50/50 p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Eye className="h-4 w-4 text-brand-600" />
        <h4 className="text-sm font-bold text-slate-900">Демо-просмотр: {client.full_name || client.company_name}</h4>
        <span className="badge bg-brand-50 text-brand-700 text-[10px] ml-auto">Только просмотр</span>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Package className="h-4 w-4 text-slate-500" />
            <h5 className="text-xs font-bold text-slate-700">Заказы клиента ({orders.length})</h5>
          </div>
          {loadingOrders ? (
            <div className="py-4 flex justify-center">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
            </div>
          ) : orders.length === 0 ? (
            <div className="rounded-lg bg-white border border-slate-100 p-4 text-center">
              <p className="text-xs text-slate-400">Заказов пока нет</p>
            </div>
          ) : (
            <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
              {orders.map(order => {
                const t = orderTotals(order.items);
                return (
                  <button
                    key={order.id}
                    onClick={() => setSelectedOrder(order)}
                    className="w-full text-left rounded-lg bg-white border border-slate-100 px-3 py-2 hover:border-brand-300 hover:shadow-sm transition-all cursor-pointer"
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-xs text-slate-900 bg-slate-100 px-1.5 py-0.5 rounded">{order.orderNumber}</span>
                        <span className={`badge border ${order.statusColor} text-[10px]`}>{order.status}</span>
                      </div>
                      <span className="text-[10px] text-slate-400">{order.date}</span>
                    </div>
                    <div className="flex items-center gap-3 text-[11px] text-slate-500">
                      <span>{order.totalItems || t.qty} шт.</span>
                      <span>{fmt2(order.totalSqm || t.sqm)} м²</span>
                      <span className="font-bold text-brand-700 ml-auto">{fmtPrice(order.totalAmount || t.sum)}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-slate-500" />
            <h5 className="text-xs font-bold text-slate-700">Финансы и долги</h5>
          </div>
          {loadingDebt ? (
            <div className="py-4 flex justify-center">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
            </div>
          ) : debt ? (
            <div className="rounded-lg bg-white border border-slate-100 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-500">Задолженность</span>
                <span className="text-sm font-bold text-red-600">
                  {fmtPrice(debt.financials?.total_debt_usd ?? 0)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-500">Оплачено</span>
                <span className="text-sm font-bold text-emerald-600">
                  {fmtPrice(debt.financials?.total_paid_usd ?? 0)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-500">Просрочено</span>
                <span className="text-sm font-bold text-amber-600">
                  {fmtPrice(debt.financials?.overdue_usd ?? 0)}
                </span>
              </div>
              {debt.financials?.is_overdue && (
                <div className="flex items-center gap-1.5 rounded-md bg-red-50 px-2 py-1 text-[11px] text-red-700">
                  <AlertTriangle className="h-3 w-3" />
                  Просрочка {debt.financials.max_overdue_days} дн.
                </div>
              )}
              {debt.client?.credit_limit_usd && (
                <div className="border-t border-slate-100 pt-2 text-[11px] text-slate-400">
                  Лимит: {fmtPrice(debt.client.credit_limit_usd)} • Отсрочка: {debt.client.payment_delay_days} дн.
                </div>
              )}
              {debt.regional_manager?.name && (
                <div className="border-t border-slate-100 pt-2 text-[11px] text-slate-500">
                  Куратор РМ: <strong className="text-slate-700">{debt.regional_manager.name}</strong>
                  {debt.regional_manager.phone && <span className="font-mono ml-1">{debt.regional_manager.phone}</span>}
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-lg bg-white border border-slate-100 p-4 text-center">
              <p className="text-xs text-slate-400">Данные из ERP не найдены</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default ClientDemoPanel;
