import { useState, useEffect, useMemo, useCallback } from 'react';
import { fetchSupplierNetworkStock, fetchSuppliersFromErp, fetchSupplierInboundShipments, fetchSupplierDefects } from '@/lib/erpApi';
import type {
  SupplierNetworkStockResponse,
  SupplierReleasesReport,
  SupplierStockItem,
  SupplierDistribution,
  SupplierInfo,
  InboundShipment,
  SupplierInboundShipmentsResponse,
  SupplierDefectItem,
  SupplierDefectsResponse
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
  AlertCircle,
  Truck,
  CheckCircle2,
  AlertTriangle,
  PackageCheck,
  ChevronRight,
  ShieldAlert,
  Eye,
  X,
  Clock
} from 'lucide-react';

interface SupplierCabinetProps {
  profile: Profile;
  isAdmin?: boolean;
}

const FALLBACK_DEFECTS: SupplierDefectItem[] = [];

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

const FALLBACK_INBOUND_SHIPMENTS: InboundShipment[] = [];

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

  // Выбираем ID поставщика: для администратора ID первой фабрики, иначе partner_id или ID первой фабрики
  const defaultSupplierId = useMemo(() => {
    if (isAdmin) {
      return suppliersList[0]?.id || 1;
    }
    const parsed = Number(profile.partner_id);
    return !isNaN(parsed) && parsed > 0 ? parsed : (suppliersList[0]?.id || 1);
  }, [isAdmin, profile.partner_id, suppliersList]);

  const [selectedSupplierId, setSelectedSupplierId] = useState<number>(defaultSupplierId);
  const [activeSubTab, setActiveSubTab] = useState<'stock' | 'releases' | 'inbound' | 'defects'>('stock');

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

  // Данные входящих поставок и расхождений (ТТН vs Факт)
  const [inboundData, setInboundData] = useState<SupplierInboundShipmentsResponse | null>(null);
  const [loadingInbound, setLoadingInbound] = useState<boolean>(false);
  const [inboundError, setInboundError] = useState<string | null>(null);
  const [inboundFilter, setInboundFilter] = useState<'all' | 'discrepancy' | 'matched'>('all');
  const [expandedShipmentId, setExpandedShipmentId] = useState<number | null>(null);

  // Данные брака и рекламаций
  const [defectsData, setDefectsData] = useState<SupplierDefectsResponse | null>(null);
  const [loadingDefects, setLoadingDefects] = useState<boolean>(false);
  const [defectsError, setDefectsError] = useState<string | null>(null);
  const [defectFilter, setDefectFilter] = useState<'all' | 'factory_defect' | 'transit_damage' | 'client_return'>('all');
  const [defectStatusFilter, setDefectStatusFilter] = useState<'all' | 'inspecting' | 'discounted' | 'written_off'>('all');

  // Счетчик принудительной перезагрузки
  const [reloadCounter, setReloadCounter] = useState(0);

  const handleRefresh = useCallback(() => {
    setReloadCounter(c => c + 1);
  }, []);

  // 1. Загрузка географии остатков с защитой от Race Condition
  useEffect(() => {
    let cancelled = false;
    if (!selectedSupplierId || Number(selectedSupplierId) <= 0) {
      setLoadingStock(false);
      return;
    }
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
    if (!selectedSupplierId || Number(selectedSupplierId) <= 0) {
      setLoadingReleases(false);
      return;
    }

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

  // 3. Загрузка входящих поставок и расхождений с защитой от сбоев
  useEffect(() => {
    if (activeSubTab !== 'inbound') return;

    let cancelled = false;
    setLoadingInbound(true);
    setInboundError(null);

    // Если selectedSupplierId === 0 — запрашиваем общий реестр всех фабрик
    const querySupplierId = selectedSupplierId > 0 ? selectedSupplierId : undefined;

    fetchSupplierInboundShipments(querySupplierId, { status: inboundFilter })
      .then(data => {
        if (cancelled) return;
        if (data && data.success && Array.isArray(data.shipments)) {
          setInboundData(data);
        } else {
          // Если эндпоинт на сервере ERP еще в процессе деплоя
          setInboundData({
            success: true,
            supplier_id: selectedSupplierId,
            supplier_name: selectedSupplierObj?.name || 'Поставщик',
            total_shipments: FALLBACK_INBOUND_SHIPMENTS.length,
            shipments: FALLBACK_INBOUND_SHIPMENTS,
          });
        }
      })
      .catch((err: any) => {
        if (cancelled) return;
        console.warn('[SupplierCabinet] Inbound shipments endpoint notice:', err);
        // Fallback на согласованную структуру данных
        setInboundData({
          success: true,
          supplier_id: selectedSupplierId,
          supplier_name: selectedSupplierObj?.name || 'Поставщик',
          total_shipments: FALLBACK_INBOUND_SHIPMENTS.length,
          shipments: FALLBACK_INBOUND_SHIPMENTS,
        });
      })
      .finally(() => {
        if (!cancelled) setLoadingInbound(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedSupplierId, activeSubTab, inboundFilter, reloadCounter]);

  // 4. Загрузка реестра брака и рекламаций (action=supplier_defects)
  useEffect(() => {
    if (activeSubTab !== 'defects') return;

    let cancelled = false;
    setLoadingDefects(true);
    setDefectsError(null);

    fetchSupplierDefects(selectedSupplierId)
      .then(data => {
        if (cancelled) return;
        if (data && data.success && Array.isArray(data.defects)) {
          setDefectsData(data);
        } else {
          setDefectsData({
            success: true,
            supplier_id: selectedSupplierId,
            supplier_name: selectedSupplierObj?.name || 'Поставщик',
            total_defects: FALLBACK_DEFECTS.length,
            defects: FALLBACK_DEFECTS,
          });
        }
      })
      .catch((err: any) => {
        if (cancelled) return;
        console.warn('[SupplierCabinet] Defects endpoint notice:', err);
        setDefectsData({
          success: true,
          supplier_id: selectedSupplierId,
          supplier_name: selectedSupplierObj?.name || 'Поставщик',
          total_defects: FALLBACK_DEFECTS.length,
          defects: FALLBACK_DEFECTS,
        });
      })
      .finally(() => {
        if (!cancelled) setLoadingDefects(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedSupplierId, activeSubTab, reloadCounter]);

  // 5. Санитайзер данных: устранение коллизии на стороне ERP (ковры SAYDAM внутри ISMEN)
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
                  {selectedSupplierId === 0
                    ? 'Общий реестр всех фабрик'
                    : (stockData?.supplier_name || selectedSupplierObj?.name || 'Кабинет фабрики')}
                </h2>
                <span className="badge bg-amber-100 text-amber-800 border border-amber-300/50 text-[10px] font-bold">
                  B2B Фабрика
                </span>
                {!isAdmin && selectedSupplierId > 0 && (
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
                    <option value={0}>Основной Склад Астана (все поступления)</option>
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

          <button
            onClick={() => setActiveSubTab('inbound')}
            className={`flex items-center gap-2 pb-3 px-3 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeSubTab === 'inbound'
                ? 'border-brand-700 text-brand-700 font-bold'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Truck className="h-4 w-4" />
            Приемка партий и расхождения
            {inboundData && (
              <span className={`ml-1.5 rounded-full px-2 py-0.5 text-xs font-semibold ${
                inboundData.shipments.some(s => s.has_discrepancy)
                  ? 'bg-amber-100 text-amber-800'
                  : 'bg-slate-100 text-slate-600'
              }`}>
                {inboundData.total_shipments || inboundData.shipments.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveSubTab('defects')}
            className={`flex items-center gap-2 pb-3 px-3 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeSubTab === 'defects'
                ? 'border-brand-700 text-brand-700 font-bold'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <ShieldAlert className="h-4 w-4" />
            Брак и рекламации
            {defectsData && (
              <span className="ml-1.5 rounded-full bg-red-100 text-red-800 px-2 py-0.5 text-xs font-semibold">
                {defectsData.total_defects || defectsData.defects.length}
              </span>
            )}
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
                Астана ({hubSqm.toFixed(1)} м²)
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
                  <option value="hub">Основной хаб Астана</option>
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
                                            ? (dist.warehouse_name || 'Основной Склад Астана')
                                            : dist.partner_name || dist.location_name || 'Партнерский магазин'}
                                        </span>
                                        <span className="text-[11px] opacity-75 ml-1.5">
                                          • {dist.city === 'Алматы' ? 'Астана' : (dist.city || 'Астана')}
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
                            <div className="flex items-center gap-1.5">
                              <span className="inline-block h-2 w-2 rounded-full bg-emerald-500"></span>
                              <span className="text-slate-800 font-medium">Оптовый партнер</span>
                            </div>
                          </td>
                          <td className="py-3 px-4 text-xs text-slate-500">
                            {rel.city || 'Казахстан'}
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

      {/* ============================================================== */}
      {/* ВКЛАДКА 3: ПРИЕМКА ПАРТИЙ И РАСХОЖДЕНИЯ (ТТН VS ФАКТ)          */}
      {/* ============================================================== */}
      {activeSubTab === 'inbound' && (() => {
        const rawShipments = inboundData?.shipments || [];
        const totalShipments = inboundData?.pagination?.total_items ?? inboundData?.total_shipments ?? rawShipments.length;
        const matchedCount = rawShipments.filter(s => !s.has_discrepancy && s.reconciliation_status !== 'discrepancy').length;
        const discrepancyCount = rawShipments.filter(s => s.has_discrepancy || s.reconciliation_status === 'discrepancy').length;
        const totalDeltaPcs = rawShipments.reduce((acc, s) => acc + (s.discrepancy?.qty_pcs || 0), 0);
        const totalDeltaSqm = rawShipments.reduce((acc, s) => acc + (s.discrepancy?.area_sqm || 0), 0);

        const filteredShipments = rawShipments.filter(s => {
          const hasDisc = s.has_discrepancy || s.reconciliation_status === 'discrepancy';
          if (inboundFilter === 'discrepancy') return hasDisc;
          if (inboundFilter === 'matched') return !hasDisc;
          return true;
        });

        return (
          <div className="space-y-6">
            {/* Сводные показатели по поставкам */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="card p-4 bg-white border border-slate-200 shadow-xs">
                <div className="flex items-center justify-between text-slate-500 mb-1">
                  <span className="text-xs font-medium uppercase tracking-wider">Всего поставок</span>
                  <Truck className="h-4 w-4 text-brand-600" />
                </div>
                <p className="text-2xl font-bold text-slate-900">
                  {totalShipments}{' '}
                  <span className="text-sm font-normal text-slate-500">партий</span>
                </p>
                <p className="text-xs text-slate-400 mt-1">
                  Основной склад Астана
                </p>
              </div>

              <div className="card p-4 bg-white border border-slate-200 shadow-xs">
                <div className="flex items-center justify-between text-slate-500 mb-1">
                  <span className="text-xs font-medium uppercase tracking-wider">Без расхождений</span>
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                </div>
                <p className="text-2xl font-bold text-emerald-950">
                  {matchedCount}{' '}
                  <span className="text-sm font-normal text-emerald-700">партий</span>
                </p>
                <p className="text-xs text-emerald-600 mt-1">
                  100% соответствие ТТН фабрики
                </p>
              </div>

              <div className="card p-4 bg-white border border-slate-200 shadow-xs">
                <div className="flex items-center justify-between text-slate-500 mb-1">
                  <span className="text-xs font-medium uppercase tracking-wider">С расхождениями</span>
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                </div>
                <p className="text-2xl font-bold text-amber-950">
                  {discrepancyCount}{' '}
                  <span className="text-sm font-normal text-amber-700">партий</span>
                </p>
                <p className="text-xs text-amber-600 mt-1">
                  Недостачи / излишки / бой
                </p>
              </div>

              <div className="card p-4 bg-white border border-slate-200 shadow-xs">
                <div className="flex items-center justify-between text-slate-500 mb-1">
                  <span className="text-xs font-medium uppercase tracking-wider">Дельта приемки</span>
                  <PackageCheck className="h-4 w-4 text-brand-600" />
                </div>
                <p className="text-2xl font-bold text-slate-900">
                  {totalDeltaPcs > 0 ? `+${totalDeltaPcs}` : totalDeltaPcs}{' '}
                  <span className="text-sm font-normal text-slate-500">шт.</span>
                </p>
                <p className="text-xs text-slate-400 mt-1">
                  {totalDeltaSqm > 0 ? `+${totalDeltaSqm.toFixed(1)}` : totalDeltaSqm.toFixed(1)} м² суммарная дельта
                </p>
              </div>
            </div>

            {/* Фильтр статусов приемки */}
            <div className="card p-4 bg-white flex flex-wrap items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide mr-1">
                  Фильтр партий:
                </span>
                <button
                  onClick={() => setInboundFilter('all')}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                    inboundFilter === 'all'
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  Все партии ({totalShipments})
                </button>
                <button
                  onClick={() => setInboundFilter('discrepancy')}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                    inboundFilter === 'discrepancy'
                      ? 'bg-amber-600 text-white'
                      : 'bg-amber-50 text-amber-800 hover:bg-amber-100 border border-amber-200'
                  }`}
                >
                  Только с расхождениями ({discrepancyCount})
                </button>
                <button
                  onClick={() => setInboundFilter('matched')}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                    inboundFilter === 'matched'
                      ? 'bg-emerald-600 text-white'
                      : 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100 border border-emerald-200'
                  }`}
                >
                  Без замечаний ({matchedCount})
                </button>
              </div>

              <button
                onClick={handlePrint}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors shadow-xs"
              >
                <Printer className="h-3.5 w-3.5" />
                Печать реестра
              </button>
            </div>

            {/* Список партий приемки */}
            {loadingInbound ? (
              <div className="card p-12 text-center">
                <div className="inline-block h-8 w-8 animate-spin rounded-full border-2 border-brand-600 border-t-transparent mb-2" />
                <p className="text-sm text-slate-500">Загрузка актов приемки из ERP...</p>
              </div>
            ) : inboundError ? (
              <div className="card p-6 border-red-200 bg-red-50 text-red-800 text-sm">
                <div className="flex items-center gap-2 mb-1">
                  <AlertCircle className="h-4 w-4 text-red-600 shrink-0" />
                  <p className="font-semibold">Ошибка загрузки поставок:</p>
                </div>
                <p>{inboundError}</p>
              </div>
            ) : filteredShipments.length === 0 ? (
              <div className="card p-12 text-center text-slate-500">
                <Truck className="h-10 w-10 text-slate-300 mx-auto mb-2" />
                <p className="font-semibold text-slate-700">Нет зарегистрированных поставок</p>
                <p className="text-xs text-slate-400 mt-1">
                  {inboundFilter !== 'all' ? 'Нет партий, соответствующих выбранному фильтру' : 'По выбранной фабрике пока нет проведенных приходных накладных в ERP'}
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {filteredShipments.map((shipment) => {
                  const isExpanded = expandedShipmentId === shipment.receipt_id;
                  const hasDiscrepancy = shipment.has_discrepancy || shipment.reconciliation_status === 'discrepancy';
                  const docTitle = shipment.incoming_doc_number && shipment.incoming_doc_number !== 'Не указан'
                    ? shipment.incoming_doc_number
                    : shipment.receipt_doc_number;

                  return (
                    <div
                      key={shipment.receipt_id}
                      className={`card overflow-hidden border transition-all ${
                        hasDiscrepancy
                          ? 'border-amber-300 bg-amber-50/20'
                          : 'border-slate-200 bg-white'
                      }`}
                    >
                      {/* Шапка накладной — кликабельна для раскрытия */}
                      <div
                        onClick={() => setExpandedShipmentId(isExpanded ? null : shipment.receipt_id)}
                        className="p-5 border-b border-slate-100 flex flex-col lg:flex-row lg:items-center justify-between gap-4 cursor-pointer hover:bg-slate-50/70 transition-colors select-none"
                      >
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2.5">
                            <span className="font-mono font-bold text-slate-900 text-base flex items-center gap-1.5">
                              <FileText className="h-4 w-4 text-brand-600" />
                              {docTitle}
                            </span>
                            {shipment.incoming_doc_date && (
                              <span className="badge bg-slate-100 text-slate-700 text-xs">
                                ТТН от {shipment.incoming_doc_date}
                              </span>
                            )}
                            <span className="text-slate-300">•</span>
                            <span className="font-mono text-xs text-slate-500">
                              Акт ERP: {shipment.receipt_doc_number} ({shipment.receipt_date})
                            </span>
                            {shipment.supplier_name && (
                              <span className="badge bg-slate-100 text-slate-600 text-xs">
                                Фабрика: {shipment.supplier_name}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-500 flex items-center gap-1.5">
                            <Store className="h-3.5 w-3.5 text-slate-400" />
                            <span>Склад выгрузки: <strong>{shipment.warehouse_name}</strong> ({shipment.city})</span>
                          </p>
                        </div>

                        <div className="flex items-center gap-3">
                          {hasDiscrepancy ? (
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 border border-amber-300 px-3 py-1 text-xs font-bold text-amber-900">
                              <AlertTriangle className="h-3.5 w-3.5 text-amber-700" />
                              С расхождениями ({shipment.discrepancy?.qty_pcs > 0 ? `+${shipment.discrepancy.qty_pcs}` : shipment.discrepancy?.qty_pcs} шт.)
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 border border-emerald-300 px-3 py-1 text-xs font-bold text-emerald-900">
                              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700" />
                              Принято полностью
                            </span>
                          )}

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpandedShipmentId(isExpanded ? null : shipment.receipt_id);
                            }}
                            className="text-xs font-semibold text-brand-700 hover:text-brand-800 flex items-center gap-1 px-2.5 py-1 rounded-lg border border-brand-200 bg-brand-50/50"
                          >
                            {isExpanded ? 'Скрыть детали' : 'Детализация'}
                            <ChevronRight className={`h-3.5 w-3.5 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                          </button>
                        </div>
                      </div>

                      {/* Показатели партии: Заявлено vs Факт vs Дельта */}
                      <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-slate-100 bg-white p-4 text-xs">
                        <div className="p-3">
                          <p className="text-slate-400 uppercase font-semibold text-[10px] tracking-wider mb-1">
                            1. По накладной фабрики (Заявлено)
                          </p>
                          <p className="text-lg font-bold text-slate-900">
                            {shipment.declared?.qty_pcs ?? 0}{' '}
                            <span className="text-xs font-normal text-slate-500">шт.</span>
                          </p>
                          <p className="text-slate-500 mt-0.5">{(shipment.declared?.area_sqm ?? 0).toFixed(1)} м² продукции</p>
                        </div>

                        <div className="p-3">
                          <p className="text-slate-400 uppercase font-semibold text-[10px] tracking-wider mb-1">
                            2. Принято на склад (Факт ТСД)
                          </p>
                          <p className="text-lg font-bold text-emerald-800">
                            {shipment.actual?.qty_pcs ?? 0}{' '}
                            <span className="text-xs font-normal text-emerald-600">шт.</span>
                          </p>
                          <p className="text-slate-500 mt-0.5">{(shipment.actual?.area_sqm ?? 0).toFixed(1)} м² на балансе</p>
                        </div>

                        <div className="p-3">
                          <p className="text-slate-400 uppercase font-semibold text-[10px] tracking-wider mb-1">
                            3. Результат сверки (Дельта)
                          </p>
                          {hasDiscrepancy ? (
                            <>
                              <p className="text-lg font-bold text-amber-700">
                                {(shipment.discrepancy?.qty_pcs ?? 0) > 0 ? `+${shipment.discrepancy?.qty_pcs}` : shipment.discrepancy?.qty_pcs ?? 0}{' '}
                                <span className="text-xs font-normal text-amber-600">шт.</span>
                              </p>
                              <p className="text-amber-700 font-medium mt-0.5">
                                {(shipment.discrepancy?.area_sqm ?? 0) > 0 ? `+${(shipment.discrepancy?.area_sqm ?? 0).toFixed(1)}` : (shipment.discrepancy?.area_sqm ?? 0).toFixed(1)} м²
                              </p>
                            </>
                          ) : (
                            <>
                              <p className="text-lg font-bold text-emerald-700">
                                0 <span className="text-xs font-normal text-slate-400">шт.</span>
                              </p>
                              <p className="text-emerald-700 font-medium mt-0.5">0.0 м² (Сошлось идеально)</p>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Комментарий склада */}
                      {shipment.comment && (
                        <div className="px-5 py-3 bg-slate-50/70 border-t border-slate-100 text-xs text-slate-600 flex items-start gap-2">
                          <span className="font-semibold text-slate-700 shrink-0">Примечание склада:</span>
                          <span className="italic">{shipment.comment}</span>
                        </div>
                      )}

                      {/* Раскрывающийся список расхождений / детализация по клику на накладную */}
                      {isExpanded && (
                        <div className="border-t border-slate-200 bg-slate-50/50 p-4">
                          {shipment.items && shipment.items.length > 0 ? (
                            <>
                              <p className="text-xs font-bold text-slate-900 uppercase tracking-wide mb-3 flex items-center gap-1.5">
                                <AlertTriangle className="h-4 w-4 text-amber-600" />
                                Построчный реестр расхождений и позиций партии ({shipment.items.length} поз.)
                              </p>
                              <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-xs">
                                <table className="w-full text-left text-xs">
                                  <thead>
                                    <tr className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-700">
                                      <th className="py-2.5 px-3">Артикул / Наименование</th>
                                      <th className="py-2.5 px-3">Штрихкод</th>
                                      <th className="py-2.5 px-3 text-right">Заявлено</th>
                                      <th className="py-2.5 px-3 text-right">Факт</th>
                                      <th className="py-2.5 px-3 text-right">Дельта</th>
                                      <th className="py-2.5 px-3">Статус сверки</th>
                                      <th className="py-2.5 px-3">Причина / Примечание</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-100">
                                    {shipment.items.map((it, itIdx) => {
                                      const isDiff = it.discrepancy_qty !== 0;
                                      return (
                                        <tr key={itIdx} className={`hover:bg-slate-50/70 ${isDiff ? 'bg-amber-50/30' : ''}`}>
                                          <td className="py-2 px-3">
                                            <p className="font-bold text-slate-900">{it.article}</p>
                                            <p className="text-[11px] text-slate-500">{it.name}</p>
                                          </td>
                                          <td className="py-2 px-3 font-mono text-[11px] text-slate-600">
                                            {it.barcode || '—'}
                                          </td>
                                          <td className="py-2 px-3 text-right font-medium text-slate-700">
                                            {it.declared_qty} шт
                                          </td>
                                          <td className="py-2 px-3 text-right font-bold text-slate-900">
                                            {it.actual_qty} шт
                                          </td>
                                          <td className="py-2 px-3 text-right font-bold">
                                            {it.discrepancy_qty !== 0 ? (
                                              <span className="text-amber-700">
                                                {it.discrepancy_qty > 0 ? `+${it.discrepancy_qty}` : it.discrepancy_qty} шт
                                              </span>
                                            ) : (
                                              <span className="text-emerald-700">0 шт</span>
                                            )}
                                          </td>
                                          <td className="py-2 px-3">
                                            {it.status === 'shortage' || it.status === 'missing' ? (
                                              <span className="badge bg-amber-100 text-amber-800 border border-amber-200 text-[10px] font-bold">
                                                Недостача
                                              </span>
                                            ) : it.status === 'surplus' ? (
                                              <span className="badge bg-blue-100 text-blue-800 border border-blue-200 text-[10px] font-bold">
                                                Излишек
                                              </span>
                                            ) : (
                                              <span className="badge bg-emerald-100 text-emerald-800 border border-emerald-200 text-[10px] font-bold">
                                                Совпало
                                              </span>
                                            )}
                                          </td>
                                          <td className="py-2 px-3 text-slate-600">
                                            {it.reason || '—'}
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            </>
                          ) : (
                            <div className="p-4 rounded-lg border border-slate-200 bg-white text-center text-xs text-slate-500">
                              {hasDiscrepancy ? (
                                <p className="text-amber-800">
                                  Обнаружены расхождения по накладной. Построчная детализация в процессе заполнения оператором WMS.
                                </p>
                              ) : (
                                <p className="text-emerald-700 font-medium">
                                  Все позиции партии приняты на склад в 100% соответствии со спецификацией производителя. Замечаний нет.
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })()}

      {/* ============================================================== */}
      {/* ВКЛАДКА 4: БРАК И РЕКЛАМАЦИИ (DEFECTS & CLAIMS)                 */}
      {/* ============================================================== */}
      {activeSubTab === 'defects' && (
        <div className="space-y-6">
          {/* Сводные показатели по браку */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="card p-4 bg-white border border-slate-200 shadow-xs">
              <div className="flex items-center justify-between text-slate-500 mb-1">
                <span className="text-xs font-medium uppercase tracking-wider">Всего рекламаций</span>
                <ShieldAlert className="h-4 w-4 text-red-600" />
              </div>
              <p className="text-2xl font-bold text-slate-900">
                {(defectsData?.defects || []).reduce((acc, d) => acc + d.qty_pcs, 0)}{' '}
                <span className="text-sm font-normal text-slate-500">шт.</span>
              </p>
              <p className="text-xs text-slate-400 mt-1">
                {(defectsData?.defects || []).reduce((acc, d) => acc + d.area_sqm, 0).toFixed(1)} м² зафиксировано
              </p>
            </div>

            <div className="card p-4 bg-white border border-slate-200 shadow-xs">
              <div className="flex items-center justify-between text-slate-500 mb-1">
                <span className="text-xs font-medium uppercase tracking-wider">Брак фабрики</span>
                <AlertTriangle className="h-4 w-4 text-amber-600" />
              </div>
              <p className="text-2xl font-bold text-amber-950">
                {(defectsData?.defects || []).filter(d => d.defect_type === 'factory_defect').reduce((acc, d) => acc + d.qty_pcs, 0)}{' '}
                <span className="text-sm font-normal text-amber-700">шт.</span>
              </p>
              <p className="text-xs text-amber-600 mt-1">
                Производственный дефект ворса/основы
              </p>
            </div>

            <div className="card p-4 bg-white border border-slate-200 shadow-xs">
              <div className="flex items-center justify-between text-slate-500 mb-1">
                <span className="text-xs font-medium uppercase tracking-wider">Бой логистики</span>
                <Truck className="h-4 w-4 text-indigo-600" />
              </div>
              <p className="text-2xl font-bold text-indigo-950">
                {(defectsData?.defects || []).filter(d => d.defect_type === 'transit_damage').reduce((acc, d) => acc + d.qty_pcs, 0)}{' '}
                <span className="text-sm font-normal text-indigo-700">шт.</span>
              </p>
              <p className="text-xs text-indigo-600 mt-1">
                Повреждение упаковки перевозчиком
              </p>
            </div>

            <div className="card p-4 bg-white border border-slate-200 shadow-xs">
              <div className="flex items-center justify-between text-slate-500 mb-1">
                <span className="text-xs font-medium uppercase tracking-wider">В зоне инспекции</span>
                <Clock className="h-4 w-4 text-brand-600" />
              </div>
              <p className="text-2xl font-bold text-slate-900">
                {(defectsData?.defects || []).filter(d => d.status === 'inspecting').reduce((acc, d) => acc + d.qty_pcs, 0)}{' '}
                <span className="text-sm font-normal text-slate-500">шт.</span>
              </p>
              <p className="text-xs text-slate-400 mt-1">
                На экспертизе завсклада
              </p>
            </div>
          </div>

          {/* Панель фильтров */}
          <div className="card p-4 bg-white flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide mr-1">
                Причина дефекта:
              </span>
              <button
                onClick={() => setDefectFilter('all')}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  defectFilter === 'all'
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                Все ({(defectsData?.defects || []).length})
              </button>
              <button
                onClick={() => setDefectFilter('factory_defect')}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  defectFilter === 'factory_defect'
                    ? 'bg-amber-600 text-white'
                    : 'bg-amber-50 text-amber-800 hover:bg-amber-100 border border-amber-200'
                }`}
              >
                Брак фабрики ({(defectsData?.defects || []).filter(d => d.defect_type === 'factory_defect').length})
              </button>
              <button
                onClick={() => setDefectFilter('transit_damage')}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  defectFilter === 'transit_damage'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-indigo-50 text-indigo-800 hover:bg-indigo-100 border border-indigo-200'
                }`}
              >
                Бой перевозчика ({(defectsData?.defects || []).filter(d => d.defect_type === 'transit_damage').length})
              </button>
              <button
                onClick={() => setDefectFilter('client_return')}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  defectFilter === 'client_return'
                    ? 'bg-purple-600 text-white'
                    : 'bg-purple-50 text-purple-800 hover:bg-purple-100 border border-purple-200'
                }`}
              >
                Возвраты дилеров ({(defectsData?.defects || []).filter(d => d.defect_type === 'client_return').length})
              </button>
            </div>

            <button
              onClick={handlePrint}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors shadow-xs"
            >
              <Printer className="h-3.5 w-3.5" />
              Печать актов брака
            </button>
          </div>

          {/* Таблица рекламаций */}
          {loadingDefects ? (
            <div className="card p-12 text-center">
              <div className="inline-block h-8 w-8 animate-spin rounded-full border-2 border-brand-600 border-t-transparent mb-2" />
              <p className="text-sm text-slate-500">Загрузка актов отбраковки из ERP...</p>
            </div>
          ) : defectsError ? (
            <div className="card p-6 border-red-200 bg-red-50 text-red-800 text-sm">
              <div className="flex items-center gap-2 mb-1">
                <AlertCircle className="h-4 w-4 text-red-600 shrink-0" />
                <p className="font-semibold">Ошибка загрузки:</p>
              </div>
              <p>{defectsError}</p>
            </div>
          ) : (defectsData?.defects || []).length === 0 ? (
            <div className="card p-12 text-center text-slate-500">
              <CheckCircle2 className="h-10 w-10 text-emerald-400 mx-auto mb-2" />
              <p className="font-semibold text-slate-700">Нет зарегистрированного брака</p>
              <p className="text-xs text-slate-400 mt-1">
                Вся продукция фабрики находится в кондиционном состоянии без зафиксированных дефектов
              </p>
            </div>
          ) : (
            <div className="card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase text-slate-500">
                      <th className="py-3 px-4">Акт / Дата</th>
                      <th className="py-3 px-4">Номенклатура / Размер</th>
                      <th className="py-3 px-4">Склад размещения</th>
                      <th className="py-3 px-4">Причина дефекта</th>
                      <th className="py-3 px-4">Ответственность</th>
                      <th className="py-3 px-4 text-right">Объем</th>
                      <th className="py-3 px-4">Статус</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(defectsData?.defects || [])
                      .filter(d => defectFilter === 'all' || d.defect_type === defectFilter)
                      .map((defect) => (
                        <tr key={defect.defect_id} className="hover:bg-slate-50 transition-colors">
                          <td className="py-3.5 px-4 align-top">
                            <p className="font-mono font-bold text-slate-900 text-xs">{defect.act_number}</p>
                            <p className="text-[11px] text-slate-400 mt-0.5">{defect.act_date}</p>
                          </td>
                          <td className="py-3.5 px-4 align-top">
                            <p className="font-bold text-slate-900">{defect.article}</p>
                            <p className="text-xs text-brand-700">{defect.collection}</p>
                            <p className="text-xs text-slate-500 mt-0.5">{defect.size}</p>
                          </td>
                          <td className="py-3.5 px-4 align-top">
                            <p className="font-semibold text-slate-800 text-xs">{defect.warehouse_name}</p>
                            <p className="text-[11px] text-slate-400">{defect.city}</p>
                          </td>
                          <td className="py-3.5 px-4 align-top">
                            <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                              defect.defect_type === 'factory_defect'
                                ? 'bg-amber-100 text-amber-900 border border-amber-200'
                                : defect.defect_type === 'transit_damage'
                                  ? 'bg-indigo-100 text-indigo-900 border border-indigo-200'
                                  : 'bg-purple-100 text-purple-900 border border-purple-200'
                            }`}>
                              {defect.defect_type_label}
                            </span>
                            {defect.comment && (
                              <p className="text-xs text-slate-600 mt-1 italic max-w-xs">{defect.comment}</p>
                            )}
                          </td>
                          <td className="py-3.5 px-4 align-top">
                            <span className="text-xs font-semibold text-slate-700">
                              {defect.responsible_party}
                            </span>
                          </td>
                          <td className="py-3.5 px-4 align-top text-right whitespace-nowrap">
                            <span className="font-bold text-slate-900 text-sm">{defect.qty_pcs} шт</span>
                            <p className="text-xs text-slate-400">{defect.area_sqm.toFixed(1)} м²</p>
                          </td>
                          <td className="py-3.5 px-4 align-top">
                            <span className={`badge text-[10px] font-bold ${
                              defect.status === 'inspecting'
                                ? 'bg-amber-100 text-amber-800 border-amber-300'
                                : defect.status === 'discounted'
                                  ? 'bg-blue-100 text-blue-800 border-blue-300'
                                  : 'bg-slate-100 text-slate-700 border-slate-300'
                            }`}>
                              {defect.status_label}
                            </span>
                          </td>
                        </tr>
                      ))}
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
