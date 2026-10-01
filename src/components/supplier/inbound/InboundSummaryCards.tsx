import React from 'react';
import {
  Truck,
  CheckCircle2,
  AlertTriangle,
  PackageCheck,
} from 'lucide-react';

export interface InboundSummaryCardsProps {
  totalShipments: number;
  matchedCount: number;
  discrepancyCount: number;
  totalDeltaPcs: number;
  totalDeltaSqm: number;
}

export function InboundSummaryCards({
  totalShipments,
  matchedCount,
  discrepancyCount,
  totalDeltaPcs,
  totalDeltaSqm,
}: InboundSummaryCardsProps) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-4">
      <div className="card p-3 sm:p-4 bg-white border border-slate-200 shadow-xs">
        <div className="flex items-center justify-between text-slate-500 mb-1">
          <span className="text-[10px] sm:text-xs font-semibold uppercase tracking-wider truncate">Всего поставок</span>
          <Truck className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-brand-600 shrink-0" />
        </div>
        <p className="text-xl sm:text-2xl font-bold text-slate-900">
          {totalShipments}{' '}
          <span className="text-xs sm:text-sm font-normal text-slate-500">партий</span>
        </p>
        <p className="text-[11px] sm:text-xs text-slate-400 mt-0.5 truncate">
          Основной склад Астана
        </p>
      </div>

      <div className="card p-3 sm:p-4 bg-white border border-slate-200 shadow-xs">
        <div className="flex items-center justify-between text-slate-500 mb-1">
          <span className="text-[10px] sm:text-xs font-semibold uppercase tracking-wider truncate">Без замечаний</span>
          <CheckCircle2 className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-emerald-600 shrink-0" />
        </div>
        <p className="text-xl sm:text-2xl font-bold text-emerald-950">
          {matchedCount}{' '}
          <span className="text-xs sm:text-sm font-normal text-emerald-700">партий</span>
        </p>
        <p className="text-[11px] sm:text-xs text-emerald-600 mt-0.5 truncate">
          100% соответствие ТТН
        </p>
      </div>

      <div className="card p-3 sm:p-4 bg-white border border-slate-200 shadow-xs">
        <div className="flex items-center justify-between text-slate-500 mb-1">
          <span className="text-[10px] sm:text-xs font-semibold uppercase tracking-wider truncate">Расхождения</span>
          <AlertTriangle className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-amber-600 shrink-0" />
        </div>
        <p className="text-xl sm:text-2xl font-bold text-amber-950">
          {discrepancyCount}{' '}
          <span className="text-xs sm:text-sm font-normal text-amber-700">партий</span>
        </p>
        <p className="text-[11px] sm:text-xs text-amber-600 mt-0.5 truncate">
          Недостачи / излишки
        </p>
      </div>

      <div className="card p-3 sm:p-4 bg-white border border-slate-200 shadow-xs">
        <div className="flex items-center justify-between text-slate-500 mb-1">
          <span className="text-[10px] sm:text-xs font-semibold uppercase tracking-wider truncate">Дельта приемки</span>
          <PackageCheck className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-brand-600 shrink-0" />
        </div>
        <p className="text-xl sm:text-2xl font-bold text-slate-900">
          {totalDeltaPcs > 0 ? `+${totalDeltaPcs}` : totalDeltaPcs}{' '}
          <span className="text-xs sm:text-sm font-normal text-slate-500">шт.</span>
        </p>
        <p className="text-[11px] sm:text-xs text-slate-400 mt-0.5 truncate">
          {totalDeltaSqm > 0 ? `+${totalDeltaSqm.toFixed(1)}` : totalDeltaSqm.toFixed(1)} м² суммарно
        </p>
      </div>
    </div>
  );
}

export default InboundSummaryCards;
