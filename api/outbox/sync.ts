import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { recordAuditLog } from '../audit/logs';
import { applyCorrelationId } from '../lib/trace';
import { enforceRateLimit } from '../lib/rateLimit';
import { sendWhatsAppMessage } from '../approvals/whatsapp';
import { applyCorsHeaders } from '../lib/cors';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://sjvvoxxwevwgziuxjvcy.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
const SERVER_ERP_KEY = process.env.ERP_API_KEY || '';
const TARGET_ERP_URL = process.env.ERP_API_URL || 'https://kilem-khan.kz/api/sin/public/api_portal.php';

const MAX_RETRIES = 5;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

async function dispatchDlqEmergencyAlert(params: {
  orderId: string;
  orderNumber: string;
  amount: number;
  retries: number;
  error: string;
}) {
  const alertPhone = process.env.ADMIN_WHATSAPP_PHONE || '+77017770000';
  const text = `🚨 *КРИТИЧЕСКИЙ СБОЙ OUTBOX / 1C:ERP*\n\n` +
    `Заказ *№${params.orderNumber}* переведен в *Dead Letter Queue (DLQ)* после ${params.retries} неудачных попыток синхронизации!\n\n` +
    `💰 Сумма заказа: $${params.amount}\n` +
    `❌ Ошибка: ${params.error}\n\n` +
    `_Требуется ручное вмешательство дежурного инженера или проверка доступности 1С._`;

  try {
    await sendWhatsAppMessage(alertPhone, text);
  } catch (e) {
    console.warn('[DLQ Alert WhatsApp notice]:', e);
  }

  const tgWebhook = process.env.TELEGRAM_ALERT_WEBHOOK_URL;
  if (tgWebhook) {
    try {
      await fetch(tgWebhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
    } catch (e) {
      console.warn('[DLQ Alert Telegram notice]:', e);
    }
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!applyCorsHeaders(req, res)) {
    return;
  }

  const correlationId = applyCorrelationId(req, res);

  // Rate Limiting (макс 30 запусков в минуту на IP)
  if (!enforceRateLimit(req, res, { limit: 30, windowSeconds: 60, actionPrefix: 'outbox_sync' })) {
    return;
  }

  const startTime = Date.now();
  const nowIso = new Date().toISOString();

  try {
    // 1. Поиск отложенных заказов, готовых к синхронизации (pending и next_retry_at <= now)
    const { data: pendingOrders, error: fetchErr } = await supabase
      .from('orders')
      .select('*')
      .eq('status', 'pending')
      .lte('next_retry_at', nowIso)
      .order('created_at', { ascending: true })
      .limit(10);

    if (fetchErr) {
      console.error('[Outbox Sync] Failed to fetch pending orders:', fetchErr);
      return res.status(500).json({
        success: false,
        error: 'Ошибка обращения к очереди заказов в БД',
        details: fetchErr.message,
      });
    }

    if (!pendingOrders || pendingOrders.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'Очередь Outbox пуста или все заказы ожидают своего тайм-аута ретрая.',
        count: 0,
        processed: [],
      });
    }

    const results: Array<{ order_id: string; order_number: string; success: boolean; dlq?: boolean; error?: string }> = [];

    for (const order of pendingOrders) {
      // 2. Атомарный захват заказа (Claim Lock) для исключения параллельной гонки
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
        // Заказ уже перехвачен параллельным воркером
        continue;
      }

      const currentRetries = Number(order.retry_count || 0);

      // Подгружаем товарные позиции заказа из order_items
      const { data: dbItems } = await supabase
        .from('order_items')
        .select('*')
        .eq('order_id', order.id);

      const itemsList = (dbItems && dbItems.length > 0)
        ? dbItems.map(it => ({
            item_id: Number(it.product_id) > 0 ? Number(it.product_id) : undefined,
            sku: it.sku || it.product_name,
            quantity: Number(it.quantity) || 1,
            price: Number(it.price) || 10,
            warehouse: it.warehouse || order.warehouse || 'Основной Склад Астана',
          }))
        : [
            {
              sku: 'OUTBOX-ITEM',
              quantity: order.total_items || 1,
              price: order.total_amount || 10,
              warehouse: order.warehouse || 'Основной Склад Астана',
            }
          ];

      const orderPayload = {
        partner_id: order.partner_id || 'guest',
        client_name: order.client_name || 'Оптовый клиент',
        warehouse_id: 81,
        buyer: {
          name: order.client_name || 'Оптовый клиент',
          phone: order.client_phone || '',
        },
        customer: {
          name: order.client_name || 'Оптовый клиент',
          phone: order.client_phone || '',
        },
        comment: `[Outbox Auto-Sync] ${order.notes || ''}`,
        total_amount: order.total_amount,
        items: itemsList,
      };

      try {
        const erpUrl = `${TARGET_ERP_URL}?action=create_order&portal_key=${encodeURIComponent(SERVER_ERP_KEY)}`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);

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
              notes: `${order.notes || ''} [Синхронизировано с 1С: ${new Date().toISOString()}]`.trim(),
              updated_at: new Date().toISOString(),
            })
            .eq('id', order.id);

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

          results.push({ order_id: order.id, order_number: order.order_number, success: true });
        } else {
          const errText = await erpRes.text().catch(() => '');
          const nextRetries = currentRetries + 1;
          const isDlq = nextRetries >= MAX_RETRIES;

          // Экспоненциальный откат: 1 мин, 2 мин, 4 мин, 8 мин, 16 мин
          const backoffMinutes = Math.min(60, Math.pow(2, nextRetries - 1));
          const nextRetryAt = new Date(Date.now() + backoffMinutes * 60000).toISOString();

          await supabase
            .from('orders')
            .update({
              status: isDlq ? 'failed_dlq' : 'pending',
              retry_count: nextRetries,
              last_error: `ERP ${erpRes.status}: ${errText.slice(0, 200)}`,
              next_retry_at: nextRetryAt,
              updated_at: new Date().toISOString(),
            })
            .eq('id', order.id);

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

          results.push({
            order_id: order.id,
            order_number: order.order_number,
            success: false,
            dlq: isDlq,
            error: `ERP ${erpRes.status}: ${errText.slice(0, 100)}`,
          });
        }
      } catch (reqErr: any) {
        const nextRetries = currentRetries + 1;
        const isDlq = nextRetries >= MAX_RETRIES;
        const backoffMinutes = Math.min(60, Math.pow(2, nextRetries - 1));
        const nextRetryAt = new Date(Date.now() + backoffMinutes * 60000).toISOString();

        await supabase
          .from('orders')
          .update({
            status: isDlq ? 'failed_dlq' : 'pending',
            retry_count: nextRetries,
            last_error: `Сетевой сбой: ${reqErr?.message || 'Network error'}`,
            next_retry_at: nextRetryAt,
            updated_at: new Date().toISOString(),
          })
          .eq('id', order.id);

        if (isDlq) {
          dispatchDlqEmergencyAlert({
            orderId: order.id,
            orderNumber: order.order_number,
            amount: Number(order.total_amount || 0),
            retries: nextRetries,
            error: reqErr?.message || 'Постоянный сетевой сбой',
          }).catch(() => {});
        }

        results.push({
          order_id: order.id,
          order_number: order.order_number,
          success: false,
          dlq: isDlq,
          error: reqErr?.message || 'Network error',
        });
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
