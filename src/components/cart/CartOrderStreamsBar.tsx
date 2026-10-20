import { Building2, Store, Factory, CheckCircle2, Layers } from 'lucide-react';
import { useCurrency } from '@/contexts/CurrencyContext';
import { fmt2, type CartOrderStream } from './types';

export interface CartOrderStreamsBarProps {
  streams: CartOrderStream[];
  activeStreamId: string;
  onSelectStream: (streamId: string) => void;
  lastSubmittedOrder?: { docNumber: string; title: string } | null;
}

export function CartOrderStreamsBar({
  streams,
  activeStreamId,
  onSelectStream,
  lastSubmittedOrder,
}: CartOrderStreamsBarProps) {
  const { formatPrice: fmtPrice } = useCurrency();

  const activeStream = streams.find(s => s.id === activeStreamId) || streams[0];
  const showStreamsTabs = streams.length > 1 || (activeStream && activeStream.type !== 'hub');

  if (!showStreamsTabs && !lastSubmittedOrder) {
    return null;
  }

  return (
    <div className="mb-4 space-y-2.5">
      {lastSubmittedOrder && (
        <div className="flex items-start gap-2.5 rounded-xl border-2 border-emerald-400 bg-emerald-50 px-4 py-3 text-xs text-emerald-950 shadow-xs animate-in fade-in">
          <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-bold text-sm text-emerald-950">
              Заказ №{lastSubmittedOrder.docNumber} ({lastSubmittedOrder.title}) успешно отправлен в Synergy ERP!
            </p>
            <p className="text-emerald-800 mt-0.5">
              В корзине остались позиции из другого потока ({activeStream?.title}). Проверьте и подтвердите их отдельным заказом ниже.
            </p>
          </div>
        </div>
      )}

      {showStreamsTabs && (
        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2.5">
            <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
              <Layers className="h-4 w-4 text-brand-700 shrink-0" />
              <span>
                {streams.length > 1
                  ? `Разделение корзины по типам заказов (${streams.length} отд. документа в ERP):`
                  : `Тип оформляемого заказа: ${activeStream?.title}`}
              </span>
            </div>
            {streams.length > 1 && (
              <span className="text-[11px] font-medium text-slate-500">
                Остатки разных складов и предзаказ не смешиваются и оформляются по очереди
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {streams.map((stream, index) => {
              const isActive = stream.id === activeStream?.id;
              const isCons = stream.type === 'consignment';
              const isPre = stream.type === 'preorder';

              return (
                <button
                  key={stream.id}
                  type="button"
                  onClick={() => onSelectStream(stream.id)}
                  className={`flex items-start gap-2.5 rounded-xl p-2.5 text-left transition-all cursor-pointer border ${
                    isActive
                      ? isCons
                        ? 'bg-emerald-50/90 border-2 border-emerald-600 ring-2 ring-emerald-500/15 shadow-xs'
                        : isPre
                        ? 'bg-amber-50/90 border-2 border-amber-600 ring-2 ring-amber-500/15 shadow-xs'
                        : 'bg-brand-50/90 border-2 border-brand-700 ring-2 ring-brand-700/15 shadow-xs'
                      : 'bg-slate-50/70 border-slate-200 hover:bg-slate-100/80 opacity-80 hover:opacity-100'
                  }`}
                >
                  <div
                    className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-white ${
                      isCons ? 'bg-emerald-600' : isPre ? 'bg-amber-600' : 'bg-brand-700'
                    }`}
                  >
                    {isCons ? <Store className="h-4 w-4" /> : isPre ? <Factory className="h-4 w-4" /> : <Building2 className="h-4 w-4" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
                        Заказ {index + 1} из {streams.length}
                      </span>
                      {isActive && (
                        <span className="inline-flex items-center rounded bg-slate-900 px-1.5 py-0.2 text-[9.5px] font-bold text-white">
                          Выбран сейчас
                        </span>
                      )}
                    </div>
                    <p className="text-xs font-extrabold text-slate-900 truncate mt-0.5" title={stream.title}>
                      {stream.title}
                    </p>
                    <p className="text-[11px] font-semibold text-slate-600 mt-0.5">
                      {stream.totalQty} шт. • {fmt2(stream.totalSqm)} м² • <strong className="text-slate-900">{fmtPrice(stream.totalAmount)}</strong>
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default CartOrderStreamsBar;
