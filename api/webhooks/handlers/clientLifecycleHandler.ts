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
          impersonation_enabled: false,
          updated_at: new Date().toISOString(),
        })
        .eq('partner_id', String(counterpartyId));

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
      const updateData: Record<string, any> = {
        is_blocked_for_shipment: false,
        impersonation_enabled: true,
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
      if (payload.credit_limit_usd !== undefined) updateData.credit_limit_usd = Number(payload.credit_limit_usd) || 0;
      if (payload.payment_delay_days !== undefined) updateData.payment_delay_days = Number(payload.payment_delay_days) || 0;

      await supabaseServer
        .from('profiles')
        .update(updateData)
        .eq('partner_id', String(counterpartyId));

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
