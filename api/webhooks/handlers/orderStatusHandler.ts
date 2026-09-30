import type { SupabaseClient } from '@supabase/supabase-js';
import { recordAuditLog } from '../../audit/logs';

export async function dispatchWhatsAppNotification(params: {
  phone: string;
  orderDoc: string;
  status: string;
  trackCode?: string;
  clientName?: string;
}) {
  const WHATSAPP_GATEWAY_URL = process.env.WHATSAPP_API_URL || process.env.GREEN_API_URL;
  const WHATSAPP_TOKEN = process.env.WHATSAPP_API_TOKEN;

  let text = '';
  if (params.status === 'shipped') {
    text =
      `Здравствуйте, ${params.clientName || 'уважаемый партнер'}!\n\nВаш заказ №${params.orderDoc} успешно отгружен со склада компании Synergy.\n` +
      (params.trackCode ? `🚚 Трек-код автотранспорта: ${params.trackCode}\n` : '') +
      `\nСтатус заказа и накладные доступны в вашем личном кабинете на B2B-портале. Спасибо за сотрудничество!`;
  } else if (params.status === 'confirmed') {
    text = `Здравствуйте, ${params.clientName || 'уважаемый партнер'}!\n\nВаш заказ №${params.orderDoc} подтвержден и передан в сборку WMS на складе Астана.\n\nКоманда Synergy B2B.`;
  }

  if (!text) return;
  console.log(`[WhatsApp Dispatcher] Message ready for ${params.phone}:\n${text}`);

  if (WHATSAPP_GATEWAY_URL) {
    try {
      await fetch(WHATSAPP_GATEWAY_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(WHATSAPP_TOKEN ? { Authorization: `Bearer ${WHATSAPP_TOKEN}` } : {}),
        },
        body: JSON.stringify({
          phone: params.phone.replace(/\D+/g, ''),
          message: text,
        }),
      });
      console.log(`[WhatsApp Dispatcher] Successfully sent WhatsApp message to ${params.phone}`);
    } catch (err) {
      console.warn(`[WhatsApp Dispatcher] Gateway delivery error for ${params.phone}:`, err);
    }
  }
}

