import { useState, useEffect, useMemo } from 'react';
import {
  Users,
  Search,
  User,
  Building2,
  Power,
  FileText,
  UserCog,
  ChevronDown,
} from 'lucide-react';
import type { PageId } from '@/types';
import { useAuth, type UserRole } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import {
  fetchCounterpartiesFromErp,
  updateClientAccessInErp,
  broadcastClientDeactivated,
  isCounterpartyArchivedOrMailing,
} from '@/lib/erpApi';
import { getClientWarehouseSettings } from '@/lib/warehouseVisibility';
import { ClientWarehouseModal } from './ClientWarehouseModal';
import { ClientDemoPanel } from './ClientDemoPanel';

export interface AdminUsersTabProps {
  onNavigate: (page: PageId) => void;
}

export function AdminUsersTab({ onNavigate }: AdminUsersTabProps) {
  const { impersonateUser, user: currentUser, realIsAdmin } = useAuth();
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
    is_archived_or_mailing?: boolean;
    showroom_warehouse_id?: number | null;
    showroom_warehouse_name?: string | null;
  }>>([]);
  const [userSearch, setUserSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [loading, setLoading] = useState(true);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [warehouseModalUser, setWarehouseModalUser] = useState<typeof users[0] | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadUsers() {
      setLoading(true);
      try {
        const cpData = await fetchCounterpartiesFromErp({ limit: 300, includeArchived: true });
        if (!cancelled && cpData && cpData.success && Array.isArray(cpData.counterparties) && cpData.counterparties.length > 0) {
          const mappedUsers = cpData.counterparties.map((cp) => {
            const isAccessOn = cp.portal_access_enabled !== 0 && cp.is_active !== 0 && cp.status !== 'inactive' && cp.access !== 'disabled';
            const isArchived = isCounterpartyArchivedOrMailing(cp);
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
              is_archived_or_mailing: isArchived,
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

      try {
        const { data } = await supabase
          .from('profiles')
          .select('id, full_name, company_name, phone, role, partner_id, price_type, manager_id, created_at')
          .order('created_at', { ascending: false });
        if (!cancelled && data) {
          setUsers(data.map((u: any) => ({
            ...u,
            portal_access_enabled: true,
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
      await updateClientAccessInErp(userId, newStatus ? 1 : 0);
      if (!newStatus) {
        broadcastClientDeactivated(userId);
      }

      setUsers(prev => prev.map(u => u.id === userId ? {
        ...u,
        portal_access_enabled: newStatus,
        impersonation_enabled: newStatus,
      } : u));

      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
        try {
          await supabase
            .from('profiles')
            .update({ impersonation_enabled: newStatus })
            .eq('id', userId);
        } catch {
          // safe fallback
        }
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
    if (!showArchived) {
      clients = clients.filter(user => !user.is_archived_or_mailing);
    }
    if (!userSearch.trim()) return clients;
    const q = userSearch.toLowerCase().trim();
    return clients.filter(user =>
      (user.full_name || '').toLowerCase().includes(q) ||
      (user.company_name || '').toLowerCase().includes(q) ||
      (user.phone || '').toLowerCase().includes(q) ||
      (user.partner_id || '').toLowerCase().includes(q)
    );
  }, [users, userSearch, isAdminView, managerId, showArchived]);

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
        <div className="flex flex-wrap items-center gap-2">
          {isAdminView && (
            <button
              type="button"
              onClick={() => setShowArchived(!showArchived)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                showArchived
                  ? 'bg-amber-50 text-amber-800 border-amber-300'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              {showArchived ? 'Скрыть архив/рассылку' : 'Показать архив/рассылку'}
            </button>
          )}
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

export default AdminUsersTab;
