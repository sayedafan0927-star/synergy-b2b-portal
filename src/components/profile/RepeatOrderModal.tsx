import { RotateCcw, X, CheckCircle2, AlertTriangle, ShoppingCart, ArrowRight } from 'lucide-react';
import type { RepeatResult } from './types';
import { Portal } from '@/components/common/Portal';
import ProductImage from '@/components/ProductImage';
import { useCurrency } from '@/contexts/CurrencyContext';
import { calcSqm } from '@/types';

export interface RepeatOrderModalProps {
  repeatResult: RepeatResult | null;
  onClose: () => void;
  onGoToCart: () => void;
}

export function RepeatOrderModal({
  repeatResult,
  onClose,
  onGoToCart,
}: RepeatOrderModalProps) {
  const { formatPrice: fmtPrice } = useCurrency();
  if (!repeatResult) return null;

  const totalAddedCount = repeatResult.added.reduce((sum, it) => sum + it.addedQty, 0);
  const hasAdded = repeatResult.added.length > 0;
  const hasMissing = repeatResult.missing.length > 0;

  return (
    <Portal>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4">
        <div
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm animate-modal-backdrop modal-gpu-backdrop"
          onClick={onClose}
          aria-hidden="true"
        />
        <div
          className="relative bg-white rounded-2xl max-w-lg w-full max-h-[92vh] flex flex-col p-4 sm:p-6 shadow-2xl border border-slate-100 animate-modal-card modal-gpu-card z-10"
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-start justify-between pb-3.5 border-b border-slate-100 shrink-0">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-700 shrink-0 shadow-2xs">
                <RotateCcw className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h3 className="font-bold text-slate-900 text-sm sm:text-base leading-tight truncate">
                  Повтор заказа #{repeatResult.orderNumber}
                </h3>
                <p className="text-[11px] sm:text-xs text-slate-500 mt-0.5">
                  {hasAdded && !hasMissing
                    ? `Все позиции (${repeatResult.added.length}) проверены и добавлены в корзину`
                    : hasAdded && hasMissing
                    ? `Добавлено ${repeatResult.added.length} поз., нет в наличии: ${repeatResult.missing.length} поз.`
                    : 'Проверка складских остатков завершена'}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="h-8 w-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer shrink-0 -mr-1"
              aria-label="Закрыть"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Scrollable Content */}
          <div className="overflow-y-auto flex-1 my-3 pr-1 space-y-4 max-h-[56vh] sm:max-h-[60vh]">
            {/* Added items list */}
            {hasAdded && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs font-semibold text-emerald-800">
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                    <span>Добавлено в корзину ({repeatResult.added.length} поз.):</span>
                  </div>
                  <span className="text-[11px] text-emerald-700 bg-emerald-100/70 px-2 py-0.5 rounded-full font-bold">
                    Итого: {totalAddedCount} шт.
                  </span>
                </div>

                <div className="space-y-2">
                  {repeatResult.added.map((item, idx) => {
                    const sqm = item.area_sqm || (item.size ? calcSqm(item.size, 1) : 0);
                    return (
                      <div
                        key={idx}
                        className="bg-white rounded-xl border border-emerald-200/80 p-2.5 sm:p-3 shadow-2xs hover:border-emerald-300 transition-all flex flex-col gap-2"
                      >
                        <div className="flex items-start gap-3">
                          {/* Carpet preview image */}
                          <ProductImage
                            src={item.image}
                            alt={item.name}
                            loading="lazy"
                            decoding="async"
                            width={56}
                            className="h-14 w-14 sm:h-16 sm:w-16 shrink-0 rounded-lg object-contain bg-slate-50 border border-slate-200/90 p-1"
                          />

                          {/* Product info */}
                          <div className="flex-1 min-w-0">
                            <h4 className="font-bold text-xs sm:text-[13px] text-slate-900 leading-snug break-words">
                              {item.name}
                            </h4>

                            {item.sku && (
                              <p className="text-[11px] text-slate-500 font-mono mt-0.5">
                                Артикул: <span className="text-slate-700 font-semibold">{item.sku}</span>
                              </p>
                            )}

                            {/* Badges: size, sqm, warehouse */}
                            <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                              {item.size && (
                                <span className="inline-flex items-center text-[10.5px] font-bold px-2 py-0.5 rounded-md bg-slate-100 text-slate-800 border border-slate-200/60">
                                  {item.size}
                                  {sqm > 0 && <span className="ml-1 font-normal text-slate-500">({sqm.toFixed(2)} м²)</span>}
                                </span>
                              )}

                              <span className="inline-flex items-center text-[10.5px] font-medium px-2 py-0.5 rounded-md bg-brand-50 text-brand-900 border border-brand-100">
                                {item.warehouse || 'Основной Склад Астана'}
                              </span>
                            </div>
                          </div>

                          {/* Qty & Price */}
                          <div className="text-right shrink-0">
                            <div className="text-xs sm:text-sm font-black text-emerald-800 bg-emerald-50 px-2 py-1 rounded-lg border border-emerald-200/70 inline-block">
                              {item.addedQty} шт.
                            </div>
                            {item.addedQty < item.requestedQty && (
                              <p className="text-[10px] text-amber-700 font-medium mt-1">
                                из {item.requestedQty} запрош.
                              </p>
                            )}
                            {Boolean(item.price && item.price > 0) && (
                              <p className="text-[11px] font-semibold text-slate-600 mt-1">
                                {fmtPrice(item.price! * item.addedQty)}
                              </p>
                            )}
                          </div>
                        </div>

                        {/* Warehouse substitution notice */}
                        {item.isWarehouseSubstituted && (
                          <div className="flex items-center gap-1.5 text-[10.5px] text-amber-900 bg-amber-50/90 border border-amber-200 px-2.5 py-1 rounded-lg font-medium">
                            <span className="shrink-0 font-bold">⚠️ Склад изменен:</span>
                            {item.originalWarehouse && (
                              <span className="line-through text-slate-400 shrink-0">{item.originalWarehouse}</span>
                            )}
                            <ArrowRight className="h-3 w-3 text-amber-700 shrink-0" />
                            <span className="font-bold text-amber-950 truncate">{item.warehouse}</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Missing items list */}
            {hasMissing && (
              <div className="space-y-2 pt-1">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-800">
                  <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                  <span>Не добавлено — нет в наличии ({repeatResult.missing.length} поз.):</span>
                </div>

                <div className="space-y-2">
                  {repeatResult.missing.map((item, idx) => (
                    <div
                      key={idx}
                      className="bg-amber-50/40 rounded-xl border border-amber-200/80 p-2.5 sm:p-3 flex items-start gap-3"
                    >
                      <ProductImage
                        src={item.image}
                        alt={item.name}
                        loading="lazy"
                        decoding="async"
                        width={48}
                        className="h-12 w-12 shrink-0 rounded-lg object-contain bg-white border border-amber-200/60 p-1 opacity-70"
                      />

                      <div className="flex-1 min-w-0">
                        <h4 className="font-semibold text-xs text-slate-800 leading-snug break-words">
                          {item.name}
                        </h4>

                        <div className="flex flex-wrap items-center gap-1.5 mt-1 text-[11px] text-slate-500">
                          {item.sku && <span className="font-mono">{item.sku}</span>}
                          {item.size && (
                            <span className="px-1.5 py-0.2 rounded bg-slate-100 text-slate-700 font-medium text-[10px]">
                              {item.size}
                            </span>
                          )}
                        </div>

                        <div className="mt-1.5">
                          <span className="inline-flex items-center text-[10.5px] font-bold text-rose-700 bg-rose-50 border border-rose-200/80 px-2 py-0.5 rounded-md">
                            {item.reason}
                          </span>
                        </div>
                      </div>

                      <div className="text-right text-xs text-slate-500 font-medium shrink-0">
                        {item.requestedQty} шт.
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!hasAdded && hasMissing && (
              <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-4 text-center space-y-1.5">
                <AlertTriangle className="h-6 w-6 text-amber-600 mx-auto" />
                <p className="text-xs font-bold text-amber-950">Позиций нет в наличии</p>
                <p className="text-[11px] text-amber-800">
                  К сожалению, ни одной позиции из данного заказа сейчас нет в наличии на складах. Вы можете подобрать похожие дизайны в каталоге.
                </p>
              </div>
            )}
          </div>

          {/* Footer actions */}
          <div className="flex flex-col-reverse sm:flex-row items-center justify-end gap-2.5 pt-3 border-t border-slate-100 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="w-full sm:w-auto px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 border border-slate-200/80 transition-colors cursor-pointer text-center"
            >
              Закрыть
            </button>
            {hasAdded && (
              <button
                type="button"
                onClick={onGoToCart}
                className="w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold bg-brand-700 hover:bg-brand-800 text-white shadow-md hover:shadow-lg transition-all cursor-pointer text-center"
              >
                <ShoppingCart className="h-4 w-4" />
                <span>Перейти в корзину ({totalAddedCount} шт.)</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </Portal>
  );
}

export default RepeatOrderModal;
