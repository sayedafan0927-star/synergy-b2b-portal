import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { recordAuditLog } from '../audit/logs';
import { applyCorrelationId } from '../lib/trace';
import { enforceRateLimit } from '../lib/rateLimit';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://sjvvoxxwevwgziuxjvcy.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZmY2dscW5qaHl1Ynh1aGZ0cndvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDMwMzQ1MDUsImV4cCI6MjA1ODYxMDUwNX0.z0Vw3tJ4372iY-qC52dZ_Yl-kC46M25jH3_P9z3G30w';
const SERVER_ERP_KEY = process.env.ERP_API_KEY || '138d1bdaf9402600c8f5d5763e2e1573c1e45d32401e62e4981cd7e898bf0544';
const TARGET_ERP_URL = process.env.ERP_API_URL || 'https://kilem-khan.kz/api/sin/public/api_portal.php';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Portal-Key, X-Cron-Key, X-Correlation-ID');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const correlationId = applyCorrelationId(req, res);

  // Rate Limiting (макс 30 запусков в минуту на IP)
  if (!enforceRateLimit(req, res, { limit: 30, windowSeconds: 60, actionPrefix: 'outbox_sync' })) {
    return;
  }

  const startTime = Date.now();

  try {
    // 1. Поиск отложенных буферизованных заказов в Supabase
    const { data: pendingOrders, error: fetchErr } = await supabase
      .from('orders')
      .select('*')
      .in('status', ['pending', 'pending_erp_sync', 'queued_for_erp'])
      .order('created_at', { ascending: true })
      .limit(20);

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
        message: 'Очередь Outbox пуста. Все заказы синхронизированы с 1С.',
        count: 0,
        processed: [],
      });
    }

    const results: Array<{ order_id: string; order_number: string; success: boolean; error?: string }> = [];

    for (const order of pendingOrders) {
      // Подгружаем реальные товарные позиции заказа из order_items
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
        : (order.items || [
            {
              sku: 'OUTBOX-ITEM',
              quantity: order.total_items || 1,
              price: order.total_amount || 10,
              warehouse: order.warehouse || 'Основной Склад Астана',
            }
          ]);

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
            'Idempotency-Key': `outbox-${order.id}`,
            'X-Idempotency-Key': `outbox-${order.id}`,
            'X-Correlation-ID': correlationId,
          },
          body: JSON.stringify(orderPayload),
          signal: controller.signal,
        }).finally(() => clearTimeout(timeout));

        if (erpRes.ok) {
          const erpData = await erpRes.json().catch(() => ({}));
          const docNumber = erpData?.order?.doc_number || erpData?.order_id || `1C-${order.order_number}`;

          // Обновляем статус заказа в Supabase на confirmed
          await supabase
            .from('orders')
            .update({
              status: 'confirmed',
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
                order_doc_number: order.order_number,
                new_status: 'confirmed',
                timestamp: new Date().toISOString(),
              },
            });
          } catch {}

          results.push({ order_id: order.id, order_number: order.order_number, success: true });
        } else {
          const errText = await erpRes.text().catch(() => '');
          results.push({ order_id: order.id, order_number: order.order_number, success: false, error: `ERP ${erpRes.status}: ${errText.slice(0, 100)}` });

          await recordAuditLog({
            eventType: 'outbox_sync_retry_failed',
            direction: 'outbound',
            status: 'warning',
            statusCode: erpRes.status,
            latencyMs: Date.now() - startTime,
            source: 'Outbox Worker',
            correlationId,
            payload: { order_id: order.id, order_number: order.order_number },
            errorMessage: errText.slice(0, 200),
          });
        }
      } catch (reqErr: any) {
        results.push({ order_id: order.id, order_number: order.order_number, success: false, error: reqErr?.message || 'Network error' });
      }
    }

    const succeeded = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    return res.status(200).json({
      success: true,
      total_pending: pendingOrders.length,
      succeeded,
      failed,
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
