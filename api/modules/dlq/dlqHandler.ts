import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { SupabaseClient } from '@supabase/supabase-js';
import { authenticateRequest } from '../../lib/authGuard';
import { recordAuditLog } from '../../audit/logs';

import { categorizeDlqError } from '../../outbox/outboxUtils';

export async function handleDlqOrders(req: VercelRequest, res: VercelResponse, supabase: SupabaseClient) {
  const auth = await authenticateRequest(req, { requiredRoles: ['admin', 'manager_rm'], allowServerKey: true });
  if (!auth.isAuthenticated || auth.error) {
    return res.status(403).json({ success: false, error: auth.error || 'Access denied' });
  }
  const { data: dlqList, error: dlqErr } = await supabase
    .from('orders')
    .select('id, order_number, user_id, warehouse, total_amount, total_items, notes, retry_count, last_error, updated_at, created_at')
    .eq('status', 'failed_dlq')
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

  const { data: updated, error: updErr } = await supabase
    .from('orders')
    .update({
      status: 'pending',
      retry_count: 0,
      next_retry_at: new Date().toISOString(),
      notes: `[Ручной перезапуск администратором: ${auth.fullName || auth.userId}]`,
      updated_at: new Date().toISOString(),
    })
    .eq('id', orderId)
    .eq('status', 'failed_dlq')
    .select('id, order_number')
    .maybeSingle();

  if (updErr || !updated) {
    return res.status(500).json({ success: false, error: updErr?.message || 'Заказ не найден в очереди DLQ.' });
  }

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

  const { data: updatedList, error: updErr } = await supabase
    .from('orders')
    .update({
      status: 'pending',
      retry_count: 0,
      next_retry_at: new Date().toISOString(),
      notes: `[Пакетный перезапуск администратором: ${auth.fullName || auth.userId}]`,
      updated_at: new Date().toISOString(),
    })
    .eq('status', 'failed_dlq')
    .select('id, order_number');

  if (updErr) {
    return res.status(500).json({ success: false, error: updErr.message });
  }

  const retriedCount = updatedList?.length || 0;

  await recordAuditLog({
    eventType: 'dlq_batch_retry',
    direction: 'outbound',
    status: 'success',
    statusCode: 200,
    source: 'Admin Portal',
    correlationId,
    payload: {
      retried_count: retriedCount,
      order_numbers: updatedList?.map(o => o.order_number) || [],
      retried_by: auth.userId,
    },
  });

  return res.status(200).json({
    success: true,
    message: `Успешно возвращено в очередь ${retriedCount} заказов из DLQ.`,
    count: retriedCount,
    orders: updatedList,
  });
}