export async function handleOrderStatusChanged(
  payload: any,
  supabaseServer: SupabaseClient | null,
  eventId: string | undefined,
  timestamp: string,
  broadcastLiveUpdate: (event: string, payload: any) => Promise<void>,
) {
  const { client_name, client_phone, track_code, comment } = payload;
  const order_id = payload.order_id;
  const order_doc_number = payload.order_doc_number || payload.order_number;
  const targetStatus = payload.new_status || payload.status || 'cancelled';
  const orderNotes =
    comment ||
    payload.reason ||
    (targetStatus === 'cancelled' ? 'Автоматическая отмена брони по истечении Hold TTL (24ч)' : null);

  console.log(
    `[Webhook ERP: order_status_changed] Order: ${order_doc_number || order_id} -> ${targetStatus} (Client: ${client_name}, Phone: ${client_phone}, Reason: ${payload.reason || 'n/a'})`,
  );

  // Сквозная трансляция в Realtime-шину браузеров
  await broadcastLiveUpdate('order_status_changed', {
    order_id,
    order_doc_number,
    order_number: order_doc_number,
    new_status: targetStatus,
    status: targetStatus,
    track_code: track_code || null,
    comment: orderNotes,
    reason: payload.reason || null,
    timestamp,
  });

  // Также транслируем в канал 'portal_order_live_sync' для гарантированной доставки
  if (supabaseServer) {
    try {
      const orderChannel = supabaseServer.channel('portal_order_live_sync');
      await orderChannel.send({
        type: 'broadcast',
        event: 'order_status_changed',
        payload: {
          order_id,
          order_doc_number,
          new_status: targetStatus,
          status: targetStatus,
          track_code: track_code || null,
          comment: orderNotes,
          reason: payload.reason || null,
          timestamp,
        },
      });
    } catch (bcErr) {
      console.warn('[Webhook ERP] Secondary channel broadcast notice:', bcErr);
    }
  }

const STATUS_HIERARCHY: Record<string, number> = {
  pending: 1,
  confirmed: 2,
  processing: 3,
  shipped: 4,
  delivered: 5,
};

export function canTransitionOrderStatus(currentStatus: string, nextStatus: string): boolean {
  const normCurrent = (currentStatus || 'pending').toLowerCase();
  const normNext = (nextStatus || '').toLowerCase();

  if (normCurrent === normNext) return true;
  if (normCurrent === 'delivered' || normCurrent === 'cancelled') return false;

  if (normNext === 'cancelled') {
    return normCurrent !== 'shipped' && normCurrent !== 'delivered';
  }

  const currentRank = STATUS_HIERARCHY[normCurrent] || 0;
  const nextRank = STATUS_HIERARCHY[normNext] || 0;

  return nextRank >= currentRank;
}

  // Синхронизация статуса в Supabase
  try {
    const isUuid = (val: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);
    const matchConditions: string[] = [];
    if (order_id && isUuid(String(order_id))) {
      matchConditions.push(`id.eq.${order_id}`);
    }
    if (order_doc_number) {
      matchConditions.push(`order_number.eq.${order_doc_number}`);
    }
    if (order_id) {
      matchConditions.push(`order_number.eq.${order_id}`);
    }

    if (matchConditions.length > 0 && supabaseServer) {
      // 1. Проверяем текущий статус для защиты от отката (Monotonic Order State Machine)
      const { data: existingOrder } = await supabaseServer
        .from('orders')
        .select('id, status, order_number')
        .or(matchConditions.join(','))
        .maybeSingle();

      const allowRollback = Boolean(payload.allow_rollback || payload.order_rollback_requested || payload.force_status);

      if (existingOrder && !canTransitionOrderStatus(existingOrder.status, targetStatus) && !allowRollback) {
        console.warn(
          `[Webhook ERP] Monotonic status regression blocked for order ${existingOrder.order_number}: cannot transition from '${existingOrder.status}' to '${targetStatus}'`,
        );
        return {
          success: true,
          event: 'order_status_changed',
          ignored: true,
          reason: 'MONOTONIC_ORDER_STATUS_VIOLATION',
          current_status: existingOrder.status,
          attempted_status: targetStatus,
          message: `Ignored out-of-order webhook transition '${existingOrder.status}' -> '${targetStatus}'. To force rollback provide allow_rollback: true.`,
        };
      }

      if (existingOrder && allowRollback && !canTransitionOrderStatus(existingOrder.status, targetStatus)) {
        console.info(
          `[Webhook ERP] Authorized status rollback applied for order ${existingOrder.order_number}: '${existingOrder.status}' -> '${targetStatus}' (Reason: ${payload.reason || 'manual_override'})`,
        );
      }

      // 2. Высвобождение остатков при отмене заказа (Zero Reservation Leak Invariant)
      if (targetStatus === 'cancelled' && existingOrder?.id) {
        try {
          await supabaseServer.rpc('release_order_reservations', { p_order_id: existingOrder.id });
          console.log(`[Webhook ERP] Successfully released stock reservations for cancelled order ${existingOrder.id}`);
        } catch (relErr) {
          console.warn('[Webhook ERP] Notice during release_order_reservations RPC:', relErr);
        }
      }

      const updatePayload: Record<string, any> = {
        status: targetStatus,
        updated_at: new Date().toISOString(),
      };
      if (orderNotes) {
        updatePayload.notes = orderNotes;
      }

      const { data: updatedOrders } = await supabaseServer
        .from('orders')
        .update(updatePayload)
        .or(matchConditions.join(','))
        .select('id');

      // КАСКАДНОЕ ОБНОВЛЕНИЕ ДОЧЕРНИХ ПОДЗАКАЗОВ МУЛЬТИСКЛАДА (parent_order_id)
      if (updatedOrders && updatedOrders.length > 0) {
        const masterIds = updatedOrders.map((o: any) => o.id);
        await supabaseServer.from('orders').update(updatePayload).in('parent_order_id', masterIds);
      }
    }
  } catch (dbErr) {
    console.warn('[Webhook ERP] Supabase sync notice:', dbErr);
  }

  await recordAuditLog({
    eventType: 'order_status_updated',
    direction: 'inbound',
    status: 'success',
    source: 'ERP Webhook',
    payload: {
      event_id: eventId || payload.event_id,
      order_id,
      order_doc_number,
      targetStatus,
      track_code,
    },
  });

  // Автоматическая отправка уведомления в WhatsApp
  if (client_phone && targetStatus !== 'cancelled') {
    await dispatchWhatsAppNotification({
      phone: client_phone,
      orderDoc: order_doc_number || String(order_id),
      status: targetStatus,
      trackCode: track_code,
      clientName: client_name,
    });
  }

  return {
    success: true,
    event: 'order_status_changed',
    event_id: eventId || payload.event_id,
    order_id,
    new_status: targetStatus,
    status: targetStatus,
    track_code: track_code || null,
    message: `Order ${order_doc_number || order_id} status updated to '${targetStatus}'.`,
    processed_at: new Date().toISOString(),
  };
}
