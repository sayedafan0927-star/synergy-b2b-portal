import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { patchCachedCatalogStock } from '../lib/catalogCache';
import { recordAuditLog } from '../audit/logs';
import { applyCorsHeaders } from '../lib/cors';

const ALLOWED_KEYS = new Set([
  process.env.PORTAL_SECRET_KEY,
  process.env.ERP_API_KEY,
  process.env.ERP_PORTAL_SECRET,
].filter(Boolean) as string[]);

const SECRET_KEY = process.env.PORTAL_SECRET_KEY || process.env.ERP_PORTAL_SECRET || '';
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

const supabaseServer = (SUPABASE_URL && SUPABASE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })
  : null as any;

/**
 * Отправка сообщения в Supabase Realtime Broadcast Channel
 */
async function broadcastLiveUpdate(event: string, payload: any) {
  if (!supabaseServer) return;
  try {
    const channel = supabaseServer.channel('portal_live_updates');
    await channel.send({
      type: 'broadcast',
      event,
      payload,
    });
  } catch (err) {
    console.warn('[Webhook ERP] Failed to broadcast realtime event:', err);
  }
}

/**
 * Автоматический шлюз отправки WhatsApp-уведомлений
 */
async function dispatchWhatsAppNotification(params: {
  phone: string;
  orderDoc: string;
  status: string;
  trackCode?: string;
  clientName?: string;
}) {
  const WHATSAPP_GATEWAY_URL = process.env.WHATSAPP_API_URL || process.env.GREEN_API_URL;
  const WHATSAPP_TOKEN = process.env.WHATSAPP_API_TOKEN;

  let text = '';
  if (params.status === 'shipped') {
    text = `Здравствуйте, ${params.clientName || 'уважаемый партнер'}!\n\nВаш заказ №${params.orderDoc} успешно отгружен со склада компании Synergy.\n` +
      (params.trackCode ? `🚚 Трек-код автотранспорта: ${params.trackCode}\n` : '') +
      `\nСтатус заказа и накладные доступны в вашем личном кабинете на B2B-портале. Спасибо за сотрудничество!`;
  } else if (params.status === 'confirmed') {
    text = `Здравствуйте, ${params.clientName || 'уважаемый партнер'}!\n\nВаш заказ №${params.orderDoc} подтвержден и передан в сборку WMS на складе Астана.\n\nКоманда Synergy B2B.`;
  }

  if (!text) return;
  console.log(`[WhatsApp Dispatcher] Message ready for ${params.phone}:\n${text}`);

  if (WHATSAPP_GATEWAY_URL) {
    try {
      await fetch(WHATSAPP_GATEWAY_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(WHATSAPP_TOKEN ? { 'Authorization': `Bearer ${WHATSAPP_TOKEN}` } : {}),
        },
        body: JSON.stringify({
          phone: params.phone.replace(/\D+/g, ''),
          message: text,
        }),
      });
      console.log(`[WhatsApp Dispatcher] Successfully sent WhatsApp message to ${params.phone}`);
    } catch (err) {
      console.warn(`[WhatsApp Dispatcher] Gateway delivery error for ${params.phone}:`, err);
    }
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!applyCorsHeaders(req, res)) {
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      error: 'Method not allowed. Expected POST request.',
    });
  }

  // Reject oversized payloads (10MB limit)
  const bodyStr = JSON.stringify(req.body);
  if (bodyStr && bodyStr.length > 10 * 1024 * 1024) {
    return res.status(413).json({ error: 'Payload too large', maxSize: '10MB' });
  }

  // 1. Проверка авторизационного ключа
  const portalKey = (
    req.headers['x-portal-key'] ||
    req.headers['X-Portal-Key'] ||
    req.query?.portal_key ||
    req.body?.portal_key
  ) as string | undefined;

  if (!portalKey || !ALLOWED_KEYS.has(portalKey)) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized: Invalid or missing X-Portal-Key header.',
    });
  }

  // 2. Проверка HMAC SHA256 подписи (если передана ERP)
  const receivedSig = (req.headers['x-webhook-signature'] || req.headers['X-Webhook-Signature']) as string | undefined;
  const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);

  if (receivedSig) {
    const expectedSig = crypto.createHmac('sha256', SECRET_KEY).update(rawBody).digest('hex');
    if (receivedSig !== expectedSig) {
      console.warn(`[Webhook ERP] Invalid HMAC signature. Expected: ${expectedSig}, Received: ${receivedSig}`);
      return res.status(401).json({
        success: false,
        error: 'Invalid HMAC signature in X-Webhook-Signature header.',
      });
    }
  }

  const eventId = (req.headers['x-webhook-event-id'] || req.headers['X-Webhook-Event-ID']) as string | undefined;

  try {
    const payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { event } = payload || {};

    if (!event) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: "event" is required in payload.',
      });
    }

    const incomingEventId = String(
      req.headers['x-webhook-event-id'] ||
      req.headers['X-Webhook-Event-ID'] ||
      payload.event_id ||
      payload.id ||
      ''
    ).trim();

    // T-18: Дедупликация входящих вебхуков через PostgreSQL
    if (incomingEventId) {
      try {
        const { data: existingEvent } = await supabaseServer
          .from('webhook_events')
          .select('event_id')
          .eq('event_id', incomingEventId)
          .maybeSingle();

        if (existingEvent) {
          console.log(`[Webhook ERP] Duplicate event ignored (deduplicated): ${incomingEventId}`);
          return res.status(200).json({
            success: true,
            deduplicated: true,
            event_id: incomingEventId,
            message: 'Webhook event already processed previously.',
          });
        }

        await supabaseServer.from('webhook_events').insert({
          event_id: incomingEventId,
          event_type: String(event),
          processed_at: new Date().toISOString(),
        });
      } catch (dedupErr) {
        console.warn('[Webhook ERP] Deduplication check notice:', dedupErr);
      }
    }

    const timestamp = payload.timestamp || new Date().toISOString();
    console.log(`[Webhook ERP] Received event '${event}' (EventID: ${incomingEventId || 'n/a'}, Timestamp: ${timestamp})`);

    // ───────────────────────────────────────────────
    // 1. Событие: stock_changed (Смена остатков / возврат резерва в free_stock)
    // ───────────────────────────────────────────────
    if (event === 'stock_changed') {
      const rawItems = Array.isArray(payload.items) ? payload.items : [];
      const items = rawItems.map((it: any) => ({
        ...it,
        sku: String(it.sku || it.article || it.code || it.barcode || '').trim(),
        article: String(it.article || it.sku || '').trim(),
        free_stock: Number(it.free_stock ?? it.stock ?? 0),
        reserved_stock: Number(it.reserved_stock ?? 0),
        total_stock: Number(it.total_stock ?? ((it.free_stock ?? 0) + (it.reserved_stock ?? 0))),
      }));

      console.log(`[Webhook ERP: stock_changed] Reason: ${payload.reason || 'manual'}, Updated items count: ${items.length}`);

      for (const item of items) {
        console.log(`  -> SKU: ${item.sku}, Free stock: ${item.free_stock}, Reserved: ${item.reserved_stock}, Total: ${item.total_stock}`);
      }

      // 1.1. Материализация в БД (inventory_balances) и инкрементальное обновление кэша каталога с версионированием
      const versionTimestamp = payload.version_timestamp || (payload.timestamp ? new Date(payload.timestamp).getTime() : Date.now());
      let dbUpdated = 0;
      let cachePatched = false;
      try {
        const patchResult = await patchCachedCatalogStock(items, 'catalog_global', versionTimestamp);
        dbUpdated = patchResult.updatedInDb;
        cachePatched = patchResult.cachePatched;
      } catch (patchErr) {
        console.warn('[Webhook ERP] Error materializing stock updates:', patchErr);
      }

      // 1.2. Сквозная трансляция в Realtime-шину браузеров
      await broadcastLiveUpdate('stock_changed', {
        items,
        reason: payload.reason || 'manual',
        timestamp,
      });

      // 1.3. Фиксация в журнале аудита интеграции
      await recordAuditLog({
        eventType: 'stock_changed_webhook',
        direction: 'inbound',
        status: 'success',
        source: 'ERP Stock Webhook',
        payload: {
          items_count: items.length,
          db_updated: dbUpdated,
          cache_patched: cachePatched,
          reason: payload.reason || 'manual',
        },
      });

      return res.status(200).json({
        success: true,
        event: 'stock_changed',
        event_id: eventId || payload.event_id,
        items_processed: items.length,
        items_saved_to_db: dbUpdated,
        catalog_cache_updated: cachePatched,
        message: `Successfully processed stock update for ${items.length} item(s) (DB: ${dbUpdated}, Cache: ${cachePatched}).`,
        processed_at: new Date().toISOString(),
      });
    }

    // ───────────────────────────────────────────────
    // 2. Событие: order_status_changed (Статус заказа WMS / авто-отмена Hold TTL)
    // ───────────────────────────────────────────────
    if (event === 'order_status_changed') {
      const { order_id, order_doc_number, client_name, client_phone, track_code, comment } = payload;
      const targetStatus = payload.new_status || payload.status || 'cancelled';
      const orderNotes = comment || payload.reason || (targetStatus === 'cancelled' ? 'Автоматическая отмена брони по истечении Hold TTL (24ч)' : null);

      console.log(`[Webhook ERP: order_status_changed] Order: ${order_doc_number || order_id} -> ${targetStatus} (Client: ${client_name}, Phone: ${client_phone}, Reason: ${payload.reason || 'n/a'})`);

      // Сквозная трансляция в Realtime-шину браузеров
      await broadcastLiveUpdate('order_status_changed', {
        order_id,
        order_doc_number,
        new_status: targetStatus,
        status: targetStatus,
        track_code: track_code || null,
        comment: orderNotes,
        reason: payload.reason || null,
        timestamp,
      });

      // Также транслируем в канал 'portal_order_live_sync' для гарантированной доставки
      try {
        const orderChannel = supabaseServer.channel('portal_order_live_sync');
        await orderChannel.send({
          type: 'broadcast',
          event: 'order_status_changed',
          payload: {
            order_id,
            order_doc_number,
            new_status: targetStatus,
            status: targetStatus,
            track_code: track_code || null,
            comment: orderNotes,
            reason: payload.reason || null,
            timestamp,
          },
        });
      } catch (bcErr) {
        console.warn('[Webhook ERP] Secondary channel broadcast notice:', bcErr);
      }

      // Синхронизация статуса в Supabase
      try {
        const updatePayload: Record<string, any> = {
          status: targetStatus,
          updated_at: new Date().toISOString(),
        };
        if (orderNotes) {
          updatePayload.notes = orderNotes;
        }

        const isUuid = (val: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);
        const matchConditions: string[] = [];
        if (order_id && isUuid(String(order_id))) {
          matchConditions.push(`id.eq.${order_id}`);
        }
        if (order_doc_number) {
          matchConditions.push(`order_number.eq.${order_doc_number}`);
        }
        if (order_id) {
          matchConditions.push(`order_number.eq.${order_id}`);
        }

        if (matchConditions.length > 0 && supabaseServer) {
          const { data: updatedOrders } = await supabaseServer
            .from('orders')
            .update(updatePayload)
            .or(matchConditions.join(','))
            .select('id');

          // КАСКАДНОЕ ОБНОВЛЕНИЕ ДОЧЕРНИХ ПОДЗАКАЗОВ МУЛЬТИСКЛАДА (parent_order_id)
          if (updatedOrders && updatedOrders.length > 0) {
            const masterIds = updatedOrders.map((o: any) => o.id);
            await supabaseServer
              .from('orders')
              .update(updatePayload)
              .in('parent_order_id', masterIds);
          }
        }
      } catch (dbErr) {
        console.warn('[Webhook ERP] Supabase sync notice:', dbErr);
      }

      await recordAuditLog({
        eventType: 'order_status_updated',
        direction: 'inbound',
        status: 'success',
        source: 'ERP Webhook',
        payload: {
          event_id: eventId || payload.event_id,
          order_id,
          order_doc_number,
          targetStatus,
          track_code,
        },
      });

      // Автоматическая отправка уведомления в WhatsApp
      if (client_phone && targetStatus !== 'cancelled') {
        await dispatchWhatsAppNotification({
          phone: client_phone,
          orderDoc: order_doc_number || String(order_id),
          status: targetStatus,
          trackCode: track_code,
          clientName: client_name,
        });
      }

      return res.status(200).json({
        success: true,
        event: 'order_status_changed',
        event_id: eventId || payload.event_id,
        order_id,
        new_status: targetStatus,
        status: targetStatus,
        track_code: track_code || null,
        message: `Order ${order_doc_number || order_id} status updated to '${targetStatus}'.`,
        processed_at: new Date().toISOString(),
      });
    }

    // ───────────────────────────────────────────────
    // 3. Событие: payment_received (Поступление оплаты)
    // ───────────────────────────────────────────────
    if (event === 'payment_received') {
      const { client_id, client_name, amount, currency, payment_doc_number, balance_usd, debt_usd } = payload;
      console.log(`[Webhook ERP: payment_received] Client: ${client_name} (ID ${client_id}) paid ${amount} ${currency || 'USD'} (Doc: ${payment_doc_number}). New balance: ${balance_usd}, Debt: ${debt_usd}`);

      // Сквозная трансляция в Realtime-шину браузеров
      await broadcastLiveUpdate('payment_received', {
        client_id,
        amount,
        balance_usd,
        debt_usd,
        timestamp,
      });

      // Сохраняем обновленный баланс в базу данных Supabase
      if (client_id) {
        try {
          await supabaseServer
            .from('partner_balances')
            .upsert({
              partner_id: String(client_id),
              balance: Number(debt_usd !== undefined ? -debt_usd : (balance_usd || 0)),
              currency: currency || 'USD',
              last_synced_at: new Date().toISOString(),
            }, { onConflict: 'partner_id' });

          if (debt_usd !== undefined) {
            await supabaseServer
              .from('profiles')
              .update({
                debt_usd: Number(debt_usd),
                updated_at: new Date().toISOString(),
              })
              .eq('partner_id', String(client_id));
          }
        } catch (dbErr) {
          console.warn('[Webhook ERP] partner_balances update notice:', dbErr);
        }
      }

      await recordAuditLog({
        eventType: 'payment_received',
        direction: 'inbound',
        status: 'success',
        source: 'ERP Webhook',
        payload: {
          event_id: eventId || payload.event_id,
          client_id,
          amount,
          balance_usd,
          debt_usd,
          payment_doc_number,
        },
      });

      return res.status(200).json({
        success: true,
        event: 'payment_received',
        event_id: eventId || payload.event_id,
        client_id,
        amount,
        balance_usd,
        debt_usd,
        message: `Payment of ${amount} ${currency || 'USD'} recorded for client ${client_id}.`,
        processed_at: new Date().toISOString(),
      });
    }

    // ───────────────────────────────────────────────
    // 4. Событие: partner_stock_released (Списание дилера)
    // ───────────────────────────────────────────────
    if (event === 'partner_stock_released') {
      const { partner_id, sku, released_qty, doc_number } = payload;
      console.log(`[Webhook ERP: partner_stock_released] Partner ${partner_id}: released ${released_qty} pcs of SKU ${sku} (Doc: ${doc_number})`);

      // Сквозная трансляция в Realtime-шину браузеров
      await broadcastLiveUpdate('partner_stock_released', {
        partner_id,
        sku,
        released_qty,
        timestamp,
      });

      await recordAuditLog({
        eventType: 'partner_stock_released',
        direction: 'inbound',
        status: 'success',
        source: 'ERP Webhook',
        payload: {
          event_id: eventId || payload.event_id,
          partner_id,
          sku,
          released_qty,
          doc_number,
        },
      });

      return res.status(200).json({
        success: true,
        event: 'partner_stock_released',
        event_id: eventId || payload.event_id,
        partner_id,
        sku,
        released_qty,
        processed_at: new Date().toISOString(),
      });
    }

    // ───────────────────────────────────────────────
    // 5. Событие: client_deactivated (Мгновенный отзыв доступа клиента)
    // ───────────────────────────────────────────────
    if (event === 'client_deactivated' || payload.access === 'disabled' || payload.status === 'inactive' || payload.status === 'archived' || payload.is_active === 0 || payload.is_active === false) {
      const counterpartyId = payload.counterparty_id || payload.client_id;
      if (counterpartyId) {
        console.log(`[Webhook ERP: client_deactivated] Revoking access for client ${counterpartyId}`);
        try {
          await supabaseServer
            .from('profiles')
            .update({ impersonation_enabled: false, updated_at: new Date().toISOString() })
            .eq('partner_id', String(counterpartyId));

          await broadcastLiveUpdate('client_deactivated', { counterparty_id: counterpartyId });
        } catch (dbErr) {
          console.warn('[Webhook ERP] Client deactivation notice:', dbErr);
        }
      }

      await recordAuditLog({
        eventType: 'client_deactivated',
        direction: 'inbound',
        status: 'success',
        source: 'ERP Webhook',
        payload: {
          event_id: eventId || payload.event_id,
          counterparty_id: counterpartyId,
        },
      });

      return res.status(200).json({
        success: true,
        event: 'client_deactivated',
        counterparty_id: counterpartyId,
        message: `Client ${counterpartyId} deactivated successfully.`,
        processed_at: new Date().toISOString(),
      });
    }

    // ───────────────────────────────────────────────
    // 6. Событие: client_synced (Активация клиента)
    // ───────────────────────────────────────────────
    if (event === 'client_synced') {
      const counterpartyId = payload.counterparty_id || payload.client_id;
      if (counterpartyId) {
        try {
          await supabaseServer
            .from('profiles')
            .update({ impersonation_enabled: true, updated_at: new Date().toISOString() })
            .eq('partner_id', String(counterpartyId));

          await broadcastLiveUpdate('client_synced', { counterparty_id: counterpartyId });
        } catch (dbErr) {
          console.warn('[Webhook ERP] Client sync notice:', dbErr);
        }
      }

      await recordAuditLog({
        eventType: 'client_synced',
        direction: 'inbound',
        status: 'success',
        source: 'ERP Webhook',
        payload: {
          event_id: eventId || payload.event_id,
          counterparty_id: counterpartyId,
        },
      });

      return res.status(200).json({
        success: true,
        event: 'client_synced',
        counterparty_id: counterpartyId,
        message: `Client ${counterpartyId} synced successfully.`,
        processed_at: new Date().toISOString(),
      });
    }

    // ───────────────────────────────────────────────
    // 7. Событие: discount_rules_updated (Обновление сетки скидок / типов цен)
    // ───────────────────────────────────────────────
    if (event === 'discount_rules_updated') {
      const rawRules = Array.isArray(payload.rules) ? payload.rules : (payload.rule ? [payload.rule] : []);
      let savedCount = 0;
      if (rawRules.length > 0 && supabaseServer) {
        try {
          for (const r of rawRules) {
            const priceTypeId = String(r.price_type_id || r.price_type || '').toLowerCase().trim();
            const discountPercent = Number(r.discount_percent ?? r.discount ?? 0);
            if (priceTypeId) {
              await supabaseServer
                .from('discount_rules')
                .upsert({
                  price_type_id: priceTypeId,
                  discount_percent: discountPercent,
                  is_active: r.is_active !== false,
                  valid_from: r.valid_from || new Date().toISOString(),
                  valid_to: r.valid_to || null,
                  updated_at: new Date().toISOString(),
                }, { onConflict: 'price_type_id' });
              savedCount++;
            }
          }
        } catch (ruleErr) {
          console.warn('[Webhook ERP] discount_rules upsert notice:', ruleErr);
        }
      }

      await broadcastLiveUpdate('discount_rules_updated', {
        rules_count: savedCount,
        timestamp,
      });

      await recordAuditLog({
        eventType: 'discount_rules_updated',
        direction: 'inbound',
        status: 'success',
        source: 'ERP Webhook',
        payload: {
          event_id: eventId || payload.event_id,
          saved_count: savedCount,
        },
      });

      return res.status(200).json({
        success: true,
        event: 'discount_rules_updated',
        saved_rules: savedCount,
        message: `Successfully synced ${savedCount} discount rules from ERP.`,
        processed_at: new Date().toISOString(),
      });
    }

    // Неизвестное событие
    return res.status(200).json({
      success: true,
      event,
      message: `Event '${event}' acknowledged.`,
      processed_at: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('[Webhook ERP] Error processing request:', err);
    return res.status(500).json({
      success: false,
      error: 'Internal server error processing webhook payload.',
      details: err?.message,
    });
  }
}
