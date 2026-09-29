import { RotateCcw, X, CheckCircle2, AlertTriangle, ShoppingCart } from 'lucide-react';
import type { RepeatResult } from './types';
import { Portal } from '@/components/common/Portal';

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
  if (!repeatResult) return null;

  return (
    <Portal>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-100 space-y-5">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
              <RotateCcw className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-base">Повтор заказа #{repeatResult.orderNumber}</h3>
              <p className="text-xs text-slate-500">Проверка актуальных складских остатков в Астане</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="h-8 w-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Added items */}
        {repeatResult.added.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              <span>Добавлено в корзину ({repeatResult.added.length} поз.):</span>
            </div>
            <div className="bg-emerald-50/60 border border-emerald-100 rounded-xl p-3 space-y-1.5 max-h-40 overflow-y-auto">
              {repeatResult.added.map((item, idx) => (
                <div key={idx} className="flex items-center justify-between text-xs text-emerald-900">
                  <span className="font-medium truncate mr-2">{item.name} ({item.size})</span>
                  <span className="font-semibold whitespace-nowrap">
                    {item.addedQty} шт.
                    {item.addedQty < item.requestedQty && (
                      <span className="text-[10px] text-amber-700 ml-1">(из {item.requestedQty} запрошенных)</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Missing items */}
        {repeatResult.missing.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-700">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <span>Не добавлено — нет в наличии ({repeatResult.missing.length} поз.):</span>
            </div>
            <div className="bg-amber-50/60 border border-amber-200/80 rounded-xl p-3 space-y-1.5 max-h-40 overflow-y-auto">
              {repeatResult.missing.map((item, idx) => (
                <div key={idx} className="flex items-center justify-between text-xs text-amber-900">
                  <span className="truncate mr-2">{item.name} ({item.size})</span>
                  <span className="text-[11px] text-rose-600 font-medium whitespace-nowrap">{item.reason}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {repeatResult.added.length === 0 && repeatResult.missing.length > 0 && (
          <p className="text-xs text-slate-500 text-center py-2">
            К сожалению, ни одной позиции из данного заказа сейчас нет в наличии на складе в Астане.
          </p>
        )}

        <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-medium text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
          >
            Закрыть
          </button>
          {repeatResult.added.length > 0 && (
            <button
              onClick={onGoToCart}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold bg-brand-700 hover:bg-brand-800 text-white shadow-sm transition-all cursor-pointer"
            >
              <ShoppingCart className="h-4 w-4" />
              Перейти в корзину
            </button>
          )}
        </div>
      </div>
    </div>
    </Portal>
  );
}

export default RepeatOrderModal;
