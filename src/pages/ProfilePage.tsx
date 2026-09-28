import { useState, useMemo, useEffect, useCallback } from 'react';
import {
  Package,
  Settings,
  ArrowLeft,
  ChevronRight,
  User,
  MapPin,
  Calendar,
  Hash,
  Filter,
  ArrowUpDown,
  Shield,
  Users,
  LogOut,
  DollarSign,
  Clock,
  Eye,
  UserCog,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Server,
  Copy,
  Check,
  Database,
  Building2,
  Boxes,
  Activity,
  FileJson,
  Search,
  ChevronDown,
  Power,
  FileText,
  RotateCcw,
  X,
  ShoppingCart,
} from 'lucide-react';
import type { PageId } from '@/types';
import { calcSqm, parseSizeDimensions } from '@/types';
import { useAuth, type UserRole } from '@/contexts/AuthContext';
import { useCart } from '@/contexts/CartContext';
import { supabase } from '@/lib/supabase';
import {
  syncAllErpData,
  type ErpSyncReport,
  ERP_API_URL,
  fetchClientDebtFromErp,
  type ClientDebtReport,
  fetchClientOrdersFromErp,
  fetchCounterpartiesFromErp,
  fetchCatalogFromErp,
  updateOrderStatusInErp,
  updateClientAccessInErp,
  fetchDisplaySettingsFromErp,
  saveDisplaySettingsToErp,
  broadcastClientDeactivated
} from '@/lib/erpApi';
import SupplierCabinet from '@/components/SupplierCabinet';
import { triggerCatalogReload, mergeProducts } from '@/hooks/useProductData';
import { triggerDisplaySettingsReload } from '@/hooks/useDisplaySettings';
import {
  getClientWarehouseSettings,
  saveClientWarehouseSettings,
  resetClientWarehouseSettings,
  getAllClientWarehouseRules,
  CENTRAL_WAREHOUSE_ID,
  CENTRAL_WAREHOUSE_NAME,
  triggerWarehouseSettingsReload,
  type ClientWarehouseSettings
} from '@/lib/warehouseVisibility';

/* ─── Types ─── */
interface OrderItem {
  id?: string;
  productName: string;
  collection: string;
  size: string;
  sku?: string;
  warehouse: string;
  price: number;
  quantity: number;
}

interface RepeatResult {
  orderNumber: string;
  added: Array<{ name: string; size: string; requestedQty: number; addedQty: number }>;
  missing: Array<{ name: string; size: string; requestedQty: number; reason: string }>;
}

