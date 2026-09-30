import { useState, useMemo, useEffect } from 'react';
import {
  ArrowLeft,
  Hash,
  RotateCcw,
  X,
  Clock,
  Activity,
  Filter,
  ArrowUpDown,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { updateOrderStatusInErp } from '@/lib/erpApi';
import { calcSqm } from '@/types';
import type { Order, OrderItem } from './types';
import {
  ORDER_STATUS_MAP,
  getReservationTtlRemaining,
  fmt2,
  fmtPrice,
  sizeArea,
  orderTotals,
} from './types';
import { OrderHoldCountdown } from './OrderHoldCountdown';
import { CancelOrderModal } from './CancelOrderModal';

export interface OrderDetailProps {
  order: Order;
  onBack: () => void;
  isAdmin?: boolean;
  onUpdateOrder?: (o: Order) => void;
  onRepeatOrder?: (o: Order) => void;
  repeatingOrderId?: string | null;
}

export function OrderDetail({
  order,
  onBack,
  isAdmin,
  onUpdateOrder,
  onRepeatOrder,
  repeatingOrderId,
}: OrderDetailProps) {
  const [activeCollection, setActiveCollection] = useState<string | null>(null);
  const [sizeAsc, setSizeAsc] = useState(true);
  const [status, setStatus] = useState(order.statusRaw || 'pending');
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [isCancelModalOpen, setIsCancelModalOpen] = useState(false);
  const [statusHistory, setStatusHistory] = useState<Array<{
    id: string;
    previous_status: string;
    new_status: string;
    created_at: string;
    reason?: string;
  }>>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  useEffect(() => {
    let isMounted = true;
    async function loadHistory() {
      if (!order.id) return;
      setLoadingHistory(true);
      try {
        const { data } = await supabase
          .from('order_status_history')
          .select('*')
          .eq('order_id', order.id)
          .order('created_at', { ascending: true });
        if (data && isMounted) {
          setStatusHistory(data);
        }
      } catch (err) {
        console.warn('Failed to load order status history', err);
      } finally {
        if (isMounted) setLoadingHistory(false);
      }
    }
    loadHistory();
    return () => { isMounted = false; };
  }, [order.id]);

  const collections = useMemo(() => Array.from(new Set(order.items.map(i => i.collection))).sort(), [order]);
  const canCancel = !['cancelled', 'shipped', 'delivered'].includes(status);

  const handleCancelOrder = () => {
    setIsCancelModalOpen(true);
  };

  const handleConfirmCancel = async () => {
    await handleStatusChange('cancelled');
    setIsCancelModalOpen(false);
  };

  const handleStatusChange = async (newStatus: string) => {
    setUpdatingStatus(true);
    // 1. Синхронизируем статус в ERP (при 'cancelled' ERP автоматически расформировывает бронь free_stock)
    try {
      await updateOrderStatusInErp({
        orderId: order.id,
        status: newStatus,
        comment: newStatus === 'cancelled' ? 'Заказ отменен пользователем/администратором через B2B-портал' : `Статус изменен на "${newStatus}"`,
      });
    } catch (erpErr) {
      console.warn('[OrderDetailModal] ERP update_order_status warning:', erpErr);
    }

    // 2. При отмене освобождаем зарезервированные остатки обратно на склад (Zero Reservation Leak)
    if (newStatus === 'cancelled') {
      try {
        await supabase.rpc('release_order_reservations', { p_order_id: order.id });
      } catch (relErr) {
        console.warn('[OrderDetail] release_order_reservations notice:', relErr);
      }
    }

    // 3. Обновляем статус в Supabase с каскадом на дочерние подзаказы
    try {
      await supabase
        .from('orders')
        .update({
          status: newStatus,
          reservations_released: newStatus === 'cancelled' ? true : undefined,
          updated_at: new Date().toISOString(),
        })
        .or(`id.eq.${order.id},parent_order_id.eq.${order.id}`);
    } catch {
      // safe fallback
    }

    const meta = ORDER_STATUS_MAP[newStatus] || { label: newStatus, color: 'bg-slate-100 text-slate-600 border-slate-200' };
    setStatus(newStatus);
    onUpdateOrder?.({
      ...order,
      status: meta.label,
      statusRaw: newStatus,
      statusColor: meta.color,
    });
    setUpdatingStatus(false);
  };

  const filteredItems = useMemo(() => {
    let list = activeCollection ? order.items.filter(i => i.collection === activeCollection) : [...order.items];
    list.sort((a, b) => { const diff = sizeArea(a.size) - sizeArea(b.size); return sizeAsc ? diff : -diff; });
    return list;
  }, [order.items, activeCollection, sizeAsc]);

  const groupedByCollection = useMemo(() => {
    const map = new Map<string, OrderItem[]>();
    for (const item of filteredItems) { const arr = map.get(item.collection) ?? []; arr.push(item); map.set(item.collection, arr); }
    return map;
  }, [filteredItems]);

  const sizeSubtotals = useMemo(() => {
    const map = new Map<string, { qty: number; sqm: number; sum: number }>();
    for (const i of filteredItems) {
      const e = map.get(i.size) ?? { qty: 0, sqm: 0, sum: 0 };
      e.qty += i.quantity; e.sqm += calcSqm(i.size, i.quantity); e.sum += i.price * i.quantity;
      map.set(i.size, e);
    }
    return Array.from(map.entries()).sort((a, b) => sizeArea(a[0]) - sizeArea(b[0]));
  }, [filteredItems]);

  const totals = useMemo(() => orderTotals(filteredItems), [filteredItems]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 cursor-pointer">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Hash className="h-4 w-4 text-slate-400" />
              <h2 className="text-lg font-bold text-slate-900">{order.orderNumber || order.id}</h2>
              <span className={`badge border ${order.statusColor}`}>{order.status}</span>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400 mt-0.5">
              <span>{order.date}</span>
              {order.warehouse && <span>• Склад: <strong className="text-slate-600">{order.warehouse}</strong></span>}
              {order.clientCompany && <span>• Клиент: <strong className="text-slate-700">{order.clientCompany}</strong></span>}
              {order.clientName && <span>({order.clientName}{order.clientPhone ? `, ${order.clientPhone}` : ''})</span>}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {onRepeatOrder && (
            <button
              type="button"
              onClick={() => onRepeatOrder(order)}
              disabled={repeatingOrderId !== null}
              className="flex items-center gap-1.5 rounded-lg bg-brand-700 hover:bg-brand-800 text-white px-3.5 py-1.5 text-xs font-semibold shadow-sm transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
            >
              <RotateCcw className={`h-3.5 w-3.5 ${repeatingOrderId === order.id ? 'animate-spin' : ''}`} />
              Повторить заказ
            </button>
          )}

          {canCancel && (
            <button
              type="button"
              onClick={handleCancelOrder}
              disabled={updatingStatus}
              className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 px-3.5 py-1.5 text-xs font-semibold shadow-2xs transition-colors disabled:opacity-50 cursor-pointer"
              title="Отменить заказ и расформировать бронь в ERP"
            >
              <X className={`h-3.5 w-3.5 ${updatingStatus ? 'animate-spin' : ''}`} />
              Отменить заказ
            </button>
          )}
        </div>
      </div>

      {/* WMS Hold TTL (24ч) Countdown Timer */}
      <OrderHoldCountdown rawDate={order.rawDate || order.date} status={status} />

      {status === 'cancelled' && (order.notes?.toLowerCase().includes('hold ttl') || order.notes?.toLowerCase().includes('брони')) && (
        <div className="rounded-xl border border-rose-200 bg-rose-50/80 p-3.5 flex items-start gap-3">
          <div className="p-1.5 rounded-lg bg-rose-100 text-rose-700 shrink-0 mt-0.5">
            <Clock className="h-4 w-4" />
          </div>
          <div className="text-xs">
            <p className="font-bold text-rose-900">Бронь аннулирована по истечении Hold TTL (24ч)</p>
            <p className="text-rose-700 mt-0.5">
              Товары автоматически возвращены в свободный остаток на складе. Вы можете нажать «Повторить заказ», чтобы проверить текущее наличие и переоформить.
            </p>
          </div>
        </div>
      )}

      {order.notes && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs text-slate-600">
          <strong className="text-slate-800">Примечание к заказу:</strong> {order.notes}
        </div>
      )}

      {/* Журнал изменений статусов заказа (Audit Timeline) */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between mb-3 border-b border-slate-100 pb-2">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-brand-700" />
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">История движения заказа</h4>
          </div>
          {loadingHistory && <span className="text-[11px] text-slate-400 animate-pulse">Загрузка истории...</span>}
        </div>

        {statusHistory.length > 0 ? (
          <div className="relative pl-6 space-y-3 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200">
            {statusHistory.map((h, idx) => {
              const meta = ORDER_STATUS_MAP[h.new_status] || { label: h.new_status, color: 'bg-slate-100 text-slate-700 border-slate-200' };
              const prevMeta = h.previous_status ? (ORDER_STATUS_MAP[h.previous_status] || { label: h.previous_status }) : null;
              const dateStr = new Date(h.created_at).toLocaleString('ru-RU', {
                day: '2-digit', month: '2-digit', year: 'numeric',
                hour: '2-digit', minute: '2-digit'
              });

              return (
                <div key={h.id || idx} className="relative">
                  <div className="absolute -left-6 top-1.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-brand-600 shadow-sm" />
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-mono text-slate-400 text-[11px]">{dateStr}</span>
                    {prevMeta && (
                      <>
                        <span className="text-slate-400 text-[11px]">{prevMeta.label}</span>
                        <span className="text-slate-300">→</span>
                      </>
                    )}
                    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold border ${meta.color}`}>
                      {meta.label}
                    </span>
                  </div>
                  {h.reason && (
                    <p className="mt-1 text-[11px] text-slate-500 italic bg-slate-50 rounded px-2 py-1 border border-slate-100">
                      {h.reason}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex items-center gap-3 text-xs text-slate-500 py-1">
            <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
            <span>Текущий статус: <strong>{order.status}</strong>. Изменения фиксируются автоматически.</span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Кол-во', value: `${totals.qty || order.totalItems} шт.` },
          { label: 'Площадь', value: `${fmt2(totals.sqm || order.totalSqm)} м²` },
          { label: 'Сумма', value: fmtPrice(totals.sum || order.totalAmount), bold: true },
        ].map(s => (
          <div key={s.label} className="card px-4 py-3 text-center">
            <p className="text-[10px] uppercase tracking-wide text-slate-400">{s.label}</p>
            <p className={`text-sm font-bold ${s.bold ? 'text-brand-700' : 'text-slate-900'}`}>{s.value}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Filter className="h-4 w-4 text-slate-400 shrink-0" />
        <button onClick={() => setActiveCollection(null)} className={`rounded-full px-3 py-1 text-xs font-medium transition-colors cursor-pointer ${activeCollection === null ? 'bg-brand-700 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>Все</button>
        {collections.map(col => (
          <button key={col} onClick={() => setActiveCollection(activeCollection === col ? null : col)} className={`rounded-full px-3 py-1 text-xs font-medium transition-colors cursor-pointer ${activeCollection === col ? 'bg-brand-700 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{col}</button>
        ))}
        <button onClick={() => setSizeAsc(v => !v)} className="ml-auto flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-200 cursor-pointer">
          <ArrowUpDown className="h-3 w-3" /> {sizeAsc ? 'Размер ↑' : 'Размер ↓'}
        </button>
      </div>

      <div className="space-y-2">
        {activeCollection !== null ? (
          Array.from(groupedByCollection.entries()).map(([col, colItems]) => {
            const ct = orderTotals(colItems);
            return (
              <div key={col} className="space-y-2">
                {colItems.map((item, idx) => <OrderItemRow key={`${item.productName}-${item.size}-${idx}`} item={item} />)}
                <div className="rounded-lg border border-brand-200 bg-brand-50/50 px-4 py-2.5 flex flex-wrap items-center justify-between text-xs">
                  <span className="font-semibold text-brand-800">{col}</span>
                  <span className="text-slate-600">{ct.qty} шт. / {fmt2(ct.sqm)} м² / {fmtPrice(ct.sum)}</span>
                </div>
              </div>
            );
          })
        ) : (
          filteredItems.map((item, idx) => <OrderItemRow key={`${item.productName}-${item.size}-${idx}`} item={item} />)
        )}
      </div>

      {sizeSubtotals.length > 1 && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <h3 className="text-xs font-bold text-slate-700 mb-2">Итого по размерам</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {sizeSubtotals.map(([size, s]) => (
              <div key={size} className="rounded-lg bg-white border border-slate-100 px-3 py-2 text-xs">
                <p className="font-semibold text-slate-800">{size}</p>
                <p className="text-slate-500">{s.qty} шт. / {fmt2(s.sqm)} м²</p>
                <p className="font-medium text-slate-700">{fmtPrice(s.sum)}</p>
              </div>
            ))}
          </div>
        </div>
      )}
      {/* Модальное окно подтверждения отмены заказа */}
      <CancelOrderModal
        isOpen={isCancelModalOpen}
        orderNumber={order.orderNumber || order.id}
        onClose={() => setIsCancelModalOpen(false)}
        onConfirm={handleConfirmCancel}
        loading={updatingStatus}
      />
    </div>
  );
}

export function OrderItemRow({ item }: { item: OrderItem }) {
  const sqm = calcSqm(item.size, item.quantity);
  const total = item.price * item.quantity;
  return (
    <div className="card flex items-center gap-3 px-4 py-3">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-900 truncate">{item.productName}</p>
        <div className="flex flex-wrap items-center gap-2 mt-0.5">
          <span className="badge text-[10px]">{item.size}</span>
          <span className="text-xs text-slate-400">{item.warehouse}</span>
        </div>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-right shrink-0">
        <span className="text-slate-500">{item.quantity} шт.</span>
        <span className="text-slate-500">{fmt2(sqm)} м²</span>
        <span className="font-bold text-slate-900">{fmtPrice(total)}</span>
      </div>
    </div>
  );
}

export default OrderDetail;
