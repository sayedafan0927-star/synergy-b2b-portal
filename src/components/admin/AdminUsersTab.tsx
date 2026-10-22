import { useState, useEffect, useMemo } from 'react';
import {
  Users,
  Search,
  Shield,
  UserCheck,
} from 'lucide-react';
import type { PageId } from '@/types';
import { useAuth, type UserRole } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import {
  fetchCounterpartiesFromErp,
  fetchRegionalManagersFromErp,
  updateClientAccessInErp,
  broadcastClientDeactivated,
  isCounterpartyArchivedOrMailing,
  searchCounterpartiesSmart,
  erpFetch,
} from '@/lib/erpApi';
import { getClientWarehouseSettings, saveClientWarehouseSettings } from '@/lib/warehouseVisibility';
import { resolveContractPriceType } from '@/lib/pricingEngine';
import { ClientWarehouseModal } from './ClientWarehouseModal';
import { AdminClientUserCard, type ClientUserItem } from './AdminClientUserCard';

export interface AdminUsersTabProps {
  onNavigate: (page: PageId) => void;
}

interface StaffMemberItem {
  id: number | string;
  name: string;
  username: string;
  phone: string;
  role: 'admin' | 'manager_rm' | 'manager_lm';
  city?: string;
  clients_count?: number;
}

