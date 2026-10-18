import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { SupabaseClient } from '@supabase/supabase-js';
import { authenticateRequest } from '../../lib/authGuard';
import { recordAuditLog } from '../../audit/logs';
import { resolveWarehouseId } from '../../lib/pricingValidator';
import { triggerImmediateOutboxSync } from '../orders/orderDispatcher';
import { categorizeDlqError } from '../../outbox/outboxUtils';

async function reReserveOrderItems(
  supabase: SupabaseClient,
  orderId: string,
): Promise<{ ok: boolean; conflictSku?: string; reservedNow: Array<{ sku: string; qty: number; wh: number }> }> {
  const { data: oItems } = await supabase
    .from('order_items')
    .select('sku, quantity, warehouse')
    .eq('order_id', orderId);

  const reservedNow: Array<{ sku: string; qty: number; wh: number }> = [];
  if (oItems && oItems.length > 0) {
    for (const it of oItems) {
      const whId = resolveWarehouseId((it as any).warehouse_id, it.warehouse);
      const { data: isRes } = await supabase.rpc('reserve_stock', {
        p_sku: it.sku,
        p_qty: it.quantity,
        p_warehouse_id: whId,
      });
      if (isRes === false) {
        for (const r of reservedNow) {
          await supabase.rpc('release_stock', { p_sku: r.sku, p_qty: r.qty, p_warehouse_id: r.wh }).catch(() => {});
        }
        return { ok: false, conflictSku: it.sku, reservedNow: [] };
      }
      reservedNow.push({ sku: it.sku, qty: it.quantity, wh: whId });
    }
  }
  return { ok: true, reservedNow };
}

export async function handleDlqOrders(req: VercelRequest, res: VercelResponse, supabase: SupabaseClient) {
  const auth = await authenticateRequest(req, { requiredRoles: ['admin', 'manager_rm'], allowServerKey: true });
  if (!auth.isAuthenticated || auth.error) {
    return res.status(403).json({ success: false, error: auth.error || 'Access denied' });
  }
  const { data: dlqList, error: dlqErr } = await supabase
    .from('orders')
    .select('id, order_number, user_id, warehouse, total_amount, total_items, notes, retry_count, last_error, updated_at, created_at')
    .eq('status', 'failed_dlq')
    .is('parent_order_id', null)
    .order('created_at', { ascending: false })
    .limit(100);

  if (dlqErr) {
    return res.status(500).json({ success: false, error: dlqErr.message });
  }

  const enrichedOrders = (dlqList || []).map(order => ({
    ...order,
    error_analysis: categorizeDlqError(order.last_error),
  }));

  return res.status(200).json({ success: true, count: enrichedOrders.length, orders: enrichedOrders });
}

export async function handleRetryDlqOrder(
  req: VercelRequest,
  res: VercelResponse,
  supabase: SupabaseClient,
  correlationId: string,
) {
  const auth = await authenticateRequest(req, { requiredRoles: ['admin'], allowServerKey: true });
  if (!auth.isAuthenticated || auth.error) {
    return res.status(403).json({ success: false, error: auth.error || 'Access denied' });
  }
  const orderId = req.body?.order_id || req.query?.order_id;
  if (!orderId) {
    return res.status(400).json({ success: false, error: 'Параметр order_id обязателен.' });
  }

  const { data: dlqOrder } = await supabase
    .from('orders')
    .select('id, order_number, reservations_released')
    .eq('id', orderId)
    .eq('status', 'failed_dlq')
    .maybeSingle();

  if (!dlqOrder) {
    return res.status(404).json({ success: false, error: 'Заказ не найден в очереди DLQ.' });
  }

  // Повторное резервирование остатков на складе, если при попадании в DLQ бронь была снята
  let reservedNow: Array<{ sku: string; qty: number; wh: number }> = [];
  if (dlqOrder.reservations_released !== false) {
    const resCheck = await reReserveOrderItems(supabase, orderId);
    if (!resCheck.ok) {
      return res.status(409).json({
        success: false,
        code: 'INSUFFICIENT_STOCK',
        error: `Невозможно перезапустить заказ из DLQ: недостаточно свободного остатка для артикула "${resCheck.conflictSku}".`,
      });
    }
    reservedNow = resCheck.reservedNow;
  }

  const retryNotes = `[Ручной перезапуск администратором: ${auth.fullName || auth.userId}]`;
  const nowIso = new Date().toISOString();

  const { data: updated, error: updErr } = await supabase
    .from('orders')
    .update({
      status: 'pending',
      reservations_released: false,
      last_error: null,
      retry_count: 0,
      next_retry_at: nowIso,
      notes: retryNotes,
      updated_at: nowIso,
    })
    .eq('id', orderId)
    .eq('status', 'failed_dlq')
    .select('id, order_number')
    .maybeSingle();

  if (updErr || !updated) {
    for (const r of reservedNow) {
      await supabase.rpc('release_stock', { p_sku: r.sku, p_qty: r.qty, p_warehouse_id: r.wh }).catch(() => {});
    }
    return res.status(500).json({ success: false, error: updErr?.message || 'Заказ не найден в очереди DLQ.' });
  }

  // Каскадный возврат дочерних подзаказов мультисклада в очередь
  try {
    await supabase
      .from('orders')
      .update({
        status: 'pending',
        reservations_released: false,
        last_error: null,
        retry_count: 0,
        next_retry_at: nowIso,
        notes: retryNotes,
        updated_at: nowIso,
      })
      .eq('parent_order_id', orderId);
  } catch (subErr) {
    console.warn('[DLQ Retry] Suborder cascade notice:', subErr);
  }

  triggerImmediateOutboxSync(req, correlationId, { orderId: updated.id, orderDoc: updated.order_number });

  await recordAuditLog({
    eventType: 'dlq_manual_retry',
    direction: 'outbound',
    status: 'success',
    statusCode: 200,
    source: 'Admin Portal',
    correlationId,
    payload: { order_id: orderId, order_number: updated.order_number, retried_by: auth.userId },
  });

  return res.status(200).json({
    success: true,
    message: `Заказ ${updated.order_number} успешно возвращен в очередь синхронизации Outbox.`,
    order: updated,
  });
}

