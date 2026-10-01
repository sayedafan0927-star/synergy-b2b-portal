/**
 * Two-Phase Cancellation Sync Worker
 * Prevents Ghost Shipment Hazard by verifying 1C cancellation before releasing physical inventory.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface CancellationSyncOptions {
  order: any;
  supabase: SupabaseClient;
  targetErpUrl: string;
  serverErpKey: string;
  correlationId: string;
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

    if (erpRes.ok) {
      // 1C подтвердила отмену: теперь безопасно высвобождаем резервы
      await supabase.rpc('release_order_reservations', { p_order_id: order.id }).catch(() => {});

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
    const errText = await erpRes.text().catch(() => '');
    const isAlreadyShipped = errText.includes('shipped') || errText.includes('отгружен') || erpRes.status === 409;
    if (isAlreadyShipped) {
      await supabase
        .from('orders')
        .update({
          status: 'shipped',
          reservations_released: false,
          last_error: `[ERP Rejection] Отмена отклонена: товар уже отгружен складом (${errText.slice(0, 100)})`,
          updated_at: nowIso,
        })
        .or(`id.eq.${order.id},parent_order_id.eq.${order.id}`);

      return { order_id: order.id, order_number: order.order_number, success: false, error: 'Отмена отклонена 1С: заказ уже отгружен' };
    }

    // Временная ошибка ERP: оставляем в cancellation_pending с бэкоффом
    await supabase
      .from('orders')
      .update({
        status: 'cancellation_pending',
        retry_count: (Number(order.retry_count || 0) + 1),
        last_error: `ERP ${erpRes.status}: ${errText.slice(0, 100)}`,
        updated_at: nowIso,
      })
      .eq('id', order.id);

    return { order_id: order.id, order_number: order.order_number, success: false, error: `ERP ${erpRes.status}` };
  } catch (netErr: any) {
    await supabase
      .from('orders')
      .update({
        status: 'cancellation_pending',
        retry_count: (Number(order.retry_count || 0) + 1),
        last_error: `Сетевой сбой при отмене: ${netErr?.message}`,
        updated_at: nowIso,
      })
      .eq('id', order.id);

    return { order_id: order.id, order_number: order.order_number, success: false, error: netErr?.message };
  }
}
