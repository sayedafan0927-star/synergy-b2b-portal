import { useState, useMemo } from 'react';
import { Package, RefreshCw, RotateCcw } from 'lucide-react';
import type { Order } from './types';
import { OrderCard } from './OrderCard';
import { OrderFiltersBar } from './OrderFiltersBar';
import { useOrdersList } from './useOrdersList';

export interface OrdersTabProps {
  onSelectOrder: (o: Order) => void;
  isAdmin: boolean;
  isManager: boolean;
  onRepeatOrder?: (o: Order) => void;
  repeatingOrderId?: string | null;
}

const FILTER_TABS = [
  { id: 'all', label: 'Все' },
  { id: 'pending', label: 'В авторезерве' },
  { id: 'processing', label: 'На сборке' },
  { id: 'assembled', label: 'Готов к отгрузке' },
  { id: 'shipped', label: 'Отгружен' },
  { id: 'delivered', label: 'Доставлен' },
  { id: 'cancelled', label: 'Отменён' },
];

export function OrdersTab({
  onSelectOrder,
  isAdmin,
  isManager,
  onRepeatOrder,
  repeatingOrderId,
}: OrdersTabProps) {
  const { orders, loading, updatingId, fetchOrders, handleCancelOrder } = useOrdersList({
    isAdmin,
    isManager,
  });

  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { all: orders.length };
    for (const o of orders) {
      counts[o.statusRaw] = (counts[o.statusRaw] || 0) + 1;
    }
    return counts;
  }, [orders]);

  const filteredOrders = useMemo(() => {
    return orders.filter(o => {
      if (statusFilter !== 'all') {
        if (statusFilter === 'pending' && !['pending', 'reserved', 'confirmed'].includes(o.statusRaw)) return false;
        else if (statusFilter === 'processing' && !['processing', 'picking'].includes(o.statusRaw)) return false;
        else if (statusFilter === 'assembled' && !['assembled', 'ready'].includes(o.statusRaw)) return false;
        else if (!['pending', 'processing', 'assembled'].includes(statusFilter) && o.statusRaw !== statusFilter) return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchNumber = o.orderNumber.toLowerCase().includes(q);
        const matchCompany = (o.clientCompany || '').toLowerCase().includes(q);
        const matchName = (o.clientName || '').toLowerCase().includes(q);
        const matchPhone = (o.clientPhone || '').toLowerCase().includes(q);
        const matchWarehouse = (o.warehouse || '').toLowerCase().includes(q);
        const matchNotes = (o.notes || '').toLowerCase().includes(q);
        const matchItems = o.items.some(i => i.productName.toLowerCase().includes(q) || i.collection.toLowerCase().includes(q));
        if (!matchNumber && !matchCompany && !matchName && !matchPhone && !matchWarehouse && !matchNotes && !matchItems) {
          return false;
        }
      }
      return true;
    });
  }, [orders, statusFilter, searchQuery]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-50">
            <Package className="h-5 w-5 text-slate-500" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              {isAdmin ? 'Все заказы' : isManager ? 'Заказы клиентов' : 'Мои заказы'} ({orders.length})
            </h2>
            <p className="text-sm text-slate-500">
              {isAdmin ? 'Управление заказами всех клиентов' : 'История ваших заказов на портале'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {onRepeatOrder && orders.length > 0 && (
            <button
              onClick={() => onRepeatOrder(orders[0])}
              disabled={repeatingOrderId !== null}
              className="flex items-center gap-1.5 rounded-lg bg-brand-700 hover:bg-brand-800 text-white px-3.5 py-1.5 text-xs font-semibold shadow-sm transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
              title="Добавить товары из последнего заказа в корзину с проверкой наличия"
            >
              <RotateCcw className={`h-3.5 w-3.5 ${repeatingOrderId === orders[0].id ? 'animate-spin' : ''}`} />
              Повторить последний заказ
            </button>
          )}

          <button
            onClick={fetchOrders}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors cursor-pointer"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Обновить
          </button>
        </div>
      </div>

      <OrderFiltersBar
        filterTabs={FILTER_TABS}
        statusFilter={statusFilter}
        onStatusChange={setStatusFilter}
        statusCounts={statusCounts}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
      />

      {loading ? (
        <div className="py-12 flex flex-col items-center justify-center text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-600 border-t-transparent mb-3" />
          <p className="text-xs text-slate-400">Загрузка заказов...</p>
        </div>
      ) : filteredOrders.length === 0 ? (
        <div className="card p-12 text-center">
          <Package className="h-10 w-10 text-slate-300 mx-auto mb-3" />
          <h3 className="text-sm font-semibold text-slate-900 mb-1">
            {orders.length === 0 ? 'Заказов пока нет' : 'Ничего не найдено'}
          </h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            {orders.length === 0
              ? 'Новые оформленные заказы будут отображаться в этом реестре.'
              : 'Попробуйте изменить параметры поиска или фильтр статуса.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredOrders.map(order => (
            <OrderCard
              key={order.id}
              order={order}
              isAdmin={isAdmin}
              isManager={isManager}
              onSelectOrder={onSelectOrder}
              onRepeatOrder={onRepeatOrder}
              repeatingOrderId={repeatingOrderId}
              onCancelOrder={handleCancelOrder}
              isUpdating={updatingId === order.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default OrdersTab;
