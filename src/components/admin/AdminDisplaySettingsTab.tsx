import { useState, useEffect, useMemo } from 'react';
import {
  Eye,
  CheckCircle2,
  Building2,
  Users,
  Search,
} from 'lucide-react';
import type { UserRole } from '@/contexts/AuthContext';
import {
  fetchDisplaySettingsFromErp,
  saveDisplaySettingsToErp,
  fetchCounterpartiesFromErp,
} from '@/lib/erpApi';
import { triggerDisplaySettingsReload } from '@/hooks/useDisplaySettings';
import { getClientWarehouseSettings } from '@/lib/warehouseVisibility';
import { ClientWarehouseModal } from './ClientWarehouseModal';

export interface DisplaySettings {
  show_stock: boolean;
  show_reserve: boolean;
  show_total_pcs: boolean;
  show_sqm: boolean;
  show_price: boolean;
  show_hub_warehouse?: boolean;
  show_showroom_warehouse?: boolean;
  hidden_warehouses?: number[];
  hide_out_of_stock_products?: boolean;
}

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

export function AdminDisplaySettingsTab() {
  const roles: UserRole[] = ['admin', 'manager_rm', 'manager_lm', 'supplier', 'client'];
  const defaultMap: Record<string, DisplaySettings> = {
    admin: { show_stock: true, show_reserve: true, show_total_pcs: true, show_sqm: true, show_price: true, show_hub_warehouse: true, show_showroom_warehouse: true, hidden_warehouses: [], hide_out_of_stock_products: false },
    manager_rm: { show_stock: true, show_reserve: true, show_total_pcs: true, show_sqm: true, show_price: true, show_hub_warehouse: true, show_showroom_warehouse: true, hidden_warehouses: [], hide_out_of_stock_products: false },
    manager_lm: { show_stock: true, show_reserve: false, show_total_pcs: true, show_sqm: true, show_price: true, show_hub_warehouse: true, show_showroom_warehouse: true, hidden_warehouses: [], hide_out_of_stock_products: true },
    supplier: { show_stock: true, show_reserve: false, show_total_pcs: true, show_sqm: true, show_price: false, show_hub_warehouse: true, show_showroom_warehouse: false, hidden_warehouses: [], hide_out_of_stock_products: false },
    client: { show_stock: true, show_reserve: false, show_total_pcs: true, show_sqm: true, show_price: true, show_hub_warehouse: true, show_showroom_warehouse: true, hidden_warehouses: [], hide_out_of_stock_products: true },
  };

  const isFeatureEnabled = (role: string, key: keyof DisplaySettings) => {
    const val = settings[role]?.[key];
    if (val !== undefined) return Boolean(val);
    if (key === 'hide_out_of_stock_products') {
      return role === 'client' || role === 'manager_lm';
    }
    return true;
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
  const [exchangeRate, setExchangeRate] = useState<number>(520.00);
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
        if ((erpSettings as any).exchange_rate_usd_kzt) {
          setExchangeRate(Number((erpSettings as any).exchange_rate_usd_kzt));
        }
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
    setSettings(prev => {
      const currentVal = isFeatureEnabled(role, field);
      return {
        ...prev,
        [role]: { ...prev[role], [field]: !currentVal },
      };
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);

    const clientSettings = settings['client'];
    try {
      await saveDisplaySettingsToErp({
        show_free_stock: clientSettings?.show_stock,
        show_reserved_stock: clientSettings?.show_reserve,
        show_to_ship_stock: clientSettings?.show_total_pcs,
        show_total_stock: clientSettings?.show_total_pcs,
        show_prices: clientSettings?.show_price,
        show_price_per_sqm: clientSettings?.show_sqm,
        show_discounts: true,
        show_dealer_showroom: clientSettings?.show_showroom_warehouse !== false,
        allow_orders_when_zero_stock: false,
        exchange_rate_usd_kzt: exchangeRate,
      } as any);
    } catch (err) {
      console.warn('[AdminDisplaySettings] Save to ERP warning:', err);
    }

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
    { key: 'hide_out_of_stock_products' as const, label: 'Скрывать 0 шт.' },
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

      {/* Официальный курс валюты USD / KZT */}
      <div className="card p-4 bg-gradient-to-r from-amber-50/70 to-orange-50/50 border border-amber-200/80 rounded-xl shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-amber-900 bg-amber-200/80 px-1.5 py-0.5 rounded">
                Финансовый контур
              </span>
              <h3 className="text-sm font-bold text-slate-900">Официальный курс валюты (USD / KZT)</h3>
            </div>
            <p className="text-xs text-slate-600 mt-0.5">
              Установленный курс фиксируется при оформлении каждого заказа дилером (applied_exchange_rate).
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 bg-white border border-amber-300 rounded-lg px-2.5 py-1.5 shadow-sm">
              <span className="text-xs font-semibold text-slate-500">1 USD =</span>
              <input
                type="number"
                step="0.01"
                min="1"
                value={exchangeRate}
                onChange={e => setExchangeRate(Number(e.target.value) || 0)}
                className="w-20 text-right font-bold text-slate-900 focus:outline-none text-xs"
              />
              <span className="text-xs font-semibold text-slate-700">KZT</span>
            </div>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-3 py-1.5 text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white rounded-lg transition-colors shadow-sm cursor-pointer disabled:opacity-50"
            >
              {saved ? 'Курс сохранён!' : 'Сохранить курс'}
            </button>
          </div>
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
                        className={`h-5 w-5 rounded border transition-colors inline-flex items-center justify-center cursor-pointer ${
                          isFeatureEnabled(role, c.key) ? 'bg-brand-600 border-brand-600' : 'bg-white border-slate-300'
                        }`}
                      >
                        {isFeatureEnabled(role, c.key) && (
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
          <button onClick={handleSave} disabled={saving} className="btn-primary text-sm cursor-pointer">
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

export default AdminDisplaySettingsTab;
