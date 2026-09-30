import { useState, useEffect } from 'react';
import { Clock, AlertTriangle } from 'lucide-react';

export interface OrderHoldCountdownProps {
  rawDate?: string;
  status: string;
  ttlHours?: number;
}

export function OrderHoldCountdown({
  rawDate,
  status,
  ttlHours = 24,
}: OrderHoldCountdownProps) {
  const [now, setNow] = useState<number>(Date.now());

  useEffect(() => {
    if (status !== 'pending' || !rawDate) return;

    // Таймер обновляется раз в секунду, если осталось меньше часа, иначе раз в 15 секунд
    const intervalTime = 1000;
    const timer = setInterval(() => {
      setNow(Date.now());
    }, intervalTime);

    return () => clearInterval(timer);
  }, [status, rawDate]);

  if (status !== 'pending' || !rawDate) {
    return null;
  }

  const createdTime = new Date(rawDate).getTime();
  if (isNaN(createdTime)) return null;

  const totalTtlMs = ttlHours * 3600 * 1000;
  const deadline = createdTime + totalTtlMs;
  const remainingMs = deadline - now;
  const isExpired = remainingMs <= 0;

  const hours = Math.max(0, Math.floor(remainingMs / (3600 * 1000)));
  const minutes = Math.max(0, Math.floor((remainingMs % (3600 * 1000)) / (60 * 1000)));
  const seconds = Math.max(0, Math.floor((remainingMs % (60 * 1000)) / 1000));

  // Процент оставшегося времени для визуальной шкалы
  const percentRemaining = Math.max(0, Math.min(100, (remainingMs / totalTtlMs) * 100));

  // Уровень срочности
  const isCritical = !isExpired && hours < 3;
  const isWarning = !isExpired && hours >= 3 && hours < 12;

  if (isExpired) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50/90 p-3.5 flex items-start gap-3">
        <div className="p-1.5 rounded-lg bg-rose-100 text-rose-700 shrink-0 mt-0.5">
          <AlertTriangle className="h-4 w-4" />
        </div>
        <div className="text-xs">
          <p className="font-bold text-rose-900">
            Срок действия складской брони WMS (24ч) истёк
          </p>
          <p className="text-rose-700 mt-0.5 leading-relaxed">
            Бронь ожидает автоотмены или продления. Пожалуйста, завершите оплату или свяжитесь с персональным менеджером.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`rounded-xl border p-3.5 transition-colors ${
        isCritical
          ? 'border-rose-300 bg-rose-50/90 text-rose-950'
          : isWarning
            ? 'border-amber-300 bg-amber-50/90 text-amber-950'
            : 'border-emerald-200 bg-emerald-50/70 text-emerald-950'
      }`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`p-1.5 rounded-lg shrink-0 mt-0.5 ${
            isCritical
              ? 'bg-rose-200 text-rose-800 animate-pulse'
              : isWarning
                ? 'bg-amber-200 text-amber-800'
                : 'bg-emerald-100 text-emerald-700'
          }`}
        >
          <Clock className="h-4 w-4" />
        </div>

        <div className="flex-1 min-w-0 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-1">
            <span className="font-bold">
              Складской резерв WMS активен (Hold TTL {ttlHours}ч)
            </span>
            <span
              className={`font-mono font-bold px-2 py-0.5 rounded-md ${
                isCritical
                  ? 'bg-rose-200 text-rose-900'
                  : isWarning
                    ? 'bg-amber-200 text-amber-900'
                    : 'bg-emerald-100 text-emerald-800'
              }`}
            >
              Осталось: {hours} ч {minutes} мин {hours === 0 ? `${seconds} сек` : ''}
            </span>
          </div>

          <p className="text-slate-600 mt-1 leading-relaxed">
            {isCritical
              ? 'Внимание! До расформирования брони и возврата товара на общую витрину осталось менее 3 часов.'
              : 'Товар зарезервирован за вашей компанией. До автоматического снятия резерва осталось указанное время.'}
          </p>

          {/* Progress bar */}
          <div className="w-full bg-slate-200/80 rounded-full h-1.5 mt-2.5 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-1000 ${
                isCritical
                  ? 'bg-rose-500'
                  : isWarning
                    ? 'bg-amber-500'
                    : 'bg-emerald-500'
              }`}
              style={{ width: `${percentRemaining}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export default OrderHoldCountdown;
