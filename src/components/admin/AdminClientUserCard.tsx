import {
  User,
  Building2,
  Power,
  FileText,
  UserCog,
  ChevronDown,
  Settings,
} from 'lucide-react';
import { getClientWarehouseSettings } from '@/lib/warehouseVisibility';
import { formatPriceType } from '@/lib/pricingEngine';
import { ClientDemoPanel } from './ClientDemoPanel';
import type { UserRole } from '@/contexts/AuthContext';

export interface ClientUserItem {
  id: string;
  full_name: string;
  company_name: string;
  phone: string;
  city?: string;
  bin?: string;
  role: UserRole;
  partner_id: string | null;
  price_type: string;
  manager_id: string | null;
  impersonation_enabled: boolean;
  portal_access_enabled?: boolean;
  is_archived_or_mailing?: boolean;
  showroom_warehouse_id?: number | null;
  showroom_warehouse_name?: string | null;
  credit_limit_usd?: number;
  debt_usd?: number;
}

export interface AdminClientUserCardProps {
  user: ClientUserItem;
  currentUserId?: string;
  togglingId: string | null;
  expandedId: string | null;
  onToggleWarehouse: (clientId: string) => void;
  onOpenWarehouseModal: (user: ClientUserItem) => void;
  onToggleAccess: (userId: string, currentEnabled: boolean) => void;
  onToggleExpand: (userId: string) => void;
  onImpersonate: (user: ClientUserItem) => void;
}

export function AdminClientUserCard({
  user: u,
  currentUserId,
  togglingId,
  expandedId,
  onToggleWarehouse,
  onOpenWarehouseModal,
  onToggleAccess,
  onToggleExpand,
  onImpersonate,
}: AdminClientUserCardProps) {
  const s = getClientWarehouseSettings(u.partner_id || u.id);
  const isWhOn = s.mode === 'custom'
    ? Boolean(s.showCentralWarehouse || s.showShowroomWarehouse || s.showWarehousesToClient)
    : true;

  return (
    <div className="card px-4 py-3 hover:border-slate-300 transition-colors">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Client Info */}
        <div className="flex items-center gap-3 min-w-[220px] flex-1">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 shrink-0">
            <User className="h-5 w-5 text-slate-500" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-xs sm:text-sm font-semibold text-slate-900 truncate">{u.full_name || u.company_name}</p>
              {u.id === currentUserId && (
                <span className="badge bg-slate-100 text-slate-600 text-[10px]">Вы</span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500 mt-0.5">
              {u.city && <span>г. {u.city}</span>}
              {u.phone && <span className="font-mono text-slate-400">{u.phone}</span>}
              {u.price_type && (
                <span className="text-brand-600 font-medium">{formatPriceType(u.price_type)}</span>
              )}
              {u.partner_id && <span className="font-mono text-slate-400">ID: {u.partner_id}</span>}
              {u.showroom_warehouse_name && (
                <span className="text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded text-[10px] font-medium truncate max-w-[180px]">
                  🏬 {u.showroom_warehouse_name}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Action Controls: Warehouse Toggle, Portal Access, Demo, Impersonate */}
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
          {/* 1. Галка/тумблер «Видимость складов» */}
          <button
            type="button"
            onClick={() => onToggleWarehouse(u.partner_id || u.id)}
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors cursor-pointer border ${
              isWhOn
                ? 'bg-blue-50 text-blue-700 border-blue-300 hover:bg-blue-100'
                : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100'
            }`}
            title={isWhOn ? 'Видимость складов ВКЛЮЧЕНА. Нажмите, чтобы скрыть склады от клиента.' : 'Видимость складов ВЫКЛЮЧЕНА (по умолчанию). Нажмите, чтобы открыть видимость складов.'}
          >
            <Building2 className={`h-3.5 w-3.5 ${isWhOn ? 'text-blue-600' : 'text-slate-400'}`} />
            <span>{isWhOn ? 'Склады: Вкл' : 'Склады: Выкл'}</span>
          </button>

          {/* Детальная настройка складов */}
          <button
            type="button"
            onClick={() => onOpenWarehouseModal(u)}
            className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-700 transition-colors cursor-pointer"
            title="Детальная настройка складов клиента"
            aria-label="Настроить склады"
          >
            <Settings className="h-3.5 w-3.5" />
          </button>

          {/* 2. Тумблер «Доступ к порталу» */}
          <button
            type="button"
            onClick={() => onToggleAccess(u.id, u.portal_access_enabled ?? u.impersonation_enabled)}
            disabled={togglingId === u.id}
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors cursor-pointer border ${
              (u.portal_access_enabled ?? u.impersonation_enabled)
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                : 'bg-rose-50 text-rose-600 border-rose-200 hover:bg-rose-100'
            }`}
            title={(u.portal_access_enabled ?? u.impersonation_enabled) ? 'Доступ к сайту открыт. Нажмите для блокировки.' : 'Доступ закрыт. Нажмите для открытия.'}
          >
            <Power className="h-3.5 w-3.5" />
            <span>{togglingId === u.id ? 'Синхр...' : ((u.portal_access_enabled ?? u.impersonation_enabled) ? 'Доступ вкл.' : 'Доступ выкл.')}</span>
          </button>

          {/* 3. Демо-панель */}
          <button
            type="button"
            onClick={() => onToggleExpand(u.id)}
            className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-colors cursor-pointer"
          >
            <FileText className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Демо</span>
            <ChevronDown className={`h-3 w-3 transition-transform ${expandedId === u.id ? 'rotate-180' : ''}`} />
          </button>

          {/* 4. Войти под клиентом */}
          <button
            type="button"
            onClick={() => onImpersonate(u)}
            disabled={!u.impersonation_enabled || u.id === currentUserId}
            title={!u.impersonation_enabled ? 'Сначала включите доступ клиенту' : `Войти как ${u.full_name || u.company_name}`}
            className="flex items-center gap-1.5 rounded-lg border border-brand-200 bg-brand-50 px-2.5 sm:px-3 py-1.5 text-xs font-semibold text-brand-700 hover:bg-brand-100 transition-colors disabled:opacity-40 disabled:pointer-events-none shadow-2xs cursor-pointer"
          >
            <UserCog className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Войти</span>
          </button>
        </div>
      </div>

      {expandedId === u.id && (
        <ClientDemoPanel client={u} />
      )}
    </div>
  );
}

export default AdminClientUserCard;
