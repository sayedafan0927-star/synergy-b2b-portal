import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { recordAuditLog } from '../audit/logs';
import { applyCorrelationId } from '../lib/trace';
import { applyCorsHeaders } from '../lib/cors';
import { logger } from '../lib/logger';
import { sendWhatsAppMessage } from '../approvals/whatsapp';
import { getErpApiKey, getTargetErpUrl } from '../lib/erpKey';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
const CRON_SECRET = process.env.CRON_SECRET || process.env.PORTAL_SECRET_KEY || '';
const TARGET_ERP_URL = getTargetErpUrl();
const SERVER_ERP_KEY = getErpApiKey();

const supabase = (SUPABASE_URL && SUPABASE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })
  : null as any;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!applyCorsHeaders(req, res)) {
    return;
  }

  const correlationId = applyCorrelationId(req, res);

  // Проверка авторизации крона (Bearer Secret или x-cron-key)
  const authHeader = req.headers['authorization'] || '';
  const cronKeyHeader = req.headers['x-cron-key'] || req.headers['x-portal-key'];

  const isAuthorized =
    (process.env.NODE_ENV !== 'production' && !CRON_SECRET) ||
    (CRON_SECRET && (cronKeyHeader === CRON_SECRET || authHeader === `Bearer ${CRON_SECRET}`));

  if (!isAuthorized) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized: Invalid or missing cron authorization token.',
    });
  }

  const startTime = Date.now();
  const ttlHours = parseInt(process.env.WMS_HOLD_TTL_HOURS || '48', 10);
  const cutoffTime = new Date(Date.now() - ttlHours * 60 * 60 * 1000).toISOString();

  try {
    // 1. Попытка выполнить через оптимизированную атомарную функцию базы данных
    const { data: rpcData, error: rpcError } = await supabase.rpc('cancel_expired_order_holds', {
      p_batch_size: 50,
    });

    let cancelledOrders: any[] = [];

    if (!rpcError && Array.isArray(rpcData)) {
      cancelledOrders = rpcData;
    } else {
      // 2. Fallback: прямое выполнение запроса, если миграция ещё ожидает применения
      const { data: pendingOrders, error: fetchErr } = await supabase
        .from('orders')
        .select('id, order_number, user_id, total_amount, created_at, hold_expires_at')
        .in('status', ['pending', 'failed_dlq'])
        .is('parent_order_id', null)
        .or(`hold_expires_at.lte.${new Date().toISOString()},and(hold_expires_at.is.null,created_at.lte.${cutoffTime})`)
        .limit(50);

      if (fetchErr) {
        throw new Error(`Failed to query expired orders: ${fetchErr.message}`);
      }

      if (pendingOrders && pendingOrders.length > 0) {
        const orderIds = pendingOrders.map((o: any) => o.id);

        // Освобождаем зарезервированные остатки обратно в free_stock
        for (const ord of pendingOrders) {
          try {
            await supabase.rpc('release_order_reservations', { p_order_id: ord.id });
          } catch (relErr) {
            logger.warn('[WMS Hold Expiry] Fallback release_order_reservations notice:', relErr as Error);
          }
          // Двухконтурная гарантия: прямая очистка таблицы stock_reservations
          try {
            await supabase
              .from('stock_reservations')
              .update({ status: 'cancelled', updated_at: new Date().toISOString() })
              .eq('order_id', ord.id)
              .eq('status', 'active');
          } catch (resErr) {
            logger.warn('[WMS Hold Expiry] Direct stock_reservations fallback cleanup notice:', resErr as Error);
          }
        }

        const { error: updateErr } = await supabase
          .from('orders')
          .update({
            status: 'cancelled',
            reservations_released: true,
            notes: `[Auto-cancelled: WMS reservation hold TTL expired (${ttlHours}h)]`,
            updated_at: new Date().toISOString(),
          })
          .in('id', orderIds);

        await supabase
          .from('orders')
          .update({
            status: 'cancelled',
            reservations_released: true,
            notes: `[Auto-cancelled: Master reservation hold TTL expired (${ttlHours}h)]`,
            updated_at: new Date().toISOString(),
          })
          .in('parent_order_id', orderIds);

        if (updateErr) {
          throw new Error(`Failed to update expired orders: ${updateErr.message}`);
        }

        cancelledOrders = pendingOrders;
      }
    }

    if (cancelledOrders.length > 0) {
      logger.info(`[WMS Hold Expiry] Auto-cancelled ${cancelledOrders.length} stale pending orders.`, {
        cancelledCount: cancelledOrders.length,
        ttlHours,
      });

      // Оповещаем Realtime-канал portal_live_updates о высвобождении складских остатков
      try {
        const channel = supabase.channel('portal_live_updates');
        await channel.send({
          type: 'broadcast',
          event: 'stock_changed',
          payload: {
            reason: 'wms_hold_expired',
            cancelled_count: cancelledOrders.length,
            timestamp: new Date().toISOString(),
          },
        });
      } catch (broadcastErr) {
        logger.warn('[WMS Hold Expiry] Realtime broadcast warning', {}, broadcastErr as Error);
      }

      // Двустороннее уведомление 1C:ERP о снятии броней для исключения зомби-резервов
      if (SERVER_ERP_KEY && TARGET_ERP_URL) {
        for (const ord of cancelledOrders) {
          const ordDoc = ord.cancelled_order_number || ord.order_number || ord.id;
          try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 3000);
            await fetch(`${TARGET_ERP_URL}?action=update_order_status`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Portal-Key': SERVER_ERP_KEY,
                'X-Correlation-ID': correlationId,
              },
              body: JSON.stringify({
                order_id: ordDoc,
                status: 'cancelled',
                comment: `Авто-отмена брони WMS по истечению TTL (${ttlHours}ч)`,
              }),
              signal: controller.signal,
            }).finally(() => clearTimeout(timeout));
          } catch (erpErr: any) {
            logger.warn('[WMS Hold Expiry] Notice syncing cancel with 1C ERP:', { ordDoc, error: erpErr?.message });
          }
        }
      }

      await recordAuditLog({
        eventType: 'wms_hold_auto_expiry',
        direction: 'outbound',
        status: 'success',
        source: 'WMS Hold TTL Cron',
        payload: {
          cancelledCount: cancelledOrders.length,
          orderNumbers: cancelledOrders.map((o: any) => o.cancelled_order_number || o.order_number),
          ttlHours,
        },
      });

      // Оперативное WhatsApp-уведомление дежурному менеджеру
      const managerPhone = process.env.ADMIN_WHATSAPP_PHONE || process.env.MANAGER_WHATSAPP_PHONE || process.env.WHATSAPP_MANAGER_PHONE || '';
      if (managerPhone && cancelledOrders.length > 0) {
        const orderList = cancelledOrders.slice(0, 5).map((o: any) => `• №${o.cancelled_order_number || o.order_number || o.id}`).join('\n');
        const waMsg = `⏳ *АВТО-ОТМЕНА ПРОСРОЧЕННЫХ БРОНЕЙ (${ttlHours}ч)*\n\n` +
          `Отменено заказов с истекшим сроком оплаты: *${cancelledOrders.length}*\n` +
          `${orderList}\n\n` +
          `_Складские остатки автоматически возвращены в свободную продажу в каталоге._`;
        sendWhatsAppMessage(managerPhone, waMsg, {
          eventType: 'booking_expired',
        }).catch(waErr => {
          logger.warn('[WMS Hold Expiry] WhatsApp alert warning:', waErr as Error);
        });
      }
    }

    return res.status(200).json({
      success: true,
      message: `Checked for expired order holds (TTL: ${ttlHours}h).`,
      cancelledCount: cancelledOrders.length,
      orders: cancelledOrders.map((o: any) => ({
        id: o.cancelled_order_id || o.id,
        order_number: o.cancelled_order_number || o.order_number,
      })),
      durationMs: Date.now() - startTime,
      correlationId,
    });
  } catch (err: any) {
    console.error('[WMS Hold Expiry] Error executing hold cleanup:', err);

    await recordAuditLog({
      eventType: 'wms_hold_auto_expiry',
      direction: 'outbound',
      status: 'error',
      source: 'WMS Hold TTL Cron',
      errorMessage: err?.message,
    });

    return res.status(500).json({
      success: false,
      error: 'Failed to process WMS hold auto-expiration',
      details: err?.message,
    });
  }
}
