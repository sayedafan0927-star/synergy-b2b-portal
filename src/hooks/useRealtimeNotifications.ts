import { useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { ORDER_STATUS_MAP } from '@/components/profile/types';

export function useRealtimeNotifications() {
  const { user, profile } = useAuth();
  const toast = useToast();
  const lastEventRef = useRef<Record<string, number>>({});

  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel('portal_global_live_events')
      // 1. Изменение статуса заказов
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'orders',
        },
        (payload: any) => {
          const oldOrder = payload.old;
          const newOrder = payload.new;

          if (!newOrder || !newOrder.id) return;
          if (oldOrder && oldOrder.status === newOrder.status) return;

          // Фильтрация: обычный дилер видит только свои заказы
          const isOwner = newOrder.user_id === user.id || (profile?.partner_id && String(newOrder.client_id) === String(profile.partner_id));
          const isManager = profile?.role === 'admin' || profile?.role === 'manager_rm' || profile?.role === 'manager_lm';

          if (!isOwner && !isManager) return;

          const orderNum = newOrder.order_number || newOrder.id.slice(0, 8);
          const meta = ORDER_STATUS_MAP[newOrder.status] || { label: newOrder.status };

          // Дебаунс одинаковых событий
          const eventKey = `order-${newOrder.id}-${newOrder.status}`;
          const now = Date.now();
          if (lastEventRef.current[eventKey] && now - lastEventRef.current[eventKey] < 4000) {
            return;
          }
          lastEventRef.current[eventKey] = now;

          if (newOrder.status === 'confirmed' || newOrder.status === 'assembling') {
            toast.success(`Заказ передан на комплектацию и сборку в 1С:ERP`, `Заказ №${orderNum}`);
          } else if (newOrder.status === 'shipped') {
            toast.info(`Заказ отгружен со склада и передан в доставку`, `Заказ №${orderNum}`);
          } else if (newOrder.status === 'delivered') {
            toast.success(`Заказ успешно доставлен клиенту`, `Заказ №${orderNum}`);
          } else if (newOrder.status === 'cancelled') {
            toast.warning(`Заказ отменен. Бронь товаров расформирована в ERP`, `Заказ №${orderNum}`);
          } else {
            toast.info(`Новый статус: ${meta.label}`, `Заказ №${orderNum}`);
          }
        }
      )
      // 2. Бродкаст изменения курса валют
      .on(
        'broadcast',
        { event: 'currency_rate_updated' },
        (payload: any) => {
          const rate = payload?.payload?.exchange_rate_usd_kzt;
          if (!rate) return;

          const now = Date.now();
          if (lastEventRef.current['rate'] && now - lastEventRef.current['rate'] < 5000) {
            return;
          }
          lastEventRef.current['rate'] = now;

          toast.info(
            `Установлен актуальный курс: 1 USD = ${Number(rate).toFixed(2)} ₸. Цены каталога пересчитаны.`,
            'Курс валют 1С обновлен'
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, profile, toast]);
}

/**
 * Вспомогательный компонент для включения слушателя внутри ToastProvider
 */
export function RealtimeNotificationsWatcher() {
  useRealtimeNotifications();
  return null;
}