interface Order {
  id: string;
  orderNumber: string;
  userId?: string;
  placedById?: string;
  date: string;
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

const ORDER_STATUS_MAP: Record<string, { label: string; color: string }> = {
  pending: { label: 'Новый', color: 'bg-amber-50 text-amber-700 border-amber-200' },
  processing: { label: 'В обработке', color: 'bg-blue-50 text-blue-700 border-blue-200' },
  shipped: { label: 'Отгружен', color: 'bg-purple-50 text-purple-700 border-purple-200' },
  delivered: { label: 'Доставлен', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  cancelled: { label: 'Отменён', color: 'bg-rose-50 text-rose-700 border-rose-200' },
  draft: { label: 'Черновик', color: 'bg-slate-100 text-slate-600 border-slate-200' },
};

interface DisplaySettings {
  show_stock: boolean;
  show_reserve: boolean;
  show_total_pcs: boolean;
  show_sqm: boolean;
  show_price: boolean;
}

/* ─── Helpers ─── */
function fmt2(n: number) { return n.toFixed(2); }
function fmtPrice(n: number) { return `$${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`; }
function sizeArea(size: string) { const { w, h } = parseSizeDimensions(size); return w * h; }

function roleName(role: UserRole) {
  const map: Record<UserRole, string> = {
    admin: 'Администратор',
    manager_rm: 'Региональный менеджер',
    manager_lm: 'Локальный менеджер',
    supplier: 'Поставщик',
    client: 'Клиент',
  };
  return map[role] ?? role;
}

function roleColor(role: UserRole) {
  const map: Record<UserRole, string> = {
    admin: 'bg-red-50 text-red-700',
    manager_rm: 'bg-blue-50 text-blue-700',
    manager_lm: 'bg-sky-50 text-sky-700',
    supplier: 'bg-amber-50 text-amber-700',
    client: 'bg-slate-100 text-slate-600',
  };
  return map[role] ?? 'bg-slate-100 text-slate-600';
}

function orderTotals(items: OrderItem[]) {
  let qty = 0, sqm = 0, sum = 0;
  for (const i of items) { qty += i.quantity; sqm += calcSqm(i.size, i.quantity); sum += i.price * i.quantity; }
  return { qty, sqm, sum };
}

type TabId = 'orders' | 'supplier-portal' | 'admin-erp' | 'admin-users' | 'admin-display' | 'settings';

/* ─── Order Detail View ─── */
function OrderDetail({
  order,
  onBack,
  isAdmin,
  onUpdateOrder,
  onRepeatOrder,
  repeatingOrderId,
}: {
  order: Order;
  onBack: () => void;
  isAdmin?: boolean;
  onUpdateOrder?: (o: Order) => void;
  onRepeatOrder?: (o: Order) => void;
  repeatingOrderId?: string | null;
}) {
  const [activeCollection, setActiveCollection] = useState<string | null>(null);
  const [sizeAsc, setSizeAsc] = useState(true);
  const [status, setStatus] = useState(order.statusRaw || 'pending');
  const [updatingStatus, setUpdatingStatus] = useState(false);

  const collections = useMemo(() => Array.from(new Set(order.items.map(i => i.collection))).sort(), [order]);
  const totals = useMemo(() => orderTotals(order.items), [order.items]);

  const handleStatusChange = async (newStatus: string) => {
    setUpdatingStatus(true);
    // 1. Синхронизируем статус в ERP (при 'cancelled' ERP автоматически расформировывает бронь free_stock)
    try {
      await updateOrderStatusInErp({
        orderId: order.id,
        status: newStatus,
        comment: `Статус изменен администратором портала на "${newStatus}"`,
      });
    } catch (erpErr) {
      console.warn('[OrderDetailModal] ERP update_order_status warning:', erpErr);
    }

    // 2. Обновляем статус в Supabase
    try {
      await supabase
        .from('orders')
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq('id', order.id);
    } catch {
      // safe fallback
    }

    const meta = ORDER_STATUS_MAP[newStatus] || { label: newStatus, color: 'bg-slate-100 text-slate-600 border-slate-200' };
    setStatus(newStatus);
    onUpdateOrder?.({
      ...order,
      status: meta.label,
      statusRaw: newStatus,
      statusColor: meta.color,
    });
    setUpdatingStatus(false);
  };

  const filteredItems = useMemo(() => {
    let list = activeCollection ? order.items.filter(i => i.collection === activeCollection) : [...order.items];
    list.sort((a, b) => { const diff = sizeArea(a.size) - sizeArea(b.size); return sizeAsc ? diff : -diff; });
    return list;
  }, [order.items, activeCollection, sizeAsc]);

  const groupedByCollection = useMemo(() => {
    const map = new Map<string, OrderItem[]>();
    for (const item of filteredItems) { const arr = map.get(item.collection) ?? []; arr.push(item); map.set(item.collection, arr); }
    return map;
  }, [filteredItems]);

  const sizeSubtotals = useMemo(() => {
    const map = new Map<string, { qty: number; sqm: number; sum: number }>();
    for (const i of filteredItems) {
      const e = map.get(i.size) ?? { qty: 0, sqm: 0, sum: 0 };
      e.qty += i.quantity; e.sqm += calcSqm(i.size, i.quantity); e.sum += i.price * i.quantity;
      map.set(i.size, e);
    }
    return Array.from(map.entries()).sort((a, b) => sizeArea(a[0]) - sizeArea(b[0]));
  }, [filteredItems]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Hash className="h-4 w-4 text-slate-400" />
              <h2 className="text-lg font-bold text-slate-900">{order.orderNumber || order.id}</h2>
              <span className={`badge border ${order.statusColor}`}>{order.status}</span>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400 mt-0.5">
              <span>{order.date}</span>
              {order.warehouse && <span>• Склад: <strong className="text-slate-600">{order.warehouse}</strong></span>}
              {order.clientCompany && <span>• Клиент: <strong className="text-slate-700">{order.clientCompany}</strong></span>}
              {order.clientName && <span>({order.clientName}{order.clientPhone ? `, ${order.clientPhone}` : ''})</span>}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {onRepeatOrder && (
            <button
              type="button"
              onClick={() => onRepeatOrder(order)}
              disabled={repeatingOrderId !== null}
              className="flex items-center gap-1.5 rounded-lg bg-brand-700 hover:bg-brand-800 text-white px-3.5 py-1.5 text-xs font-semibold shadow-sm transition-all active:scale-95 disabled:opacity-50"
            >
              <RotateCcw className={`h-3.5 w-3.5 ${repeatingOrderId === order.id ? 'animate-spin' : ''}`} />
              Повторить заказ
            </button>
          )}

          {isAdmin && (
            <div className="flex items-center gap-2 bg-slate-50 p-2 rounded-xl border border-slate-200">
              <span className="text-xs font-semibold text-slate-600">Статус заказа:</span>
              <select
                value={status}
                disabled={updatingStatus}
                onChange={(e) => handleStatusChange(e.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-bold text-slate-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-500 cursor-pointer"
              >
                <option value="pending">Новый</option>
                <option value="processing">В обработке</option>
                <option value="shipped">Отгружен</option>
                <option value="delivered">Доставлен</option>
                <option value="cancelled">Отменён</option>
              </select>
            </div>
          )}
        </div>
      </div>

      {order.notes && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs text-slate-600">
          <strong className="text-slate-800">Примечание к заказу:</strong> {order.notes}
        </div>
      )}

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Кол-во', value: `${totals.qty || order.totalItems} шт.` },
          { label: 'Площадь', value: `${fmt2(totals.sqm || order.totalSqm)} м²` },
          { label: 'Сумма', value: fmtPrice(totals.sum || order.totalAmount), bold: true },
        ].map(s => (
          <div key={s.label} className="card px-4 py-3 text-center">
            <p className="text-[10px] uppercase tracking-wide text-slate-400">{s.label}</p>
            <p className={`text-sm font-bold ${s.bold ? 'text-brand-700' : 'text-slate-900'}`}>{s.value}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Filter className="h-4 w-4 text-slate-400 shrink-0" />
        <button onClick={() => setActiveCollection(null)} className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${activeCollection === null ? 'bg-brand-700 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>Все</button>
        {collections.map(col => (
          <button key={col} onClick={() => setActiveCollection(activeCollection === col ? null : col)} className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${activeCollection === col ? 'bg-brand-700 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{col}</button>
        ))}
        <button onClick={() => setSizeAsc(v => !v)} className="ml-auto flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-200">
          <ArrowUpDown className="h-3 w-3" /> {sizeAsc ? 'Размер ↑' : 'Размер ↓'}
        </button>
      </div>

      <div className="space-y-2">
        {activeCollection !== null ? (
          Array.from(groupedByCollection.entries()).map(([col, colItems]) => {
            const ct = orderTotals(colItems);
            return (
              <div key={col} className="space-y-2">
                {colItems.map((item, idx) => <OrderItemRow key={`${item.productName}-${item.size}-${idx}`} item={item} />)}
                <div className="rounded-lg border border-brand-200 bg-brand-50/50 px-4 py-2.5 flex flex-wrap items-center justify-between text-xs">
                  <span className="font-semibold text-brand-800">{col}</span>
                  <span className="text-slate-600">{ct.qty} шт. / {fmt2(ct.sqm)} м² / {fmtPrice(ct.sum)}</span>
                </div>
              </div>
            );
          })
        ) : (
          filteredItems.map((item, idx) => <OrderItemRow key={`${item.productName}-${item.size}-${idx}`} item={item} />)
        )}
      </div>

      {sizeSubtotals.length > 1 && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <h3 className="text-xs font-bold text-slate-700 mb-2">Итого по размерам</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {sizeSubtotals.map(([size, s]) => (
              <div key={size} className="rounded-lg bg-white border border-slate-100 px-3 py-2 text-xs">
                <p className="font-semibold text-slate-800">{size}</p>
                <p className="text-slate-500">{s.qty} шт. / {fmt2(s.sqm)} м²</p>
                <p className="font-medium text-slate-700">{fmtPrice(s.sum)}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function OrderItemRow({ item }: { item: OrderItem }) {
  const sqm = calcSqm(item.size, item.quantity);
  const total = item.price * item.quantity;
  return (
    <div className="card flex items-center gap-3 px-4 py-3">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-900 truncate">{item.productName}</p>
        <div className="flex flex-wrap items-center gap-2 mt-0.5">
          <span className="badge text-[10px]">{item.size}</span>
          <span className="text-xs text-slate-400">{item.warehouse}</span>
        </div>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-right shrink-0">
        <span className="text-slate-500">{item.quantity} шт.</span>
        <span className="text-slate-500">{fmt2(sqm)} м²</span>
        <span className="font-bold text-slate-900">{fmtPrice(total)}</span>
      </div>
    </div>
  );
}

/* ─── Admin: Display Settings Tab ─── */
function AdminDisplaySettings() {
  const roles: UserRole[] = ['admin', 'manager_rm', 'manager_lm', 'supplier', 'client'];
  const defaultMap: Record<string, DisplaySettings> = {
    admin: { show_stock: true, show_reserve: true, show_total_pcs: true, show_sqm: true, show_price: true, show_hub_warehouse: true, show_showroom_warehouse: true, hidden_warehouses: [] },
    manager_rm: { show_stock: true, show_reserve: true, show_total_pcs: true, show_sqm: true, show_price: true, show_hub_warehouse: true, show_showroom_warehouse: true, hidden_warehouses: [] },
    manager_lm: { show_stock: true, show_reserve: false, show_total_pcs: true, show_sqm: true, show_price: true, show_hub_warehouse: true, show_showroom_warehouse: true, hidden_warehouses: [] },
    supplier: { show_stock: true, show_reserve: false, show_total_pcs: true, show_sqm: true, show_price: false, show_hub_warehouse: true, show_showroom_warehouse: false, hidden_warehouses: [] },
    client: { show_stock: true, show_reserve: false, show_total_pcs: true, show_sqm: true, show_price: true, show_hub_warehouse: true, show_showroom_warehouse: true, hidden_warehouses: [] },
  };

  const [settings, setSettings] = useState<Record<string, DisplaySettings>>(() => {
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem('synergy:display_settings');
        if (stored) return { ...defaultMap, ...JSON.parse(stored) };
      } catch {
        // fallback
      }
    }
    return defaultMap;
  });

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [clients, setClients] = useState<any[]>([]);
  const [clientSearch, setClientSearch] = useState('');
  const [quickModalClient, setQuickModalClient] = useState<any | null>(null);

  useEffect(() => {
    fetchCounterpartiesFromErp({ limit: 100 })
      .then(res => {
        if (res?.counterparties && Array.isArray(res.counterparties)) {
          setClients(res.counterparties.map((cp: any) => ({
            id: String(cp.id),
            full_name: cp.name,
            company_name: cp.name,
            phone: cp.phone || '',
            partner_id: String(cp.id),
            showroom_warehouse_id: cp.showroom_warehouse_id ?? cp.warehouse_id ?? (cp.id === 2833 ? 2833 : null),
            showroom_warehouse_name: cp.showroom_warehouse_name ?? cp.warehouse_name ?? (cp.id === 2833 ? 'Aya Home Store (Шымкент)' : null),
          })));
        }
      })
      .catch(() => {});

    // Загрузка глобальных серверных настроек из ERP (action=display_settings)
    fetchDisplaySettingsFromErp().then(erpSettings => {
      if (erpSettings) {
        setSettings(prev => {
          const clientPrev = prev.client || defaultMap.client;
          return {
            ...prev,
            client: {
              ...clientPrev,
              show_stock: erpSettings.show_free_stock ?? clientPrev.show_stock,
              show_reserve: erpSettings.show_reserved_stock ?? clientPrev.show_reserve,
              show_total_pcs: erpSettings.show_total_stock ?? clientPrev.show_total_pcs,
              show_price: erpSettings.show_prices ?? clientPrev.show_price,
              show_sqm: erpSettings.show_price_per_sqm ?? clientPrev.show_sqm,
              show_showroom_warehouse: erpSettings.show_dealer_showroom ?? clientPrev.show_showroom_warehouse,
            },
          };
        });
      }
    }).catch(() => {});
  }, []);

  const filteredClients = useMemo(() => {
    if (!clientSearch.trim()) return clients;
    const q = clientSearch.toLowerCase().trim();
    return clients.filter(c =>
      (c.full_name || '').toLowerCase().includes(q) ||
      (c.company_name || '').toLowerCase().includes(q) ||
      (c.partner_id || '').toLowerCase().includes(q) ||
      (c.phone || '').toLowerCase().includes(q)
    );
  }, [clients, clientSearch]);

  const toggle = (role: string, field: keyof DisplaySettings) => {
    setSettings(prev => ({
      ...prev,
      [role]: { ...prev[role], [field]: !prev[role]?.[field] },
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);

    // 1. Сохраняем глобальные настройки в ERP (action=display_settings)
    const clientSettings = settings['client'];
    if (clientSettings) {
      try {
        await saveDisplaySettingsToErp({
          show_free_stock: clientSettings.show_stock,
          show_reserved_stock: clientSettings.show_reserve,
          show_to_ship_stock: clientSettings.show_total_pcs,
          show_total_stock: clientSettings.show_total_pcs,
          show_prices: clientSettings.show_price,
          show_price_per_sqm: clientSettings.show_sqm,
          show_discounts: true,
          show_dealer_showroom: clientSettings.show_showroom_warehouse !== false,
          allow_orders_when_zero_stock: false,
        });
      } catch (err) {
        console.warn('[AdminDisplaySettings] Save to ERP warning:', err);
      }
    }

    // 2. Сохраняем локально и оповещаем компоненты
    if (typeof window !== 'undefined') {
      localStorage.setItem('synergy:display_settings', JSON.stringify(settings));
    }
    triggerDisplaySettingsReload();
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  const columns = [
    { key: 'show_stock' as const, label: 'Остаток' },
    { key: 'show_reserve' as const, label: 'Резерв' },
    { key: 'show_total_pcs' as const, label: 'Всего шт.' },
    { key: 'show_sqm' as const, label: 'М²' },
    { key: 'show_price' as const, label: 'Цена' },
    { key: 'show_hub_warehouse' as const, label: 'Склад Астана' },
    { key: 'show_showroom_warehouse' as const, label: 'Свой склад' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Eye className="h-5 w-5 text-slate-500" />
        <div>
          <h2 className="text-lg font-bold text-slate-900">Видимость данных и складов</h2>
          <p className="text-sm text-slate-500">Настройте, что видит каждая роль в каталоге, карточках товаров и сетке остатков</p>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="py-3 px-4 text-left font-semibold text-slate-700">Роль</th>
                {columns.map(c => (
                  <th key={c.key} className="py-3 px-3 text-center font-semibold text-slate-700">{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {roles.map(role => (
                <tr key={role} className="hover:bg-slate-25">
                  <td className="py-3 px-4">
                    <span className={`badge ${roleColor(role)}`}>{roleName(role)}</span>
                  </td>
                  {columns.map(c => (
                    <td key={c.key} className="py-3 px-3 text-center">
                      <button
                        onClick={() => toggle(role, c.key)}
                        className={`h-5 w-5 rounded border transition-colors inline-flex items-center justify-center ${
                          settings[role]?.[c.key] !== false ? 'bg-brand-600 border-brand-600' : 'bg-white border-slate-300'
                        }`}
                      >
                        {settings[role]?.[c.key] !== false && (
                          <svg className="h-3 w-3 text-white" viewBox="0 0 12 12" fill="none">
                            <path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </button>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="border-t border-slate-100 px-4 py-3 flex items-center gap-3">
          <button onClick={handleSave} disabled={saving} className="btn-primary text-sm">
            {saving ? 'Сохранение...' : 'Сохранить настройки'}
          </button>
          {saved && (
            <span className="text-xs text-emerald-600 font-medium flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4" />
              Настройки сохранены и немедленно применены!
            </span>
          )}
        </div>
      </div>

      {/* Информационный блок правил складов */}
      <div className="card p-5 space-y-3">
        <div className="flex items-center gap-2 text-slate-900 font-bold text-sm">
          <Building2 className="h-4 w-4 text-brand-700" />
          <span>Правила распределения видимости складов:</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-3 text-xs text-slate-600">
          <div className="p-3 rounded-lg bg-emerald-50/60 border border-emerald-100">
            <p className="font-bold text-emerald-900 mb-1">1. Свой склад (Шоурум)</p>
            <p>Подтягивается автоматически из ERP для авторизованного дилера. Если своего склада нет — отображается только центральный склад.</p>
          </div>
          <div className="p-3 rounded-lg bg-blue-50/60 border border-blue-100">
            <p className="font-bold text-blue-900 mb-1">2. Центральный склад Астана</p>
            <p>Основной склад компании (ID 81). Доступен клиентам по умолчанию для добавления в корзину и отгрузок.</p>
          </div>
          <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
            <p className="font-bold text-slate-800 mb-1">3. Управление админом</p>
            <p>В любой момент администратор может индивидуально скрыть или включить видимость складов для любого клиента во вкладке «Мои клиенты» по кнопке «Склады» или ниже.</p>
          </div>
        </div>
      </div>

      {/* Быстрая настройка складов по клиентам прямо из вкладки Видимость */}
      <div className="card p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-slate-900 font-bold text-sm">
            <Users className="h-4 w-4 text-brand-700" />
            <span>Индивидуальная настройка складов для клиентов</span>
          </div>
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              value={clientSearch}
              onChange={e => setClientSearch(e.target.value)}
              placeholder="Поиск клиента..."
              className="input-field pl-9 py-1 text-xs"
            />
          </div>
        </div>

        <p className="text-xs text-slate-500">
          Нажмите «Настроить» напротив клиента, чтобы включить/отключить видимость центрального склада Астана или персонального склада шоурума:
        </p>

        <div className="divide-y divide-slate-100 max-h-64 overflow-y-auto pr-1">
          {filteredClients.slice(0, 10).map(c => {
            const s = getClientWarehouseSettings(c.partner_id || c.id);
            const isCustom = s.mode === 'custom';
            return (
              <div key={c.id} className="py-2.5 flex items-center justify-between gap-3 hover:bg-slate-25 px-2 rounded-lg transition-colors">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-bold text-slate-900 truncate">{c.company_name || c.full_name}</p>
                    {isCustom ? (
                      <span className="badge bg-amber-50 text-amber-700 border border-amber-200 text-[10px]">
                        ⚙️ Ручной режим
                      </span>
                    ) : (
                      <span className="badge bg-emerald-50 text-emerald-700 text-[10px]">
                        🏢 Авто-режим
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-400">
                    ID: {c.partner_id || c.id} • {c.phone || 'без телефона'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setQuickModalClient(c)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-colors shadow-2xs cursor-pointer shrink-0"
                >
                  Настроить
                </button>
              </div>
            );
          })}
          {filteredClients.length === 0 && (
            <p className="py-4 text-center text-xs text-slate-400">Клиенты не найдены</p>
          )}
        </div>
      </div>

      {quickModalClient && (
        <ClientWarehouseModal
          client={quickModalClient}
          onClose={() => setQuickModalClient(null)}
        />
      )}
    </div>
  );
}

/* ─── Client Warehouse Visibility Management Modal ─── */
function ClientWarehouseModal({
  client,
  onClose,
}: {
  client: {
    id: string;
    full_name: string;
    company_name: string;
    phone: string;
    partner_id: string | null;
    showroom_warehouse_id?: number | null;
    showroom_warehouse_name?: string | null;
  };
  onClose: () => void;
}) {
  const clientId = client.partner_id || client.id;
  const initialSettings = useMemo(() => getClientWarehouseSettings(clientId), [clientId]);

  const [mode, setMode] = useState<'auto' | 'custom'>(initialSettings.mode || 'auto');
  const [showCentral, setShowCentral] = useState<boolean>(initialSettings.showCentralWarehouse !== false);
  const [showShowroom, setShowShowroom] = useState<boolean>(initialSettings.showShowroomWarehouse !== false);
  const [saved, setSaved] = useState(false);

  const showroomId = client.showroom_warehouse_id;
  const showroomName = client.showroom_warehouse_name || (showroomId ? `Склад шоурума (ID: ${showroomId})` : null);

  const handleSave = () => {
    saveClientWarehouseSettings(clientId, {
      mode,
      showCentralWarehouse: showCentral,
      showShowroomWarehouse: showShowroom,
    });
    setSaved(true);
    setTimeout(() => {
      setSaved(false);
      onClose();
    }, 700);
  };

  const handleResetToAuto = () => {
    resetClientWarehouseSettings(clientId);
    setMode('auto');
    setShowCentral(true);
    setShowShowroom(true);
    setSaved(true);
    setTimeout(() => {
      setSaved(false);
      onClose();
    }, 700);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="relative w-full max-w-lg rounded-2xl bg-white shadow-2xl border border-slate-100 p-6 space-y-5" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-700 shrink-0">
              <Building2 className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 leading-snug">Видимость складов для клиента</h3>
              <p className="text-xs text-slate-500 font-medium">
                {client.company_name || client.full_name} {client.partner_id ? `(ID: ${client.partner_id})` : ''}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Mode switcher tabs */}
        <div className="flex rounded-xl bg-slate-100 p-1 text-xs font-semibold">
          <button
            type="button"
            onClick={() => setMode('auto')}
            className={`flex-1 py-2 rounded-lg transition-all cursor-pointer ${
              mode === 'auto'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Автоматический режим
          </button>
          <button
            type="button"
            onClick={() => setMode('custom')}
            className={`flex-1 py-2 rounded-lg transition-all cursor-pointer ${
              mode === 'custom'
                ? 'bg-white text-brand-700 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Индивидуальная настройка
          </button>
        </div>

        {/* Mode content */}
        {mode === 'auto' ? (
          <div className="rounded-xl bg-emerald-50/60 border border-emerald-100/80 p-4 space-y-2.5 text-xs text-emerald-950">
            <p className="font-semibold text-emerald-900 flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              Стандартное автоматическое правило:
            </p>
            <ul className="space-y-1.5 pl-5 list-disc text-emerald-800">
              <li>
                <strong>Центральный склад («Основной Склад Астана», ID 81)</strong>: виден клиенту по умолчанию.
              </li>
              <li>
                <strong>Свой персональный склад</strong>:{' '}
                {showroomId ? (
                  <span className="text-emerald-900 font-semibold">{showroomName} (виден клиенту)</span>
                ) : (
                  <span className="text-slate-600 italic">не назначен (клиент видит только центральный склад Астана)</span>
                )}
              </li>
              <li>
                <span className="text-slate-600">Все чужие партнерские склады других городов автоматически скрыты.</span>
              </li>
            </ul>
            <p className="text-[11px] text-emerald-700/80 pt-1">
              Чтобы скрыть склад Астана или персональный склад для этого клиента, выберите «Индивидуальная настройка».
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-slate-500">
              Переключайте видимость складов для данного клиента:
            </p>

            {/* Warehouse 1: Central Astana */}
            <div className="card p-3.5 flex items-center justify-between gap-3 border-slate-200">
              <div className="flex items-center gap-3">
                <div className={`flex h-9 w-9 items-center justify-center rounded-lg shrink-0 ${showCentral ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-400'}`}>
                  <Building2 className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-900">Основной Склад Астана (ID: 81)</p>
                  <p className="text-[11px] text-slate-500">Центральный склад компании для оптовых поставок</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowCentral(v => !v)}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  showCentral ? 'bg-brand-600' : 'bg-slate-200'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    showCentral ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {/* Warehouse 2: Own showroom */}
            <div className={`card p-3.5 flex items-center justify-between gap-3 border-slate-200 ${!showroomId ? 'opacity-60 bg-slate-50' : ''}`}>
              <div className="flex items-center gap-3">
                <div className={`flex h-9 w-9 items-center justify-center rounded-lg shrink-0 ${showShowroom && showroomId ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-400'}`}>
                  <Boxes className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-900">
                    {showroomName || 'Собственный склад шоурума'}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {showroomId
                      ? `Персональный склад дилера (ID: ${showroomId})`
                      : 'У данного клиента нет закреплённого склада в ERP'}
                  </p>
                </div>
              </div>
              {showroomId ? (
                <button
                  type="button"
                  onClick={() => setShowShowroom(v => !v)}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                    showShowroom ? 'bg-brand-600' : 'bg-slate-200'
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      showShowroom ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              ) : (
                <span className="text-[10px] text-slate-400 font-medium bg-slate-100 px-2 py-1 rounded">Не назначен</span>
              )}
            </div>
          </div>
        )}

        {/* Footer actions */}
        <div className="border-t border-slate-100 pt-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            {mode === 'custom' && (
              <button
                type="button"
                onClick={handleResetToAuto}
                className="text-xs font-medium text-slate-500 hover:text-brand-700 hover:underline transition-colors cursor-pointer"
              >
                Сбросить на авто-режим
              </button>
            )}
          </div>
          <div className="flex items-center gap-2 ml-auto">
            {saved && (
              <span className="text-xs text-emerald-600 font-semibold flex items-center gap-1 animate-in fade-in">
                <Check className="h-4 w-4" /> Сохранено!
              </span>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
            >
              Отмена
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="btn-primary text-xs px-4 py-2 cursor-pointer"
            >
              Сохранить
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Admin: Users Tab ─── */
function AdminUsersTab({ onNavigate }: { onNavigate: (page: PageId) => void }) {
  const { impersonateUser, user: currentUser, profile: currentProfile, realIsAdmin } = useAuth();
  const managerId = currentUser?.id;
  const isAdminView = realIsAdmin;
  const [users, setUsers] = useState<Array<{
    id: string;
    full_name: string;
    company_name: string;
    phone: string;
    role: UserRole;
    partner_id: string | null;
    price_type: string;
    manager_id: string | null;
    impersonation_enabled: boolean;
    portal_access_enabled?: boolean;
    showroom_warehouse_id?: number | null;
    showroom_warehouse_name?: string | null;
  }>>([]);
  const [userSearch, setUserSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [warehouseModalUser, setWarehouseModalUser] = useState<typeof users[0] | null>(null);
  const [warehouseVersion, setWarehouseVersion] = useState(0);

  useEffect(() => {
    const handler = () => setWarehouseVersion(v => v + 1);
    window.addEventListener('synergy:reload-warehouse-settings', handler);
    return () => window.removeEventListener('synergy:reload-warehouse-settings', handler);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadUsers() {
      setLoading(true);
      // 1. Приоритет: реальные контрагенты из Synergy ERP
      try {
        const cpData = await fetchCounterpartiesFromErp({ limit: 300 });
        if (!cancelled && cpData && cpData.success && Array.isArray(cpData.counterparties) && cpData.counterparties.length > 0) {
          const mappedUsers = cpData.counterparties.map((cp) => {
            const isAccessOn = cp.portal_access_enabled !== 0 && cp.is_active !== 0 && cp.status !== 'inactive' && cp.access !== 'disabled';
            return {
              id: String(cp.id),
              full_name: cp.name,
              company_name: cp.name,
              phone: cp.phone || '',
              role: 'client' as UserRole,
              partner_id: String(cp.id),
              price_type: cp.cooperation_type === 'комиссия' ? 'commission' : 'wholesale',
              manager_id: String(cp.manager_id || ''),
              portal_access_enabled: isAccessOn,
              impersonation_enabled: isAccessOn,
              showroom_warehouse_id: cp.showroom_warehouse_id ?? cp.warehouse_id ?? (cp.id === 2833 ? 2833 : null),
              showroom_warehouse_name: cp.showroom_warehouse_name ?? cp.warehouse_name ?? (cp.id === 2833 ? 'Aya Home Store (Шымкент)' : null),
            };
          });
          setUsers(mappedUsers);
          setLoading(false);
          return;
        }
      } catch (cpErr) {
        console.warn('[AdminUsersTab] ERP counterparties fallback:', cpErr);
      }

      // 2. Резервный источник: Supabase
      try {
        const { data } = await supabase
          .from('profiles')
          .select('id, full_name, company_name, phone, role, partner_id, price_type, manager_id, impersonation_enabled, showroom_warehouse_id, showroom_warehouse_name')
          .order('created_at', { ascending: false });
        if (!cancelled && data) {
          setUsers(data.map((u: any) => ({
            ...u,
            portal_access_enabled: u.impersonation_enabled !== false,
          })));
        }
      } catch (err) {
        console.warn('[AdminUsersTab] Supabase error:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadUsers();
    return () => { cancelled = true; };
  }, []);

  const handleToggleAccess = async (userId: string, currentEnabled: boolean) => {
    setTogglingId(userId);
    const newStatus = !currentEnabled;
    try {
      // 1. Отправляем в ERP action=update_client_access
      await updateClientAccessInErp(userId, newStatus ? 1 : 0);
      if (!newStatus) {
        broadcastClientDeactivated(userId);
      }

      // 2. Обновляем локальное состояние и Supabase
      setUsers(prev => prev.map(u => u.id === userId ? {
        ...u,
        portal_access_enabled: newStatus,
        impersonation_enabled: newStatus,
      } : u));

      try {
        await supabase
          .from('profiles')
          .update({ impersonation_enabled: newStatus })
          .eq('id', userId);
      } catch {
        // safe fallback
      }
    } catch (err: any) {
      alert(`Ошибка обновления доступа в ERP: ${err.message}`);
    } finally {
      setTogglingId(null);
    }
  };

  const filteredUsers = useMemo(() => {
    let clients = users.filter(user => user.role === 'client');
    if (!isAdminView && managerId) {
      clients = clients.filter(user => user.manager_id === managerId);
    }
    if (!userSearch.trim()) return clients;
    const q = userSearch.toLowerCase().trim();
    return clients.filter(user =>
      (user.full_name || '').toLowerCase().includes(q) ||
      (user.company_name || '').toLowerCase().includes(q) ||
      (user.phone || '').toLowerCase().includes(q) ||
      (user.partner_id || '').toLowerCase().includes(q)
    );
  }, [users, userSearch, isAdminView, managerId]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Users className="h-5 w-5 text-slate-500" />
          <div>
            <h2 className="text-lg font-bold text-slate-900">Мои клиенты ({filteredUsers.length})</h2>
            <p className="text-sm text-slate-500">
              {isAdminView
                ? 'Все клиенты портала. Включите доступ и зайдите под клиентом.'
                : 'Клиенты, закреплённые за вами. Включите доступ и зайдите под клиентом.'}
            </p>
          </div>
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            value={userSearch}
            onChange={e => setUserSearch(e.target.value)}
            placeholder="Поиск по имени, компании..."
            className="input-field pl-9 py-1 text-xs"
          />
        </div>
      </div>

      <div className="space-y-2">
        {filteredUsers.map(u => (
          <div key={u.id} className="space-y-0">
            <div className="card px-4 py-3 flex flex-wrap items-center gap-3 hover:border-slate-300 transition-colors">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 shrink-0">
                <User className="h-5 w-5 text-slate-500" />
              </div>
              <div className="flex-1 min-w-[180px]">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-slate-900 truncate">{u.full_name || 'Без имени'}</p>
                  {u.id === currentUser?.id && (
                    <span className="badge bg-slate-100 text-slate-600 text-[10px]">Вы</span>
                  )}
                </div>
                <p className="text-xs text-slate-500 truncate">{u.company_name || 'Компания не указана'}</p>
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400 mt-0.5">
                  {u.phone && <span className="font-mono">{u.phone}</span>}
                  {u.price_type && <span className="text-brand-600 font-medium">Прайс: {u.price_type}</span>}
                  {u.partner_id && <span className="font-mono">ID: {u.partner_id}</span>}
                  {(() => {
                    const s = getClientWarehouseSettings(u.partner_id || u.id);
                    if (s.mode === 'custom') {
                      const count = (s.showCentralWarehouse ? 1 : 0) + (s.showShowroomWarehouse && u.showroom_warehouse_id ? 1 : 0);
                      return (
                        <span className="badge bg-amber-50 text-amber-700 border border-amber-200 text-[10px]" title="Настроено индивидуально администратором">
                          ⚙️ Склады: индив. ({count})
                        </span>
                      );
                    }
                    if (u.showroom_warehouse_id) {
                      return (
                        <span className="badge bg-emerald-50 text-emerald-700 text-[10px]" title="Автоматический режим: склад Астана + собственный склад">
                          🏢 Склады: Астана + Шоурум
                        </span>
                      );
                    }
                    return (
                      <span className="badge bg-slate-100 text-slate-600 text-[10px]" title="Автоматический режим: только склад Астана">
                        🏢 Склады: Только Астана
                      </span>
                    );
                  })()}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setWarehouseModalUser(u)}
                  className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-colors shadow-xs cursor-pointer"
                  title="Настроить видимость складов для этого клиента"
                >
                  <Building2 className="h-3.5 w-3.5 text-slate-500" />
                  Склады
                </button>

                <button
                  onClick={() => handleToggleAccess(u.id, u.portal_access_enabled ?? u.impersonation_enabled)}
                  disabled={togglingId === u.id}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                    (u.portal_access_enabled ?? u.impersonation_enabled)
                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100'
                      : 'bg-rose-50 text-rose-600 border border-rose-200 hover:bg-rose-100'
                  }`}
                  title={(u.portal_access_enabled ?? u.impersonation_enabled) ? 'Доступ к сайту открыт. Нажмите, чтобы заблокировать.' : 'Доступ заблокирован в ERP (CLIENT_DEACTIVATED). Нажмите, чтобы открыть доступ.'}
                >
                  <Power className="h-3.5 w-3.5" />
                  {togglingId === u.id ? 'Синхронизация...' : ((u.portal_access_enabled ?? u.impersonation_enabled) ? 'Доступ вкл.' : 'Доступ выкл.')}
                </button>

                <button
                  onClick={() => setExpandedId(expandedId === u.id ? null : u.id)}
                  className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  <FileText className="h-3.5 w-3.5" />
                  Демо
                  <ChevronDown className={`h-3 w-3 transition-transform ${expandedId === u.id ? 'rotate-180' : ''}`} />
                </button>

                <button
                  onClick={() => {
                    impersonateUser(u as any);
                    onNavigate('catalog');
                  }}
                  disabled={!u.impersonation_enabled || u.id === currentUser?.id}
                  title={!u.impersonation_enabled ? 'Сначала включите доступ для этого клиента' : `Войти как ${u.full_name || u.company_name || 'клиент'}`}
                  className="flex items-center gap-1.5 rounded-lg border border-brand-200 bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-700 hover:bg-brand-100 hover:border-brand-300 transition-colors disabled:opacity-40 disabled:pointer-events-none shadow-sm cursor-pointer"
                >
                  <UserCog className="h-3.5 w-3.5" />
                  Войти под клиентом
                </button>
              </div>
            </div>

            {expandedId === u.id && (
              <ClientDemoPanel client={u} />
            )}
          </div>
        ))}
        {!loading && filteredUsers.length === 0 && (
          <p className="py-8 text-center text-sm text-slate-400">Клиенты не найдены</p>
        )}
      </div>

      {warehouseModalUser && (
        <ClientWarehouseModal
          client={warehouseModalUser}
          onClose={() => setWarehouseModalUser(null)}
        />
      )}
    </div>
  );
}

/* ─── Client Demo Panel (orders + debt preview) ─── */
function ClientDemoPanel({ client }: { client: { id: string; full_name: string; company_name: string; phone: string; partner_id: string | null; price_type: string } }) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(true);
  const [debt, setDebt] = useState<ClientDebtReport | null>(null);
  const [loadingDebt, setLoadingDebt] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadingOrders(true);

    async function loadClientOrders() {
      // 1. Приоритет: заказы клиента из ERP
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
                productName: it.name || 'Ковер',
                collection: it.name.split(' ')[0] || 'Коллекция',
                size: it.size || 'Стандарт',
                sku: it.sku || '',
                warehouse: o.warehouse_name || 'Основной склад',
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
  }, [client.id]);

  if (selectedOrder) {
    return (
      <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50/50 p-4">
        <div className="flex items-center gap-2 mb-4">
          <button onClick={() => setSelectedOrder(null)} className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50">
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
                    className="w-full text-left rounded-lg bg-white border border-slate-100 px-3 py-2 hover:border-brand-300 hover:shadow-sm transition-all"
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
                  ${debt.financials.total_debt_usd.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-500">Оплачено</span>
                <span className="text-sm font-bold text-emerald-600">
                  ${debt.financials.total_paid_usd.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-500">Просрочено</span>
                <span className="text-sm font-bold text-amber-600">
                  ${debt.financials.overdue_usd.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </span>
              </div>
              {debt.financials.is_overdue && (
                <div className="flex items-center gap-1.5 rounded-md bg-red-50 px-2 py-1 text-[11px] text-red-700">
                  <AlertTriangle className="h-3 w-3" />
                  Просрочка {debt.financials.max_overdue_days} дн.
                </div>
              )}
              {debt.client?.credit_limit_usd && (
                <div className="border-t border-slate-100 pt-2 text-[11px] text-slate-400">
                  Лимит: ${debt.client.credit_limit_usd.toLocaleString('en-US')} • Отсрочка: {debt.client.payment_delay_days} дн.
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

/* ─── Admin: ERP Sync & Diagnostics Tab ─── */
function AdminErpSyncTab() {
  const [report, setReport] = useState<ErpSyncReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [activeSubTab, setActiveSubTab] = useState<'catalog' | 'counterparties' | 'managers' | 'raw'>('catalog');

  const runSync = async () => {
    setLoading(true);
    setError(null);
    try {
      const rep = await syncAllErpData();
      setReport(rep);
      triggerCatalogReload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Неизвестная ошибка синхронизации');
    } finally {
      setLoading(false);
      setInitialLoading(false);
    }
  };

  useEffect(() => {
    runSync();
  }, []);

  const handleCopyJson = () => {
    if (!report) return;
    navigator.clipboard.writeText(JSON.stringify(report, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const products = report?.catalog?.products || [];
  const counterparties = report?.counterparties?.counterparties || [];
  const managers = report?.regionalManagers?.managers || [];

  return (
    <div className="space-y-6">
      {/* Header & Force Sync button */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
            <RefreshCw className={`h-5 w-5 ${loading ? 'animate-spin' : ''}`} />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900">Обмен данными с ERP</h2>
            <p className="text-xs text-slate-500">Диагностика шлюза, остатки и принудительная синхронизация</p>
          </div>
        </div>

        <button
          onClick={runSync}
          disabled={loading}
          className="btn-primary flex items-center justify-center gap-2 text-xs py-2 px-4 shadow-sm"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          {loading ? 'Синхронизация...' : 'Принудительно обновить'}
        </button>
      </div>

      {/* Gateway Health & Status Banner */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {/* Status card */}
        <div className="card p-4 flex items-center gap-3">
          <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${report?.ping?.success ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}`}>
            <Activity className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] uppercase font-semibold text-slate-400">Статус шлюза</p>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className={`inline-block h-2 w-2 rounded-full ${report?.ping?.success ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
              <p className="text-xs font-bold text-slate-800">
                {report?.ping?.success ? 'В сети (Online)' : error ? 'Ошибка связи' : 'Проверка...'}
              </p>
            </div>
            {report?.ping?.latencyMs !== undefined && (
              <p className="text-[10px] text-slate-400 mt-0.5">Задержка: {report.ping.latencyMs} мс</p>
            )}
          </div>
        </div>

        {/* Server Time card */}
        <div className="card p-4 flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600">
            <Clock className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] uppercase font-semibold text-slate-400">Время на ERP</p>
            <p className="text-xs font-bold text-slate-800 truncate mt-0.5">
              {report?.ping?.server_time || '—'}
            </p>
            <p className="text-[10px] text-slate-400 mt-0.5">Версия API: {report?.ping?.version || '1.0.0'}</p>
          </div>
        </div>

        {/* Last Sync card */}
        <div className="card p-4 flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600">
            <CheckCircle2 className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] uppercase font-semibold text-slate-400">Последний обмен</p>
            <p className="text-xs font-bold text-slate-800 mt-0.5">
              {report?.timestamp ? `${report.timestamp}` : '—'}
            </p>
            <p className="text-[10px] text-emerald-600 mt-0.5 font-medium">Кэш каталога обновлён</p>
          </div>
        </div>

        {/* API Endpoint card */}
        <div className="card p-4 flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-purple-50 text-purple-600">
            <Server className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] uppercase font-semibold text-slate-400">Адрес шлюза</p>
            <p className="text-[11px] font-mono font-medium text-slate-700 truncate mt-0.5" title={ERP_API_URL}>
              kilem-khan.kz/.../api_portal
            </p>
            <span className="badge bg-purple-50 text-purple-700 text-[9px] mt-0.5">X-Portal-Key активен</span>
          </div>
        </div>
      </div>

      {/* Error alert if any */}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
          <div>
            <h4 className="text-sm font-bold text-red-800">Ошибка обмена с сервером ERP</h4>
            <p className="text-xs text-red-700 mt-1">{error}</p>
          </div>
        </div>
      )}

      {/* Summary KPI Badges */}
      {report && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <div className="card px-3 py-2.5 text-center">
            <p className="text-[10px] uppercase font-semibold text-slate-400">Товары (ERP)</p>
            <p className="text-lg font-bold text-slate-900 mt-0.5">{report.totalProducts} поз.</p>
          </div>
          <div className="card px-3 py-2.5 text-center">
            <p className="text-[10px] uppercase font-semibold text-slate-400">В наличии</p>
            <p className="text-lg font-bold text-emerald-600 mt-0.5">{report.totalStockPcs} шт.</p>
          </div>
          <div className="card px-3 py-2.5 text-center">
            <p className="text-[10px] uppercase font-semibold text-slate-400">Склады в ERP</p>
            <p className="text-lg font-bold text-slate-900 mt-0.5">{report.cities.length}</p>
          </div>
          <div className="card px-3 py-2.5 text-center">
            <p className="text-[10px] uppercase font-semibold text-slate-400">Контрагенты</p>
            <p className="text-lg font-bold text-slate-900 mt-0.5">{report.totalCounterparties}</p>
          </div>
          <div className="card px-3 py-2.5 text-center">
            <p className="text-[10px] uppercase font-semibold text-slate-400">Менеджеры</p>
            <p className="text-lg font-bold text-slate-900 mt-0.5">{report.totalManagers}</p>
          </div>
        </div>
      )}

      {/* Warnings Banner if any */}
      {report && report.warnings.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <h4 className="text-xs font-bold text-amber-900">Замечания по данным ({report.warnings.length}):</h4>
          </div>
          <ul className="space-y-1 text-xs text-amber-800 list-disc list-inside">
            {report.warnings.map((w, idx) => (
              <li key={idx}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Sub-tabs navigation */}
      <div className="border-b border-slate-200 flex items-center justify-between gap-2 overflow-x-auto">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveSubTab('catalog')}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border-b-2 -mb-px transition-colors whitespace-nowrap ${
              activeSubTab === 'catalog'
                ? 'border-brand-600 text-brand-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Boxes className="h-3.5 w-3.5" />
            Каталог и остатки ({products.length})
          </button>
          <button
            onClick={() => setActiveSubTab('counterparties')}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border-b-2 -mb-px transition-colors whitespace-nowrap ${
              activeSubTab === 'counterparties'
                ? 'border-brand-600 text-brand-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Building2 className="h-3.5 w-3.5" />
            Контрагенты ({counterparties.length})
          </button>
          <button
            onClick={() => setActiveSubTab('managers')}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border-b-2 -mb-px transition-colors whitespace-nowrap ${
              activeSubTab === 'managers'
                ? 'border-brand-600 text-brand-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Users className="h-3.5 w-3.5" />
            Менеджеры ({managers.length})
          </button>
          <button
            onClick={() => setActiveSubTab('raw')}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border-b-2 -mb-px transition-colors whitespace-nowrap ${
              activeSubTab === 'raw'
                ? 'border-brand-600 text-brand-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <FileJson className="h-3.5 w-3.5" />
            Сырой JSON
          </button>
        </div>

        {activeSubTab === 'raw' && (
          <button
            onClick={handleCopyJson}
            className="flex items-center gap-1 text-xs text-brand-700 hover:text-brand-800 font-medium px-2 py-1 rounded bg-brand-50"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? 'Скопировано!' : 'Копировать JSON'}
          </button>
        )}
      </div>

      {/* Subtab Contents */}
      {initialLoading ? (
        <div className="py-16 text-center">
          <RefreshCw className="h-8 w-8 animate-spin text-brand-600 mx-auto mb-3" />
          <p className="text-sm font-medium text-slate-600">Опрос шлюза Synergy ERP...</p>
        </div>
      ) : (
        <div>
          {/* CATALOG SUBTAB */}
          {activeSubTab === 'catalog' && (
            <div className="space-y-3">
              {products.map((p: any) => {
                const totalStock = (p.variants || []).reduce((acc: number, v: any) => {
                  return acc + (v.warehouses || []).reduce((s: number, w: any) => s + (w.stock || 0), 0);
                }, 0);

                return (
                  <div key={p.id} className="card p-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
                      <div className="flex items-center gap-2">
                        <span className="badge font-mono text-[10px]">ID {p.id}</span>
                        <h4 className="text-sm font-bold text-slate-900">{p.name}</h4>
                        <span className="badge bg-slate-100 text-slate-600 text-[10px]">{p.collection}</span>
                        <span className="text-xs text-slate-400">({p.manufacturer})</span>
                      </div>
                      <span className={`badge ${totalStock > 0 ? 'bg-emerald-50 text-emerald-700 font-semibold' : 'bg-slate-100 text-slate-400'}`}>
                        Остаток: {totalStock} шт.
                      </span>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-slate-50 text-slate-500 font-semibold">
                            <th className="py-1.5 px-3 text-left">Размер</th>
                            <th className="py-1.5 px-3 text-left">SKU</th>
                            <th className="py-1.5 px-3 text-left">Базовая цена</th>
                            <th className="py-1.5 px-3 text-left">Склады с наличием</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {(p.variants || []).map((v: any) => {
                            const inStockWh = (v.warehouses || []).filter((w: any) => (w.stock || 0) > 0);
                            const vStock = inStockWh.reduce((s: number, w: any) => s + w.stock, 0);

                            return (
                              <tr key={v.sku} className="hover:bg-slate-25">
                                <td className="py-1.5 px-3 font-semibold text-slate-800">{v.size}</td>
                                <td className="py-1.5 px-3 font-mono text-slate-500">{v.sku}</td>
                                <td className="py-1.5 px-3 text-slate-700">${v.base_price}</td>
                                <td className="py-1.5 px-3">
                                  {vStock > 0 ? (
                                    <div className="flex flex-wrap gap-1.5">
                                      {inStockWh.map((w: any) => (
                                        <span key={w.city} className="badge bg-emerald-50 text-emerald-700 text-[10px]">
                                          {w.city}: {w.stock} шт.
                                        </span>
                                      ))}
                                    </div>
                                  ) : (
                                    <span className="text-slate-300">Нет на складах</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
              {products.length === 0 && (
                <p className="py-8 text-center text-xs text-slate-400">Товары в ERP не найдены</p>
              )}
            </div>
          )}

          {/* COUNTERPARTIES SUBTAB */}
          {activeSubTab === 'counterparties' && (
            <div className="card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                      <th className="py-2.5 px-3 text-left">ID</th>
                      <th className="py-2.5 px-3 text-left">Контрагент</th>
                      <th className="py-2.5 px-3 text-left">Город</th>
                      <th className="py-2.5 px-3 text-left">Телефон</th>
                      <th className="py-2.5 px-3 text-left">Региональный менеджер (РМ)</th>
                      <th className="py-2.5 px-3 text-left">Тип цены по договору</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {counterparties.map((c: any) => {
                      const contract = (c.contracts || [])[0];
                      return (
                        <tr key={c.id} className="hover:bg-slate-25">
                          <td className="py-2 px-3 font-mono text-slate-400">#{c.id}</td>
                          <td className="py-2 px-3 font-semibold text-slate-800">{c.name}</td>
                          <td className="py-2 px-3 text-slate-600">{c.city || '—'}</td>
                          <td className="py-2 px-3 text-slate-600 font-mono">{c.phone || '—'}</td>
                          <td className="py-2 px-3">
                            {c.regional_manager ? (
                              <div>
                                <span className="font-medium text-slate-800">{c.regional_manager.name}</span>
                                {c.regional_manager.phone && (
                                  <span className="text-[10px] text-slate-400 block">{c.regional_manager.phone}</span>
                                )}
                              </div>
                            ) : (
                              <span className="text-slate-300">Не привязан</span>
                            )}
                          </td>
                          <td className="py-2 px-3">
                            <span className="badge bg-brand-50 text-brand-700 font-mono text-[10px]">
                              {contract?.price_type || 'standard'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* MANAGERS SUBTAB */}
          {activeSubTab === 'managers' && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {managers.map((m: any) => (
                <div key={m.id} className="card p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="badge font-mono text-[10px]">ID {m.id}</span>
                    <span className={`badge ${m.role === 'admin' ? 'bg-red-50 text-red-700' : m.role === 'rm' ? 'bg-blue-50 text-blue-700' : 'bg-emerald-50 text-emerald-700'}`}>
                      {m.role_title}
                    </span>
                  </div>
                  <h4 className="text-sm font-bold text-slate-900">{m.name}</h4>
                  <p className="text-xs text-slate-500 font-mono">Тел: {m.phone || 'Не указан'}</p>
                </div>
              ))}
            </div>
          )}

          {/* RAW JSON SUBTAB */}
          {activeSubTab === 'raw' && (
            <div className="card p-4 bg-slate-900 text-slate-100 rounded-xl overflow-x-auto max-h-[500px]">
              <pre className="text-[11px] font-mono leading-relaxed">
                {JSON.stringify(report, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ProfilePage({ onNavigate }: { onNavigate: (page: PageId) => void }) {
  const { user, profile, loading, signOut, isAdmin, realIsAdmin, isManager, isSupplier } = useAuth();
  const { addItem } = useCart();
  const adminAccess = realIsAdmin;
  const clientsAccess = realIsAdmin || isManager;
  const [activeTab, setActiveTab] = useState<TabId>(isSupplier ? 'supplier-portal' : 'orders');
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [clientDebt, setClientDebt] = useState<ClientDebtReport | null>(null);
  const [loadingDebt, setLoadingDebt] = useState<boolean>(false);
  const [repeatingOrderId, setRepeatingOrderId] = useState<string | null>(null);
  const [repeatResult, setRepeatResult] = useState<RepeatResult | null>(null);

  const handleRepeatOrder = async (order: Order) => {
    if (repeatingOrderId) return;
    setRepeatingOrderId(order.id);

    try {
      const clientId = profile?.partner_id
        ? Number(profile.partner_id)
        : (profile?.id && !isNaN(Number(profile.id)) ? Number(profile.id) : undefined);
      const catalogData = await fetchCatalogFromErp(clientId);
      const rawProducts: any[] = (catalogData && catalogData.success && Array.isArray(catalogData.products))
        ? catalogData.products
        : [];
      const erpProducts = mergeProducts(rawProducts);

      const added: RepeatResult['added'] = [];
      const missing: RepeatResult['missing'] = [];

      for (const item of order.items) {
        let foundProd: any;
        let foundVariant: any;

        // 1. Match by SKU or item id
        if (item.sku || item.id) {
          for (const p of erpProducts) {
            const v = p.variants?.find((vr: any) =>
              (item.sku && vr.sku === item.sku) ||
              (item.id && (String(vr.id) === String(item.id) || vr.sku === item.id))
            );
            if (v) {
              foundProd = p;
              foundVariant = v;
              break;
            }
          }
        }

        // 2. Match by collection and size
        if (!foundVariant && item.collection && item.size) {
          const itemCol = item.collection.toLowerCase().trim();
          const itemSize = item.size.replace(/\s+/g, '');
          for (const p of erpProducts) {
            if (p.collection && p.collection.toLowerCase().trim() === itemCol) {
              const v = p.variants?.find((vr: any) => vr.size.replace(/\s+/g, '') === itemSize);
              if (v) {
                foundProd = p;
                foundVariant = v;
                break;
              }
            }
          }
        }

        // 3. Fallback match by product name and size
        if (!foundVariant && item.productName) {
          const itemSize = (item.size || '').replace(/\s+/g, '');
          for (const p of erpProducts) {
            if (p.name && p.name.toLowerCase().includes(item.productName.toLowerCase())) {
              const v = p.variants?.find((vr: any) => !itemSize || vr.size.replace(/\s+/g, '') === itemSize);
              if (v) {
                foundProd = p;
                foundVariant = v;
                break;
              }
            }
          }
        }

        if (!foundVariant || !foundProd) {
          missing.push({
            name: item.productName || item.collection,
            size: item.size,
            requestedQty: item.quantity,
            reason: 'Товар отсутствует в текущем каталоге',
          });
          continue;
        }

        // Stock in Astana / main warehouse
        const wh = foundVariant.warehouses?.find((w: any) =>
          w.warehouse_id === 81 ||
          (w.city && w.city.toLowerCase().includes('астан')) ||
          (w.warehouse_name && (w.warehouse_name.toLowerCase().includes('астан') || w.warehouse_name.toLowerCase().includes('основной'))) ||
          w.is_hub
        );
        const stock = wh ? (wh.stock ?? 0) : (foundVariant.warehouses?.reduce((s: number, w: any) => s + (w.stock || 0), 0) ?? 0);

        if (stock <= 0) {
          missing.push({
            name: foundProd.name || item.productName,
            size: item.size,
            requestedQty: item.quantity,
            reason: 'Нет в наличии на складе в Астане',
          });
          continue;
        }

        const qtyToAdd = Math.min(item.quantity, stock);
        const prodImg = (foundProd.images && foundProd.images.length > 0) ? foundProd.images[0] : (foundProd.image_thumb || '');

        addItem({
          productId: foundProd.id,
          item_id: foundVariant.item_id || (Number(foundVariant.id) > 0 ? Number(foundVariant.id) : undefined),
          productName: foundProd.name,
          collection: foundProd.collection,
          image: prodImg,
          size: foundVariant.size,
          sku: foundVariant.sku,
          warehouse: wh?.warehouse_name || wh?.city || 'Основной Склад Астана',
          warehouse_id: wh?.warehouse_id || 81,
          price: item.price || foundVariant.price || foundVariant.base_price,
          price_per_sqm: foundVariant.price_per_sqm,
          area_sqm: foundVariant.area_sqm,
        }, qtyToAdd);

        added.push({
          name: foundProd.name,
          size: foundVariant.size,
          requestedQty: item.quantity,
          addedQty: qtyToAdd,
        });
      }

      setRepeatResult({
        orderNumber: order.orderNumber || order.id,
        added,
        missing,
      });
    } catch (err) {
      console.error('Failed to repeat order:', err);
      alert('Не удалось проверить остатки. Попробуйте еще раз.');
    } finally {
      setRepeatingOrderId(null);
    }
  };

  useEffect(() => {
    if (!profile || profile.role === 'supplier') return;
    let cancelled = false;
    setLoadingDebt(true);
    fetchClientDebtFromErp({
      phone: profile.phone,
      counterpartyId: (profile as any).erp_id ? Number((profile as any).erp_id) : undefined,
      search: profile.company_name || profile.full_name
    })
      .then(res => {
        if (!cancelled && res.success && res.found) {
          setClientDebt(res);
        }
      })
      .catch(err => console.warn('[ProfilePage] Debt load error:', err))
      .finally(() => {
        if (!cancelled) setLoadingDebt(false);
      });
    return () => { cancelled = true; };
  }, [profile]);

  if (loading) {
    return (
      <div className="min-h-screen pt-20 pb-24 lg:pb-8 flex items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
      </div>
    );
  }

  if (!user || !profile) {
    return (
      <div className="min-h-screen pt-20 pb-24 lg:pb-8">
        <div className="container-w flex flex-col items-center justify-center py-24 text-center">
          <User className="h-12 w-12 text-slate-300 mb-4" />
          <h1 className="font-display text-2xl font-bold text-slate-900 mb-2">Войдите в аккаунт</h1>
          <p className="text-slate-500 mb-6">Для доступа к личному кабинету необходимо авторизоваться</p>
          <button onClick={() => onNavigate('login')} className="btn-primary">Войти</button>
        </div>
      </div>
    );
  }

  const tabs: { id: TabId; label: string; icon: typeof Package; show: boolean }[] = [
    { id: 'orders', label: 'Мои заказы', icon: Package, show: !isSupplier },
    { id: 'supplier-portal', label: 'Кабинет фабрики', icon: Building2, show: isSupplier || adminAccess },
    { id: 'admin-erp', label: 'Обмен с ERP', icon: RefreshCw, show: adminAccess },
    { id: 'admin-users', label: 'Мои клиенты', icon: Users, show: clientsAccess },
    { id: 'admin-display', label: 'Видимость', icon: Eye, show: adminAccess },
    { id: 'settings', label: 'Настройки', icon: Settings, show: true },
  ];

  const handleSignOut = async () => {
    await signOut();
    onNavigate('home');
  };

  return (
    <div className="min-h-screen pt-20 pb-24 lg:pb-8">
      <div className="container-w py-8 lg:py-12">
        <div className="mb-8 flex items-center gap-3">
          <button onClick={() => onNavigate('home')} className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <h1 className="section-heading text-2xl">Личный кабинет</h1>
        </div>

        <div className="grid gap-8 lg:grid-cols-[280px,1fr]">
          {/* Sidebar (desktop) / compact profile (mobile) */}
          <div className="space-y-4">
            <div className="card p-6">
              <div className="flex items-center gap-3 mb-2">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-50">
                  <User className="h-5 w-5 text-brand-700" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900 truncate">{profile.full_name || user.email}</p>
                  <p className="text-xs text-slate-400 truncate">{profile.company_name || ''}</p>
                </div>
              </div>
              <div className="mb-4">
                <span className={`badge ${roleColor(profile.role)}`}>
                  <Shield className="h-3 w-3" />
                  {roleName(profile.role)}
                </span>
              </div>

              {profile.partner_id && (
                <div className="mb-4 rounded-lg bg-slate-50 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wide text-slate-400">Партнёр ID</p>
                  <p className="text-xs font-mono font-medium text-slate-700">{profile.partner_id}</p>
                </div>
              )}

              {/* Desktop nav */}
              <nav className="hidden lg:block lg:space-y-1">
                {tabs.filter(t => t.show).map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    onClick={() => { setActiveTab(id); setSelectedOrder(null); }}
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                      activeTab === id ? 'bg-brand-50 text-brand-700 font-medium' : 'text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    {label}
                    <ChevronRight className="ml-auto h-4 w-4 text-slate-300" />
                  </button>
                ))}
              </nav>

              <div className="hidden lg:block mt-6 border-t border-slate-100 pt-4">
                <button onClick={handleSignOut} className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-colors">
                  <LogOut className="h-4 w-4" />
                  Выйти
                </button>
              </div>
            </div>

            {/* Balance & Debt card */}
            <div className="card overflow-hidden">
              <div className="bg-gradient-to-br from-slate-800 to-slate-900 px-5 py-4">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">
                    {clientDebt?.financials?.balance_usd && clientDebt.financials.balance_usd < 0 ? 'К оплате (долг)' : 'Баланс'}
                  </p>
                  {clientDebt?.financials?.is_overdue && (
                    <span className="badge bg-red-500/20 text-red-300 text-[10px] border border-red-500/30">
                      Просрочка {clientDebt.financials.max_overdue_days} дн.
                    </span>
                  )}
                </div>
                <p className="text-2xl font-bold text-white tracking-tight">
                  ${clientDebt?.financials ? Math.abs(clientDebt.financials.total_debt_usd).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00'}
                </p>
                {clientDebt?.client?.credit_limit_usd ? (
                  <p className="text-[11px] text-slate-400 mt-1">
                    Лимит: ${clientDebt.client.credit_limit_usd.toLocaleString('en-US')} • Отсрочка: {clientDebt.client.payment_delay_days} дн.
                  </p>
                ) : null}
              </div>
              <div className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-red-50">
                      <DollarSign className="h-3.5 w-3.5 text-red-500" />
                    </div>
                    <span className="text-xs text-slate-500">Задолженность</span>
                  </div>
                  <span className="text-sm font-bold text-red-600">
                    ${clientDebt?.financials ? clientDebt.financials.total_debt_usd.toLocaleString('en-US', { minimumFractionDigits: 2 }) : '0.00'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-50">
                      <DollarSign className="h-3.5 w-3.5 text-emerald-500" />
                    </div>
                    <span className="text-xs text-slate-500">Оплачено</span>
                  </div>
                  <span className="text-sm font-bold text-emerald-600">
                    ${clientDebt?.financials ? clientDebt.financials.total_paid_usd.toLocaleString('en-US', { minimumFractionDigits: 2 }) : '0.00'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-amber-50">
                      <Clock className="h-3.5 w-3.5 text-amber-500" />
                    </div>
                    <span className="text-xs text-slate-500">Просрочено</span>
                  </div>
                  <span className="text-sm font-bold text-amber-600">
                    ${clientDebt?.financials ? clientDebt.financials.overdue_usd.toLocaleString('en-US', { minimumFractionDigits: 2 }) : '0.00'}
                  </span>
                </div>
                {clientDebt?.regional_manager?.name && (
                  <div className="rounded-lg bg-slate-50 p-2.5 text-xs text-slate-600 border border-slate-100 flex items-center justify-between">
                    <div>
                      <p className="text-[10px] text-slate-400 font-medium">Куратор РМ:</p>
                      <p className="font-semibold text-slate-800">{clientDebt.regional_manager.name}</p>
                    </div>
                    {clientDebt.regional_manager.phone && (
                      <a href={`tel:${clientDebt.regional_manager.phone}`} className="text-brand-700 font-medium hover:underline text-[11px]">
                        {clientDebt.regional_manager.phone}
                      </a>
                    )}
                  </div>
                )}
                <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                  <div 
                    className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all duration-500" 
                    style={{
                      width: clientDebt?.financials && (clientDebt.financials.total_debt_usd + clientDebt.financials.total_paid_usd) > 0
                        ? `${Math.min(100, Math.round((clientDebt.financials.total_paid_usd / (clientDebt.financials.total_debt_usd + clientDebt.financials.total_paid_usd)) * 100))}%`
                        : '0%'
                    }}
                  />
                </div>
                <p className="text-[10px] text-slate-400 text-center">
                  {loadingDebt ? 'Загрузка данных из ERP...' : clientDebt?.found ? `Синхронизировано: ${clientDebt.client?.name}` : 'Данные из ERP подключены'}
                </p>
              </div>
            </div>
          </div>

          {/* Mobile tab bar */}
          <div className="lg:hidden">
            <div className="grid grid-cols-2 gap-2">
              {tabs.filter(t => t.show).map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => { setActiveTab(id); setSelectedOrder(null); }}
                  className={`flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors ${
                    activeTab === id ? 'bg-brand-700 text-white' : 'bg-white border border-slate-200 text-slate-600'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </button>
              ))}
              <button onClick={handleSignOut} className="flex items-center gap-2 rounded-lg border border-red-200 px-4 py-2.5 text-sm font-medium text-red-500 transition-colors">
                <LogOut className="h-4 w-4" />
                Выйти
              </button>
            </div>
          </div>

          {/* Main content */}
          <div>
            {activeTab === 'orders' && (
              selectedOrder ? (
                <OrderDetail
                  order={selectedOrder}
                  onBack={() => setSelectedOrder(null)}
                  isAdmin={adminAccess || isAdmin}
                  onUpdateOrder={(updated) => setSelectedOrder(updated)}
                  onRepeatOrder={handleRepeatOrder}
                  repeatingOrderId={repeatingOrderId}
                />
              ) : (
                <OrdersTab
                  onSelectOrder={setSelectedOrder}
                  isAdmin={adminAccess || isAdmin}
                  isManager={isManager || clientsAccess}
                  onRepeatOrder={handleRepeatOrder}
                  repeatingOrderId={repeatingOrderId}
                />
              )
            )}
            {activeTab === 'supplier-portal' && (isSupplier || adminAccess) && (
              <SupplierCabinet profile={profile} isAdmin={adminAccess} />
            )}
            {activeTab === 'admin-erp' && adminAccess && <AdminErpSyncTab />}
            {activeTab === 'admin-users' && clientsAccess && <AdminUsersTab onNavigate={onNavigate} />}
            {activeTab === 'admin-display' && adminAccess && <AdminDisplaySettings />}
            {activeTab === 'settings' && (
              <div className="space-y-6">
                <SettingsTab />
                {profile.role === 'client' && <AdminBootstrap />}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Repeat Order Result Modal */}
      {repeatResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-100 space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
                  <RotateCcw className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-base">Повтор заказа #{repeatResult.orderNumber}</h3>
                  <p className="text-xs text-slate-500">Проверка актуальных складских остатков в Астане</p>
                </div>
              </div>
              <button
                onClick={() => setRepeatResult(null)}
                className="h-8 w-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Added items */}
            {repeatResult.added.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  <span>Добавлено в корзину ({repeatResult.added.length} поз.):</span>
                </div>
                <div className="bg-emerald-50/60 border border-emerald-100 rounded-xl p-3 space-y-1.5 max-h-40 overflow-y-auto">
                  {repeatResult.added.map((item, idx) => (
                    <div key={idx} className="flex items-center justify-between text-xs text-emerald-900">
                      <span className="font-medium truncate mr-2">{item.name} ({item.size})</span>
                      <span className="font-semibold whitespace-nowrap">
                        {item.addedQty} шт.
                        {item.addedQty < item.requestedQty && (
                          <span className="text-[10px] text-amber-700 ml-1">(из {item.requestedQty} запрошенных)</span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Missing items */}
            {repeatResult.missing.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-700">
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                  <span>Не добавлено — нет в наличии ({repeatResult.missing.length} поз.):</span>
                </div>
                <div className="bg-amber-50/60 border border-amber-200/80 rounded-xl p-3 space-y-1.5 max-h-40 overflow-y-auto">
                  {repeatResult.missing.map((item, idx) => (
                    <div key={idx} className="flex items-center justify-between text-xs text-amber-900">
                      <span className="truncate mr-2">{item.name} ({item.size})</span>
                      <span className="text-[11px] text-rose-600 font-medium whitespace-nowrap">{item.reason}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {repeatResult.added.length === 0 && repeatResult.missing.length > 0 && (
              <p className="text-xs text-slate-500 text-center py-2">
                К сожалению, ни одной позиции из данного заказа сейчас нет в наличии на складе в Астане.
              </p>
            )}

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
              <button
                onClick={() => setRepeatResult(null)}
                className="px-4 py-2 rounded-xl text-xs font-medium text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
              >
                Закрыть
              </button>
              {repeatResult.added.length > 0 && (
                <button
                  onClick={() => {
                    setRepeatResult(null);
                    onNavigate('cart');
                  }}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold bg-brand-700 hover:bg-brand-800 text-white shadow-sm transition-all cursor-pointer"
                >
                  <ShoppingCart className="h-4 w-4" />
                  Перейти в корзину
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Orders Tab ─── */
function OrdersTab({
  onSelectOrder,
  isAdmin,
  isManager,
  onRepeatOrder,
  repeatingOrderId,
}: {
  onSelectOrder: (o: Order) => void;
  isAdmin: boolean;
  isManager: boolean;
  onRepeatOrder?: (o: Order) => void;
  repeatingOrderId?: string | null;
}) {
  const { user, profile } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    try {
      const clientId = profile?.partner_id
        ? Number(profile.partner_id)
        : (profile?.id && !isNaN(Number(profile.id)) ? Number(profile.id) : undefined);
      const phone = profile?.phone || user?.phone || (user?.user_metadata?.phone as string) || undefined;

      const params: { phone?: string; clientId?: number; limit?: number } = { limit: 100 };
      if (!isAdmin && !isManager) {
        if (clientId) params.clientId = clientId;
        if (phone) params.phone = phone;
      }

      const erpData = await fetchClientOrdersFromErp(params);
      if (erpData && erpData.success && Array.isArray(erpData.orders)) {
        const mappedErp: Order[] = erpData.orders.map((o) => {
          const st = o.status_code || 'pending';
          const meta = ORDER_STATUS_MAP[st] || { label: o.status || st, color: 'bg-amber-50 text-amber-700 border-amber-200' };
          const d = o.date ? new Date(o.date) : new Date();
          const dateStr = d.toLocaleDateString('ru-RU', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
          }) + ' ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

          const items: OrderItem[] = (o.items || []).map((it) => ({
            id: String(it.id),
            productName: it.name || 'Ковер',
            collection: it.name.split(' ')[0] || 'Коллекция',
            size: it.size || 'Стандарт',
            sku: it.sku || '',
            warehouse: o.warehouse_name || 'Основной Склад Астана',
            price: Number(it.price) || 0,
            quantity: Number(it.quantity) || 1,
          }));

          return {
            id: String(o.id),
            orderNumber: o.doc_number || `ORD-${o.id}`,
            userId: String(o.client_id || ''),
            date: dateStr,
            status: o.status || meta.label,
            statusRaw: st,
            statusColor: meta.color,
            warehouse: o.warehouse_name || 'Основной Склад Астана',
            notes: o.comment || '',
            clientName: o.client_name || profile?.full_name || 'Клиент',
            clientCompany: o.client_name || profile?.company_name || '',
            clientPhone: o.client_phone || profile?.phone || '',
            totalAmount: Number(o.total_amount) || 0,
            totalSqm: Number(o.total_sqm) || 0,
            totalItems: o.items_count || items.reduce((s, it) => s + it.quantity, 0),
            items,
          };
        });

        setOrders(mappedErp);
      } else {
        setOrders([]);
      }
    } catch (e) {
      console.warn('[OrdersTab] Failed to fetch orders from ERP:', e);
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, [isAdmin, isManager, profile, user]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  // Сквозная подписка на Realtime обновления статусов заказов со склада/WMS
  useEffect(() => {
    const channel = supabase
      .channel('portal_order_live_sync')
      .on('broadcast', { event: 'order_status_changed' }, (payload: any) => {
        const data = payload?.payload;
        if (!data || !data.order_id) return;
        const targetId = String(data.order_id);
        const newStatus = data.new_status;
        const meta = ORDER_STATUS_MAP[newStatus] || { label: newStatus, color: 'bg-slate-100 text-slate-600 border-slate-200' };

        setOrders(prev => prev.map(o => {
          if (o.id === targetId || o.orderNumber === data.order_doc_number) {
            return {
              ...o,
              status: meta.label,
              statusRaw: newStatus,
              statusColor: meta.color,
              notes: data.comment || o.notes,
            };
          }
          return o;
        }));
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const handleQuickStatusChange = async (orderId: string, newStatus: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setUpdatingId(orderId);
    // 1. Синхронизируем статус в ERP (при 'cancelled' ERP автоматически расформировывает бронь free_stock)
    try {
      await updateOrderStatusInErp({
        orderId,
        status: newStatus,
        comment: `Быстрая смена статуса на "${newStatus}"`,
      });
    } catch (erpErr) {
      console.warn('[handleQuickStatusChange] ERP update_order_status warning:', erpErr);
    }

    // 2. Обновляем статус в Supabase
    try {
      await supabase
        .from('orders')
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq('id', orderId);
    } catch {
      // safe fallback
    }
    const meta = ORDER_STATUS_MAP[newStatus] || { label: newStatus, color: 'bg-slate-100 text-slate-600 border-slate-200' };
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: meta.label, statusRaw: newStatus, statusColor: meta.color } : o));
    setUpdatingId(null);
  };

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { all: orders.length };
    for (const o of orders) {
      counts[o.statusRaw] = (counts[o.statusRaw] || 0) + 1;
    }
    return counts;
  }, [orders]);

  const filteredOrders = useMemo(() => {
    return orders.filter(o => {
      if (statusFilter !== 'all' && o.statusRaw !== statusFilter) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchNumber = o.orderNumber.toLowerCase().includes(q);
        const matchCompany = (o.clientCompany || '').toLowerCase().includes(q);
        const matchName = (o.clientName || '').toLowerCase().includes(q);
        const matchPhone = (o.clientPhone || '').toLowerCase().includes(q);
        const matchWarehouse = (o.warehouse || '').toLowerCase().includes(q);
        const matchNotes = (o.notes || '').toLowerCase().includes(q);
        const matchItems = o.items.some(i => i.productName.toLowerCase().includes(q) || i.collection.toLowerCase().includes(q));
        if (!matchNumber && !matchCompany && !matchName && !matchPhone && !matchWarehouse && !matchNotes && !matchItems) {
          return false;
        }
      }
      return true;
    });
  }, [orders, statusFilter, searchQuery]);

  const filterTabs = [
    { id: 'all', label: 'Все' },
    { id: 'pending', label: 'Новые' },
    { id: 'processing', label: 'В обработке' },
    { id: 'shipped', label: 'Отгружен' },
    { id: 'delivered', label: 'Доставлен' },
    { id: 'cancelled', label: 'Отменён' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-50">
            <Package className="h-5 w-5 text-slate-500" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              {isAdmin ? 'Все заказы' : isManager ? 'Заказы клиентов' : 'Мои заказы'} ({orders.length})
            </h2>
            <p className="text-sm text-slate-500">
              {isAdmin ? 'Управление заказами всех клиентов' : 'История ваших заказов на портале'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {onRepeatOrder && orders.length > 0 && (
            <button
              onClick={() => onRepeatOrder(orders[0])}
              disabled={repeatingOrderId !== null}
              className="flex items-center gap-1.5 rounded-lg bg-brand-700 hover:bg-brand-800 text-white px-3.5 py-1.5 text-xs font-semibold shadow-sm transition-all active:scale-95 disabled:opacity-50"
              title="Добавить товары из последнего заказа в корзину с проверкой наличия"
            >
              <RotateCcw className={`h-3.5 w-3.5 ${repeatingOrderId === orders[0].id ? 'animate-spin' : ''}`} />
              Повторить последний заказ
            </button>
          )}

          <button
            onClick={fetchOrders}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Обновить
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {filterTabs.map(t => {
            const count = statusCounts[t.id] ?? 0;
            const active = statusFilter === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setStatusFilter(t.id)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors flex items-center gap-1.5 ${
                  active ? 'bg-brand-700 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                <span>{t.label}</span>
                <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${active ? 'bg-brand-800 text-white' : 'bg-slate-200 text-slate-700'}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Поиск по номеру, клиенту..."
            className="input-field pl-9 py-1 text-xs"
          />
        </div>
      </div>

      {/* Orders List */}
      {loading ? (
        <div className="py-12 flex flex-col items-center justify-center text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-600 border-t-transparent mb-3" />
          <p className="text-xs text-slate-400">Загрузка заказов...</p>
        </div>
      ) : filteredOrders.length === 0 ? (
        <div className="card p-12 text-center">
          <Package className="h-10 w-10 text-slate-300 mx-auto mb-3" />
          <h3 className="text-sm font-semibold text-slate-900 mb-1">
            {orders.length === 0 ? 'Заказов пока нет' : 'Ничего не найдено'}
          </h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            {orders.length === 0
              ? 'Новые оформленные заказы будут отображаться в этом реестре.'
              : 'Попробуйте изменить параметры поиска или фильтр статуса.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredOrders.map(order => {
            const t = orderTotals(order.items);
            const collections = [...new Set(order.items.map(i => i.collection))];
            return (
              <div
                key={order.id}
                onClick={() => onSelectOrder(order)}
                className="card p-5 w-full text-left hover:border-brand-300 hover:shadow-sm transition-all cursor-pointer group"
              >
                <div className="flex flex-wrap items-center justify-between gap-3 mb-3 border-b border-slate-100 pb-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex items-center gap-1.5 font-mono font-bold text-slate-900 bg-slate-100 px-2.5 py-1 rounded text-sm">
                      <Hash className="h-3.5 w-3.5 text-slate-500" />
                      {order.orderNumber}
                    </div>
                    <span className={`badge border ${order.statusColor}`}>
                      {order.status}
                    </span>
                    {isAdmin && (
                      <div className="ml-1" onClick={e => e.stopPropagation()}>
                        <select
                          value={order.statusRaw}
                          disabled={updatingId === order.id}
                          onChange={(e) => handleQuickStatusChange(order.id, e.target.value, e as any)}
                          className="rounded border border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-600 focus:outline-none focus:ring-1 focus:ring-brand-500 cursor-pointer"
                        >
                          <option value="pending">Новый</option>
                          <option value="processing">В обработке</option>
                          <option value="shipped">Отгружен</option>
                          <option value="delivered">Доставлен</option>
                          <option value="cancelled">Отменён</option>
                        </select>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-3 text-xs text-slate-400">
                    <div className="flex items-center gap-1">
                      <Calendar className="h-3.5 w-3.5" />
                      {order.date}
                    </div>
                    <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-brand-500 transition-colors" />
                  </div>
                </div>

                {/* Client info banner if admin or manager */}
                {(isAdmin || isManager) && (order.clientCompany || order.clientName) && (
                  <div className="mb-3 flex flex-wrap items-center gap-2 text-xs bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-100">
                    <User className="h-3.5 w-3.5 text-slate-400" />
                    <span className="font-semibold text-slate-800">{order.clientCompany || order.clientName}</span>
                    {order.clientCompany && order.clientName && (
                      <span className="text-slate-500">({order.clientName})</span>
                    )}
                    {order.clientPhone && (
                      <span className="text-slate-400 font-mono text-[11px] ml-auto">{order.clientPhone}</span>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
                  <div>
                    <p className="text-xs text-slate-400 mb-0.5">Кол-во</p>
                    <p className="text-sm font-semibold text-slate-900">{order.totalItems || t.qty} шт.</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400 mb-0.5">Площадь</p>
                    <p className="text-sm font-semibold text-slate-900">{fmt2(order.totalSqm || t.sqm)} м²</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400 mb-0.5">Сумма</p>
                    <p className="text-sm font-bold text-brand-700">{fmtPrice(order.totalAmount || t.sum)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400 mb-0.5">Склад</p>
                    <div className="flex items-center gap-1">
                      <MapPin className="h-3 w-3 text-slate-400" />
                      <p className="text-sm text-slate-700 truncate">{order.warehouse || 'Главный'}</p>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
                  <div className="flex flex-wrap gap-1.5">
                    {collections.map(col => (
                      <span key={col} className="badge bg-slate-100 text-slate-600 text-[10px]">
                        {col}
                      </span>
                    ))}
                  </div>

                  {onRepeatOrder && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRepeatOrder(order);
                      }}
                      disabled={repeatingOrderId !== null}
                      className="flex items-center gap-1.5 text-xs font-semibold text-brand-700 hover:text-brand-800 bg-brand-50 hover:bg-brand-100 px-3 py-1.5 rounded-lg border border-brand-200 transition-colors ml-auto active:scale-95 disabled:opacity-50"
                    >
                      <RotateCcw className={`h-3 w-3 ${repeatingOrderId === order.id ? 'animate-spin' : ''}`} />
                      Повторить заказ
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ─── Settings Tab ─── */
function AdminBootstrap() {
  const { refreshProfile } = useAuth();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const handleBootstrap = async () => {
    setBusy(true);
    const { data, error } = await supabase.rpc('bootstrap_admin');
    setBusy(false);
    if (error) {
      setResult(error.message.includes('already exists') ? 'Админ уже назначен' : 'Ошибка: ' + error.message);
    } else {
      setResult('Вы теперь администратор!');
      await refreshProfile();
    }
  };

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-5">
      <h3 className="text-sm font-semibold text-amber-900 mb-2">Стать администратором</h3>
      <p className="text-xs text-amber-800 mb-3">Если в системе ещё нет админа, нажмите кнопку ниже. Это работает только один раз для первого пользователя.</p>
      {result ? (
        <p className="text-sm font-medium text-amber-900">{result}</p>
      ) : (
        <button onClick={handleBootstrap} disabled={busy} className="btn-primary text-sm">
          {busy ? 'Назначение...' : 'Назначить меня админом'}
        </button>
      )}
    </div>
  );
}

function SettingsTab() {
  const { profile, refreshProfile } = useAuth();
  const [form, setForm] = useState({ full_name: profile?.full_name ?? '', company_name: profile?.company_name ?? '', phone: profile?.phone ?? '' });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    if (!profile) return;
    setSaving(true);
    const { error } = await supabase.from('profiles').update({
      full_name: form.full_name,
      company_name: form.company_name,
      phone: form.phone,
    }).eq('id', profile.id);
    setSaving(false);
    if (!error) {
      setSaved(true);
      await refreshProfile();
      setTimeout(() => setSaved(false), 2000);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Settings className="h-5 w-5 text-slate-500" />
        <div>
          <h2 className="text-lg font-bold text-slate-900">Настройки профиля</h2>
          <p className="text-sm text-slate-500">Обновите ваши контактные данные</p>
        </div>
      </div>

      <div className="card p-6 max-w-lg space-y-4">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">Имя</label>
          <input type="text" value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} className="input-field" />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">Компания</label>
          <input type="text" value={form.company_name} onChange={e => setForm(f => ({ ...f, company_name: e.target.value }))} className="input-field" />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">Телефон</label>
          <input type="text" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} className="input-field" placeholder="+7 (___) ___-__-__" />
        </div>
        <button onClick={handleSave} disabled={saving} className="btn-primary">
          {saving ? 'Сохранение...' : saved ? 'Сохранено!' : 'Сохранить'}
        </button>
      </div>
    </div>
  );
}
