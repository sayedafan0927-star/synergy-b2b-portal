import { ArrowUpDown, Layers } from 'lucide-react';
import { useCurrency } from '@/contexts/CurrencyContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { fmt2, type SizeSubtotal, type CollectionSubtotal } from './types';

interface CartSubtotalsPanelProps {
  sizeSubtotals: SizeSubtotal[];
  collectionSubtotals: CollectionSubtotal[];
  activeCollection: string | null;
  onSelectCollection: (col: string | null) => void;
  sizeAsc: boolean;
  onToggleSizeSort: () => void;
}

export function CartSubtotalsPanel({
  sizeSubtotals,
  collectionSubtotals,
  activeCollection,
  onSelectCollection,
  sizeAsc,
  onToggleSizeSort,
}: CartSubtotalsPanelProps) {
  const { formatPrice: fmtPrice } = useCurrency();
  const { t } = useLanguage();

  const displayedTotalQty = sizeSubtotals.reduce((acc, s) => acc + s.qty, 0);
  const displayedTotalSqm = sizeSubtotals.reduce((acc, s) => acc + s.sqm, 0);
  const displayedTotalSum = sizeSubtotals.reduce((acc, s) => acc + s.sum, 0);

  const allTotalQty = collectionSubtotals.reduce((acc, c) => acc + c.qty, 0);
  const allTotalSqm = collectionSubtotals.reduce((acc, c) => acc + c.sqm, 0);
  const allTotalSum = collectionSubtotals.reduce((acc, c) => acc + c.sum, 0);

  return (
    <div className="space-y-3.5">
      {/* ─── 1. Сводный подытог по размерам (для выбранной коллекции или для всех) ─── */}
      {sizeSubtotals.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-2xs">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
                {t('cart.size_subtotals_title')}
              </h4>
              <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold bg-brand-50 text-brand-800 border border-brand-200/70">
                {activeCollection ? activeCollection : t('common.all')}
              </span>
              <span className="text-[11px] font-semibold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md">
                {displayedTotalQty} {t('common.pcs')} · {fmt2(displayedTotalSqm)} {t('common.sqm')} ·{' '}
                <strong className="text-slate-900">{fmtPrice(displayedTotalSum)}</strong>
              </span>
            </div>

            {sizeSubtotals.length > 1 && (
              <button
                type="button"
                onClick={onToggleSizeSort}
                className="text-xs text-brand-700 hover:text-brand-800 font-semibold inline-flex items-center gap-1 cursor-pointer"
              >
                <ArrowUpDown className="h-3 w-3" />
                <span>{sizeAsc ? t('cart.sort_asc') : t('cart.sort_desc')}</span>
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 text-xs">
            {sizeSubtotals.map(st => (
              <div
                key={st.size}
                className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-slate-50 border border-slate-200/80"
              >
                <span className="font-bold text-slate-800 bg-white px-2 py-0.5 rounded border border-slate-200/90 text-[11px] shrink-0">
                  {st.size}
                </span>
                <div className="flex flex-wrap items-center justify-end gap-x-2.5 gap-y-0.5 text-slate-600 text-right">
                  <span className="font-semibold text-slate-700">
                    {st.qty} {t('common.pcs')}
                  </span>
                  <span className="text-[11px] font-medium text-slate-500 bg-slate-200/70 px-1.5 py-0.5 rounded">
                    {fmt2(st.sqm)} {t('common.sqm')}
                  </span>
                  <span className="font-extrabold text-brand-700">{fmtPrice(st.sum)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── 2. Сводный подытог по каждой коллекции (штуки, квадратура, сумма + размеры) ─── */}
      {collectionSubtotals.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-2xs">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
              <Layers className="h-3.5 w-3.5 text-brand-700" />
              <span>{t('cart.collection_subtotals_title', 'Итого по коллекциям')}</span>
            </h4>
            <span className="text-[11px] font-semibold text-slate-600">
              {t('common.all')}: <strong className="text-slate-800">{allTotalQty} {t('common.pcs')}</strong> ·{' '}
              <strong className="text-slate-800">{fmt2(allTotalSqm)} {t('common.sqm')}</strong> ·{' '}
              <strong className="text-brand-700">{fmtPrice(allTotalSum)}</strong>
            </span>
          </div>

          <div className="space-y-2.5">
            {collectionSubtotals.map(col => {
              const isSelected = activeCollection === col.collection;
              return (
                <div
                  key={col.collection}
                  onClick={() =>
                    collectionSubtotals.length > 1
                      ? onSelectCollection(isSelected ? null : col.collection)
                      : undefined
                  }
                  className={`rounded-lg border p-2.5 transition-all ${
                    collectionSubtotals.length > 1 ? 'cursor-pointer' : ''
                  } ${
                    isSelected
                      ? 'border-brand-500 bg-brand-50/40 ring-1 ring-brand-500/20'
                      : 'border-slate-200/90 bg-slate-50/70 hover:bg-slate-50'
                  }`}
                >
                  {/* Шапка коллекции: название + общие штуки, квадратура и сумма по коллекции */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-200/70">
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold ${
                          isSelected ? 'bg-brand-700 text-white' : 'bg-slate-800 text-white'
                        }`}
                      >
                        {col.collection}
                      </span>
                      {isSelected && (
                        <span className="text-[10px] font-semibold text-brand-700">
                          ({t('cart.active_filter', 'выбрана')})
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2.5 text-xs">
                      <span className="font-bold text-slate-800">
                        {col.qty} {t('common.pcs')}
                      </span>
                      <span className="font-semibold text-slate-600 bg-white px-2 py-0.5 rounded border border-slate-200/80">
                        {fmt2(col.sqm)} {t('common.sqm')}
                      </span>
                      <span className="font-extrabold text-brand-700 text-xs sm:text-sm">
                        {fmtPrice(col.sum)}
                      </span>
                    </div>
                  </div>

                  {/* Разбивка по размерам внутри данной коллекции */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5 pt-2 text-[11px]">
                    {col.sizes.map(sz => (
                      <div
                        key={`${col.collection}-${sz.size}`}
                        className="flex items-center justify-between gap-1.5 px-2 py-1 rounded bg-white border border-slate-200/70"
                      >
                        <span className="font-bold text-slate-800">{sz.size}</span>
                        <div className="flex items-center gap-1.5 text-slate-600">
                          <span className="font-semibold text-slate-700">
                            {sz.qty} {t('common.pcs')}
                          </span>
                          <span className="text-slate-400">·</span>
                          <span className="font-medium text-slate-600">
                            {fmt2(sz.sqm)} {t('common.sqm')}
                          </span>
                          <span className="text-slate-400">·</span>
                          <span className="font-bold text-slate-900">{fmtPrice(sz.sum)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default CartSubtotalsPanel;
