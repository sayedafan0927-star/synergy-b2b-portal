import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../../lib/logger';
import { recordFailure, recordSuccess } from '../../lib/circuitBreaker';
import { releaseAllReservedStock, ReservedStockItem } from '../../lib/saga';
import type { SplitOrderSummary } from './orderSplitter';

/**
 * Неблокирующий вызов воркера Outbox для мгновенного сброса заказа в ERP (sub-second sync)
 * Устраняет 2-минутную задержку ожидания Vercel Cron и защищен от Serverless Runtime Freeze.
 */
export function triggerImmediateOutboxSync(req: VercelRequest, correlationId: string): void {
  try {
    const host = req.headers['host'] || 'localhost:3000';
    const proto = (req.headers['x-forwarded-proto'] as string) || (String(host).includes('localhost') ? 'http' : 'https');
    const workerUrl = `${proto}://${host}/api/outbox/sync`;
    const cronSecret = process.env.CRON_SECRET || process.env.PORTAL_SECRET_KEY || '';

    // Fire-and-forget: не блокируем ответ клиенту
    const fetchPromise = fetch(workerUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${cronSecret}`,
        'X-Portal-Key': cronSecret,
        'X-Cron-Key': cronSecret,
        'X-Correlation-ID': correlationId,
      },
    }).catch(err => {
      logger.debug('[Outbox Immediate Trigger Notice]', { error: (err as Error)?.message });
    });

    // Защита от Serverless runtime freezing через waitUntil (Vercel / Edge context)
    const vercelWaitUntil = (req as any).context?.waitUntil || (globalThis as any).waitUntil;
    if (typeof vercelWaitUntil === 'function') {
      vercelWaitUntil(fetchPromise);
    }
  } catch (triggerErr) {
    logger.debug('[Outbox Immediate Trigger Exception]', { error: (triggerErr as Error)?.message });
  }
}

export interface DispatchErpCheckoutParams {
  req: VercelRequest;
  res: VercelResponse;
  targetErpUrl: string;
  serverErpKey: string;
  incomingIdempotencyKey?: string;
  outboxOrderDoc: string;
  outboxOrderId?: string | null;
  correlationId: string;
  clientIp: string;
  outboundPayload: any;
  createdSplitOrders: SplitOrderSummary[];
  reservedSkuItems: ReservedStockItem[];
  supabase: SupabaseClient;
}

/**
 * Быстрая синхронизация оформленного заказа с 1C:ERP с тайм-аутом 2.5s и отказоустойчивым фоллбэком в Outbox
 */
export async function dispatchErpCheckoutWithFallback(params: DispatchErpCheckoutParams): Promise<void> {
  const {
    req,
    res,
    targetErpUrl,
    serverErpKey,
    incomingIdempotencyKey,
    outboxOrderDoc,
    outboxOrderId,
    correlationId,
    clientIp,
    outboundPayload,
    createdSplitOrders,
    reservedSkuItems,
    supabase,
  } = params;

  const controller = new AbortController();
  const erpTimeoutId = setTimeout(() => controller.abort(), 2500);

  try {
    const erpResponse = await fetch(`${targetErpUrl}?action=create_order`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Portal-Key': serverErpKey,
        'X-Idempotency-Key': incomingIdempotencyKey || outboxOrderDoc,
        'Idempotency-Key': incomingIdempotencyKey || outboxOrderDoc,
        Accept: 'application/json',
        'X-Correlation-ID': correlationId,
        'X-Forwarded-For': clientIp,
        'X-Real-IP': clientIp,
      },
      body: JSON.stringify(outboundPayload),
      signal: controller.signal,
    });
    clearTimeout(erpTimeoutId);

    const jsonData = await erpResponse.json().catch(() => null);

    // Обработка 409 Conflict / INSUFFICIENT_STOCK от 1C:ERP
    if (erpResponse.status === 409 || jsonData?.error_code === 'INSUFFICIENT_STOCK') {
      logger.warn('[Order] 1C:ERP returned 409 Conflict / Insufficient stock. Triggering Saga rollback', {
        orderDoc: outboxOrderDoc,
        correlationId,
      });

      if (outboxOrderId) {
        await supabase
          .from('orders')
          .update({
            status: 'cancelled',
            notes: `[Отклонено ERP: Недостаточно остатка] ${jsonData?.error || ''}`,
            updated_at: new Date().toISOString(),
          })
          .eq('id', outboxOrderId);
      }

      // SAGA: Откат всех локальных резервов
      await releaseAllReservedStock(reservedSkuItems, {
        correlationId,
        orderId: outboxOrderId || undefined,
        orderNumber: outboxOrderDoc || undefined,
        reason: '1C ERP отклонила заказ по причине нехватки остатка (409 Conflict)',
      });

      res.status(409).json({
        success: false,
        code: 'INSUFFICIENT_STOCK',
        error: jsonData?.error || '1C:ERP отклонила заказ: недостаточно товара на складе.',
      });
      return;
    }

    if (erpResponse.ok && jsonData?.success) {
      await recordSuccess('erp_gateway');
      if (outboxOrderId && jsonData.order?.doc_number) {
        await supabase
          .from('orders')
          .update({
            order_number: jsonData.order.doc_number,
            status: 'processing',
            updated_at: new Date().toISOString(),
          })
          .eq('id', outboxOrderId);
      }

      if (jsonData && typeof jsonData === 'object' && createdSplitOrders.length > 0) {
        jsonData.split_orders = createdSplitOrders;
      }
      res.status(200).json(jsonData);
      return;
    }

    // Если ответ не OK, заказ остается в статусе pending для Outbox Sync Worker
    logger.warn('[Order] ERP non-OK response. Order preserved in outbox for asynchronous sync', {
      statusCode: erpResponse.status,
      orderDoc: outboxOrderDoc,
    });
    triggerImmediateOutboxSync(req, correlationId);
    res.status(200).json({
      success: true,
      outbox_queued: true,
      is_buffered_offline: true,
      order_number: outboxOrderDoc,
      order_id: outboxOrderId,
      split_orders: createdSplitOrders,
      message: 'Заказ успешно зарегистрирован и поставлен в очередь асинхронной отправки в ERP.',
    });
  } catch (err: any) {
    clearTimeout(erpTimeoutId);
    await recordFailure('erp_gateway');
    logger.info('[Order Outbox Fallback] ERP sync timeout/disconnect. Order safely retained in PostgreSQL outbox queue', {
      orderDoc: outboxOrderDoc,
      isTimeout: err?.name === 'AbortError',
      correlationId,
    });

    triggerImmediateOutboxSync(req, correlationId);
    res.status(200).json({
      success: true,
      outbox_queued: true,
      is_buffered_offline: true,
      order_number: outboxOrderDoc,
      order_id: outboxOrderId,
      split_orders: createdSplitOrders,
      message: 'Заказ принят и надежно сохранен в базе данных. Синхронизация с ERP выполняется в фоновом режиме.',
    });
  }
}
