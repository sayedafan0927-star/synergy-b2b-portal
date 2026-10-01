import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { recordAuditLog } from '../audit/logs';
import { applyCorrelationId } from '../lib/trace';
import { enforceRateLimit } from '../lib/rateLimit';
import { applyCorsHeaders } from '../lib/cors';
import { getErpApiKey } from '../lib/erpKey';
import { checkCircuit } from '../lib/circuitBreaker';
import {
  dispatchDlqEmergencyAlert,
  buildOutboxErpPayload,
  computeBackoffNextRetry,
  isFatalBusinessError,
} from './outboxUtils';

// Re-export for backwards compatibility and test introspection
export { dispatchDlqEmergencyAlert };

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
const SERVER_ERP_KEY = getErpApiKey();
const TARGET_ERP_URL = process.env.ERP_API_URL || 'https://kilem-khan.kz/api/sin/public/api_portal.php';

const supabase = (SUPABASE_URL && SUPABASE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })
  : null as any;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!applyCorsHeaders(req, res)) {
    return;
  }

  const correlationId = applyCorrelationId(req, res);

  // Проверка авторизации воркера (CRON_SECRET или PORTAL_SECRET_KEY)
  const CRON_SECRET = process.env.CRON_SECRET || process.env.PORTAL_SECRET_KEY || '';
  const authHeader = req.headers['authorization'] || '';
  const cronKeyHeader = req.headers['x-cron-key'] || req.headers['x-portal-key'];

  const isAuthorized =
    (process.env.NODE_ENV !== 'production' && !CRON_SECRET) ||
    (CRON_SECRET && (cronKeyHeader === CRON_SECRET || authHeader === `Bearer ${CRON_SECRET}`));

  if (!isAuthorized) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized: Invalid or missing authorization token for outbox worker.',
    });
  }

  // Rate Limiting (макс 30 запусков в минуту на IP)
  if (!(await enforceRateLimit(req, res, { limit: 30, windowSeconds: 60, actionPrefix: 'outbox_sync' }))) {
    return;
  }

  const startTime = Date.now();
  const nowIso = new Date().toISOString();
  try {
    // 0. Автоматическое освобождение зависших заказов (Stale Claim Recovery)
    // Если предыдущий воркер аварийно завершился и заказ остался в 'processing_sync' > 5 минут
    const staleThreshold = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    try {
      await supabase
        .from('orders')
        .update({
          status: 'pending',
          last_error: 'Сброс зависшего захвата синхронизации (Stale Claim Recovery)',
          updated_at: nowIso,
        })
        .eq('status', 'processing_sync')
        .lte('updated_at', staleThreshold);
    } catch (staleErr) {
      console.warn('[Outbox Sync] Stale claim recovery warning:', staleErr);
    }

    // 1. Атомарный конкурентно-безопасный захват заказов (FOR UPDATE SKIP LOCKED)
    let pendingOrders: any[] | null = null;
    let claimedViaRpc = false;

    const { data: claimedOrders, error: rpcErr } = await supabase.rpc('claim_outbox_orders', { p_limit: 4 });
    if (!rpcErr && Array.isArray(claimedOrders)) {
      pendingOrders = claimedOrders;
      claimedViaRpc = true;
    } else {
      // Fallback на селективный claim, если RPC еще не применена в миграциях
      const { data: fetchedOrders, error: fetchErr } = await supabase
        .from('orders')
        .select('*')
        .eq('status', 'pending')
        .is('parent_order_id', null)
        .or(`next_retry_at.is.null,next_retry_at.lte.${nowIso}`)
        .order('created_at', { ascending: true })
        .limit(4);

      if (fetchErr) {
        console.error('[Outbox Sync] Failed to fetch pending orders:', fetchErr);
        return res.status(500).json({
          success: false,
          error: 'Ошибка обращения к очереди заказов в БД',
          details: fetchErr.message,
        });
      }
      pendingOrders = fetchedOrders;
    }

    if (!pendingOrders || pendingOrders.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'Очередь Outbox пуста или все заказы ожидают своего тайм-аута ретрая.',
        count: 0,
        processed: [],
      });
    }

    // Circuit Breaker Guard: не бомбардируем аварийный шлюз ERP при открытом контуре
    const circuit = await checkCircuit('erp_gateway');
    if (!circuit.permitted) {
      return res.status(200).json({
        success: true,
        circuit_open: true,
        message: 'Circuit breaker for erp_gateway is OPEN. Postponing outbox drain until recovery.',
        count: pendingOrders.length,
      });
    }

    const results: Array<{ order_id: string; order_number: string; success: boolean; dlq?: boolean; error?: string }> = [];

    async function syncSingleOrder(order: any): Promise<{ order_id: string; order_number: string; success: boolean; dlq?: boolean; error?: string } | null> {
      // Если заказ не был предварительно залочен через SKIP LOCKED RPC — захватываем атомарно
      if (!claimedViaRpc) {
        const { data: claimedRow } = await supabase
          .from('orders')
          .update({
            status: 'processing_sync',
            updated_at: new Date().toISOString(),
          })
          .eq('id', order.id)
          .eq('status', 'pending')
          .select('id')
          .maybeSingle();

        if (!claimedRow) {
          return null; // Заказ уже перехвачен параллельным воркером
        }
      }

      const currentRetries = Number(order.retry_count || 0);

      // Подгружаем товарные позиции заказа из order_items
      const { data: dbItems } = await supabase
        .from('order_items')
        .select('*')
        .eq('order_id', order.id);

      const orderPayload = buildOutboxErpPayload(order, dbItems);

      try {
        const erpUrl = `${TARGET_ERP_URL}?action=create_order`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 4000); // 4s timeout (fast failover)

        const erpRes = await fetch(erpUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Portal-Key': SERVER_ERP_KEY,
            'Idempotency-Key': order.idempotency_key || `outbox-${order.id}`,
            'X-Idempotency-Key': order.idempotency_key || `outbox-${order.id}`,
            'X-Correlation-ID': correlationId,
          },
          body: JSON.stringify(orderPayload),
          signal: controller.signal,
        }).finally(() => clearTimeout(timeout));

        if (erpRes.ok) {
          const erpData = await erpRes.json().catch(() => ({}));
          const docNumber = erpData?.order?.doc_number || erpData?.order_id || `1C-${order.order_number}`;

          // Успех: обновляем статус заказа в Supabase на confirmed
          await supabase
            .from('orders')
            .update({
              status: 'confirmed',
              order_number: docNumber,
              last_error: null,
              notes: `${order.notes || ''} [Синхронизировано с ERP: ${new Date().toISOString()}]`.trim(),
              updated_at: new Date().toISOString(),
            })
            .eq('id', order.id);

          // Каскадная нумерация и подтверждение дочерних подзаказов мультисклада (parent_order_id)
          try {
            const splitListFromErp = Array.isArray(erpData?.split_orders) ? erpData.split_orders : [];
            const { data: childOrders } = await supabase
              .from('orders')
              .select('id, warehouse')
              .eq('parent_order_id', order.id);

            if (childOrders && childOrders.length > 0) {
              for (const child of childOrders) {
                const matchingSplit = splitListFromErp.find((s: any) =>
                  s.warehouse === child.warehouse || String(s.warehouse_id) === String(child.warehouse)
                );
                const childDocNumber = matchingSplit?.doc_number || `${docNumber}-${child.id.slice(0, 6).toUpperCase()}`;
                await supabase
                  .from('orders')
                  .update({
                    status: 'confirmed',
                    order_number: childDocNumber,
                    last_error: null,
                    notes: `${order.notes || ''} [Синхронизировано с ERP: ${new Date().toISOString()}]`.trim(),
                    updated_at: new Date().toISOString(),
                  })
                  .eq('id', child.id);
              }
            }
          } catch (splitSyncErr) {
            console.warn('[Outbox Sync] Multi-warehouse suborder update notice:', splitSyncErr);
          }

          await recordAuditLog({
            eventType: 'outbox_sync_success',
            direction: 'outbound',
            status: 'success',
            statusCode: erpRes.status,
            latencyMs: Date.now() - startTime,
            source: 'Outbox Worker',
            correlationId,
            payload: { order_id: order.id, order_number: order.order_number, erp_doc: docNumber },
          });

          // Оповещаем Realtime-канал
          try {
            const channel = supabase.channel('portal_live_updates');
            await channel.send({
              type: 'broadcast',
              event: 'order_status_changed',
              payload: {
                order_id: order.id,
                order_doc_number: docNumber,
                new_status: 'confirmed',
                timestamp: new Date().toISOString(),
              },
            });
          } catch {}

          return { order_id: order.id, order_number: order.order_number, success: true };
        } else {
          const errText = await erpRes.text().catch(() => '');
          const isFatal = isFatalBusinessError(erpRes.status, errText);
          const nextRetries = isFatal ? 5 : (currentRetries + 1);
          const { nextRetryAt, isDlq } = isFatal
            ? { nextRetryAt: new Date().toISOString(), isDlq: true }
            : computeBackoffNextRetry(nextRetries);

          await supabase
            .from('orders')
            .update({
              status: isDlq ? 'failed_dlq' : 'pending',
              reservations_released: isDlq ? true : undefined,
              retry_count: nextRetries,
              last_error: isFatal
                ? `[Fatal Business Error] ERP ${erpRes.status}: ${errText.slice(0, 200)}`
                : `ERP ${erpRes.status}: ${errText.slice(0, 200)}`,
              next_retry_at: nextRetryAt,
              updated_at: new Date().toISOString(),
            })
            .eq('id', order.id);

          if (isDlq) {
            try {
              await supabase
                .from('orders')
                .update({
                  status: 'failed_dlq',
                  reservations_released: true,
                  last_error: isFatal
                    ? `[Fatal Business Error] ERP ${erpRes.status}: ${errText.slice(0, 200)}`
                    : `ERP ${erpRes.status}: ${errText.slice(0, 200)}`,
                  updated_at: new Date().toISOString(),
                })
                .eq('parent_order_id', order.id);

              await supabase.rpc('release_order_reservations', { p_order_id: order.id });
            } catch (relErr) {
              console.warn('[Outbox Sync] DLQ reservation release error:', relErr);
            }
          }

          await recordAuditLog({
            eventType: isDlq ? 'outbox_dlq_moved' : 'outbox_sync_retry_scheduled',
            direction: 'outbound',
            status: isDlq ? 'error' : 'warning',
            statusCode: erpRes.status,
            latencyMs: Date.now() - startTime,
            source: 'Outbox Worker',
            correlationId,
            payload: {
              order_id: order.id,
              order_number: order.order_number,
              retry_count: nextRetries,
              is_dlq: isDlq,
              is_fatal: isFatal,
              next_retry_at: nextRetryAt,
            },
            errorMessage: errText.slice(0, 250),
          });

          if (isDlq) {
            dispatchDlqEmergencyAlert({
              orderId: order.id,
              orderNumber: order.order_number,
              amount: Number(order.total_amount || 0),
              retries: nextRetries,
              error: errText.slice(0, 150) || `HTTP ${erpRes.status}`,
            }).catch(() => {});
          }

          return {
            order_id: order.id,
            order_number: order.order_number,
            success: false,
            dlq: isDlq,
            error: `ERP ${erpRes.status}: ${errText.slice(0, 100)}`,
          };
        }
      } catch (reqErr: any) {
        const nextRetries = currentRetries + 1;
        const { nextRetryAt, isDlq } = computeBackoffNextRetry(nextRetries);

        await supabase
          .from('orders')
          .update({
            status: isDlq ? 'failed_dlq' : 'pending',
            reservations_released: isDlq ? true : undefined,
            retry_count: nextRetries,
            last_error: `Сетевой сбой: ${reqErr?.message || 'Network error'}`,
            next_retry_at: nextRetryAt,
            updated_at: new Date().toISOString(),
          })
          .eq('id', order.id);

        if (isDlq) {
          try {
            await supabase
              .from('orders')
              .update({
                status: 'failed_dlq',
                reservations_released: true,
                last_error: `Сетевой сбой: ${reqErr?.message || 'Network error'}`,
                updated_at: new Date().toISOString(),
              })
              .eq('parent_order_id', order.id);

            await supabase.rpc('release_order_reservations', { p_order_id: order.id });
          } catch (relErr) {
            console.warn('[Outbox Sync] Network DLQ reservation release error:', relErr);
          }
          dispatchDlqEmergencyAlert({
            orderId: order.id,
            orderNumber: order.order_number,
            amount: Number(order.total_amount || 0),
            retries: nextRetries,
            error: reqErr?.message || 'Постоянный сетевой сбой',
          }).catch(() => {});
        }

        return {
          order_id: order.id,
          order_number: order.order_number,
          success: false,
          dlq: isDlq,
          error: reqErr?.message || 'Network error',
        };
      }
    }

    // Обработка батчами по 2 заказа с защитой от Serverless 504 Timeout (дедлайн 7.5с)
    const BATCH_SIZE = 2;
    const MAX_EXECUTION_MS = 7500;
    let deadlineReached = false;

    for (let i = 0; i < pendingOrders.length; i += BATCH_SIZE) {
      if (Date.now() - startTime > MAX_EXECUTION_MS) {
        deadlineReached = true;
        break;
      }
      const batch = pendingOrders.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(batch.map(order => syncSingleOrder(order)));
      for (const res of batchResults) {
        if (res) results.push(res);
      }
    }

    // Zero 5-Minute Stale Delay: Если воркер уперся в дедлайн, немедленно освобождаем захваченные, но необработанные заказы
    if (claimedViaRpc && deadlineReached) {
      const processedIds = new Set(results.map(r => r.order_id));
      const unhandledOrders = pendingOrders.filter(o => !processedIds.has(o.id));
      if (unhandledOrders.length > 0) {
        const unhandledIds = unhandledOrders.map(o => o.id);
        try {
          await supabase
            .from('orders')
            .update({
              status: 'pending',
              last_error: 'Освобождение по таймауту воркера (Graceful Deadline Yield)',
              updated_at: new Date().toISOString(),
            })
            .in('id', unhandledIds)
            .eq('status', 'processing_sync');
        } catch (releaseErr) {
          console.warn('[Outbox Sync] Unhandled orders release warning:', releaseErr);
        }
      }
    }

    const succeeded = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success && !r.dlq).length;
    const dlq = results.filter(r => r.dlq).length;

    return res.status(200).json({
      success: true,
      total_processed: results.length,
      succeeded,
      failed,
      dlq_moved: dlq,
      results,
      executed_at: new Date().toISOString(),
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: 'Внутренняя ошибка фонового Outbox Worker',
      details: err?.message,
    });
  }
}