export async function handleRetryAllDlqOrders(
  req: VercelRequest,
  res: VercelResponse,
  supabase: SupabaseClient,
  correlationId: string,
) {
  const auth = await authenticateRequest(req, { requiredRoles: ['admin'], allowServerKey: true });
  if (!auth.isAuthenticated || auth.error) {
    return res.status(403).json({ success: false, error: auth.error || 'Access denied' });
  }

  const { data: dlqCandidates, error: fetchErr } = await supabase
    .from('orders')
    .select('id, order_number, reservations_released')
    .eq('status', 'failed_dlq')
    .is('parent_order_id', null)
    .limit(50);

  if (fetchErr) {
    return res.status(500).json({ success: false, error: fetchErr.message });
  }

  const updatedList: Array<{ id: string; order_number: string }> = [];
  const skippedOutOfStock: Array<{ id: string; order_number: string; conflict_sku?: string }> = [];
  const nowIso = new Date().toISOString();
  const batchNotes = `[Пакетный перезапуск администратором: ${auth.fullName || auth.userId}]`;

  for (const cand of dlqCandidates || []) {
    if (cand.reservations_released !== false) {
      const resCheck = await reReserveOrderItems(supabase, cand.id);
      if (!resCheck.ok) {
        skippedOutOfStock.push({ id: cand.id, order_number: cand.order_number, conflict_sku: resCheck.conflictSku });
        continue;
      }
    }

    const { data: upd } = await supabase
      .from('orders')
      .update({
        status: 'pending',
        reservations_released: false,
        last_error: null,
        retry_count: 0,
        next_retry_at: nowIso,
        notes: batchNotes,
        updated_at: nowIso,
      })
      .eq('id', cand.id)
      .eq('status', 'failed_dlq')
      .select('id, order_number')
      .maybeSingle();

    if (upd) {
      updatedList.push(upd);
      await supabase
        .from('orders')
        .update({
          status: 'pending',
          reservations_released: false,
          last_error: null,
          retry_count: 0,
          next_retry_at: nowIso,
          notes: batchNotes,
          updated_at: nowIso,
        })
        .eq('parent_order_id', cand.id);
    }
  }

  const retriedCount = updatedList.length;
  if (retriedCount > 0) {
    triggerImmediateOutboxSync(req, correlationId, {
      orderId: updatedList[0].id,
      orderDoc: updatedList[0].order_number,
    });
  }

  await recordAuditLog({
    eventType: 'dlq_batch_retry',
    direction: 'outbound',
    status: 'success',
    statusCode: 200,
    source: 'Admin Portal',
    correlationId,
    payload: {
      retried_count: retriedCount,
      skipped_out_of_stock: skippedOutOfStock.length,
      order_numbers: updatedList.map(o => o.order_number),
      retried_by: auth.userId,
    },
  });

  return res.status(200).json({
    success: true,
    message: `Успешно возвращено в очередь ${retriedCount} заказов из DLQ.${skippedOutOfStock.length > 0 ? ` Пропущено из-за нехватки остатка: ${skippedOutOfStock.length}.` : ''}`,
    count: retriedCount,
    orders: updatedList,
    skipped_insufficient_stock: skippedOutOfStock,
  });
}

