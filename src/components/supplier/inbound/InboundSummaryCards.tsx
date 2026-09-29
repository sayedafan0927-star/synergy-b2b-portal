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
  );
}

export default InboundSummaryCards;
