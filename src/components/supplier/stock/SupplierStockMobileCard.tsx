import React from 'react';
import { Warehouse as WarehouseIcon, Store } from 'lucide-react';
import type { SupplierStockItem, SupplierDistribution } from '@/types';

export interface SupplierStockMobileCardProps {
  item: SupplierStockItem;
}

export function SupplierStockMobileCard({ item }: SupplierStockMobileCardProps) {
  const totalQty = item.total_network_qty ?? item.total_qty ?? 0;
  const totalSqm = item.total_network_sqm ?? item.total_sqm ?? 0;
  const sizeLabel =
    item.width && item.length
      ? `${item.width} × ${item.length} м`
      : item.size || 'Стандарт';

  return (
    <div className="card p-3.5 bg-white border border-slate-200/80 shadow-xs space-y-3">
      {/* Шапка: артикул, коллекция, название */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-base font-bold text-slate-900 tracking-tight">{item.article}</span>
            <span className="badge bg-brand-50 text-brand-700 border border-brand-200/60 text-[10px] font-semibold">
              {item.collection}
            </span>
          </div>
          {item.name && (
            <p className="text-xs text-slate-500 line-clamp-1 mt-0.5">{item.name}</p>
          )}
        </div>
        <div className="text-right shrink-0">
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-900 px-2.5 py-0.5 text-xs font-bold text-white shadow-xs">
            {totalQty} шт
          </span>
          <p className="text-[11px] text-slate-500 font-medium mt-0.5">{totalSqm.toFixed(1)} м²</p>
        </div>
      </div>

      {/* Размер и площадь */}
      <div className="flex items-center justify-between text-xs py-1.5 px-2.5 rounded-lg bg-slate-50 border border-slate-100 text-slate-700">
        <span className="text-slate-500">Размер полотна:</span>
        <span className="font-semibold text-slate-800">
          {sizeLabel} {item.area_sqm ? `(${item.area_sqm} м²)` : ''}
        </span>
      </div>

      {/* Распределение по сети */}
      <div className="space-y-1.5 pt-1 border-t border-slate-100">
        <p className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
          Размещение в сети ({item.distribution?.length || 0}):
        </p>
        <div className="space-y-1.5">
          {(item.distribution || []).map((dist: SupplierDistribution, dIdx: number) => {
            const q = dist.qty_pcs ?? dist.qty ?? 0;
            const s = dist.area_sqm ?? dist.sqm ?? 0;
            const isHub = dist.type === 'central_hub';
            const distKey = `${item.carpet_id}-${dIdx}-${dist.warehouse_id || ''}-${dist.city}`;

            return (
              <div
                key={distKey}
                className={`flex items-center justify-between rounded-lg p-2 text-xs ${
                  isHub
                    ? 'bg-emerald-50/90 border border-emerald-200/70 text-emerald-950'
                    : 'bg-indigo-50/90 border border-indigo-200/70 text-indigo-950'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  {isHub ? (
                    <WarehouseIcon className="h-3.5 w-3.5 text-emerald-700 shrink-0" />
                  ) : (
                    <Store className="h-3.5 w-3.5 text-indigo-700 shrink-0" />
                  )}
                  <div className="min-w-0 truncate">
                    <p className="font-bold truncate text-[11px] sm:text-xs">
                      {isHub
                        ? (dist.warehouse_name || 'Основной Склад Астана')
                        : dist.partner_name || dist.location_name || 'Партнерский магазин'}
                    </p>
                    <p className="text-[10px] opacity-75">
                      {dist.city === 'Алматы' ? 'Астана' : (dist.city || 'Астана')}
                    </p>
                  </div>
                </div>
                <div className="text-right whitespace-nowrap pl-2 shrink-0">
                  <span className="font-bold text-xs">{q} шт</span>
                  <span className="text-[10px] opacity-75 block">({s.toFixed(1)} м²)</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default SupplierStockMobileCard;
