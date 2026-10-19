/**
 * Two-Phase Cancellation Sync Worker
 * Prevents Ghost Shipment Hazard by verifying Synergy ERP cancellation before releasing physical inventory.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface CancellationSyncOptions {
  order: any;
  supabase: SupabaseClient;
  targetErpUrl: string;
  serverErpKey: string;
  correlationId: string;
}

export async function releaseOrderAndSubordersReservations(
  supabase: SupabaseClient,
  parentOrderId: string,
): Promise<void> {
  try {
    await supabase.rpc('release_order_reservations', { p_order_id: parentOrderId });
  } catch {}
  try {
    const { data: subOrders } = await supabase
      .from('orders')
      .select('id, reservations_released')
      .eq('parent_order_id', parentOrderId);
    if (Array.isArray(subOrders)) {
      for (const sub of subOrders) {
        if (sub.id && !sub.reservations_released) {
          await supabase.rpc('release_order_reservations', { p_order_id: sub.id }).catch(() => {});
        }
      }
    }
  } catch {}
}

export async function drainPendingErpCancelOrders(
  supabase: SupabaseClient,
  targetErpUrl: string,
  serverErpKey: string,
  correlationId: string,
): Promise<number> {
  let drained = 0;
  try {
    const { data: cancelPending } = await supabase
      .from('orders')
      .select('id, order_number, notes, reservations_released')
      .ilike('last_error', 'pending_erp_cancel%')
      .limit(3);

    if (cancelPending && cancelPending.length > 0) {
      for (const co of cancelPending) {
        try {
          const isOutboxOnly = String(co.order_number || '').startsWith('OUTBOX-');
          let confirmedCancel = isOutboxOnly;

          if (!isOutboxOnly) {
            const cRes = await fetch(`${targetErpUrl}?action=update_order_status`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-Portal-Key': serverErpKey, 'X-Correlation-ID': correlationId },
              body: JSON.stringify({ order_id: co.order_number || co.id, status: 'cancelled', comment: 'Асинхронная отмена через Outbox Worker' }),
            });
            const cText = await cRes.text().catch(() => '');
            let cJson: any = null;
            try { cJson = cText ? JSON.parse(cText) : null; } catch {}
            const isOrderMissingInErp =
              cRes.status === 404 ||
              cText.toLowerCase().includes('not found') ||
              cText.toLowerCase().includes('не найден');
            confirmedCancel = (cRes.ok && cJson?.success !== false) || isOrderMissingInErp;
          }

          if (confirmedCancel) {
            if (!co.reservations_released) {
              await releaseOrderAndSubordersReservations(supabase, co.id);
            }
            const nowIso = new Date().toISOString();
            await supabase
              .from('orders')
              .update({
                status: 'cancelled',
                reservations_released: true,
                last_error: null,
                notes: `${co.notes || ''} [Отмена подтверждена ERP: ${nowIso}]`.trim(),
                updated_at: nowIso,
              })
              .or(`id.eq.${co.id},parent_order_id.eq.${co.id}`);
            drained++;
          }
        } catch (coErr) {
          console.warn('[Outbox Sync] Async cancel retry error:', coErr);
        }
      }
    }
  } catch (cancelErr) {
    console.warn('[Outbox Sync] Cancel query error:', cancelErr);
  }
  return drained;
}

const MAX_CANCEL_RETRIES = 5;

async function handleCancellationFailure(
  supabase: SupabaseClient,
  order: any,
  reason: string,
  nowIso: string,
): Promise<{ order_id: string; order_number: string; success: boolean; error: string }> {
  const nextRetryCount = Number(order.retry_count || 0) + 1;
  const isDlq = nextRetryCount >= MAX_CANCEL_RETRIES;
  const formattedError = nextRetryCount < MAX_CANCEL_RETRIES
    ? `pending_erp_cancel: Retry #${nextRetryCount} (${reason})`
    : `[Cancel DLQ] ${reason}`;

  await supabase
    .from('orders')
    .update({
      status: isDlq ? 'failed_dlq' : 'cancellation_pending',
      retry_count: nextRetryCount,
      last_error: formattedError,
      updated_at: nowIso,
    })
    .eq('id', order.id);

  return { order_id: order.id, order_number: order.order_number, success: false, error: reason };
}

export async function syncPendingCancellation(options: CancellationSyncOptions): Promise<{
  order_id: string;
  order_number: string;
  success: boolean;
  error?: string;
}> {
  const { order, supabase, targetErpUrl, serverErpKey, correlationId } = options;
  const nowIso = new Date().toISOString();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const erpUrl = `${targetErpUrl}?action=update_order_status`;

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
        comment: 'Подтверждение отмены через Outbox Worker',
      }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    const errText = await erpRes.text().catch(() => '');
    let erpData: any = null;
    try { erpData = errText ? JSON.parse(errText) : null; } catch {}
    const isOrderMissing =
      erpRes.status === 404 ||
      errText.toLowerCase().includes('not found') ||
      errText.toLowerCase().includes('не найден');

    if ((erpRes.ok && erpData?.success !== false) || isOrderMissing) {
      // Synergy ERP подтвердила отмену: безопасно высвобождаем резервы мастера и подзаказов
      await releaseOrderAndSubordersReservations(supabase, order.id);

      await supabase
        .from('orders')
        .update({
          status: 'cancelled',
          reservations_released: true,
          last_error: null,
          notes: `${order.notes || ''} [Отмена подтверждена ERP через Outbox: ${nowIso}]`.trim(),
          updated_at: nowIso,
        })
        .or(`id.eq.${order.id},parent_order_id.eq.${order.id}`);

      return { order_id: order.id, order_number: order.order_number, success: true };
    }

    // ERP отклонила отмену (например, статус уже shipped / собран)
    const logicalErr = erpData?.error || erpData?.message || errText;
    const isAlreadyShipped =
      logicalErr.toLowerCase().includes('shipped') ||
      logicalErr.toLowerCase().includes('отгружен') ||
      erpRes.status === 409;
    if (isAlreadyShipped) {
      await supabase
        .from('orders')
        .update({
          status: 'shipped',
          reservations_released: false,
          last_error: `[ERP Rejection] Отмена отклонена: товар уже отгружен складом (${logicalErr.slice(0, 100)})`,
          updated_at: nowIso,
        })
        .or(`id.eq.${order.id},parent_order_id.eq.${order.id}`);

      return { order_id: order.id, order_number: order.order_number, success: false, error: 'Отмена отклонена Synergy ERP: заказ уже отгружен' };
    }

    // Временная ошибка ERP: оставляем в cancellation_pending с префиксом pending_erp_cancel
    return await handleCancellationFailure(supabase, order, `ERP ${erpRes.status}: ${logicalErr.slice(0, 100)}`, nowIso);
  } catch (netErr: any) {
    return await handleCancellationFailure(supabase, order, `Сетевой сбой при отмене: ${netErr?.message}`, nowIso);
  }
}
