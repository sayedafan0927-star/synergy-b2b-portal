import { useState, useMemo, useEffect } from 'react';
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
} from 'lucide-react';
import type { PageId } from '@/types';
import { calcSqm, parseSizeDimensions } from '@/types';
import { useAuth, type UserRole } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { syncAllErpData, type ErpSyncReport, ERP_API_URL, fetchClientDebtFromErp, type ClientDebtReport } from '@/lib/erpApi';
import { triggerCatalogReload } from '@/hooks/useProductData';

/* ─── Types ─── */
interface OrderItem {
  productName: string;
  collection: string;
  size: string;
  warehouse: string;
  price: number;
  quantity: number;
}

interface Order {
  id: string;
  date: string;
  status: string;
  statusColor: string;
  warehouse: string;
  items: OrderItem[];
}

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

/* ─── Mock orders (demo) ─── */
const MOCK_ORDERS: Order[] = [
  {
    id: 'ORD-2025-0047', date: '22.09.2025', status: 'Доставлен', statusColor: 'bg-emerald-50 text-emerald-700', warehouse: 'Астана',
    items: [
      { productName: 'Royal Heritage 1200', collection: 'Royal Heritage', size: '1.00 × 2.00', warehouse: 'Астана', price: 72, quantity: 4 },
      { productName: 'Royal Heritage 1200', collection: 'Royal Heritage', size: '1.50 × 2.30', warehouse: 'Астана', price: 136, quantity: 2 },
      { productName: 'Milano Geometric', collection: 'Milano', size: '0.80 × 1.50', warehouse: 'Астана', price: 38, quantity: 6 },
    ],
  },
  {
    id: 'ORD-2025-0039', date: '15.09.2025', status: 'В обработке', statusColor: 'bg-amber-50 text-amber-700', warehouse: 'Алматы',
    items: [
      { productName: 'Nordic Comfort', collection: 'Nordic', size: '1.00 × 2.00', warehouse: 'Алматы', price: 52, quantity: 3 },
      { productName: 'Nordic Comfort', collection: 'Nordic', size: '1.50 × 2.30', warehouse: 'Алматы', price: 95, quantity: 2 },
      { productName: 'Elegance Medallion', collection: 'Elegance', size: '1.20 × 1.70', warehouse: 'Алматы', price: 76, quantity: 3 },
    ],
  },
  {
    id: 'ORD-2025-0031', date: '02.09.2025', status: 'Доставлен', statusColor: 'bg-emerald-50 text-emerald-700', warehouse: 'Астана',
    items: [
      { productName: 'Royal Heritage 1200', collection: 'Royal Heritage', size: '2.00 × 3.00', warehouse: 'Астана', price: 204, quantity: 5 },
      { productName: 'Isfahan Silk Touch', collection: 'Isfahan', size: '1.00 × 2.00', warehouse: 'Астана', price: 98, quantity: 4 },
      { productName: 'Isfahan Silk Touch', collection: 'Isfahan', size: '1.50 × 2.30', warehouse: 'Астана', price: 182, quantity: 3 },
      { productName: 'Avenue Runner', collection: 'Avenue', size: '0.80 × 25.00', warehouse: 'Астана', price: 109, quantity: 6 },
      { productName: 'Avenue Runner', collection: 'Avenue', size: '1.00 × 25.00', warehouse: 'Астана', price: 136, quantity: 6 },
    ],
  },
];

type TabId = 'orders' | 'admin-erp' | 'admin-users' | 'admin-display' | 'settings';

