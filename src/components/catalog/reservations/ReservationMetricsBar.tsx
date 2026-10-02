import React from 'react';
import { Package, Layers, Building2 } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

interface ReservationMetricsBarProps {
  totalPcs: number;
  totalSqm: number;
  uniqueClientsCount: number;
  fmtNum: (n: number, decimals?: number) => string;
}

export function ReservationMetricsBar({
  totalPcs,
  totalSqm,
  uniqueClientsCount,
  fmtNum,
}: ReservationMetricsBarProps) {
  const { t } = useLanguage();

  return (
    <div className="grid grid-cols-3 gap-1.5 sm:gap-2 px-3 sm:px-5 py-2 sm:py-3 border-b border-slate-100 bg-white select-none">
      {/* 1. Total Reserved */}
      <div className="rounded-xl bg-amber-50/60 border border-amber-200/80 p-2 sm:p-2.5 flex items-center gap-2 sm:gap-3 min-w-0">
        <div className="flex h-7 w-7 sm:h-8 sm:w-8 items-center justify-center rounded-lg bg-amber-500 text-white shrink-0">
          <Package className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
        </div>
        <div className="min-w-0 flex-1 overflow-hidden">
          <p className="text-[9px] sm:text-[10px] uppercase font-bold text-amber-800 truncate leading-tight">
            {t('reservations.total_in_reserve')}
          </p>
          <p className="text-xs sm:text-base font-extrabold text-slate-900 font-mono truncate mt-0.5">
            {fmtNum(totalPcs)}{' '}
            <span className="text-[10px] sm:text-xs font-medium text-slate-500">
              {t('common.pcs')}
            </span>
          </p>
        </div>
      </div>

      {/* 2. Total Area */}
      <div className="rounded-xl bg-emerald-50/60 border border-emerald-200/80 p-2 sm:p-2.5 flex items-center gap-2 sm:gap-3 min-w-0">
        <div className="flex h-7 w-7 sm:h-8 sm:w-8 items-center justify-center rounded-lg bg-emerald-600 text-white shrink-0">
          <Layers className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
        </div>
        <div className="min-w-0 flex-1 overflow-hidden">
          <p className="text-[9px] sm:text-[10px] uppercase font-bold text-emerald-800 truncate leading-tight">
            {t('reservations.total_area')}
          </p>
          <p className="text-xs sm:text-base font-extrabold text-emerald-950 font-mono truncate mt-0.5">
            {fmtNum(totalSqm, 2)}{' '}
            <span className="text-[10px] sm:text-xs font-medium text-emerald-700">
              {t('common.sqm')}
            </span>
          </p>
        </div>
      </div>

      {/* 3. Clients */}
      <div className="rounded-xl bg-indigo-50/60 border border-indigo-200/80 p-2 sm:p-2.5 flex items-center gap-2 sm:gap-3 min-w-0">
        <div className="flex h-7 w-7 sm:h-8 sm:w-8 items-center justify-center rounded-lg bg-indigo-600 text-white shrink-0">
          <Building2 className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
        </div>
        <div className="min-w-0 flex-1 overflow-hidden">
          <p className="text-[9px] sm:text-[10px] uppercase font-bold text-indigo-800 truncate leading-tight">
            {t('reservations.clients')}
          </p>
          <p className="text-xs sm:text-base font-extrabold text-slate-900 font-mono truncate mt-0.5">
            {uniqueClientsCount}{' '}
            <span className="text-[10px] sm:text-xs font-medium text-slate-500">
              {t('reservations.counterparties')}
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}
