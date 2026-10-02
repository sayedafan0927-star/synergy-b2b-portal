import { useState, useEffect } from 'react';
import {
  Printer,
  FileText,
  AlertCircle,
  Download,
} from 'lucide-react';
import { fetchSupplierNetworkStock, exportSupplierReleasesToCsv } from '@/lib/erpApi';
import type { SupplierReleasesReport } from '@/types';

export interface SupplierReleasesTabProps {
  selectedSupplierId: number;
  reloadCounter: number;
  supplierName?: string;
}

export function SupplierReleasesTab({
  selectedSupplierId,
  reloadCounter,
  supplierName,
}: SupplierReleasesTabProps) {
  const [startDate, setStartDate] = useState<string>('2026-09-01');
  const [endDate, setEndDate] = useState<string>('2026-09-30');
  const [releasesData, setReleasesData] = useState<SupplierReleasesReport | null>(null);
  const [loadingReleases, setLoadingReleases] = useState<boolean>(false);
  const [releasesError, setReleasesError] = useState<string | null>(null);

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

  const handlePrint = () => {
    window.print();
  };

  const handleExportCsv = () => {
    if (!releasesData?.releases) return;
    exportSupplierReleasesToCsv(releasesData.releases, {
      supplierName,
      startDate,
      endDate,
      totalAmountUsd: releasesData.total_amount_usd,
      totalPcs: releasesData.total_released_pcs,
      totalSqm: releasesData.total_released_sqm,
    });
  };

  useEffect(() => {
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
  }, [selectedSupplierId, startDate, endDate, reloadCounter]);

  return (
    <div className="space-y-6">
      {/* Период и экспорт */}
      <div className="card p-3.5 sm:p-5 bg-white">
        <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3 sm:gap-4">
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
            <span className="text-[10px] sm:text-xs font-semibold text-slate-500 uppercase tracking-wide mr-1">
              Период отчета:
            </span>
            <button
              onClick={() => setPeriodQuickPick('current_month')}
              className="rounded-md px-2 sm:px-2.5 py-1 text-[11px] sm:text-xs font-medium transition-colors bg-slate-100 text-slate-700 hover:bg-slate-200 cursor-pointer"
            >
              Текущий месяц
            </button>
            <button
              onClick={() => setPeriodQuickPick('prev_month')}
              className="rounded-md px-2 sm:px-2.5 py-1 text-[11px] sm:text-xs font-medium transition-colors bg-slate-100 text-slate-700 hover:bg-slate-200 cursor-pointer"
            >
              Предыдущий месяц
            </button>
            <button
              onClick={() => setPeriodQuickPick('q3')}
              className="rounded-md px-2 sm:px-2.5 py-1 text-[11px] sm:text-xs font-medium transition-colors bg-slate-100 text-slate-700 hover:bg-slate-200 cursor-pointer"
            >
              3-й квартал
            </button>
            <button
              onClick={() => setPeriodQuickPick('year')}
              className="rounded-md px-2 sm:px-2.5 py-1 text-[11px] sm:text-xs font-medium transition-colors bg-slate-100 text-slate-700 hover:bg-slate-200 cursor-pointer"
            >
              Весь {curYear} год
            </button>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-2 border-t border-slate-100 lg:border-t-0 lg:pt-0">
            <div className="flex items-center gap-1.5 text-xs w-full sm:w-auto">
              <input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className="flex-1 sm:flex-initial rounded-lg border border-slate-300 px-2 py-1.5 text-xs text-slate-800 bg-white"
              />
              <span className="text-slate-400 shrink-0">—</span>
              <input
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                className="flex-1 sm:flex-initial rounded-lg border border-slate-300 px-2 py-1.5 text-xs text-slate-800 bg-white"
              />
            </div>
            <button
              onClick={handlePrint}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors shadow-xs cursor-pointer w-full sm:w-auto shrink-0"
            >
              <Printer className="h-3.5 w-3.5" />
              Печать акта
            </button>
            <button
              type="button"
              onClick={handleExportCsv}
              disabled={!releasesData?.releases || releasesData.releases.length === 0}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 transition-colors shadow-xs cursor-pointer w-full sm:w-auto shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
              title="Скачать реестр документов реализации в Excel (.csv)"
            >
              <Download className="h-3.5 w-3.5 text-emerald-700" />
              Скачать (.csv)
            </button>
          </div>
        </div>
      </div>

      {/* Финансовые показатели акта сверки */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
        <div className="card p-4 sm:p-5 bg-gradient-to-br from-emerald-600 to-emerald-700 text-white shadow-md">
          <p className="text-[10px] sm:text-xs uppercase tracking-wider text-emerald-100 font-semibold mb-1">
            К перечислению фабрике
          </p>
          <p className="text-2xl sm:text-3xl font-extrabold">
            ${(releasesData?.total_amount_usd ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
          <p className="text-[11px] sm:text-xs text-emerald-100 mt-1.5 sm:mt-2">
            Сумма за реализованную продукцию (снятую с холда)
          </p>
        </div>

        <div className="card p-4 sm:p-5 bg-white border border-slate-200 shadow-xs">
          <p className="text-[10px] sm:text-xs uppercase tracking-wider text-slate-400 font-semibold mb-1">
            Реализовано ковров
          </p>
          <p className="text-2xl sm:text-3xl font-bold text-slate-900">
            {releasesData?.total_released_pcs ?? 0}{' '}
            <span className="text-xs sm:text-sm font-normal text-slate-500">шт.</span>
          </p>
          <p className="text-[11px] sm:text-xs text-slate-400 mt-1.5 sm:mt-2">
            {(releasesData?.total_released_sqm ?? 0).toFixed(1)} м² отпущено покупателям
          </p>
        </div>

        <div className="card p-4 sm:p-5 bg-white border border-slate-200 shadow-xs">
          <p className="text-[10px] sm:text-xs uppercase tracking-wider text-slate-400 font-semibold mb-1">
            Документов реализации
          </p>
          <p className="text-2xl sm:text-3xl font-bold text-slate-900">
            {releasesData?.releases?.length ?? 0}
          </p>
          <p className="text-[11px] sm:text-xs text-slate-400 mt-1.5 sm:mt-2">
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
            В периоде с {startDate} по {endDate} по фабрике {supplierName || ''} не зафиксировано выпусков с консигнации или отгрузок конечным клиентам.
          </p>
          <button
            onClick={() => setPeriodQuickPick('year')}
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-brand-700 hover:bg-slate-50 cursor-pointer"
          >
            Показать за весь {curYear} год
          </button>
        </div>
      ) : (
        <>
          {/* Mobile view (< md) */}
          <div className="md:hidden space-y-3">
            <div className="px-1 py-1 flex items-center justify-between text-xs text-slate-500">
              <span className="font-bold text-slate-800">
                Документы реализации ({releasesData.releases.length})
              </span>
              <span className="font-mono text-[11px]">
                {startDate} — {endDate}
              </span>
            </div>
            {releasesData.releases.map((rel, idx) => {
              const relKey = `${idx}-${rel.doc_number || ''}-${rel.date || ''}`;
              return (
                <div key={relKey} className="card p-3.5 bg-white border border-slate-200/80 shadow-xs space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono font-bold text-slate-900 text-xs">
                      {rel.doc_number}
                    </span>
                    <span className="badge bg-slate-100 text-slate-600 text-[10px]">
                      {rel.date}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5">
                      <span className="inline-block h-2 w-2 rounded-full bg-emerald-500"></span>
                      <span className="text-slate-800 font-medium">Оптовый партнер</span>
                    </div>
                    <span className="text-slate-400 text-[11px]">{rel.city || 'Казахстан'}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-100 text-center">
                    <div className="bg-slate-50 rounded-lg p-1.5">
                      <p className="text-[10px] text-slate-400">Кол-во</p>
                      <p className="font-bold text-xs text-slate-900">{rel.released_qty} шт</p>
                    </div>
                    <div className="bg-slate-50 rounded-lg p-1.5">
                      <p className="text-[10px] text-slate-400">Площадь</p>
                      <p className="font-bold text-xs text-slate-900">{rel.released_sqm.toFixed(1)} м²</p>
                    </div>
                    <div className="bg-emerald-50 rounded-lg p-1.5">
                      <p className="text-[10px] text-emerald-600 font-medium">К выплате</p>
                      <p className="font-bold text-xs text-emerald-800">${rel.total_usd.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Desktop view (>= md) */}
          <div className="hidden md:block card overflow-hidden">
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
        </>
      )}
    </div>
  );
}

export default SupplierReleasesTab;