/* ─── Order Detail View ─── */
function OrderDetail({ order, onBack }: { order: Order; onBack: () => void }) {
  const [activeCollection, setActiveCollection] = useState<string | null>(null);
  const [sizeAsc, setSizeAsc] = useState(true);
  const collections = useMemo(() => Array.from(new Set(order.items.map(i => i.collection))).sort(), [order]);
  const totals = orderTotals(order.items);

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
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"><ArrowLeft className="h-4 w-4" /></button>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <Hash className="h-4 w-4 text-slate-400" />
            <h2 className="text-lg font-bold text-slate-900">{order.id}</h2>
            <span className={`badge ${order.statusColor}`}>{order.status}</span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">{order.date} / {order.warehouse}</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Кол-во', value: `${totals.qty} шт.` },
          { label: 'Площадь', value: `${fmt2(totals.sqm)} м²` },
          { label: 'Сумма', value: fmtPrice(totals.sum), bold: true },
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
  const [settings, setSettings] = useState<Record<string, DisplaySettings>>({});
  const [saving, setSaving] = useState(false);
  const roles: UserRole[] = ['admin', 'manager_rm', 'manager_lm', 'supplier', 'client'];

  useEffect(() => {
    supabase.from('display_settings').select('*').then(({ data }) => {
      if (data) {
        const map: Record<string, DisplaySettings> = {};
        for (const row of data) {
          map[row.target_role] = {
            show_stock: row.show_stock,
            show_reserve: row.show_reserve,
            show_total_pcs: row.show_total_pcs,
            show_sqm: row.show_sqm,
            show_price: row.show_price,
          };
        }
        setSettings(map);
      }
    });
  }, []);

  const toggle = (role: string, field: keyof DisplaySettings) => {
    setSettings(prev => ({
      ...prev,
      [role]: { ...prev[role], [field]: !prev[role]?.[field] },
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    for (const role of roles) {
      const s = settings[role];
      if (!s) continue;
      await supabase.from('display_settings').update({
        show_stock: s.show_stock,
        show_reserve: s.show_reserve,
        show_total_pcs: s.show_total_pcs,
        show_sqm: s.show_sqm,
        show_price: s.show_price,
        updated_at: new Date().toISOString(),
      }).eq('target_role', role);
    }
    setSaving(false);
  };

  const columns = [
    { key: 'show_stock' as const, label: 'Остаток' },
    { key: 'show_reserve' as const, label: 'Резерв' },
    { key: 'show_total_pcs' as const, label: 'Всего шт.' },
    { key: 'show_sqm' as const, label: 'М²' },
    { key: 'show_price' as const, label: 'Цена' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Eye className="h-5 w-5 text-slate-500" />
        <div>
          <h2 className="text-lg font-bold text-slate-900">Видимость столбцов</h2>
          <p className="text-sm text-slate-500">Настройте, что видит каждая роль в сетке остатков</p>
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
                          settings[role]?.[c.key] ? 'bg-brand-600 border-brand-600' : 'bg-white border-slate-300'
                        }`}
                      >
                        {settings[role]?.[c.key] && (
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
        <div className="border-t border-slate-100 px-4 py-3">
          <button onClick={handleSave} disabled={saving} className="btn-primary text-sm">
            {saving ? 'Сохранение...' : 'Сохранить настройки'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Admin: Users Tab ─── */
function AdminUsersTab() {
  const [users, setUsers] = useState<Array<{ id: string; full_name: string; company_name: string; role: UserRole; partner_id: string | null }>>([]);

  useEffect(() => {
    supabase.from('profiles').select('id, full_name, company_name, role, partner_id').order('created_at', { ascending: false }).then(({ data }) => {
      if (data) setUsers(data as typeof users);
    });
  }, []);

  const handleRoleChange = async (userId: string, newRole: string) => {
    const { error } = await supabase.rpc('set_user_role', { p_user_id: userId, p_role: newRole });
    if (!error) {
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, role: newRole as UserRole } : u));
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Users className="h-5 w-5 text-slate-500" />
        <div>
          <h2 className="text-lg font-bold text-slate-900">Пользователи</h2>
          <p className="text-sm text-slate-500">Управление ролями и доступом</p>
        </div>
      </div>

      <div className="space-y-2">
        {users.map(u => (
          <div key={u.id} className="card px-4 py-3 flex flex-wrap items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 shrink-0">
              <User className="h-4 w-4 text-slate-500" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-900 truncate">{u.full_name || 'Без имени'}</p>
              <p className="text-xs text-slate-400 truncate">{u.company_name || 'Компания не указана'}</p>
            </div>
            <select
              value={u.role}
              onChange={e => handleRoleChange(u.id, e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-medium text-slate-700"
            >
              <option value="admin">Админ</option>
              <option value="manager_rm">РМ</option>
              <option value="manager_lm">ЛМ</option>
              <option value="supplier">Поставщик</option>
              <option value="client">Клиент</option>
            </select>
            <button className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors">
              <UserCog className="h-3 w-3" />
              Войти как
            </button>
          </div>
        ))}
        {users.length === 0 && (
          <p className="py-8 text-center text-sm text-slate-400">Пока нет зарегистрированных пользователей</p>
        )}
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
  const { user, profile, loading, signOut, isAdmin, isManager } = useAuth();
  const [activeTab, setActiveTab] = useState<TabId>('orders');
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [clientDebt, setClientDebt] = useState<ClientDebtReport | null>(null);
  const [loadingDebt, setLoadingDebt] = useState<boolean>(false);

  useEffect(() => {
    if (!profile) return;
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
    { id: 'orders', label: 'Мои заказы', icon: Package, show: true },
    { id: 'admin-erp', label: 'Обмен с ERP', icon: RefreshCw, show: isAdmin },
    { id: 'admin-users', label: 'Пользователи', icon: Users, show: isAdmin },
    { id: 'admin-display', label: 'Видимость', icon: Eye, show: isAdmin },
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
              <nav className="hidden lg:space-y-1">
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
                <OrderDetail order={selectedOrder} onBack={() => setSelectedOrder(null)} />
              ) : (
                <OrdersTab onSelectOrder={setSelectedOrder} isAdmin={isAdmin} isManager={isManager} />
              )
            )}
            {activeTab === 'admin-erp' && isAdmin && <AdminErpSyncTab />}
            {activeTab === 'admin-users' && isAdmin && <AdminUsersTab />}
            {activeTab === 'admin-display' && isAdmin && <AdminDisplaySettings />}
            {activeTab === 'settings' && (
              <div className="space-y-6">
                <SettingsTab />
                {profile.role === 'client' && <AdminBootstrap />}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Orders Tab ─── */
function OrdersTab({ onSelectOrder, isAdmin, isManager }: { onSelectOrder: (o: Order) => void; isAdmin: boolean; isManager: boolean }) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-50">
            <Package className="h-5 w-5 text-slate-500" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              {isAdmin ? 'Все заказы' : isManager ? 'Заказы клиентов' : 'Мои заказы'}
            </h2>
            <p className="text-sm text-slate-500">Демо-данные, подключится к реальным заказам</p>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {MOCK_ORDERS.map(order => {
          const t = orderTotals(order.items);
          const collections = [...new Set(order.items.map(i => i.collection))];
          return (
            <button key={order.id} onClick={() => onSelectOrder(order)} className="card p-5 w-full text-left hover:border-brand-200 transition-colors group">
              <div className="flex flex-wrap items-center gap-3 mb-4">
                <div className="flex items-center gap-1.5">
                  <Hash className="h-3.5 w-3.5 text-slate-400" />
                  <span className="text-sm font-bold text-slate-900">{order.id}</span>
                </div>
                <span className={`badge ${order.statusColor}`}>{order.status}</span>
                <div className="flex items-center gap-1.5 text-xs text-slate-400 ml-auto">
                  <Calendar className="h-3.5 w-3.5" />
                  {order.date}
                </div>
                <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-brand-500 transition-colors" />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
                <div><p className="text-xs text-slate-400 mb-0.5">Кол-во</p><p className="text-sm font-semibold text-slate-900">{t.qty} шт.</p></div>
                <div><p className="text-xs text-slate-400 mb-0.5">Площадь</p><p className="text-sm font-semibold text-slate-900">{fmt2(t.sqm)} м²</p></div>
                <div><p className="text-xs text-slate-400 mb-0.5">Сумма</p><p className="text-sm font-bold text-brand-700">{fmtPrice(t.sum)}</p></div>
                <div><p className="text-xs text-slate-400 mb-0.5">Склад</p><div className="flex items-center gap-1"><MapPin className="h-3 w-3 text-slate-400" /><p className="text-sm text-slate-700">{order.warehouse}</p></div></div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {collections.map(col => <span key={col} className="badge bg-slate-50 text-slate-500 text-[10px]">{col}</span>)}
              </div>
            </button>
          );
        })}
      </div>
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
