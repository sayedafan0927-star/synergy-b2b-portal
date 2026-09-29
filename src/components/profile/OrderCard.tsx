import React from 'react';
import {
  Hash,
  Clock,
  Calendar,
  ChevronRight,
  User,
  MapPin,
  X,
  RotateCcw,
} from 'lucide-react';
import type { Order } from './types';
import {
  getReservationTtlRemaining,
  fmt2,
  fmtPrice,
  orderTotals,
} from './types';

export interface OrderCardProps {
  order: Order;
  isAdmin: boolean;
  isManager: boolean;
  onSelectOrder: (order: Order) => void;
  onRepeatOrder?: (order: Order) => void;
  repeatingOrderId?: string | null;
  onCancelOrder: (order: Order, e?: React.MouseEvent) => void;
  isUpdating: boolean;
}

export function OrderCard({
  order,
  isAdmin,
  isManager,
  onSelectOrder,
  onRepeatOrder,
  repeatingOrderId,
  onCancelOrder,
  isUpdating,
}: OrderCardProps) {
  const t = orderTotals(order.items);
  const collections = [...new Set(order.items.map(i => i.collection))];

  return (
    <div
      onClick={() => onSelectOrder(order)}
      className="card p-5 w-full text-left hover:border-brand-300 hover:shadow-sm transition-all cursor-pointer group"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3 border-b border-slate-100 pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 font-mono font-bold text-slate-900 bg-slate-100 px-2.5 py-1 rounded text-sm">
            <Hash className="h-3.5 w-3.5 text-slate-500" />
            {order.orderNumber}
          </div>
          <span className={`badge border ${order.statusColor}`}>
            {order.status}
          </span>
          {order.statusRaw === 'pending' && (() => {
            const ttl = getReservationTtlRemaining(order.rawDate || order.date, 24);
            if (!ttl) return null;
            return (
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold ${ttl.isExpired ? 'bg-rose-50 text-rose-700 border border-rose-200' : 'bg-amber-50 text-amber-800 border border-amber-200'}`}>
                <Clock className="h-3 w-3" />
                <span>{ttl.isExpired ? 'Бронь истекает' : `Бронь: ${ttl.label}`}</span>
              </span>
            );
          })()}
          {order.statusRaw === 'cancelled' && (order.notes?.toLowerCase().includes('hold ttl') || order.notes?.toLowerCase().includes('брони')) && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-rose-50 text-rose-700 border border-rose-200">
              <Clock className="h-3 w-3" />
              <span>Снята бронь (Hold TTL)</span>
            </span>
          )}
        </div>

        <div className="flex items-center gap-3 text-xs text-slate-400">
          <div className="flex items-center gap-1">
            <Calendar className="h-3.5 w-3.5" />
            {order.date}
          </div>
          <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-brand-500 transition-colors" />
        </div>
      </div>

      {/* Client info banner if admin or manager */}
      {(isAdmin || isManager) && (order.clientCompany || order.clientName) && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-100">
          <User className="h-3.5 w-3.5 text-slate-400" />
          <span className="font-semibold text-slate-800">{order.clientCompany || order.clientName}</span>
          {order.clientCompany && order.clientName && (
            <span className="text-slate-500">({order.clientName})</span>
          )}
          {order.clientPhone && (
            <span className="text-slate-400 font-mono text-[11px] ml-auto">{order.clientPhone}</span>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
        <div>
          <p className="text-xs text-slate-400 mb-0.5">Кол-во</p>
          <p className="text-sm font-semibold text-slate-900">{order.totalItems || t.qty} шт.</p>
        </div>
        <div>
          <p className="text-xs text-slate-400 mb-0.5">Площадь</p>
          <p className="text-sm font-semibold text-slate-900">{fmt2(order.totalSqm || t.sqm)} м²</p>
        </div>
        <div>
          <p className="text-xs text-slate-400 mb-0.5">Сумма</p>
          <p className="text-sm font-bold text-brand-700">{fmtPrice(order.totalAmount || t.sum)}</p>
        </div>
        <div>
          <p className="text-xs text-slate-400 mb-0.5">Склад</p>
          <div className="flex items-center gap-1">
            <MapPin className="h-3 w-3 text-slate-400" />
            <p className="text-sm text-slate-700 truncate">{order.warehouse || 'Главный'}</p>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
        <div className="flex flex-wrap gap-1.5">
          {collections.map(col => (
            <span key={col} className="badge bg-slate-100 text-slate-600 text-[10px]">
              {col}
            </span>
          ))}
        </div>

        <div className="flex items-center gap-2 ml-auto">
          {!['cancelled', 'shipped', 'delivered'].includes(order.statusRaw) && (
            <button
              type="button"
              onClick={(e) => onCancelOrder(order, e)}
              disabled={isUpdating}
              className="inline-flex items-center gap-1 text-xs font-semibold text-rose-700 hover:text-rose-800 bg-rose-50 hover:bg-rose-100 px-2.5 py-1.5 rounded-lg border border-rose-200 transition-colors active:scale-95 disabled:opacity-50 cursor-pointer"
              title="Отменить заказ и расформировать бронь в ERP"
            >
              <X className={`h-3 w-3 ${isUpdating ? 'animate-spin' : ''}`} />
              Отменить
            </button>
          )}

          {onRepeatOrder && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRepeatOrder(order);
              }}
              disabled={repeatingOrderId !== null}
              className="flex items-center gap-1.5 text-xs font-semibold text-brand-700 hover:text-brand-800 bg-brand-50 hover:bg-brand-100 px-3 py-1.5 rounded-lg border border-brand-200 transition-colors active:scale-95 disabled:opacity-50 cursor-pointer"
            >
              <RotateCcw className={`h-3 w-3 ${repeatingOrderId === order.id ? 'animate-spin' : ''}`} />
              Повторить заказ
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default OrderCard;
