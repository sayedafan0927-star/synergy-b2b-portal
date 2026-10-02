import { useState, useEffect, useMemo, useCallback } from 'react';
import { fetchSuppliersFromErp } from '@/lib/erpApi';
import {
  Building2,
  RefreshCw,
  FileText,
  Warehouse as WarehouseIcon,
  Truck,
  ShieldAlert,
  ChevronDown,
} from 'lucide-react';
import {
  FALLBACK_SUPPLIERS,
  type SupplierCabinetProps,
  type SupplierSubTab,
  type SupplierItem,
  SupplierStockTab,
  SupplierReleasesTab,
  SupplierInboundTab,
  SupplierDefectsTab,
} from './supplier';
import { useLanguage } from '@/contexts/LanguageContext';

export default function SupplierCabinet({ profile, isAdmin: propIsAdmin }: SupplierCabinetProps) {
  const { t } = useLanguage();
  const isAdmin = propIsAdmin ?? (profile.role === 'admin');
  const [suppliersList, setSuppliersList] = useState<SupplierItem[]>(FALLBACK_SUPPLIERS);

  // Загрузка динамического списка фабрик из ERP (action=suppliers)
  useEffect(() => {
    let cancelled = false;
    async function loadSuppliers() {
      try {
        const erpSuppliers = await fetchSuppliersFromErp();
        if (!cancelled && erpSuppliers && erpSuppliers.length > 0) {
          const mapped = erpSuppliers.map(s => ({
            id: s.id,
            name: s.country ? `${s.name} (${s.country})` : s.name,
            country: s.country,
          }));
          setSuppliersList(mapped);
        }
      } catch (err) {
        console.warn('[SupplierCabinet] Error fetching dynamic suppliers:', err);
      }
    }
    loadSuppliers();
    return () => { cancelled = true; };
  }, []);

  const defaultSupplierId = useMemo(() => {
    if (isAdmin) {
      return suppliersList[0]?.id || 1;
    }
    const parsed = Number(profile.partner_id);
    return !isNaN(parsed) && parsed > 0 ? parsed : (suppliersList[0]?.id || 1);
  }, [isAdmin, profile.partner_id, suppliersList]);

  const [selectedSupplierId, setSelectedSupplierId] = useState<number>(defaultSupplierId);
  const [activeSubTab, setActiveSubTab] = useState<SupplierSubTab>('stock');
  const [reloadCounter, setReloadCounter] = useState(0);

  useEffect(() => {
    if (!isAdmin && defaultSupplierId > 0 && selectedSupplierId !== defaultSupplierId) {
      setSelectedSupplierId(defaultSupplierId);
    }
  }, [isAdmin, defaultSupplierId, selectedSupplierId]);

  const selectedSupplierObj = useMemo(
    () => suppliersList.find(s => s.id === selectedSupplierId),
    [suppliersList, selectedSupplierId]
  );

  const handleRefresh = useCallback(() => {
    setReloadCounter(c => c + 1);
  }, []);

  return (
    <div className="space-y-6">
      {/* Header кабинета */}
      <div className="card p-4 sm:p-6 border-l-4 border-l-brand-600 bg-gradient-to-r from-brand-50/50 via-white to-white overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3.5 sm:gap-4">
          <div className="flex items-start sm:items-center gap-3 min-w-0">
            <div className="flex h-10 w-10 sm:h-12 sm:w-12 shrink-0 items-center justify-center rounded-xl bg-brand-700 text-white shadow-md">
              <Building2 className="h-5 w-5 sm:h-6 sm:w-6" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                <h2 className="text-lg sm:text-xl font-bold text-slate-900 truncate">
                  {selectedSupplierId === 0
                    ? t('supplier.all_factories', 'Общий реестр всех фабрик')
                    : (selectedSupplierObj?.name || t('supplier.factory_cabinet', 'Кабинет фабрики'))}
                </h2>
                <span className="badge bg-amber-100 text-amber-800 border border-amber-300/50 text-[10px] font-bold shrink-0">
                  {t('supplier.b2b_factory_badge', 'B2B Фабрика')}
                </span>
                {!isAdmin && selectedSupplierId > 0 && (
                  <span className="badge bg-slate-100 text-slate-600 text-[10px] shrink-0">
                    ID: {selectedSupplierId}
                  </span>
                )}
              </div>
              <p className="text-[11px] sm:text-xs text-slate-500 mt-0.5 line-clamp-1 sm:line-clamp-none">
                {t('supplier.integration_desc', 'Прямая интеграция с распределительной сетью Synergiya Group в Казахстане')}
              </p>
            </div>
          </div>

          {/* Панель управления фабрикой: селектор только для администраторов */}
          <div className="flex items-center gap-2 w-full md:w-auto">
            {isAdmin ? (
              <div className="flex items-center gap-2 flex-1 md:flex-initial min-w-0">
                <span className="text-xs text-slate-500 whitespace-nowrap hidden sm:inline">{t('supplier.factory_label', 'Фабрика:')}</span>
                <div className="relative flex-1 md:flex-initial min-w-0">
                  <select
                    value={selectedSupplierId}
                    onChange={e => setSelectedSupplierId(Number(e.target.value))}
                    className="w-full appearance-none rounded-lg border border-slate-300 bg-white py-1.5 pl-2.5 sm:pl-3 pr-7 sm:pr-8 text-xs font-semibold text-slate-800 shadow-xs focus:border-brand-500 focus:outline-none cursor-pointer truncate"
                  >
                    <option value={0}>{t('supplier.main_wh_all', 'Основной Склад Астана (все)')}</option>
                    {suppliersList.map(sup => (
                      <option key={sup.id} value={sup.id}>
                        {sup.name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2 sm:right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                </div>
              </div>
            ) : null}

            <button
              onClick={handleRefresh}
              title={t('common.refresh', 'Обновить')}
              className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 hover:text-brand-700 transition-colors shadow-xs cursor-pointer shrink-0"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{t('common.refresh', 'Обновить')}</span>
            </button>
          </div>
        </div>

        {/* Sub-nav tabs with smooth horizontal touch-scroll */}
        <div className="-mx-4 px-4 sm:mx-0 sm:px-0 mt-4 sm:mt-6 flex border-b border-slate-200 gap-1 sm:gap-2 overflow-x-auto no-scrollbar scroll-smooth">
          <button
            onClick={() => setActiveSubTab('stock')}
            className={`flex items-center gap-1.5 sm:gap-2 pb-2.5 sm:pb-3 px-2 sm:px-3 text-xs sm:text-sm font-medium transition-colors border-b-2 -mb-px whitespace-nowrap cursor-pointer shrink-0 ${
              activeSubTab === 'stock'
                ? 'border-brand-700 text-brand-700 font-bold'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <WarehouseIcon className="h-4 w-4" />
            {t('supplier.tab_stock_geo', 'География остатков сети')}
          </button>

          <button
            onClick={() => setActiveSubTab('releases')}
            className={`flex items-center gap-1.5 sm:gap-2 pb-2.5 sm:pb-3 px-2 sm:px-3 text-xs sm:text-sm font-medium transition-colors border-b-2 -mb-px whitespace-nowrap cursor-pointer shrink-0 ${
              activeSubTab === 'releases'
                ? 'border-brand-700 text-brand-700 font-bold'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <FileText className="h-4 w-4" />
            {t('supplier.tab_releases', 'Акт реализации / Выпуски')}
          </button>

          <button
            onClick={() => setActiveSubTab('inbound')}
            className={`flex items-center gap-1.5 sm:gap-2 pb-2.5 sm:pb-3 px-2 sm:px-3 text-xs sm:text-sm font-medium transition-colors border-b-2 -mb-px whitespace-nowrap cursor-pointer shrink-0 ${
              activeSubTab === 'inbound'
                ? 'border-brand-700 text-brand-700 font-bold'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Truck className="h-4 w-4" />
            {t('supplier.tab_inbound', 'Приемка партий и расхождения')}
          </button>

          <button
            onClick={() => setActiveSubTab('defects')}
            className={`flex items-center gap-1.5 sm:gap-2 pb-2.5 sm:pb-3 px-2 sm:px-3 text-xs sm:text-sm font-medium transition-colors border-b-2 -mb-px whitespace-nowrap cursor-pointer shrink-0 ${
              activeSubTab === 'defects'
                ? 'border-brand-700 text-brand-700 font-bold'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <ShieldAlert className="h-4 w-4" />
            {t('supplier.tab_defects', 'Брак и рекламации')}
          </button>
        </div>
      </div>

      {/* Вкладки кабинета поставщика */}
      {activeSubTab === 'stock' && (
        <SupplierStockTab
          selectedSupplierId={selectedSupplierId}
          reloadCounter={reloadCounter}
        />
      )}

      {activeSubTab === 'releases' && (
        <SupplierReleasesTab
          selectedSupplierId={selectedSupplierId}
          reloadCounter={reloadCounter}
          supplierName={selectedSupplierObj?.name}
        />
      )}

      {activeSubTab === 'inbound' && (
        <SupplierInboundTab
          selectedSupplierId={selectedSupplierId}
          reloadCounter={reloadCounter}
          supplierName={selectedSupplierObj?.name}
        />
      )}

      {activeSubTab === 'defects' && (
        <SupplierDefectsTab
          selectedSupplierId={selectedSupplierId}
          reloadCounter={reloadCounter}
          supplierName={selectedSupplierObj?.name}
        />
      )}
    </div>
  );
}
