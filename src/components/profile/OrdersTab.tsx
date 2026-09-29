import { useState, useMemo, useEffect, useCallback } from 'react';
import {
  Package,
  RefreshCw,
  Search,
  Hash,
  Clock,
  Calendar,
  ChevronRight,
  User,
  MapPin,
  X,
  RotateCcw,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { fetchClientOrdersFromErp, updateOrderStatusInErp } from '@/lib/erpApi';
import { useAuth } from '@/contexts/AuthContext';
import { calcSqm } from '@/types';
import type { Order, OrderItem } from './types';
import {
  ORDER_STATUS_MAP,
  getReservationTtlRemaining,
  fmt2,
  fmtPrice,
  orderTotals,
} from './types';

export interface OrdersTabProps {
  onSelectOrder: (o: Order) => void;
  isAdmin: boolean;
  isManager: boolean;
  onRepeatOrder?: (o: Order) => void;
  repeatingOrderId?: string | null;
}

export function OrdersTab({
  onSelectOrder,
  isAdmin,
  isManager,
  onRepeatOrder,
  repeatingOrderId,
}: OrdersTabProps) {
  const { user, profile } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    try {
      const clientId = profile?.partner_id
        ? Number(profile.partner_id)
        : (profile?.id && !isNaN(Number(profile.id)) ? Number(profile.id) : undefined);
      const phone = profile?.phone || user?.phone || (user?.user_metadata?.phone as string) || undefined;

      const params: { phone?: string; clientId?: number; limit?: number } = { limit: 100 };
      if (!isAdmin && !isManager) {
        if (clientId) params.clientId = clientId;
        if (phone) params.phone = phone;
      }

      let mappedErp: Order[] = [];
      try {
        const erpData = await fetchClientOrdersFromErp(params);
        if (erpData && erpData.success && Array.isArray(erpData.orders)) {
          mappedErp = erpData.orders.map((o) => {
            const st = o.status_code || 'pending';
            const meta = ORDER_STATUS_MAP[st] || { label: o.status || st, color: 'bg-amber-50 text-amber-700 border-amber-200' };
            const d = o.date ? new Date(o.date) : new Date();
            const dateStr = d.toLocaleDateString('ru-RU', {
              day: '2-digit',
              month: '2-digit',
              year: 'numeric',
            }) + ' ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

            const items: OrderItem[] = (o.items || []).map((it) => ({
              id: String(it.id),
              productName: it.name || 'Ковер',
              collection: (it.name || '').split(' ')[0] || 'Коллекция',
              size: it.size || 'Стандарт',
              sku: it.sku || '',
              warehouse: o.warehouse_name || 'Основной Склад Астана',
              price: Number(it.price) || 0,
              quantity: Number(it.quantity) || 1,
            }));

            return {
              id: String(o.id),
              orderNumber: o.doc_number || `ORD-${o.id}`,
              userId: String(o.client_id || ''),
              date: dateStr,
              rawDate: o.date || o.created_at || new Date().toISOString(),
              status: o.status || meta.label,
              statusRaw: st,
              statusColor: meta.color,
              warehouse: o.warehouse_name || 'Основной Склад Астана',
              notes: o.comment || '',
              clientName: o.client_name || profile?.full_name || 'Клиент',
              clientCompany: o.client_name || profile?.company_name || '',
              clientPhone: o.client_phone || profile?.phone || '',
              totalAmount: Number(o.total_amount) || 0,
              totalSqm: Number(o.total_sqm) || 0,
              totalItems: o.items_count || items.reduce((s, it) => s + it.quantity, 0),
              items,
            };
          });
        }
      } catch (erpErr) {
        console.warn('[OrdersTab] Failed to fetch orders from ERP:', erpErr);
      }

      // Offline Resilience: Merge with Supabase orders table (buffered/offline orders)
      try {
        let q = supabase.from('orders').select('*').order('created_at', { ascending: false }).limit(50);
        if (!isAdmin && !isManager && profile?.id) {
          q = q.eq('user_id', profile.id);
        }
        const { data: dbOrders } = await q;
        if (Array.isArray(dbOrders) && dbOrders.length > 0) {
          const knownDocNumbers = new Set(mappedErp.map(o => o.orderNumber).filter(Boolean));
          const knownIds = new Set(mappedErp.map(o => o.id));

          const localMapped: Order[] = dbOrders
            .filter(row => !knownIds.has(String(row.id)) && (!row.doc_number || !knownDocNumbers.has(row.doc_number)))
            .map(row => {
              const st = row.status || 'pending';
              const meta = ORDER_STATUS_MAP[st] || { label: st, color: 'bg-amber-50 text-amber-700 border-amber-200' };
              const d = row.created_at ? new Date(row.created_at) : new Date();
              const dateStr = d.toLocaleDateString('ru-RU', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
              }) + ' ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

              const rawItems = Array.isArray(row.items) ? row.items : [];
              const items: OrderItem[] = rawItems.map((it: any, idx: number) => ({
                id: String(it.id || idx),
                productName: it.product_name || it.name || 'Ковер',
                collection: it.collection || (it.name || '').split(' ')[0] || 'Коллекция',
                size: it.size || 'Стандарт',
                sku: it.sku || '',
                warehouse: it.warehouse || row.warehouse_name || 'Основной Склад Астана',
                price: Number(it.price) || 0,
                quantity: Number(it.quantity) || 1,
              }));

              return {
                id: String(row.id),
                orderNumber: row.doc_number || `LOCAL-${row.id.slice(0, 8)}`,
                userId: String(row.user_id || ''),
                date: dateStr,
                rawDate: row.created_at || new Date().toISOString(),
                status: meta.label,
                statusRaw: st,
                statusColor: meta.color,
                warehouse: row.warehouse_name || 'Основной Склад Астана',
                notes: row.notes || row.comment || '',
                clientName: profile?.full_name || 'Клиент',
                clientCompany: profile?.company_name || '',
                clientPhone: profile?.phone || '',
                totalAmount: Number(row.total_amount) || 0,
                totalSqm: items.reduce((s, it) => s + calcSqm(it.size, it.quantity), 0),
                totalItems: items.reduce((s, it) => s + it.quantity, 0),
                items,
              };
            });

          mappedErp = [...localMapped, ...mappedErp];
        }
      } catch (dbErr) {
        console.warn('[OrdersTab] Failed to merge Supabase orders:', dbErr);
      }

      setOrders(mappedErp);
    } catch (e) {
      console.warn('[OrdersTab] Unexpected error loading orders:', e);
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, [isAdmin, isManager, profile, user]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  // Сквозная подписка на Realtime обновления статусов заказов со склада/WMS
  useEffect(() => {
    const handleOrderStatusEvent = (payload: any) => {
      const data = payload?.payload || payload;
      if (!data || (!data.order_id && !data.order_doc_number)) return;
      const targetId = String(data.order_id || '');
      const newStatus = data.new_status || data.status || 'cancelled';
      const meta = ORDER_STATUS_MAP[newStatus] || { label: newStatus, color: 'bg-slate-100 text-slate-600 border-slate-200' };

      setOrders(prev => prev.map(o => {
        const matchesId = targetId && (o.id === targetId || o.id === `erp-${targetId}` || String(o.id) === targetId);
        const matchesDoc = Boolean(data.order_doc_number && (o.orderNumber === data.order_doc_number || o.id === data.order_doc_number));
        const matchesDocId = Boolean(targetId && o.orderNumber === targetId);

        if (matchesId || matchesDoc || matchesDocId) {
          return {
            ...o,
            status: meta.label,
            statusRaw: newStatus,
            statusColor: meta.color,
            notes: data.comment || data.reason || o.notes,
          };
        }
        return o;
      }));
    };

    const channel1 = supabase
      .channel('portal_live_updates')
      .on('broadcast', { event: 'order_status_changed' }, handleOrderStatusEvent)
      .subscribe((status, err) => {
        if (status === 'CHANNEL_ERROR') {
          console.warn('[Realtime] portal_live_updates order sync error:', err?.message || status);
        }
      });

    const channel2 = supabase
      .channel('portal_order_live_sync')
      .on('broadcast', { event: 'order_status_changed' }, handleOrderStatusEvent)
      .subscribe((status, err) => {
        if (status === 'CHANNEL_ERROR') {
          console.warn('[Realtime] portal_order_live_sync error:', err?.message || status);
        }
      });

    return () => {
      supabase.removeChannel(channel1);
      supabase.removeChannel(channel2);
    };
  }, []);

  const handleCancelOrder = async (order: Order, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!confirm(`Вы действительно хотите отменить заказ №${order.orderNumber || order.id}? Бронь товаров будет расформирована в ERP.`)) {
      return;
    }
    setUpdatingId(order.id);
    try {
      await updateOrderStatusInErp({
        orderId: order.id,
        status: 'cancelled',
        comment: 'Заказ отменен пользователем/администратором через B2B-портал',
      });
    } catch (erpErr) {
      console.warn('[handleCancelOrder] ERP update_order_status warning:', erpErr);
    }

    try {
      await supabase
        .from('orders')
        .update({ status: 'cancelled', updated_at: new Date().toISOString() })
        .eq('id', order.id);
    } catch {
      // safe fallback
    }

    const meta = ORDER_STATUS_MAP['cancelled'] || { label: 'Отменён', color: 'bg-rose-50 text-rose-700 border-rose-200' };
    setOrders(prev => prev.map(o => o.id === order.id ? { ...o, status: meta.label, statusRaw: 'cancelled', statusColor: meta.color } : o));
    setUpdatingId(null);
  };

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

  const filterTabs = [
    { id: 'all', label: 'Все' },
    { id: 'pending', label: 'В авторезерве' },
    { id: 'processing', label: 'На сборке' },
    { id: 'assembled', label: 'Готов к отгрузке' },
    { id: 'shipped', label: 'Отгружен' },
    { id: 'delivered', label: 'Доставлен' },
    { id: 'cancelled', label: 'Отменён' },
  ];

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

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {filterTabs.map(t => {
            const count = statusCounts[t.id] ?? 0;
            const active = statusFilter === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setStatusFilter(t.id)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer ${
                  active ? 'bg-brand-700 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                <span>{t.label}</span>
                <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${active ? 'bg-brand-800 text-white' : 'bg-slate-200 text-slate-700'}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Поиск по номеру, клиенту..."
            className="input-field pl-9 py-1 text-xs"
          />
        </div>
      </div>

      {/* Orders List */}
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
          {filteredOrders.map(order => {
            const t = orderTotals(order.items);
            const collections = [...new Set(order.items.map(i => i.collection))];
            return (
              <div
                key={order.id}
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
                        onClick={(e) => handleCancelOrder(order, e)}
                        disabled={updatingId === order.id}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-rose-700 hover:text-rose-800 bg-rose-50 hover:bg-rose-100 px-2.5 py-1.5 rounded-lg border border-rose-200 transition-colors active:scale-95 disabled:opacity-50 cursor-pointer"
                        title="Отменить заказ и расформировать бронь в ERP"
                      >
                        <X className={`h-3 w-3 ${updatingId === order.id ? 'animate-spin' : ''}`} />
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
          })}
        </div>
      )}
    </div>
  );
}

export default OrdersTab;
