import { useState, useEffect, useMemo, useCallback } from 'react';
import { fetchSupplierNetworkStock, fetchSuppliersFromErp } from '@/lib/erpApi';
import type {
  SupplierNetworkStockResponse,
  SupplierReleasesReport,
  SupplierStockItem,
  SupplierDistribution,
  SupplierInfo
} from '@/types';
import type { Profile } from '@/contexts/AuthContext';
import {
  Building2,
  Printer,
  RefreshCw,
  FileText,
  Search,
  Store,
  Warehouse as WarehouseIcon,
  TrendingUp,
  Layers,
  ChevronDown,
  AlertCircle
} from 'lucide-react';

interface SupplierCabinetProps {
  profile: Profile;
  isAdmin?: boolean;
}

const FALLBACK_SUPPLIERS = [
  { id: 6, name: 'ISMEN (Турция)' },
  { id: 7, name: 'MERINOS (Турция)' },
  { id: 10, name: 'KARMEN HALI (Турция)' },
  { id: 11, name: 'SAYDAM (Турция)' },
  { id: 1, name: 'Merinos Россия (Россия)' },
  { id: 8, name: 'IRAN (Иран)' },
  { id: 9, name: 'GHEYTARAN (Иран)' },
  { id: 12, name: 'LYSANDRA HALI (Турция)' },
];

