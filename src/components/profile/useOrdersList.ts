import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { fetchClientOrdersFromErp, updateOrderStatusInErp, cancelOrderViaPortal } from '@/lib/erpApi';
import { useAuth } from '@/contexts/AuthContext';
import { calcSqm } from '@/types';
import type { Order, OrderItem } from './types';
import { ORDER_STATUS_MAP } from './types';

export interface UseOrdersListOptions {
  isAdmin: boolean;
  isManager: boolean;
}

export function useOrdersList({ isAdmin, isManager }: UseOrdersListOptions) {
  const { user, profile } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
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
              item_id: it.item_id ? String(it.item_id) : undefined,
              productId: it.item_id ? String(it.item_id) : undefined,
              productName: it.name || 'Ковер',
              collection: (it.name || '').split(' ')[0] || 'Коллекция',
              size: it.size || 'Стандарт',
              sku: it.sku || '',
              warehouse: it.warehouse || o.warehouse_name || 'Основной Склад Астана',
              warehouse_id: it.warehouse_id || o.warehouse_id,
              price: Number(it.price) || 0,
              quantity: Number(it.quantity) || 1,
            }));

            return {
              id: String(o.id),
              orderNumber: o.doc_number || `ORD-${o.id}`,
              userId: String(o.client_id || ''),
              date: dateStr,
              rawDate: o.date || (o as any).created_at || new Date().toISOString(),
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
        // Metadata invariant: profiles!user_id(full_name, company_name, phone)
        let q = supabase
          .from('orders')
          .select('*, order_items(*)')
          .is('parent_order_id', null)
          .order('created_at', { ascending: false })
          .limit(50);

        if (!isAdmin && !isManager && profile?.id) {
          q = q.eq('user_id', profile.id);
        }
        let { data: dbOrders, error: qErr } = await q;
        if (qErr) {
          const fallback = await supabase
            .from('orders')
            .select('*, order_items(*)')
            .is('parent_order_id', null)
            .order('created_at', { ascending: false })
            .limit(50);
          dbOrders = fallback.data;
        }
        if (Array.isArray(dbOrders) && dbOrders.length > 0) {
          const knownDocNumbers = new Set(mappedErp.map(o => o.orderNumber).filter(Boolean));
          const knownIds = new Set(mappedErp.map(o => o.id));

          const localMapped: Order[] = dbOrders
            .filter(row => {
              const doc = row.order_number || row.doc_number;
              return !knownIds.has(String(row.id)) && (!doc || !knownDocNumbers.has(doc));
            })
            .map(row => {
              const st = row.status || 'pending';
              const meta = ORDER_STATUS_MAP[st] || { label: st, color: 'bg-amber-50 text-amber-700 border-amber-200' };
              const d = row.created_at ? new Date(row.created_at) : new Date();
              const dateStr = d.toLocaleDateString('ru-RU', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
              }) + ' ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

              const rawItems = Array.isArray(row.order_items) && row.order_items.length > 0
                ? row.order_items
                : (Array.isArray(row.items) ? row.items : []);
              const items: OrderItem[] = rawItems.map((it: any, idx: number) => ({
                id: String(it.id || idx),
                item_id: it.item_id || it.product_id,
                productId: it.product_id || (it.item_id ? String(it.item_id) : undefined),
                productName: it.product_name || it.name || 'Ковер',
                collection: it.collection || (it.product_name || it.name || '').split(' ')[0] || 'Коллекция',
                size: it.size || 'Стандарт',
                sku: it.sku || '',
                warehouse: it.warehouse || row.warehouse || row.warehouse_name || 'Основной Склад Астана',
                warehouse_id: it.warehouse_id,
                price: Number(it.price) || 0,
                quantity: Number(it.quantity) || 1,
              }));

              const profileData = (row as any).profiles;

              return {
                id: String(row.id),
                orderNumber: row.order_number || row.doc_number || `ORD-${row.id.slice(0, 8)}`,
                userId: String(row.user_id || ''),
                date: dateStr,
                rawDate: row.created_at || new Date().toISOString(),
                status: meta.label,
                statusRaw: st,
                statusColor: meta.color,
                warehouse: row.warehouse || row.warehouse_name || 'Основной Склад Астана',
                notes: row.notes || row.comment || '',
                clientName: profileData?.full_name || profile?.full_name || 'Клиент',
                clientCompany: profileData?.company_name || profile?.company_name || '',
                clientPhone: profileData?.phone || profile?.phone || '',
                totalAmount: Number(row.total_amount) || 0,
                totalSqm: Number(row.total_sqm) || items.reduce((s, it) => s + calcSqm(it.size, it.quantity), 0),
                totalItems: Number(row.total_items) || items.reduce((s, it) => s + it.quantity, 0),
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
        if (status === 'CHANNEL_ERROR' && import.meta.env.DEV) {
          console.debug('[Realtime] portal_live_updates order sync offline:', err?.message || status);
        }
      });

    const channel2 = supabase
      .channel('portal_order_live_sync')
      .on('broadcast', { event: 'order_status_changed' }, handleOrderStatusEvent)
      .subscribe((status, err) => {
        if (status === 'CHANNEL_ERROR' && import.meta.env.DEV) {
          console.debug('[Realtime] portal_order_live_sync offline:', err?.message || status);
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
      await cancelOrderViaPortal({
        orderId: order.id,
        comment: 'Заказ отменен пользователем через B2B-портал',
      });

      const meta = ORDER_STATUS_MAP['cancelled'] || { label: 'Отменён', color: 'bg-rose-50 text-rose-700 border-rose-200' };
      setOrders(prev => prev.map(o => o.id === order.id ? { ...o, status: meta.label, statusRaw: 'cancelled', statusColor: meta.color } : o));
    } catch (cancelErr: any) {
      console.warn('[handleCancelOrder] Cancel failed:', cancelErr);
      alert(cancelErr?.message || 'Не удалось отменить заказ. Пожалуйста, обратитесь к персональному менеджеру.');
    } finally {
      setUpdatingId(null);
    }
  };

  return {
    orders,
    loading,
    updatingId,
    fetchOrders,
    handleCancelOrder,
  };
}
