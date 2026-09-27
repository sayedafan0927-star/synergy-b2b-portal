import { useState, useEffect } from 'react';
import { fetchSupplierNetworkStock } from '@/lib/erpApi';
import type {
  SupplierNetworkStockResponse,
  SupplierReleasesReport,
  SupplierStockItem,
  SupplierDistribution
} from '@/types';
import type { Profile } from '@/contexts/AuthContext';
import {
  Building2,
  MapPin,
  Calendar,
  Printer,
  Download,
  RefreshCw,
  FileText,
  Search,
  Filter,
  CheckCircle2,
  Store,
  Warehouse as WarehouseIcon,
  TrendingUp,
  Layers,
  ChevronDown
} from 'lucide-react';

interface SupplierCabinetProps {
  profile: Profile;
}

const KNOWN_SUPPLIERS = [
  { id: 6, name: 'ISMEN (Турция)' },
  { id: 7, name: 'MERINOS' },
  { id: 10, name: 'KARMEN HALI (Турция)' },
  { id: 11, name: 'SAYDAM (Турция)' },
  { id: 1, name: 'Merinos Россия' },
  { id: 8, name: 'IRAN' },
  { id: 9, name: 'GHEYTARAN' },
  { id: 12, name: 'LYSANDRA HALI' },
];