export default function SupplierCabinet({ profile, isAdmin: propIsAdmin }: SupplierCabinetProps) {
  const isAdmin = propIsAdmin ?? (profile.role === 'admin');
  const [suppliersList, setSuppliersList] = useState<Array<{ id: number; name: string; country?: string }>>(FALLBACK_SUPPLIERS);

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

  // Выбираем ID поставщика: если у профиля есть partner_id или erp_id, иначе 6 (ISMEN)
  const defaultSupplierId = useMemo(() => {
    const parsed = Number(profile.partner_id);
    return !isNaN(parsed) && parsed > 0 ? parsed : 6;
  }, [profile.partner_id]);

  const [selectedSupplierId, setSelectedSupplierId] = useState<number>(defaultSupplierId);
  const [activeSubTab, setActiveSubTab] = useState<'stock' | 'releases'>('stock');

  // Если пользователь не админ, принудительно фиксируем его ID на его фабрике
  useEffect(() => {
    if (!isAdmin && defaultSupplierId > 0 && selectedSupplierId !== defaultSupplierId) {
      setSelectedSupplierId(defaultSupplierId);
    }
  }, [isAdmin, defaultSupplierId, selectedSupplierId]);

  // Данные остатков сети
  const [stockData, setStockData] = useState<SupplierNetworkStockResponse | null>(null);
  const [loadingStock, setLoadingStock] = useState<boolean>(true);
  const [stockError, setStockError] = useState<string | null>(null);

  // Фильтры по остаткам
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [cityFilter, setCityFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');

  // Данные акта реализации
  const [startDate, setStartDate] = useState<string>('2026-09-01');
  const [endDate, setEndDate] = useState<string>('2026-09-30');
  const [releasesData, setReleasesData] = useState<SupplierReleasesReport | null>(null);
  const [loadingReleases, setLoadingReleases] = useState<boolean>(false);
  const [releasesError, setReleasesError] = useState<string | null>(null);

  // Счетчик принудительной перезагрузки
  const [reloadCounter, setReloadCounter] = useState(0);

  const handleRefresh = useCallback(() => {
    setReloadCounter(c => c + 1);
  }, []);

  // 1. Загрузка географии остатков с защитой от Race Condition
  useEffect(() => {
    let cancelled = false;
    setLoadingStock(true);
    setStockError(null);

    fetchSupplierNetworkStock(selectedSupplierId, 'stock')
      .then(data => {
        if (cancelled) return;
        if (data && data.success) {
          setStockData(data);
        } else {
          setStockError(data?.error || 'Не удалось загрузить остатки фабрики');
        }
      })
      .catch((err: any) => {
        if (cancelled) return;
        setStockError(err?.message || 'Ошибка сети при обращении к ERP');
      })
      .finally(() => {
        if (!cancelled) setLoadingStock(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedSupplierId, reloadCounter]);

  // 2. Загрузка акта реализации с защитой от Race Condition
  useEffect(() => {
    if (activeSubTab !== 'releases') return;

    if (startDate > endDate) {
      setReleasesError('Начальная дата периода не может быть позже конечной даты');
      return;
    }

    let cancelled = false;
    setLoadingReleases(true);
    setReleasesError(null);

    fetchSupplierNetworkStock(selectedSupplierId, 'releases', {
      startDate,
      endDate,
    })
      .then(data => {
        if (cancelled) return;
        if (data && data.success) {
          setReleasesData(data);
        } else {
          setReleasesError(data?.error || 'Не удалось загрузить акт реализации');
        }
      })
      .catch((err: any) => {
        if (cancelled) return;
        setReleasesError(err?.message || 'Ошибка сети при обращении к ERP');
      })
      .finally(() => {
        if (!cancelled) setLoadingReleases(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedSupplierId, activeSubTab, startDate, endDate, reloadCounter]);

  // 3. Санитайзер данных: устранение коллизии на стороне ERP (ковры SAYDAM внутри ISMEN)
  const sanitizedItems = useMemo(() => {
    const raw = stockData?.items || [];
    if (selectedSupplierId === 6) {
      // Исключаем номенклатуру SAYDAM, ошибочно возвращаемую ERP под ISMEN
      return raw.filter(item => {
        const coll = (item.collection || '').toUpperCase();
        const name = (item.name || '').toUpperCase();
        return coll !== 'SAYDAM' && !name.includes('SAYDAM');
      });
    }
    return raw;
  }, [stockData?.items, selectedSupplierId]);

  // Собираем все уникальные города для фильтра из санированных данных
  const availableCities = useMemo(() => {
    return Array.from(
      new Set(
        sanitizedItems.flatMap(item => (item.distribution || []).map(d => d.city).filter(Boolean))
      )
    );
  }, [sanitizedItems]);

  // 4. Фильтрация позиций с точным расчетом локальных KPI по городу и типу размещения
  const {
    filteredItems,
    hubQty,
    consignmentQty,
    hubSqm,
    consignmentSqm,
    totalFilteredQty,
    totalFilteredSqm,
  } = useMemo(() => {
    let hubQ = 0;
    let hubS = 0;
    let consQ = 0;
    let consS = 0;
    let totalQ = 0;
    let totalS = 0;

    const qLower = searchQuery.toLowerCase().trim();
    const resultItems: SupplierStockItem[] = [];

    for (const item of sanitizedItems) {
      const matchSearch =
        !qLower ||
        item.article?.toLowerCase().includes(qLower) ||
        item.collection?.toLowerCase().includes(qLower) ||
        (item.name && item.name.toLowerCase().includes(qLower));

      if (!matchSearch) continue;

      // Фильтруем строки распределения внутри ковра
      const matchedDist = (item.distribution || []).filter(dist => {
        const matchCity = cityFilter === 'all' || dist.city === cityFilter;
        const matchType =
          typeFilter === 'all' ||
          (typeFilter === 'hub' && dist.type === 'central_hub') ||
          (typeFilter === 'consignment' && dist.type !== 'central_hub');
        return matchCity && matchType;
      });

      // Если установлен конкретный фильтр города/типа, товар показывается ТОЛЬКО если есть остаток в этой точке
      if ((cityFilter !== 'all' || typeFilter !== 'all') && matchedDist.length === 0) {
        continue;
      }

      const distToCount = (cityFilter === 'all' && typeFilter === 'all')
        ? (item.distribution || [])
        : matchedDist;

      let itemFilteredQty = 0;
      let itemFilteredSqm = 0;

      for (const d of distToCount) {
        const q = d.qty_pcs ?? d.qty ?? 0;
        const s = d.area_sqm ?? d.sqm ?? 0;
        itemFilteredQty += q;
        itemFilteredSqm += s;
        if (d.type === 'central_hub') {
          hubQ += q;
          hubS += s;
        } else {
          consQ += q;
          consS += s;
        }
      }

      totalQ += itemFilteredQty;
      totalS += itemFilteredSqm;

      resultItems.push({
        ...item,
        total_network_qty: (cityFilter === 'all' && typeFilter === 'all') ? (item.total_network_qty ?? itemFilteredQty) : itemFilteredQty,
        total_network_sqm: (cityFilter === 'all' && typeFilter === 'all') ? (item.total_network_sqm ?? itemFilteredSqm) : itemFilteredSqm,
        distribution: distToCount,
      });
    }

    return {
      filteredItems: resultItems,
      hubQty: hubQ,
      consignmentQty: consQ,
      hubSqm: hubS,
      consignmentSqm: consS,
      totalFilteredQty: totalQ,
      totalFilteredSqm: totalS,
    };
  }, [sanitizedItems, searchQuery, cityFilter, typeFilter]);

  const handlePrint = () => {
    window.print();
  };

  // Динамические периоды дат
  const now = new Date();
  const curYear = now.getFullYear();
  const curMonth = now.getMonth();
  const pad = (n: number) => String(n).padStart(2, '0');

  const setPeriodQuickPick = (pick: 'current_month' | 'prev_month' | 'q3' | 'year') => {
    if (pick === 'current_month') {
      const lastDay = new Date(curYear, curMonth + 1, 0).getDate();
      setStartDate(`${curYear}-${pad(curMonth + 1)}-01`);
      setEndDate(`${curYear}-${pad(curMonth + 1)}-${pad(lastDay)}`);
    } else if (pick === 'prev_month') {
      const prevYear = curMonth === 0 ? curYear - 1 : curYear;
      const prevMonth = curMonth === 0 ? 12 : curMonth;
      const lastDay = new Date(prevYear, prevMonth, 0).getDate();
      setStartDate(`${prevYear}-${pad(prevMonth)}-01`);
      setEndDate(`${prevYear}-${pad(prevMonth)}-${pad(lastDay)}`);
    } else if (pick === 'q3') {
      setStartDate(`${curYear}-07-01`);
      setEndDate(`${curYear}-09-30`);
    } else if (pick === 'year') {
      setStartDate(`${curYear}-01-01`);
      setEndDate(`${curYear}-12-31`);
    }
  };

  const selectedSupplierObj = suppliersList.find(s => s.id === selectedSupplierId);

  return (
    <div className="space-y-6">
      {/* Header кабинета */}
      <div className="card p-6 border-l-4 border-l-brand-600 bg-gradient-to-r from-brand-50/50 via-white to-white">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-700 text-white shadow-md">
              <Building2 className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold text-slate-900">
                  {stockData?.supplier_name || selectedSupplierObj?.name || 'Кабинет фабрики'}
                </h2>
                <span className="badge bg-amber-100 text-amber-800 border border-amber-300/50 text-[10px] font-bold">
                  B2B Фабрика
                </span>
                {!isAdmin && (
                  <span className="badge bg-slate-100 text-slate-600 text-[10px]">
                    ID: {selectedSupplierId}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Прямая интеграция с распределительной сетью Synergiya Group в Казахстане
              </p>
            </div>
          </div>

          {/* Панель управления фабрикой: селектор только для администраторов */}
          <div className="flex items-center gap-2">
            {isAdmin ? (
              <>
                <span className="text-xs text-slate-500 whitespace-nowrap">Фабрика:</span>
                <div className="relative">
                  <select
                    value={selectedSupplierId}
                    onChange={e => setSelectedSupplierId(Number(e.target.value))}
                    className="appearance-none rounded-lg border border-slate-300 bg-white py-1.5 pl-3 pr-8 text-xs font-semibold text-slate-800 shadow-xs focus:border-brand-500 focus:outline-none"
                  >
                    {suppliersList.map(sup => (
                      <option key={sup.id} value={sup.id}>
                        {sup.name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                </div>
              </>
            ) : null}

            <button
              onClick={handleRefresh}
              title="Обновить данные"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 hover:text-brand-700 transition-colors shadow-xs"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loadingStock || loadingReleases ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Обновить</span>
            </button>
          </div>
        </div>

        {/* Sub-nav tabs */}
        <div className="mt-6 flex border-b border-slate-200 gap-2">
          <button
            onClick={() => setActiveSubTab('stock')}
            className={`flex items-center gap-2 pb-3 px-3 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeSubTab === 'stock'
                ? 'border-brand-700 text-brand-700 font-bold'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <WarehouseIcon className="h-4 w-4" />
            География остатков сети
            {stockData && (
              <span className="ml-1.5 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 font-semibold">
                {totalFilteredQty} шт.
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveSubTab('releases')}
            className={`flex items-center gap-2 pb-3 px-3 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeSubTab === 'releases'
                ? 'border-brand-700 text-brand-700 font-bold'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <FileText className="h-4 w-4" />
            Акт реализации / Выпуски
          </button>
        </div>
      </div>

      {/* ============================================================== */}
      {/* ВКЛАДКА 1: ГЕОГРАФИЯ ОСТАТКОВ СЕТИ                             */}
      {/* ============================================================== */}
      {activeSubTab === 'stock' && (
        <div className="space-y-6">
          {/* Сводные KPI карточки с точным пересчетом под фильтры */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="card p-4 bg-white border border-slate-200 shadow-xs">
              <div className="flex items-center justify-between text-slate-500 mb-1">
                <span className="text-xs font-medium uppercase tracking-wider">
                  {cityFilter === 'all' && typeFilter === 'all' ? 'Всего в сети РК' : 'Остаток по фильтру'}
                </span>
                <Layers className="h-4 w-4 text-brand-600" />
              </div>
              <p className="text-2xl font-bold text-slate-900">
                {totalFilteredQty}{' '}
                <span className="text-sm font-normal text-slate-500">шт.</span>
              </p>
              <p className="text-xs text-slate-400 mt-1">
                {totalFilteredSqm.toFixed(1)} м² продукции
              </p>
            </div>

            <div className="card p-4 bg-white border border-slate-200 shadow-xs">
              <div className="flex items-center justify-between text-slate-500 mb-1">
                <span className="text-xs font-medium uppercase tracking-wider">Центральный хаб</span>
                <WarehouseIcon className="h-4 w-4 text-emerald-600" />
              </div>
              <p className="text-2xl font-bold text-emerald-950">
                {hubQty} <span className="text-sm font-normal text-emerald-700">шт.</span>
              </p>
              <p className="text-xs text-emerald-600 mt-1">
                Алматы ({hubSqm.toFixed(1)} м²)
              </p>
            </div>

            <div className="card p-4 bg-white border border-slate-200 shadow-xs">
              <div className="flex items-center justify-between text-slate-500 mb-1">
                <span className="text-xs font-medium uppercase tracking-wider">Консигнация (Регионы)</span>
                <Store className="h-4 w-4 text-indigo-600" />
              </div>
              <p className="text-2xl font-bold text-indigo-950">
                {consignmentQty} <span className="text-sm font-normal text-indigo-700">шт.</span>
              </p>
              <p className="text-xs text-indigo-600 mt-1">
                В шоурумах партнеров ({consignmentSqm.toFixed(1)} м²)
              </p>
            </div>

            <div className="card p-4 bg-white border border-slate-200 shadow-xs">
              <div className="flex items-center justify-between text-slate-500 mb-1">
                <span className="text-xs font-medium uppercase tracking-wider">Номенклатур</span>
                <TrendingUp className="h-4 w-4 text-brand-600" />
              </div>
              <p className="text-2xl font-bold text-slate-900">
                {filteredItems.length}
              </p>
              <p className="text-xs text-slate-400 mt-1">
                {availableCities.length > 0 ? `${availableCities.length} городов покрытия` : '1 город'}
              </p>
            </div>
          </div>

          {/* Панель фильтров */}
          <div className="card p-4 bg-white">
            <div className="flex flex-col md:flex-row gap-3 items-center justify-between">
              <div className="relative w-full md:w-80">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="Поиск по артикулу, коллекции..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 pl-9 pr-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
                />
              </div>

              <div className="flex flex-wrap gap-2 w-full md:w-auto">
                <select
                  value={cityFilter}
                  onChange={e => setCityFilter(e.target.value)}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 focus:outline-none"
                >
                  <option value="all">Все города</option>
                  {availableCities.map(city => (
                    <option key={city} value={city}>
                      {city}
                    </option>
                  ))}
                </select>

                <select
                  value={typeFilter}
                  onChange={e => setTypeFilter(e.target.value)}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 focus:outline-none"
                >
                  <option value="all">Все типы размещения</option>
                  <option value="hub">Центральный хаб (Алматы)</option>
                  <option value="consignment">Консигнация у партнеров</option>
                </select>
              </div>
            </div>
          </div>

          {/* Таблица остатков с детализацией распределения */}
          {loadingStock ? (
            <div className="card p-12 text-center">
              <div className="inline-block h-8 w-8 animate-spin rounded-full border-2 border-brand-600 border-t-transparent mb-2" />
              <p className="text-sm text-slate-500">Загрузка остатков сети из ERP...</p>
            </div>
          ) : stockError ? (
            <div className="card p-6 border-red-200 bg-red-50 text-red-800 text-sm">
              <div className="flex items-center gap-2 mb-1">
                <AlertCircle className="h-4 w-4 text-red-600 shrink-0" />
                <p className="font-semibold">Ошибка загрузки:</p>
              </div>
              <p>{stockError}</p>
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="card p-12 text-center text-slate-500">
              <Store className="h-10 w-10 text-slate-300 mx-auto mb-2" />
              <p className="font-semibold text-slate-700">Остатков не найдено</p>
              <p className="text-xs text-slate-400 mt-1">
                Для выбранной фабрики или фильтра нет активных остатков на складах сети
              </p>
            </div>
          ) : (
            <div className="card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase text-slate-500">
                      <th className="py-3 px-4">Ковер / Артикул</th>
                      <th className="py-3 px-4">Размер / Площадь</th>
                      <th className="py-3 px-4">В наличии</th>
                      <th className="py-3 px-4">Распределение по сети (Хаб и Партнеры)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredItems.map(item => {
                      const totalQty = item.total_network_qty ?? item.total_qty ?? 0;
                      const totalSqm = item.total_network_sqm ?? item.total_sqm ?? 0;
                      const sizeLabel =
                        item.width && item.length
                          ? `${item.width} × ${item.length} м`
                          : item.size || 'Стандарт';

                      return (
                        <tr key={item.carpet_id} className="hover:bg-slate-50/70 transition-colors">
                          <td className="py-3.5 px-4 align-top">
                            <p className="font-bold text-slate-900">{item.article}</p>
                            <p className="text-xs text-brand-700 font-medium">{item.collection}</p>
                            {item.name && (
                              <p className="text-[11px] text-slate-400 line-clamp-1 mt-0.5">{item.name}</p>
                            )}
                          </td>
                          <td className="py-3.5 px-4 align-top whitespace-nowrap">
                            <p className="font-semibold text-slate-800">{sizeLabel}</p>
                            {item.area_sqm && (
                              <p className="text-xs text-slate-400">{item.area_sqm} м² / шт</p>
                            )}
                          </td>
                          <td className="py-3.5 px-4 align-top whitespace-nowrap">
                            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-800">
                              {totalQty} шт
                            </span>
                            <p className="text-xs text-slate-500 mt-1">{totalSqm.toFixed(1)} м²</p>
                          </td>
                          <td className="py-3.5 px-4 align-top">
                            <div className="space-y-1.5">
                              {(item.distribution || []).map((dist: SupplierDistribution, dIdx: number) => {
                                const q = dist.qty_pcs ?? dist.qty ?? 0;
                                const s = dist.area_sqm ?? dist.sqm ?? 0;
                                const isHub = dist.type === 'central_hub';
                                const distKey = `${item.carpet_id}-${dIdx}-${dist.warehouse_id || ''}-${dist.city}`;

                                return (
                                  <div
                                    key={distKey}
                                    className={`flex items-center justify-between rounded-md p-2 text-xs ${
                                      isHub
                                        ? 'bg-emerald-50/80 border border-emerald-200/60 text-emerald-950'
                                        : 'bg-indigo-50/80 border border-indigo-200/60 text-indigo-950'
                                    }`}
                                  >
                                    <div className="flex items-center gap-2">
                                      {isHub ? (
                                        <WarehouseIcon className="h-3.5 w-3.5 text-emerald-700 shrink-0" />
                                      ) : (
                                        <Store className="h-3.5 w-3.5 text-indigo-700 shrink-0" />
                                      )}
                                      <div>
                                        <span className="font-bold">
                                          {isHub
                                            ? 'Центральный хаб (Алматы)'
                                            : dist.partner_name || dist.location_name || 'Партнерский магазин'}
                                        </span>
                                        <span className="text-[11px] opacity-75 ml-1.5">
                                          • {dist.city} {dist.warehouse_name ? `(${dist.warehouse_name})` : ''}
                                        </span>
                                      </div>
                                    </div>
                                    <div className="text-right whitespace-nowrap pl-3">
                                      <span className="font-bold text-xs">{q} шт</span>
                                      <span className="text-[10px] opacity-75 ml-1">({s.toFixed(1)} м²)</span>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ============================================================== */}
      {/* ВКЛАДКА 2: АКТ РЕАЛИЗАЦИИ / ВЫПУСКИ (ТОЛЬКО СНЯТОЕ С ХОЛДА)     */}
      {/* ============================================================== */}
      {activeSubTab === 'releases' && (
        <div className="space-y-6">
          {/* Период и экспорт */}
          <div className="card p-5 bg-white">
            <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide mr-1">
                  Период отчета:
                </span>
                <button
                  onClick={() => setPeriodQuickPick('current_month')}
                  className="rounded-md px-2.5 py-1 text-xs font-medium transition-colors bg-slate-100 text-slate-700 hover:bg-slate-200"
                >
                  Текущий месяц
                </button>
                <button
                  onClick={() => setPeriodQuickPick('prev_month')}
                  className="rounded-md px-2.5 py-1 text-xs font-medium transition-colors bg-slate-100 text-slate-700 hover:bg-slate-200"
                >
                  Предыдущий месяц
                </button>
                <button
                  onClick={() => setPeriodQuickPick('q3')}
                  className="rounded-md px-2.5 py-1 text-xs font-medium transition-colors bg-slate-100 text-slate-700 hover:bg-slate-200"
                >
                  3-й квартал
                </button>
                <button
                  onClick={() => setPeriodQuickPick('year')}
                  className="rounded-md px-2.5 py-1 text-xs font-medium transition-colors bg-slate-100 text-slate-700 hover:bg-slate-200"
                >
                  Весь {curYear} год
                </button>
              </div>

              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1 text-xs">
                  <input
                    type="date"
                    value={startDate}
                    onChange={e => setStartDate(e.target.value)}
                    className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                  />
                  <span className="text-slate-400">—</span>
                  <input
                    type="date"
                    value={endDate}
                    onChange={e => setEndDate(e.target.value)}
                    className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                  />
                </div>
                <button
                  onClick={handlePrint}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors shadow-xs"
                >
                  <Printer className="h-3.5 w-3.5" />
                  Печать акта
                </button>
              </div>
            </div>
          </div>

          {/* Финансовые показатели акта сверки */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="card p-5 bg-gradient-to-br from-emerald-600 to-emerald-700 text-white shadow-md">
              <p className="text-xs uppercase tracking-wider text-emerald-100 font-semibold mb-1">
                К перечислению фабрике
              </p>
              <p className="text-3xl font-extrabold">
                ${(releasesData?.total_amount_usd ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
              <p className="text-xs text-emerald-100 mt-2">
                Сумма за реализованную продукцию (снятую с холда)
              </p>
            </div>

            <div className="card p-5 bg-white border border-slate-200 shadow-xs">
              <p className="text-xs uppercase tracking-wider text-slate-400 font-semibold mb-1">
                Реализовано ковров
              </p>
              <p className="text-3xl font-bold text-slate-900">
                {releasesData?.total_released_pcs ?? 0}{' '}
                <span className="text-sm font-normal text-slate-500">шт.</span>
              </p>
              <p className="text-xs text-slate-400 mt-2">
                {(releasesData?.total_released_sqm ?? 0).toFixed(1)} м² отпущено покупателям
              </p>
            </div>

            <div className="card p-5 bg-white border border-slate-200 shadow-xs">
              <p className="text-xs uppercase tracking-wider text-slate-400 font-semibold mb-1">
                Документов реализации
              </p>
              <p className="text-3xl font-bold text-slate-900">
                {releasesData?.releases?.length ?? 0}
              </p>
              <p className="text-xs text-slate-400 mt-2">
                Накладных и актов списания консигнации
              </p>
            </div>
          </div>

          {/* Документы реализации */}
          {loadingReleases ? (
            <div className="card p-12 text-center">
              <div className="inline-block h-8 w-8 animate-spin rounded-full border-2 border-brand-600 border-t-transparent mb-2" />
              <p className="text-sm text-slate-500">Формирование акта реализации из ERP...</p>
            </div>
          ) : releasesError ? (
            <div className="card p-6 border-red-200 bg-red-50 text-red-800 text-sm">
              <div className="flex items-center gap-2 mb-1">
                <AlertCircle className="h-4 w-4 text-red-600 shrink-0" />
                <p className="font-semibold">Ошибка загрузки акта:</p>
              </div>
              <p>{releasesError}</p>
            </div>
          ) : !releasesData?.releases || releasesData.releases.length === 0 ? (
            <div className="card p-10 text-center text-slate-500">
              <FileText className="h-10 w-10 text-slate-300 mx-auto mb-2" />
              <p className="font-semibold text-slate-800">Нет документов реализации за выбранный период</p>
              <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
                В периоде с {startDate} по {endDate} по фабрике {stockData?.supplier_name || selectedSupplierObj?.name || ''} не зафиксировано выпусков с консигнации или отгрузок конечным клиентам.
              </p>
              <button
                onClick={() => setPeriodQuickPick('year')}
                className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-brand-700 hover:bg-slate-50"
              >
                Показать за весь {curYear} год
              </button>
            </div>
          ) : (
            <div className="card overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
                <h3 className="text-sm font-bold text-slate-900">
                  Реестр документов реализации ({releasesData.releases.length})
                </h3>
                <span className="text-xs text-slate-500 font-mono">
                  Период: {startDate} — {endDate}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs font-semibold uppercase text-slate-400">
                      <th className="py-3 px-4">Документ</th>
                      <th className="py-3 px-4">Дата</th>
                      <th className="py-3 px-4">Покупатель / Партнер</th>
                      <th className="py-3 px-4">Город</th>
                      <th className="py-3 px-4 text-right">Кол-во</th>
                      <th className="py-3 px-4 text-right">Площадь</th>
                      <th className="py-3 px-4 text-right">Сумма ($)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {releasesData.releases.map((rel, idx) => {
                      const relKey = `${idx}-${rel.doc_number || ''}-${rel.date || ''}`;
                      return (
                        <tr key={relKey} className="hover:bg-slate-50 transition-colors">
                          <td className="py-3 px-4 font-mono font-bold text-slate-800 text-xs">
                            {rel.doc_number}
                          </td>
                          <td className="py-3 px-4 text-xs text-slate-600 whitespace-nowrap">
                            {rel.date}
                          </td>
                          <td className="py-3 px-4 font-medium text-slate-800">
                            {rel.counterparty_name}
                          </td>
                          <td className="py-3 px-4 text-xs text-slate-500">
                            {rel.city}
                          </td>
                          <td className="py-3 px-4 text-right font-bold text-slate-900">
                            {rel.released_qty} шт
                          </td>
                          <td className="py-3 px-4 text-right text-xs text-slate-500">
                            {rel.released_sqm.toFixed(1)} м²
                          </td>
                          <td className="py-3 px-4 text-right font-bold text-emerald-700">
                            ${rel.total_usd.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
