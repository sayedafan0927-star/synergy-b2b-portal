import React from 'react';
import type { StockSummary } from '@/types';
import { useLanguage } from '@/contexts/LanguageContext';
import { CheckCircle2, Clock, Truck, Boxes, Layers } from 'lucide-react';

interface StockSummaryBarProps {
  summary: StockSummary;
  className?: string;
  onReserveClick?: () => void;
}

function fmtNum(n: number, decimals = 0): string {
  if (n === undefined || n === null || isNaN(n)) return '0';
  return n.toLocaleString('ru-RU', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export const StockSummaryBar: React.FC<StockSummaryBarProps> = ({ summary, className = '', onReserveClick }) => {
  const { language } = useLanguage();

  const labels = {
    found: language === 'kz' ? 'Табылды' : 'Найдено',
    free: language === 'kz' ? 'Қалдық' : 'Остаток',
    freeSub: language === 'kz' ? 'еркін' : 'свободно',
    reserve: language === 'kz' ? 'Резерв' : 'Резерв',
    toShip: language === 'kz' ? 'Жөнелтуге' : 'К отгрузке',
    total: language === 'kz' ? 'Барлығы' : 'Всего',
    totalSub: language === 'kz' ? 'қоймада' : 'на складе',
    pcs: language === 'kz' ? 'дн' : 'шт.',
  };

  return (
    <div
      className={`w-full rounded-xl bg-white border border-slate-200/90 shadow-2xs px-4 py-3 select-none transition-all ${className}`}
    >
      {/* ── Desktop & Tablet: Horizontal Compact Strip (like screenshot) ── */}
      <div className="hidden sm:flex flex-wrap items-center justify-between gap-y-2 gap-x-4 text-xs">
        {/* Найдено */}
        <div className="flex items-center gap-2 pr-3 border-r border-slate-200/80">
          <span className="font-semibold text-slate-700">{labels.found}:</span>
          <span className="inline-flex items-center justify-center font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-800 text-xs font-mono">
            {summary.total_items}
          </span>
        </div>

        {/* 1. Свободный остаток к заказу */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
            <span className="font-medium text-slate-600">{labels.free}:</span>
          </div>
          <span className="font-bold text-slate-900 font-mono">
            {fmtNum(summary.free_stock_qty)} {labels.pcs}
          </span>
          <span className="font-semibold text-emerald-700 font-mono">
            {fmtNum(summary.free_stock_sqm, 2)} м²
          </span>
        </div>

        <div className="h-3.5 w-px bg-slate-200/80 hidden md:block" />

        {/* 2. В резерве */}
        <div
          onClick={onReserveClick}
          className={`flex items-center gap-2 rounded-lg px-2 py-1 -my-1 transition-all ${
            onReserveClick
              ? 'cursor-pointer hover:bg-amber-50 active:scale-95 border border-transparent hover:border-amber-200'
              : ''
          }`}
          title={onReserveClick ? 'Нажмите, чтобы посмотреть клиентов и объём резерва' : undefined}
        >
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-amber-500 shrink-0" />
            <span className="font-medium text-slate-600">{labels.reserve}:</span>
          </div>
          <span className="font-bold text-slate-900 font-mono">
            {fmtNum(summary.reserved_stock_qty)} {labels.pcs}
          </span>
          <span className="font-semibold text-amber-700 font-mono">
            {fmtNum(summary.reserved_stock_sqm, 2)} м²
          </span>
          {onReserveClick && (
            <span className="text-[10px] font-medium text-amber-800 bg-amber-100/80 px-1.5 py-0.5 rounded-full hover:bg-amber-200">
              клиенты ↗
            </span>
          )}
        </div>

        <div className="h-3.5 w-px bg-slate-200/80 hidden md:block" />

        {/* 3. К отгрузке (сборка ТСД) */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-indigo-500 shrink-0" />
            <span className="font-medium text-slate-600">{labels.toShip}:</span>
          </div>
          <span className="font-bold text-slate-900 font-mono">
            {fmtNum(summary.to_ship_qty)} {labels.pcs}
          </span>
          <span className="font-semibold text-indigo-700 font-mono">
            {fmtNum(summary.to_ship_sqm, 2)} м²
          </span>
        </div>

        <div className="h-3.5 w-px bg-slate-200/80 hidden lg:block" />

        {/* 4. Всего физически на складе */}
        <div className="flex items-center gap-2 pl-2 border-l border-slate-200/80">
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-slate-600 shrink-0" />
            <span className="font-bold text-slate-800">{labels.total}:</span>
          </div>
          <span className="font-bold text-slate-900 font-mono">
            {fmtNum(summary.total_stock_qty)} {labels.pcs}
          </span>
          <span className="font-bold text-slate-700 font-mono">
            {fmtNum(summary.total_stock_sqm, 2)} м²
          </span>
        </div>
      </div>

      {/* ── Mobile View: Sleek Single-Line Horizontal Strip (Desktop Screen 3 Style) ── */}
      <div className="sm:hidden flex items-center gap-3 overflow-x-auto no-scrollbar py-0.5 text-xs whitespace-nowrap">
        {/* Найдено */}
        <div className="flex items-center gap-1.5 pr-2.5 border-r border-slate-200/80 shrink-0">
          <span className="font-semibold text-slate-700">{labels.found}:</span>
          <span className="inline-flex items-center justify-center font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-800 text-xs font-mono">
            {summary.total_items}
          </span>
        </div>

        {/* 1. Свободный остаток */}
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
          <span className="font-medium text-slate-600">{labels.free}:</span>
          <span className="font-bold text-slate-900 font-mono">
            {fmtNum(summary.free_stock_qty)} {labels.pcs}
          </span>
          <span className="font-semibold text-emerald-700 font-mono">
            {fmtNum(summary.free_stock_sqm, 2)} м²
          </span>
        </div>

        <div className="h-3 w-px bg-slate-200/80 shrink-0" />

        {/* 2. В резерве */}
        <div
          onClick={onReserveClick}
          className={`flex items-center gap-1.5 shrink-0 rounded-lg px-1.5 py-0.5 transition-all ${
            onReserveClick ? 'cursor-pointer active:scale-95 bg-amber-50/70 border border-amber-200/60' : ''
          }`}
          title={onReserveClick ? 'Нажмите, чтобы посмотреть клиентов и объём резерва' : undefined}
        >
          <span className="h-2 w-2 rounded-full bg-amber-500 shrink-0" />
          <span className="font-medium text-slate-600">{labels.reserve}:</span>
          <span className="font-bold text-slate-900 font-mono">
            {fmtNum(summary.reserved_stock_qty)} {labels.pcs}
          </span>
          <span className="font-semibold text-amber-700 font-mono">
            {fmtNum(summary.reserved_stock_sqm, 2)} м²
          </span>
          {onReserveClick && (
            <span className="text-[9px] font-bold text-amber-800 bg-amber-100/90 px-1 py-0.5 rounded">
              клиенты ↗
            </span>
          )}
        </div>

        <div className="h-3 w-px bg-slate-200/80 shrink-0" />

        {/* 3. К отгрузке */}
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="h-2 w-2 rounded-full bg-indigo-500 shrink-0" />
          <span className="font-medium text-slate-600">{labels.toShip}:</span>
          <span className="font-bold text-slate-900 font-mono">
            {fmtNum(summary.to_ship_qty)} {labels.pcs}
          </span>
          <span className="font-semibold text-indigo-700 font-mono">
            {fmtNum(summary.to_ship_sqm, 2)} м²
          </span>
        </div>

        <div className="h-3 w-px bg-slate-200/80 shrink-0" />

        {/* 4. Всего */}
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="h-2 w-2 rounded-full bg-slate-600 shrink-0" />
          <span className="font-bold text-slate-800">{labels.total}:</span>
          <span className="font-bold text-slate-900 font-mono">
            {fmtNum(summary.total_stock_qty)} {labels.pcs}
          </span>
          <span className="font-bold text-slate-700 font-mono">
            {fmtNum(summary.total_stock_sqm, 2)} м²
          </span>
        </div>
      </div>
    </div>
  );
};

export default StockSummaryBar;
