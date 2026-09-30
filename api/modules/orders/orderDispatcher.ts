import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../../lib/logger';
import { recordFailure, recordSuccess } from '../../lib/circuitBreaker';
import { releaseAllReservedStock, ReservedStockItem } from '../../lib/saga';
import { patchCachedCatalogStock, StockItemUpdate } from '../../lib/catalogCache';
import type { SplitOrderSummary } from './orderSplitter';
import { isFatalBusinessError, dispatchDlqEmergencyAlert } from '../../outbox/outboxUtils';

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

      // Мгновенная инвалидация кэша остатков и бродкаст во все браузеры дилеров
      try {
        const stockUpdates: StockItemUpdate[] = reservedSkuItems.map(it => ({
          sku: it.sku,
          free_stock: 0,
          total_stock: 0,
        }));
        await patchCachedCatalogStock(stockUpdates, 'catalog_global', Date.now());

        const channel = supabase.channel('portal_live_updates');
        await channel.send({
          type: 'broadcast',
          event: 'stock_changed',
          payload: {
            items: stockUpdates,
            reason: '409_insufficient_stock_reconciled',
            timestamp: new Date().toISOString(),
          },
        });
      } catch (patchErr) {
        logger.warn('[Order] Conflict stock invalidation notice:', patchErr as Error);
      }

      res.status(409).json({
        success: false,
        code: 'INSUFFICIENT_STOCK',
        error: jsonData?.error || '1C:ERP отклонила заказ: недостаточно товара на складе.',
      });
      return;
    }

    // Обработка фатальных бизнес-ошибок (400, 404, 422, клиент заблокирован) -> немедленный откат Saga и DLQ
    const fatalErrorText = jsonData?.error || jsonData?.message || '';
    if (isFatalBusinessError(erpResponse.status, fatalErrorText)) {
      logger.error('[Order] 1C:ERP rejected order with fatal business error. Triggering Saga rollback and DLQ', {
        orderDoc: outboxOrderDoc,
        status: erpResponse.status,
        error: fatalErrorText,
        correlationId,
      });

      if (outboxOrderId) {
        await supabase
          .from('orders')
          .update({
            status: 'failed_dlq',
            last_error: `[Фатальный сбой ERP (${erpResponse.status})] ${fatalErrorText}`,
            updated_at: new Date().toISOString(),
          })
          .eq('id', outboxOrderId);
      }

      // SAGA: Освобождаем локальные резервы
      await releaseAllReservedStock(reservedSkuItems, {
        correlationId,
        orderId: outboxOrderId || undefined,
        orderNumber: outboxOrderDoc || undefined,
        reason: `Фатальный отказ 1C:ERP (${erpResponse.status}): ${fatalErrorText}`,
      });

      // Тревожный алерт дежурной смене
      dispatchDlqEmergencyAlert({
        orderId: outboxOrderId || outboxOrderDoc,
        orderNumber: outboxOrderDoc,
        retries: 0,
        amount: Number(outboundPayload.total_amount || 0),
        error: `[Fatal Checkout Error ${erpResponse.status}] ${fatalErrorText}`,
      }).catch(() => {});

      const httpStatus = erpResponse.status >= 400 && erpResponse.status < 500 ? erpResponse.status : 422;
      res.status(httpStatus).json({
        success: false,
        code: jsonData?.error_code || 'FATAL_BUSINESS_ERROR',
        error: fatalErrorText || '1C:ERP отклонила оформление заказа по бизнес-причинам.',
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
