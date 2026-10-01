import { AlertTriangle, Loader2 } from 'lucide-react';
import { Portal } from '@/components/common/Portal';

export interface CancelOrderModalProps {
  isOpen: boolean;
  orderNumber: string;
  onClose: () => void;
  onConfirm: () => void;
  loading?: boolean;
}

export function CancelOrderModal({
  isOpen,
  orderNumber,
  onClose,
  onConfirm,
  loading = false,
}: CancelOrderModalProps) {
  if (!isOpen) return null;

  return (
    <Portal>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm animate-modal-backdrop modal-gpu-backdrop" onClick={onClose} aria-hidden="true" />
        <div className="relative bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-100 space-y-4 animate-modal-card modal-gpu-card z-10" onClick={e => e.stopPropagation()}>
          <div className="flex items-start gap-3.5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-50 text-rose-600">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-base">
                Отменить заказ №{orderNumber}?
              </h3>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                Складской резерв WMS будет аннулирован, а забронированные ковры вернутся в общую витрину для других покупателей.
              </p>
            </div>
          </div>

          <div className="bg-rose-50/70 border border-rose-100 rounded-xl p-3 text-xs text-rose-800 leading-relaxed">
            Данное действие необратимо. Статус накладной будет синхронизирован с 1С:ERP.
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 rounded-xl text-xs font-medium text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
            >
              Вернуться
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold shadow-sm transition-all cursor-pointer disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Отмена...</span>
                </>
              ) : (
                <span>Да, отменить заказ</span>
              )}
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}

export default CancelOrderModal;
