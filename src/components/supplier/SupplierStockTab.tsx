import { useState, useEffect, useMemo } from 'react';
import {
  Layers,
  Warehouse as WarehouseIcon,
  Store,
  TrendingUp,
  Search,
  AlertCircle,
} from 'lucide-react';
import { fetchSupplierNetworkStock } from '@/lib/erpApi';
import type {
  SupplierNetworkStockResponse,
  SupplierStockItem,
  SupplierDistribution,
} from '@/types';

export interface SupplierStockTabProps {
  selectedSupplierId: number;
  reloadCounter: number;
}

export function SupplierStockTab({ selectedSupplierId, reloadCounter }: SupplierStockTabProps) {
  const [stockData, setStockData] = useState<SupplierNetworkStockResponse | null>(null);
  const [loadingStock, setLoadingStock] = useState<boolean>(true);
  const [stockError, setStockError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState<string>('');
  const [cityFilter, setCityFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');

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

  // Санитайзер данных: устранение коллизии на стороне ERP (ковры SAYDAM внутри ISMEN)
  const sanitizedItems = useMemo(() => {
    const raw = stockData?.items || [];
    if (selectedSupplierId === 6) {
      return raw.filter(item => {
        const coll = (item.collection || '').toUpperCase();
        const name = (item.name || '').toUpperCase();
        return coll !== 'SAYDAM' && !name.includes('SAYDAM');
      });
    }
    return raw;
  }, [stockData?.items, selectedSupplierId]);

  const availableCities = useMemo(() => {
    return Array.from(
      new Set(
        sanitizedItems.flatMap(item => (item.distribution || []).map(d => d.city).filter(Boolean))
      )
    );
  }, [sanitizedItems]);

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

      const matchedDist = (item.distribution || []).filter(dist => {
        const matchCity = cityFilter === 'all' || dist.city === cityFilter;
        const matchType =
          typeFilter === 'all' ||
          (typeFilter === 'hub' && dist.type === 'central_hub') ||
          (typeFilter === 'consignment' && dist.type !== 'central_hub');
        return matchCity && matchType;
      });

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

  return (
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
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 focus:outline-none cursor-pointer"
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
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 focus:outline-none cursor-pointer"
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
  );
}

export default SupplierStockTab;
