import { FileText, X, RefreshCw, Printer } from 'lucide-react';
import type { Profile } from '@/contexts/AuthContext';
import { Portal } from '@/components/common/Portal';

export interface ReconciliationModalProps {
  isOpen: boolean;
  onClose: () => void;
  profile: Profile | null;
  reconciliationPeriod: 'month' | 'quarter' | 'year';
  onPeriodChange: (period: 'month' | 'quarter' | 'year') => void;
  loading: boolean;
  data: any | null;
}

export function ReconciliationModal({
  isOpen,
  onClose,
  profile,
  reconciliationPeriod,
  onPeriodChange,
  loading,
  data,
}: ReconciliationModalProps) {
  if (!isOpen) return null;

  return (
    <Portal>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm animate-modal-backdrop modal-gpu-backdrop" onClick={onClose} aria-hidden="true" />
        <div className="relative bg-white rounded-2xl max-w-3xl w-full p-6 shadow-2xl border border-slate-100 space-y-4 max-h-[90vh] flex flex-col animate-modal-card modal-gpu-card z-10" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
              <FileText className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-base">Акт сверки взаиморасчетов</h3>
              <p className="text-xs text-slate-500">
                Контрагент: <strong>{profile?.company_name || profile?.full_name || 'Оптовый клиент'}</strong>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Period selector */}
        <div className="flex items-center justify-between gap-2 shrink-0 bg-slate-50 p-2.5 rounded-xl border border-slate-200 text-xs">
          <span className="font-medium text-slate-600">Период сверки:</span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => onPeriodChange('month')}
              className={`px-3 py-1 rounded-lg font-semibold transition-colors cursor-pointer ${
                reconciliationPeriod === 'month' ? 'bg-brand-700 text-white shadow-xs' : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100'
              }`}
            >
              30 дней
            </button>
            <button
              type="button"
              onClick={() => onPeriodChange('quarter')}
              className={`px-3 py-1 rounded-lg font-semibold transition-colors cursor-pointer ${
                reconciliationPeriod === 'quarter' ? 'bg-brand-700 text-white shadow-xs' : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100'
              }`}
            >
              Квартал
            </button>
            <button
              type="button"
              onClick={() => onPeriodChange('year')}
              className={`px-3 py-1 rounded-lg font-semibold transition-colors cursor-pointer ${
                reconciliationPeriod === 'year' ? 'bg-brand-700 text-white shadow-xs' : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100'
              }`}
            >
              С начала года
            </button>
          </div>
        </div>

        {/* Content body */}
        <div className="overflow-y-auto flex-1 space-y-4 pr-1">
          {loading ? (
            <div className="py-16 text-center">
              <RefreshCw className="h-7 w-7 animate-spin text-brand-600 mx-auto mb-2" />
              <p className="text-xs text-slate-500">Запрос проводок и актов из Synergy ERP...</p>
            </div>
          ) : data ? (
            <div className="space-y-4">
              {/* KPI cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <div className="card p-3 bg-slate-50">
                  <span className="text-[10px] text-slate-400 uppercase font-semibold">Входящее сальдо</span>
                  <p className="text-sm font-bold text-slate-800 mt-0.5">${data.initial_balance ?? '0.00'}</p>
                </div>
                <div className="card p-3 bg-slate-50">
                  <span className="text-[10px] text-slate-400 uppercase font-semibold">Отгрузки (Дебет)</span>
                  <p className="text-sm font-bold text-red-600 mt-0.5">${data.total_debit ?? '0.00'}</p>
                </div>
                <div className="card p-3 bg-slate-50">
                  <span className="text-[10px] text-slate-400 uppercase font-semibold">Оплаты (Кредит)</span>
                  <p className="text-sm font-bold text-emerald-600 mt-0.5">${data.total_credit ?? '0.00'}</p>
                </div>
                <div className="card p-3 bg-slate-50">
                  <span className="text-[10px] text-slate-400 uppercase font-semibold">Конечное сальдо</span>
                  <p className="text-sm font-bold text-slate-900 mt-0.5">${data.final_balance ?? '0.00'}</p>
                </div>
              </div>

              {/* Transactions table */}
              <div className="card overflow-hidden border border-slate-200">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                      <th className="py-2 px-3 text-left">Дата</th>
                      <th className="py-2 px-3 text-left">Документ</th>
                      <th className="py-2 px-3 text-left">Номер</th>
                      <th className="py-2 px-3 text-right">Отгрузка ($)</th>
                      <th className="py-2 px-3 text-right">Оплата ($)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.transactions && data.transactions.length > 0 ? (
                      data.transactions.map((tx: any, idx: number) => (
                        <tr key={idx} className="hover:bg-slate-25">
                          <td className="py-2 px-3 font-mono text-slate-600">{tx.date}</td>
                          <td className="py-2 px-3 font-medium text-slate-800">{tx.doc_type}</td>
                          <td className="py-2 px-3 font-mono text-slate-500">{tx.doc_number}</td>
                          <td className="py-2 px-3 text-right font-semibold text-slate-900">
                            {tx.debit > 0 ? `$${Number(tx.debit).toFixed(2)}` : '—'}
                          </td>
                          <td className="py-2 px-3 text-right font-semibold text-emerald-600">
                            {tx.credit > 0 ? `$${Number(tx.credit).toFixed(2)}` : '—'}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-slate-400">
                          За выбранный период проводок в ERP не зафиксировано
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="py-12 text-center text-xs text-slate-400">
              Не удалось загрузить данные акта сверки
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="pt-3 border-t border-slate-100 flex items-center justify-between shrink-0">
          <button
            type="button"
            onClick={() => window.print()}
            className="btn-secondary flex items-center gap-1.5 text-xs py-1.5 px-3 cursor-pointer"
          >
            <Printer className="h-3.5 w-3.5" />
            Печать
          </button>
          <button
            type="button"
            onClick={onClose}
            className="btn-primary text-xs py-1.5 px-4 cursor-pointer"
          >
            Закрыть
          </button>
        </div>
      </div>
    </div>
    </Portal>
  );
}

export default ReconciliationModal;
