import { CheckCircle2, WifiOff, AlertTriangle, Boxes } from 'lucide-react';
import type { SplitSubOrder } from '@/lib/erpApi';
import { useCurrency } from '@/contexts/CurrencyContext';

interface CartSuccessModalProps {
  orderDocNumber: string;
  splitOrders: SplitSubOrder[] | null;
  isOfflineQueued: boolean;
  isServerBuffered: boolean;
  isWaitingApproval: boolean;
  onContinueShopping: () => void;
}

export function CartSuccessModal({
  orderDocNumber,
  splitOrders,
  isOfflineQueued,
  isServerBuffered,
  isWaitingApproval,
  onContinueShopping,
}: CartSuccessModalProps) {
  const { formatPrice: fmtPrice } = useCurrency();

  return (
    <div className="min-h-screen pt-20 pb-24 lg:pb-8 flex items-center justify-center">
      <div className="container-w flex flex-col items-center justify-center py-16 text-center">
        <div
          className={`mb-6 flex h-20 w-20 items-center justify-center rounded-full ${
            isOfflineQueued
              ? 'bg-sky-50 text-sky-600'
              : isServerBuffered
              ? 'bg-amber-50 text-amber-600'
              : isWaitingApproval
              ? 'bg-amber-50 text-amber-600'
              : 'bg-emerald-50 text-emerald-600'
          }`}
        >
          {isOfflineQueued ? (
            <WifiOff className="h-10 w-10" />
          ) : isServerBuffered ? (
            <AlertTriangle className="h-10 w-10" />
          ) : isWaitingApproval ? (
            <AlertTriangle className="h-10 w-10" />
          ) : (
            <CheckCircle2 className="h-10 w-10" />
          )}
        </div>
        <h1 className="font-display text-2xl font-bold text-slate-900">
          {isOfflineQueued
            ? 'Заказ сохранен офлайн'
            : isServerBuffered
            ? 'Заказ зарезервирован и отправлен в буфер'
            : isWaitingApproval
            ? 'Заказ отправлен на согласование'
            : 'Заказ успешно оформлен!'}
        </h1>
        <div className="mt-4 rounded-xl border border-slate-200 bg-white px-6 py-4 shadow-sm">
          <p className="text-xs uppercase tracking-wider text-slate-400 font-semibold mb-1">
            {isOfflineQueued ? 'Номер в локальной очереди' : isServerBuffered ? 'Номер брони в буфере' : 'Номер заказа'}
          </p>
          <p
            className={`text-2xl font-bold font-mono ${
              isOfflineQueued
                ? 'text-sky-800'
                : isServerBuffered
                ? 'text-amber-800'
                : isWaitingApproval
                ? 'text-amber-800'
                : 'text-emerald-800'
            }`}
          >
            {orderDocNumber}
          </p>
        </div>

        {/* Мультисклад: детализированный блок субордеров */}
        {splitOrders && splitOrders.length > 1 && (
          <div className="mt-6 w-full max-w-md rounded-xl border border-slate-200 bg-slate-50/70 p-4 text-left shadow-2xs">
            <div className="flex items-center gap-2 mb-3 text-slate-800 font-semibold text-sm">
              <Boxes className="h-4 w-4 text-brand-600" />
              <span>Мультисклад: заказ разделен на {splitOrders.length} накладные</span>
            </div>
            <div className="space-y-2">
              {splitOrders.map((split, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between rounded-lg bg-white p-3 border border-slate-200/80 text-xs shadow-2xs"
                >
                  <div>
                    <div className="font-mono font-bold text-slate-900">{split.doc_number}</div>
                    <div className="text-slate-500 mt-0.5">{split.warehouse}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-bold text-slate-900">{fmtPrice(split.amount || 0)}</div>
                    <div className="text-slate-400">{split.items_count} шт</div>
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[11px] text-slate-500">
              Товары распределены по региональным складам для раздельной комплектации и оперативной логистики.
            </p>
          </div>
        )}

        <p className="mt-4 max-w-md text-slate-500">
          {isOfflineQueued
            ? 'Соединение с сетью отсутствует или нестабильно. Заказ надежно сохранен в локальной базе и будет автоматически передан в ERP при восстановлении интернета.'
            : isServerBuffered
            ? 'Шлюз ERP временно недоступен или на регламентном обслуживании. Товар надежно зарезервирован на складе портала и будет автоматически синхронизирован с ERP сервисом Outbox в течение нескольких минут.'
            : isWaitingApproval
            ? 'Запрос на согласование условий отгрузки отправлен вашему региональному менеджеру в WhatsApp. Как только заказ будет одобрен, вам придет подтверждающее сообщение в WhatsApp.'
            : 'Наш менеджер свяжется с вами для подтверждения заказа.'}
        </p>
        <button type="button" onClick={onContinueShopping} className="btn-primary mt-8 cursor-pointer">
          Продолжить покупки
        </button>
      </div>
    </div>
  );
}
export default CartSuccessModal;