export default function SupplierCabinet({ profile }: SupplierCabinetProps) {
  // Выбираем ID поставщика: если у профиля есть partner_id или erp_id, иначе 6 (ISMEN)
  const defaultSupplierId = Number(profile.partner_id) || (profile.role === 'supplier' ? 6 : 6);
  const [selectedSupplierId, setSelectedSupplierId] = useState<number>(defaultSupplierId);
  const [activeSubTab, setActiveSubTab] = useState<'stock' | 'releases'>('stock');

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

  // Загрузка географии остатков
  const loadStock = async (supplierId: number) => {
    setLoadingStock(true);
    setStockError(null);
    try {
      const data = await fetchSupplierNetworkStock(supplierId, 'stock');
      if (data && data.success) {
        setStockData(data);
      } else {
        setStockError(data?.error || 'Не удалось загрузить остатки фабрики');
      }
    } catch (err: any) {
      setStockError(err?.message || 'Ошибка сети при обращении к ERP');
    } finally {
      setLoadingStock(false);
    }
  };

  // Загрузка акта реализации
  const loadReleases = async (supplierId: number, start: string, end: string) => {
    setLoadingReleases(true);
    setReleasesError(null);
    try {
      const data = await fetchSupplierNetworkStock(supplierId, 'releases', {
        startDate: start,
        endDate: end,
      });
      if (data && data.success) {
        setReleasesData(data);
      } else {
        setReleasesError(data?.error || 'Не удалось загрузить акт реализации');
      }
    } catch (err: any) {
      setReleasesError(err?.message || 'Ошибка сети при обращении к ERP');
    } finally {
      setLoadingReleases(false);
    }
  };

  useEffect(() => {
    loadStock(selectedSupplierId);
  }, [selectedSupplierId]);

  useEffect(() => {
    if (activeSubTab === 'releases') {
      loadReleases(selectedSupplierId, startDate, endDate);
    }
  }, [selectedSupplierId, activeSubTab, startDate, endDate]);

  // Расчет агрегатов для вкладки остатков
  const items = stockData?.items || [];

  // Собираем все уникальные города для фильтра
  const availableCities = Array.from(
    new Set(
      items.flatMap(item => (item.distribution || []).map(d => d.city).filter(Boolean))
    )
  );

  // Вычисляем объемы на центральном хабе и у партнеров
  let hubQty = 0;
  let hubSqm = 0;
  let consignmentQty = 0;
  let consignmentSqm = 0;

  for (const item of items) {
    for (const dist of item.distribution || []) {
      const q = dist.qty_pcs ?? dist.qty ?? 0;
      const s = dist.area_sqm ?? dist.sqm ?? 0;
      if (dist.type === 'central_hub') {
        hubQty += q;
        hubSqm += s;
      } else {
        consignmentQty += q;
        consignmentSqm += s;
      }
    }
  }

  // Фильтрация позиций
  const filteredItems = items.filter(item => {
    const qLower = searchQuery.toLowerCase().trim();
    const matchSearch =
      !qLower ||
      item.article?.toLowerCase().includes(qLower) ||
      item.collection?.toLowerCase().includes(qLower) ||
      (item.name && item.name.toLowerCase().includes(qLower));

    if (!matchSearch) return false;

    // Проверяем распределение
    const hasMatchingDist = (item.distribution || []).some(dist => {
      const matchCity = cityFilter === 'all' || dist.city === cityFilter;
      const matchType =
        typeFilter === 'all' ||
        (typeFilter === 'hub' && dist.type === 'central_hub') ||
        (typeFilter === 'consignment' && dist.type !== 'central_hub');
      return matchCity && matchType;
    });

    return (item.distribution || []).length === 0 || hasMatchingDist;
  });

  const handlePrint = () => {
    window.print();
  };

  const setPeriodQuickPick = (pick: 'current_month' | 'prev_month' | 'q3_2026' | 'year_2026') => {
    if (pick === 'current_month') {
      setStartDate('2026-09-01');
      setEndDate('2026-09-30');
    } else if (pick === 'prev_month') {
      setStartDate('2026-08-01');
      setEndDate('2026-08-31');
    } else if (pick === 'q3_2026') {
      setStartDate('2026-07-01');
      setEndDate('2026-09-30');
    } else if (pick === 'year_2026') {
      setStartDate('2026-01-01');
      setEndDate('2026-12-31');
    }
  };

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
                  {stockData?.supplier_name || 'Кабинет турецкого поставщика'}
                </h2>
                <span className="badge bg-amber-100 text-amber-800 border border-amber-300/50 text-[10px] font-bold">
                  B2B Фабрика
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Прямая интеграция с распределительной сетью Synergiya Group в Казахстане
              </p>
            </div>
          </div>

          {/* Селектор поставщика для переключения */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 whitespace-nowrap">Фабрика:</span>
            <div className="relative">
              <select
                value={selectedSupplierId}
                onChange={e => setSelectedSupplierId(Number(e.target.value))}
                className="appearance-none rounded-lg border border-slate-300 bg-white py-1.5 pl-3 pr-8 text-xs font-semibold text-slate-800 shadow-xs focus:border-brand-500 focus:outline-none"
              >
                {KNOWN_SUPPLIERS.map(sup => (
                  <option key={sup.id} value={sup.id}>
                    {sup.name}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            </div>
            <button
              onClick={() => {
                if (activeSubTab === 'stock') loadStock(selectedSupplierId);
                else loadReleases(selectedSupplierId, startDate, endDate);
              }}
              title="Обновить данные"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-brand-700 transition-colors"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loadingStock || loadingReleases ? 'animate-spin' : ''}`} />
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
                {stockData.total_network_qty} шт.
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
          {/* Сводные KPI карточки */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="card p-4 bg-white border border-slate-200 shadow-xs">
              <div className="flex items-center justify-between text-slate-500 mb-1">
                <span className="text-xs font-medium uppercase tracking-wider">Всего в сети РК</span>
                <Layers className="h-4 w-4 text-brand-600" />
              </div>
              <p className="text-2xl font-bold text-slate-900">
                {stockData?.total_network_qty ?? 0}{' '}
                <span className="text-sm font-normal text-slate-500">шт.</span>
              </p>
              <p className="text-xs text-slate-400 mt-1">
                {(stockData?.total_sqm_in_network ?? 0).toFixed(1)} м² продукции
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
                У партнеров в магазинах ({consignmentSqm.toFixed(1)} м²)
              </p>
            </div>

            <div className="card p-4 bg-white border border-slate-200 shadow-xs">
              <div className="flex items-center justify-between text-slate-500 mb-1">
                <span className="text-xs font-medium uppercase tracking-wider">Номенклатур</span>
                <TrendingUp className="h-4 w-4 text-brand-600" />
              </div>
              <p className="text-2xl font-bold text-slate-900">
                {stockData?.items_count ?? 0}
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
              <p className="font-semibold">Ошибка загрузки:</p>
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
                      <th className="py-3 px-4">Всего в РК</th>
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
                              {(item.distribution || []).map((dist, dIdx) => {
                                const q = dist.qty_pcs ?? dist.qty ?? 0;
                                const s = dist.area_sqm ?? dist.sqm ?? 0;
                                const isHub = dist.type === 'central_hub';

                                return (
                                  <div
                                    key={dIdx}
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
      {/* ВКЛАДКА 2: АКТ РЕАЛИЗАЦИИ / ОТЧЕТ ПО ПРОДАЖАМ (SETTLEMENT)     */}
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
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                    startDate === '2026-09-01' && endDate === '2026-09-30'
                      ? 'bg-brand-700 text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  Сентябрь 2026
                </button>
                <button
                  onClick={() => setPeriodQuickPick('prev_month')}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                    startDate === '2026-08-01' && endDate === '2026-08-31'
                      ? 'bg-brand-700 text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  Август 2026
                </button>
                <button
                  onClick={() => setPeriodQuickPick('q3_2026')}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                    startDate === '2026-07-01' && endDate === '2026-09-30'
                      ? 'bg-brand-700 text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  3-й квартал 2026
                </button>
                <button
                  onClick={() => setPeriodQuickPick('year_2026')}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                    startDate === '2026-01-01' && endDate === '2026-12-31'
                      ? 'bg-brand-700 text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  Весь 2026 год
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
                Сумма за реализованную продукцию за период
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
              <p className="font-semibold">Ошибка загрузки акта:</p>
              <p>{releasesError}</p>
            </div>
          ) : !releasesData?.releases || releasesData.releases.length === 0 ? (
            <div className="card p-10 text-center text-slate-500">
              <FileText className="h-10 w-10 text-slate-300 mx-auto mb-2" />
              <p className="font-semibold text-slate-800">Нет реализаций за выбранный период</p>
              <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
                В периоде с {startDate} по {endDate} по фабрике {stockData?.supplier_name || ''} не было зафиксировано выпусков с консигнации или отгрузок конечным клиентам.
              </p>
              <button
                onClick={() => setPeriodQuickPick('year_2026')}
                className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-brand-700 hover:bg-slate-50"
              >
                Показать за весь 2026 год
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
                    {releasesData.releases.map((rel, idx) => (
                      <tr key={idx} className="hover:bg-slate-50 transition-colors">
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
