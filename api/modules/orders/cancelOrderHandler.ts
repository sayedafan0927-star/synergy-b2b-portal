import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../../lib/logger';
import { recordAuditLog } from '../../audit/logs';

export interface CancelOrderOptions {
  req: VercelRequest;
  res: VercelResponse;
  callerAuth: any;
  correlationId: string;
  supabase: SupabaseClient;
  targetErpUrl: string;
  serverErpKey: string;
}

export async function handleCancelOrder(options: CancelOrderOptions): Promise<void> {
  const { req, res, callerAuth, correlationId, supabase, targetErpUrl, serverErpKey } = options;

  const rawOrderId = String(req.body?.order_id || req.query?.order_id || '').trim();
  const comment = String(req.body?.comment || 'Отмена заказа пользователем/администратором через B2B-портал').trim();

  if (!rawOrderId) {
    res.status(400).json({ success: false, error: 'Параметр order_id обязателен' });
    return;
  }

  // 1. Поиск заказа в базе данных
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const isUuid = UUID_REGEX.test(rawOrderId);

  let query = supabase.from('orders').select('id, order_number, user_id, placed_by_id, status, total_amount, reservations_released');
  if (isUuid) {
    query = query.eq('id', rawOrderId);
  } else {
    query = query.or(`order_number.eq.${rawOrderId},id.eq.${rawOrderId}`);
  }

  const { data: order, error: orderErr } = await query.maybeSingle();

  if (orderErr || !order) {
    logger.warn('[CancelOrder] Order not found', { rawOrderId, error: orderErr?.message });
    res.status(404).json({ success: false, error: 'Заказ не найден' });
    return;
  }

  // 2. Проверка прав доступа (Anti-IDOR)
  const isStaff = callerAuth.isServer || callerAuth.role === 'admin' || callerAuth.role === 'manager_rm' || callerAuth.role === 'manager_lm';
  if (!isStaff) {
    const isOwner = (order.user_id && String(order.user_id) === String(callerAuth.userId)) ||
                    (order.placed_by_id && String(order.placed_by_id) === String(callerAuth.userId));
    if (!isOwner) {
      logger.warn('[CancelOrder] Unauthorized cancellation attempt', {
        orderId: order.id,
        callerId: callerAuth.userId,
        correlationId,
      });
      res.status(403).json({ success: false, error: 'Доступ запрещен: отмена чужого заказа невозможна (Anti-IDOR).' });
      return;
    }
  }

  // 3. Проверка статуса (нельзя отменить уже отгруженный или доставленный заказ)
  if (['shipped', 'delivered'].includes(order.status)) {
    res.status(400).json({
      success: false,
      error: `Заказ в статусе «${order.status}» уже передан на складскую отгрузку или доставлен и не может быть отменен через портал.`,
    });
    return;
  }

  if (order.status === 'cancelled') {
    res.status(200).json({ success: true, message: 'Заказ уже был отменен ранее.' });
    return;
  }

  // 4. Отправка отмены в 1C:ERP
  let erpNotified = false;
  try {
    const erpUrl = `${targetErpUrl}?action=update_order_status`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);

    const erpRes = await fetch(erpUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Portal-Key': serverErpKey,
        'X-Correlation-ID': correlationId,
      },
      body: JSON.stringify({
        order_id: order.order_number || order.id,
        status: 'cancelled',
        comment,
      }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    if (erpRes.ok) {
      erpNotified = true;
    } else {
      logger.warn('[CancelOrder] 1C ERP update_order_status non-OK response', { status: erpRes.status });
    }
  } catch (netErr) {
    logger.warn('[CancelOrder] Notice notifying 1C ERP:', netErr as Error);
  }

  // 5. Высвобождение резервов в PostgreSQL (Service-Role execution)
  try {
    await supabase.rpc('release_order_reservations', { p_order_id: order.id });
  } catch (rpcErr) {
    logger.warn('[CancelOrder] release_order_reservations RPC error:', rpcErr as Error);
  }

  // 6. Обновление статуса мастер-заказа и дочерних субордеров
  const nowIso = new Date().toISOString();
  await supabase
    .from('orders')
    .update({
      status: 'cancelled',
      reservations_released: true,
      notes: `${comment} [Отменен через B2B-портал: ${nowIso}]`,
      updated_at: nowIso,
    })
    .or(`id.eq.${order.id},parent_order_id.eq.${order.id}`);

  // 7. Оповещение Realtime-канала
  try {
    const channel = supabase.channel('portal_live_updates');
    await channel.send({
      type: 'broadcast',
      event: 'order_status_changed',
      payload: {
        order_id: order.id,
        order_doc_number: order.order_number,
        new_status: 'cancelled',
        comment,
        timestamp: nowIso,
      },
    });
  } catch {}

  // 8. Аудит лог
  await recordAuditLog({
    eventType: 'order_cancelled',
    direction: 'outbound',
    status: 'success',
    source: 'B2B Portal Cancel Handler',
    correlationId,
    payload: {
      order_id: order.id,
      order_number: order.order_number,
      erp_notified: erpNotified,
      cancelled_by: callerAuth.userId || 'client',
    },
  });

  res.status(200).json({
    success: true,
    order_id: order.id,
    order_number: order.order_number,
    status: 'cancelled',
    erp_notified: erpNotified,
    message: 'Заказ успешно отменен. Зарезервированные остатки возвращены в свободную продажу.',
  });
}
