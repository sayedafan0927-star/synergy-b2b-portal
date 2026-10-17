import type { SupabaseClient } from '@supabase/supabase-js';
import { recordAuditLog } from '../../audit/logs';
import { getRedisClient } from '../../lib/redis';

export async function handleClientDeactivated(
  payload: any,
  supabaseServer: SupabaseClient | null,
  eventId: string | undefined,
  broadcastLiveUpdate: (event: string, payload: any) => Promise<void>,
) {
  const counterpartyId = payload.counterparty_id || payload.client_id || payload.partner_id;
  if (counterpartyId && supabaseServer) {
    console.log(`[Webhook ERP: client_deactivated] Revoking access and blocking shipments for client ${counterpartyId}`);
    try {
      // 1. Блокируем отгрузки и отключаем имперсонацию в profiles
      await supabaseServer
        .from('profiles')
        .update({
          is_blocked_for_shipment: true,
          is_blocked_for_orders: true,
          impersonation_enabled: false,
          status: 'inactive',
          updated_at: new Date().toISOString(),
        })
        .eq('partner_id', String(counterpartyId));

      // 1.1. Освобождаем складские резервы по неотправленным заказам (pending / waiting_approval) деактивированного контрагента
      try {
        const { data: activeOrders } = await supabaseServer
          .from('orders')
          .select('id')
          .eq('partner_id', String(counterpartyId))
          .in('status', ['pending', 'waiting_approval'])
          .is('parent_order_id', null);

        if (Array.isArray(activeOrders) && activeOrders.length > 0) {
          for (const ord of activeOrders) {
            await supabaseServer.rpc('release_order_reservations', { p_order_id: ord.id }).catch(() => {});
          }
          const ids = activeOrders.map((o: any) => o.id);
          await supabaseServer
            .from('orders')
            .update({
              status: 'cancelled',
              reservations_released: true,
              notes: '[Авто-отмена: Контрагент деактивирован в ERP]',
              updated_at: new Date().toISOString(),
            })
            .or(`id.in.(${ids.join(',')}),parent_order_id.in.(${ids.join(',')})`);
        }
      } catch (relErr) {
        console.warn('[Webhook ERP] Notice releasing reservations for deactivated client:', relErr);
      }

      // 2. Вносим partnerId в черный список отозванных сессий в Redis на 24 часа
      const redis = getRedisClient();
      if (redis) {
        try {
          await redis.set(`revoked_partner:${counterpartyId}`, '1', { ex: 86400 });
        } catch (rErr) {
          console.warn('[Webhook ERP] Redis partner revocation warning:', rErr);
        }
      }

      // 3. Отправляем широковещательное событие для принудительного разлогинивания в браузере
      await broadcastLiveUpdate('client_deactivated', {
        counterparty_id: counterpartyId,
        is_blocked_for_shipment: true,
        force_logout: true,
      });
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
      is_blocked_for_shipment: true,
    },
  });

  return {
    success: true,
    event: 'client_deactivated',
    counterparty_id: counterpartyId,
    message: `Client ${counterpartyId} deactivated successfully (shipments blocked, sessions revoked).`,
    processed_at: new Date().toISOString(),
  };
}

export async function handleClientSynced(
  payload: any,
  supabaseServer: SupabaseClient | null,
  eventId: string | undefined,
  broadcastLiveUpdate: (event: string, payload: any) => Promise<void>,
) {
  const counterpartyId = payload.counterparty_id || payload.client_id || payload.partner_id;
  if (counterpartyId && supabaseServer) {
    try {
      const firstContract = Array.isArray(payload.contracts) && payload.contracts.length > 0 ? payload.contracts[0] : null;
      const resolvedPriceType = payload.price_type || firstContract?.price_type;
      const resolvedCreditLimit = payload.credit_limit_usd ?? firstContract?.credit_limit_usd ?? firstContract?.credit_limit;
      const resolvedDeferral = payload.payment_delay_days ?? payload.payment_deferral_days ?? firstContract?.payment_deferral_days;

      const updateData: Record<string, any> = {
        is_blocked_for_shipment: false,
        is_blocked_for_orders: false,
        impersonation_enabled: true,
        status: 'active',
        updated_at: new Date().toISOString(),
      };
      if (payload.name) {
        updateData.full_name = payload.name;
        updateData.company_name = payload.name;
      }
      if (payload.phone) updateData.phone = payload.phone;
      if (payload.city !== undefined) updateData.city = payload.city;
      if (payload.address !== undefined) updateData.address = payload.address;
      if (payload.bin !== undefined) updateData.bin_iin = payload.bin;
      if (resolvedPriceType) updateData.price_type = String(resolvedPriceType);
      if (resolvedCreditLimit !== undefined) updateData.credit_limit_usd = Number(resolvedCreditLimit) || 0;
      if (resolvedDeferral !== undefined) updateData.payment_delay_days = Number(resolvedDeferral) || 0;

      const { data: updatedRows } = await supabaseServer
        .from('profiles')
        .update(updateData)
        .eq('partner_id', String(counterpartyId))
        .select('id');

      // Если контрагент новый и еще не существовал в profiles — создаем запись
      if (!updatedRows || updatedRows.length === 0) {
        await supabaseServer
          .from('profiles')
          .upsert({
            partner_id: String(counterpartyId),
            erp_id: Number(counterpartyId) || null,
            role: 'client',
            full_name: payload.name || `Контрагент #${counterpartyId}`,
            company_name: payload.name || `Контрагент #${counterpartyId}`,
            phone: payload.phone || '',
            price_type: resolvedPriceType ? String(resolvedPriceType) : 'wholesale',
            ...updateData,
          }, { onConflict: 'partner_id' });
      }

      // Удаляем из черного списка Redis при активации
      const redis = getRedisClient();
      if (redis) {
        try {
          await redis.del(`revoked_partner:${counterpartyId}`);
        } catch {}
      }

      await broadcastLiveUpdate('client_synced', {
        counterparty_id: counterpartyId,
        is_blocked_for_shipment: false,
      });
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

  return {
    success: true,
    event: 'client_synced',
    counterparty_id: counterpartyId,
    message: `Client ${counterpartyId} synced successfully.`,
    processed_at: new Date().toISOString(),
  };
}

export async function handlePartnerStockReleased(
  payload: any,
  eventId: string | undefined,
  timestamp: string,
  broadcastLiveUpdate: (event: string, payload: any) => Promise<void>,
) {
  const { partner_id, sku, released_qty, doc_number } = payload;
  console.log(`[Webhook ERP: partner_stock_released] Partner ${partner_id}: released ${released_qty} pcs of SKU ${sku} (Doc: ${doc_number})`);

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

  return {
    success: true,
    event: 'partner_stock_released',
    event_id: eventId || payload.event_id,
    partner_id,
    sku,
    released_qty,
    processed_at: new Date().toISOString(),
  };
}