export function AdminUsersTab({ onNavigate }: AdminUsersTabProps) {
  const { impersonateUser, user: currentUser, profile, realIsAdmin } = useAuth();
  const managerId = currentUser?.id;
  const isAdminView = realIsAdmin;

  const [users, setUsers] = useState<ClientUserItem[]>([]);
  const [staffMembers, setStaffMembers] = useState<StaffMemberItem[]>([]);
  const [userTab, setUserTab] = useState<'all' | 'clients' | 'staff'>('all');
  const [userSearch, setUserSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [onlyMyAssigned, setOnlyMyAssigned] = useState(false);
  const [loading, setLoading] = useState(true);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [warehouseModalUser, setWarehouseModalUser] = useState<ClientUserItem | null>(null);
  const [warehouseVersion, setWarehouseVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function loadData() {
      setLoading(true);

      // 1. Загрузка сотрудников и региональных менеджеров
      try {
        const rmData = await fetchRegionalManagersFromErp();
        if (!cancelled && rmData?.success && Array.isArray(rmData.managers)) {
          setStaffMembers(rmData.managers.map((m: any) => ({
            id: m.id,
            name: m.name || m.username || 'Менеджер',
            username: m.username || '',
            phone: m.phone || '',
            role: (m.role === 'admin' ? 'admin' : (m.role === 'manager_lm' || m.role === 'lm' ? 'manager_lm' : 'manager_rm')) as any,
            city: m.city || 'Астана / РК',
            clients_count: m.clients_count || 0,
          })));
        }
      } catch (rmErr) {
        console.warn('[AdminUsersTab] Regional managers load error:', rmErr);
      }

      // 2. Загрузка контрагентов/дилеров
      try {
        let cpList: any[] = [];
        try {
          const cpData = await fetchCounterpartiesFromErp({ limit: 1000, includeArchived: true });
          if (cpData && cpData.success && Array.isArray(cpData.counterparties) && cpData.counterparties.length > 0) {
            cpList = cpData.counterparties;
          }
        } catch {
          const direct = await erpFetch('counterparties', { method: 'GET', params: { limit: 1000 } });
          if (direct.ok) {
            const dj = await direct.json();
            if (Array.isArray(dj?.counterparties)) cpList = dj.counterparties;
          }
        }

        if (!cancelled && cpList.length > 0) {
          const mappedUsers: ClientUserItem[] = cpList.map((cp: any) => {
            const isAccessOn = cp.portal_access_enabled !== false && cp.portal_access_enabled !== 0 && cp.status !== 'inactive' && cp.access !== 'disabled';
            const isArchived = isCounterpartyArchivedOrMailing(cp);
            const contractPriceType = resolveContractPriceType(cp, cp.contracts, 'price_deferred');
            return {
              id: String(cp.id),
              full_name: cp.name,
              company_name: cp.name,
              phone: cp.phone || cp.portal_login || '',
              city: cp.city || '',
              bin: cp.bin || '',
              role: 'client' as UserRole,
              partner_id: String(cp.id),
              price_type: contractPriceType,
              manager_id: String(cp.manager_id ?? cp.regional_manager?.id ?? ''),
              portal_access_enabled: isAccessOn,
              impersonation_enabled: isAccessOn,
              is_archived_or_mailing: isArchived,
              showroom_warehouse_id: cp.showroom_warehouse_id ?? cp.warehouse_id ?? (cp.id === 2833 ? 2833 : null),
              showroom_warehouse_name: cp.showroom_warehouse_name ?? cp.warehouse_name ?? (cp.id === 2833 ? 'Aya Home Store (Шымкент)' : null),
              credit_limit_usd: cp.financials?.credit_limit_usd ?? cp.credit_limit_usd,
              debt_usd: cp.financials?.debt_usd ?? cp.debt_usd,
            };
          });
          setUsers(mappedUsers);
          setLoading(false);
          return;
        }
      } catch (cpErr) {
        console.warn('[AdminUsersTab] ERP counterparties error:', cpErr);
      }

      // 3. Fallback: Supabase profiles if ERP unavailable
      try {
        const { data } = await supabase
          .from('profiles')
          .select('id, full_name, company_name, phone, role, partner_id, price_type, manager_id, created_at')
          .order('created_at', { ascending: false });
        if (!cancelled && data) {
          setUsers(data.map((u: any) => ({
            ...u,
            portal_access_enabled: true,
            impersonation_enabled: true,
          })));
        }
      } catch (err) {
        console.warn('[AdminUsersTab] Supabase fallback error:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadData();
    return () => { cancelled = true; };
  }, []);

  const handleToggleAccess = async (userId: string, currentEnabled: boolean) => {
    setTogglingId(userId);
    const newStatus = !currentEnabled;
    try {
      await updateClientAccessInErp(userId, newStatus ? 1 : 0);
      if (!newStatus) broadcastClientDeactivated(userId);

      setUsers(prev => prev.map(u => u.id === userId ? {
        ...u,
        portal_access_enabled: newStatus,
        impersonation_enabled: newStatus,
      } : u));
    } catch (err: any) {
      alert(`Ошибка обновления доступа в ERP: ${err.message}`);
    } finally {
      setTogglingId(null);
    }
  };

  const handleToggleWarehouseVisibility = (clientId: string) => {
    const s = getClientWarehouseSettings(clientId);
    const currentlyOn = s.mode === 'custom'
      ? Boolean(s.showCentralWarehouse || s.showShowroomWarehouse || s.showWarehousesToClient)
      : Boolean(s.showWarehousesToClient);
    const nextOn = !currentlyOn;

    saveClientWarehouseSettings(clientId, {
      ...s,
      mode: 'custom',
      showWarehousesToClient: nextOn,
      showCentralWarehouse: nextOn,
      showShowroomWarehouse: nextOn,
    });
    setWarehouseVersion(v => v + 1);
  };

  const filteredClients = useMemo(() => {
    let clients = users;
    if (!isAdminView && onlyMyAssigned && managerId) {
      const candidateIds = new Set<string>([
        String(managerId),
        String(profile?.partner_id || ''),
        String(profile?.manager_id || ''),
      ].filter(Boolean));
      clients = clients.filter(user => user.manager_id && candidateIds.has(String(user.manager_id)));
    }
    if (!showArchived) {
      clients = clients.filter(user => !user.is_archived_or_mailing);
    }
    if (!userSearch.trim()) return clients;
    return searchCounterpartiesSmart(clients, userSearch);
  }, [users, userSearch, isAdminView, onlyMyAssigned, managerId, profile?.partner_id, profile?.manager_id, showArchived]);

  const filteredStaff = useMemo(() => {
    if (!userSearch.trim()) return staffMembers;
    const q = userSearch.toLowerCase().trim();
    return staffMembers.filter(m =>
      m.name.toLowerCase().includes(q) ||
      m.username.toLowerCase().includes(q) ||
      m.phone.includes(q) ||
      (m.city && m.city.toLowerCase().includes(q))
    );
  }, [staffMembers, userSearch]);

  return (
    <div className="space-y-5">
      {/* Header & Stats */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Users className="h-5 w-5 text-slate-500" />
          <div>
            <h2 className="text-lg font-bold text-slate-900">Пользователи и роли ({users.length + staffMembers.length})</h2>
            <p className="text-xs text-slate-500">Управление сотрудниками, клиентами-дилерами, доступом и видимостью складов.</p>
          </div>
        </div>

        {/* Tab switch: All / Clients / Staff */}
        <div className="flex rounded-xl bg-slate-100 p-1 text-xs font-semibold">
          <button
            type="button"
            onClick={() => setUserTab('all')}
            className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${userTab === 'all' ? 'bg-white text-slate-900 shadow-2xs font-bold' : 'text-slate-600 hover:text-slate-900'}`}
          >
            Все ({users.length + staffMembers.length})
          </button>
          <button
            type="button"
            onClick={() => setUserTab('clients')}
            className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${userTab === 'clients' ? 'bg-white text-slate-900 shadow-2xs font-bold' : 'text-slate-600 hover:text-slate-900'}`}
          >
            Клиенты ({users.length})
          </button>
          <button
            type="button"
            onClick={() => setUserTab('staff')}
            className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${userTab === 'staff' ? 'bg-white text-slate-900 shadow-2xs font-bold' : 'text-slate-600 hover:text-slate-900'}`}
          >
            Сотрудники ({staffMembers.length})
          </button>
        </div>
      </div>

      {/* Search & Filters Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            value={userSearch}
            onChange={e => setUserSearch(e.target.value)}
            placeholder="Поиск по имени, компании, БИН, тел, городу..."
            className="input-field pl-9 py-1.5 text-xs"
          />
        </div>

        <div className="flex items-center gap-2">
          {!isAdminView && profile?.role === 'manager_rm' && (
            <button
              type="button"
              onClick={() => setOnlyMyAssigned(!onlyMyAssigned)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${onlyMyAssigned ? 'bg-brand-50 text-brand-800 border-brand-300' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
            >
              {onlyMyAssigned ? 'Все активные' : 'Только мои дилеры'}
            </button>
          )}
          {isAdminView && userTab !== 'staff' && (
            <button
              type="button"
              onClick={() => setShowArchived(!showArchived)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${showArchived ? 'bg-amber-50 text-amber-800 border-amber-300' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
            >
              {showArchived ? 'Скрыть архив/рассылку' : 'Показать архив/рассылку'}
            </button>
          )}
        </div>
      </div>

      {/* Staff Members Section (When 'all' or 'staff') */}
      {(userTab === 'all' || userTab === 'staff') && filteredStaff.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500 pt-1">
            <Shield className="h-3.5 w-3.5 text-brand-700" />
            <span>Сотрудники компании ({filteredStaff.length})</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {filteredStaff.map(m => {
              const roleBadge = m.role === 'admin'
                ? { label: 'Администратор', cls: 'bg-brand-50 text-brand-700 border-brand-200' }
                : m.role === 'manager_lm'
                ? { label: 'Логист (ЛМ)', cls: 'bg-sky-50 text-sky-700 border-sky-200' }
                : { label: 'Региональный менеджер (РМ)', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
              return (
                <div key={m.id} className="card p-3.5 flex items-center justify-between gap-3 border-slate-200 bg-white hover:border-slate-300 transition-colors">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-50 text-brand-700 shrink-0">
                      {m.role === 'admin' ? <Shield className="h-4 w-4" /> : <UserCheck className="h-4 w-4" />}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-xs font-bold text-slate-900 truncate">{m.name}</p>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${roleBadge.cls}`}>
                          {roleBadge.label}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-[11px] text-slate-500 mt-0.5">
                        {m.phone && <span className="font-mono">{m.phone}</span>}
                        {m.city && <span>• {m.city}</span>}
                      </div>
                    </div>
                  </div>
                  {m.clients_count !== undefined && m.clients_count > 0 && (
                    <span className="badge bg-slate-100 text-slate-600 text-[10px] shrink-0" title="Закреплено дилеров в ERP">
                      {m.clients_count} дилеров
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Clients Section (When 'all' or 'clients') */}
      {(userTab === 'all' || userTab === 'clients') && (
        <div className="space-y-2">
          {userTab === 'all' && (
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500 pt-2">
              <Users className="h-3.5 w-3.5 text-slate-500" />
              <span>Клиенты и дилеры ({filteredClients.length})</span>
            </div>
          )}

          <div className="space-y-2" key={`wh-v-${warehouseVersion}`}>
            {filteredClients.map(u => (
              <AdminClientUserCard
                key={u.id}
                user={u}
                currentUserId={currentUser?.id}
                togglingId={togglingId}
                expandedId={expandedId}
                onToggleWarehouse={handleToggleWarehouseVisibility}
                onOpenWarehouseModal={setWarehouseModalUser}
                onToggleAccess={handleToggleAccess}
                onToggleExpand={id => setExpandedId(expandedId === id ? null : id)}
                onImpersonate={client => {
                  impersonateUser(client as any);
                  onNavigate('catalog');
                }}
              />
            ))}
          </div>
        </div>
      )}

      {!loading && filteredClients.length === 0 && filteredStaff.length === 0 && (
        <div className="card py-12 text-center text-sm text-slate-400">
          Пользователи не найдены. Попробуйте изменить поисковый запрос.
        </div>
      )}

      {/* Modal for detailed warehouse configuration */}
      {warehouseModalUser && (
        <ClientWarehouseModal
          client={warehouseModalUser}
          onClose={() => {
            setWarehouseModalUser(null);
            setWarehouseVersion(v => v + 1);
          }}
        />
      )}
    </div>
  );
}

export default AdminUsersTab;
