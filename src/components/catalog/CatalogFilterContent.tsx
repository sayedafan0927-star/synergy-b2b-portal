import { useState, useEffect, useMemo } from 'react';
import { Search, X, UserCheck, Check } from 'lucide-react';
import { parseSizeDimensions } from '@/types';
import { useAuth } from '@/contexts/AuthContext';
import { useCart } from '@/contexts/CartContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useCurrency } from '@/contexts/CurrencyContext';
import { isCentralWarehouse } from '@/lib/warehouseVisibility';
import { fetchCounterpartiesFromErp, searchCounterpartiesSmart, isCounterpartyActive, type Counterparty } from '@/lib/erpApi';
import type { FilterDrawerProps } from './types';
import { FilterSection, CheckItem } from './FilterDrawer';

export interface CatalogFilterContentProps extends Omit<FilterDrawerProps, 'open'> {
  onApply?: () => void;
}

export function CatalogFilterContent({
  onClose,
  onApply,
  searchQuery,
  setSearchQuery,
  priceMin = '',
  setPriceMin,
  priceMax = '',
  setPriceMax,
  selectedCollections,
  toggleCollection,
  selectedManufacturers,
  toggleManufacturer,
  selectedCountries,
  toggleCountry,
  selectedWarehouses,
  toggleWarehouse,
  selectedSizes,
  toggleSize,
  selectedClusters,
  toggleCluster,
  onlyInProduction = false,
  setOnlyInProduction,
  activeFilterCount,
  resetFilters,
  allCollections,
  allManufacturers,
  allCountries,
  allWarehouses,
  allSizes,
}: CatalogFilterContentProps) {
  const { t } = useLanguage();
  const { currencyUnitLabel } = useCurrency();
  const { user, isAdmin, isImpersonating, profile } = useAuth();
  const { targetClient, setTargetClient } = useCart();
  const isAdminView = Boolean(!isImpersonating && (isAdmin || profile?.role === 'admin'));
  const canViewAllWarehouses = Boolean(!isImpersonating && (isAdmin || profile?.role === 'admin' || profile?.role === 'manager_lm'));
  const roleShortLabel = profile?.role === 'manager_lm' ? 'ЛМ' : 'Админ';

  const [cpSearch, setCpSearch] = useState('');
  const [counterparties, setCounterparties] = useState<Counterparty[]>([]);

  useEffect(() => {
    if (!canViewAllWarehouses) return;
    let active = true;
    fetchCounterpartiesFromErp({ includeArchived: false })
      .then(res => {
        if (active && res?.success && Array.isArray(res.counterparties)) {
          setCounterparties(res.counterparties.filter((c: any) => isCounterpartyActive(c)));
        }
      })
      .catch(() => {});
    return () => { active = false; };
  }, [canViewAllWarehouses]);

  // Список «за кого в корзину» — склады комиссионеров; выбор склада назначает его владельца-контрагента
  const warehouseEntries = useMemo(() => {
    const seen = new Set<string>();
    const out: Array<{ id: string; key: string; warehouse: string; owner: Counterparty; name: string; city?: string; phone?: string; bin?: string; showroom_warehouse_names: string[] }> = [];
    for (const cp of counterparties as any[]) {
      const names: string[] = [
        ...(Array.isArray(cp.showroom_warehouse_names) ? cp.showroom_warehouse_names : []),
        ...(Array.isArray(cp.linked_warehouse_names) ? cp.linked_warehouse_names : []),
      ];
      for (const w of names) {
        const key = String(w).toLowerCase().trim();
        if (!key || seen.has(key) || isCentralWarehouse({ warehouse_name: w })) continue;
        seen.add(key);
        out.push({ id: key, key, warehouse: w, owner: cp, name: w, city: cp.city, phone: cp.phone, bin: cp.bin, showroom_warehouse_names: [w] });
      }
    }
    return out.sort((x, y) => x.warehouse.localeCompare(y.warehouse, 'ru'));
  }, [counterparties]);

  const filteredWarehouseEntries = useMemo(
    () => searchCounterpartiesSmart(warehouseEntries, cpSearch, 40),
    [warehouseEntries, cpSearch]
  );

  const rugSizes = useMemo(
    () =>
      allSizes.filter(s => {
        const { w, h } = parseSizeDimensions(s);
        return Math.max(w, h) / Math.min(w, h) < 2.5;
      }),
    [allSizes],
  );

  const runnerSizes = useMemo(
    () =>
      allSizes.filter(s => {
        const { w, h } = parseSizeDimensions(s);
        return Math.max(w, h) / Math.min(w, h) >= 2.5;
      }),
    [allSizes],
  );

  const handleApply = () => {
    if (onApply) onApply();
    else if (onClose) onClose();
  };

  return (
    <div className="flex flex-col min-h-0 flex-1 h-full">
      <div className="min-h-0 flex-1 overflow-y-auto px-5 thin-scrollbar">
        <div className="py-4 border-b border-slate-100">
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                if (typeof window !== 'undefined' && window.innerWidth < 1024 && onClose) {
                  onClose();
                }
                window.dispatchEvent(new CustomEvent('synergy:open-command-palette', { detail: { initialQuery: searchQuery } }));
              }}
              className="w-full flex items-center gap-2.5 rounded-lg border border-slate-200 bg-white pl-3 pr-8 py-2.5 text-sm text-left transition-colors hover:border-brand-400 hover:bg-slate-50/60 cursor-pointer min-w-0"
            >
              <Search className="h-4 w-4 text-brand-600 shrink-0" />
              <span className={`truncate ${searchQuery ? 'text-slate-900 font-medium' : 'text-slate-400'}`}>
                {searchQuery || t('catalog.search_ph')}
              </span>
            </button>
            {searchQuery && (
              <button
                type="button"
                onClick={e => { e.stopPropagation(); setSearchQuery(''); }}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
                aria-label={t('common.reset')}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          {Boolean(user) && setOnlyInProduction && (
            <div className="mt-3">
              <CheckItem
                label="🏭 В производстве (Доступно к предзаказу)"
                checked={Boolean(onlyInProduction)}
                onToggle={() => setOnlyInProduction(prev => !prev)}
              />
            </div>
          )}
        </div>

        {/* 1. ЦЕНА ЗА 1 М² (ОТ / ДО) — в самом верху бокового фильтра */}
        {setPriceMin && setPriceMax && (
          <FilterSection title={`ЦЕНА ЗА 1 М² (${currencyUnitLabel})`} defaultOpen={true}>
            <div className="grid grid-cols-2 gap-2.5">
              <div className="relative">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[11px] font-medium text-slate-400 pointer-events-none">
                  От
                </span>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.5"
                  value={priceMin}
                  onChange={e => setPriceMin(e.target.value)}
                  placeholder="0"
                  className="input-field pl-8 pr-6 py-2 text-base sm:text-sm font-medium"
                />
                {priceMin && (
                  <button
                    type="button"
                    onClick={() => setPriceMin('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                    aria-label="Очистить цену от"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <div className="relative">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[11px] font-medium text-slate-400 pointer-events-none">
                  До
                </span>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.5"
                  value={priceMax}
                  onChange={e => setPriceMax(e.target.value)}
                  placeholder="14"
                  className="input-field pl-8 pr-6 py-2 text-base sm:text-sm font-medium"
                />
                {priceMax && (
                  <button
                    type="button"
                    onClick={() => setPriceMax('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                    aria-label="Очистить цену до"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
            {(priceMin || priceMax) && (
              <p className="mt-2 text-[11px] text-brand-700 font-medium">
                Найдено коллекций: {allCollections.length}
              </p>
            )}
          </FilterSection>
        )}

        {/* 2. КОЛЛЕКЦИЯ — сразу под ценой, чтобы при вводе цены клиент мгновенно видел подходящие коллекции */}
        <FilterSection title={t('catalog.filter_collection')} defaultOpen={true}>
          {allCollections.length > 0 ? (
            allCollections.map(c => (
              <CheckItem key={c} label={c} checked={selectedCollections.has(c)} onToggle={() => toggleCollection(c)} />
            ))
          ) : (
            <p className="text-xs text-slate-400 py-1">Нет коллекций по выбранным параметрам</p>
          )}
        </FilterSection>

        {/* 2.5. ВЫБОР ЗА КОГО КЛАСТЬ В КОРЗИНУ (ТОЛЬКО ДЛЯ ЛМ И АДМИНА) */}
        {canViewAllWarehouses && (
          <FilterSection title={`ЗА КОГО В КОРЗИНУ (УЧЕТКА ${roleShortLabel})`} defaultOpen={true}>
            {targetClient ? (
              <div className="rounded-xl bg-emerald-50/80 border border-emerald-200 p-2.5 space-y-1.5 text-xs">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-bold text-emerald-950 truncate">{targetClient.name}</p>
                    {targetClient.city && (
                      <p className="text-[11px] text-emerald-700">г. {targetClient.city}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setTargetClient(null)}
                    className="p-1 rounded text-emerald-700 hover:bg-emerald-100 cursor-pointer shrink-0"
                    title="Сбросить клиента"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="flex items-center gap-1.5 pt-1 border-t border-emerald-200/70 text-[10.5px] font-semibold text-emerald-800">
                  <UserCheck className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                  <span>Под учёткой {roleShortLabel}: {profile?.full_name || roleShortLabel}</span>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="relative">
                  <Search className="h-3.5 w-3.5 text-slate-400 absolute left-2.5 top-2.5 pointer-events-none" />
                  <input
                    type="text"
                    value={cpSearch}
                    onChange={e => setCpSearch(e.target.value)}
                    placeholder="Найти склад комиссионера..."
                    className="input-field text-xs h-8 pl-8 pr-6 py-1"
                  />
                  {cpSearch && (
                    <button
                      type="button"
                      onClick={() => setCpSearch('')}
                      className="absolute right-2 top-2 text-slate-400 hover:text-slate-600 cursor-pointer"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <div className="max-h-36 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50/60 divide-y divide-slate-100">
                  {filteredWarehouseEntries.map(entry => (
                    <button
                      key={entry.key}
                      type="button"
                      onClick={() => {
                        const cp = entry.owner;
                        setTargetClient({
                          id: cp.id,
                          name: cp.name,
                          city: cp.city,
                          phone: cp.phone,
                          portal_login: cp.portal_login,
                          price_type: cp.price_type,
                        });
                        setCpSearch('');
                      }}
                      className="w-full text-left px-2.5 py-1.5 text-xs hover:bg-brand-50 transition-colors flex items-center justify-between gap-2 cursor-pointer"
                    >
                      <span className="min-w-0 truncate font-medium text-slate-800">
                        {entry.warehouse}
                        <span className="block truncate text-[10px] font-normal text-slate-500">{entry.owner.name}</span>
                      </span>
                      {entry.city && <span className="text-[10px] text-slate-500 shrink-0">{entry.city}</span>}
                    </button>
                  ))}
                  {filteredWarehouseEntries.length === 0 && (
                    <p className="p-2 text-[11px] text-slate-400 text-center">Склады не найдены</p>
                  )}
                </div>
                <p className="text-[10.5px] text-slate-500 leading-tight">
                  Выберите склад комиссионера, чтобы положить товары в корзину за него с отметкой вашей учётной записи ({roleShortLabel}).
                </p>
              </div>
            )}
          </FilterSection>
        )}

        {/* 3. СКЛАД (Все склады видят только Админ и ЛМ; дилер видит только при наличии своего шоурума) */}
        {(canViewAllWarehouses || allWarehouses.length > 1) && (
          <FilterSection title={t('catalog.filter_warehouse')} defaultOpen={true}>
            {allWarehouses.map(w => (
              <CheckItem key={w} label={w} checked={selectedWarehouses.has(w)} onToggle={() => toggleWarehouse(w)} />
            ))}
          </FilterSection>
        )}

        {/* 4. КЛАСТЕРЫ РАЗМЕРОВ */}
        <FilterSection title={t('catalog.filter_clusters') || 'КЛАСТЕРЫ РАЗМЕРОВ'} defaultOpen={true}>
          <CheckItem label={t('catalog.cluster_small')} checked={selectedClusters.has('small')} onToggle={() => toggleCluster('small')} />
          <CheckItem label={t('catalog.cluster_medium')} checked={selectedClusters.has('medium')} onToggle={() => toggleCluster('medium')} />
          <CheckItem label={t('catalog.cluster_large')} checked={selectedClusters.has('large')} onToggle={() => toggleCluster('large')} />
          <CheckItem label={t('catalog.cluster_oversize')} checked={selectedClusters.has('oversize')} onToggle={() => toggleCluster('oversize')} />
        </FilterSection>

        <FilterSection title={t('catalog.filter_size')} defaultOpen={false}>
          {rugSizes.length > 0 && (
            <div className="mb-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1.5">{t('catalog.category_rugs')}</p>
              {rugSizes.map(s => (
                <CheckItem key={s} label={s} checked={selectedSizes.has(s)} onToggle={() => toggleSize(s)} />
              ))}
            </div>
          )}
          {runnerSizes.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1.5">{t('catalog.category_runners')}</p>
              {runnerSizes.map(s => (
                <CheckItem key={s} label={s} checked={selectedSizes.has(s)} onToggle={() => toggleSize(s)} />
              ))}
            </div>
          )}
        </FilterSection>

        {isAdminView && (
          <FilterSection title={t('catalog.filter_manufacturer')}>
            {allManufacturers.map(m => (
              <CheckItem key={m} label={m} checked={selectedManufacturers.has(m)} onToggle={() => toggleManufacturer(m)} />
            ))}
          </FilterSection>
        )}

        <FilterSection title={t('catalog.filter_country')}>
          {allCountries.map(c => (
            <CheckItem key={c} label={c} checked={selectedCountries.has(c)} onToggle={() => toggleCountry(c)} />
          ))}
        </FilterSection>
      </div>

      <div className="border-t border-slate-100 px-5 py-4 space-y-2 shrink-0 bg-white">
        <button type="button" onClick={handleApply} className="btn-primary w-full cursor-pointer">
          {t('catalog.show_results')}
        </button>
        {activeFilterCount > 0 && (
          <button type="button" onClick={resetFilters} className="btn-secondary w-full text-sm cursor-pointer">
            {t('catalog.reset_filters')}
          </button>
        )}
      </div>
    </div>
  );
}
