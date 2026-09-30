import type { SupabaseClient } from '@supabase/supabase-js';
import { recordAuditLog } from '../../audit/logs';

export async function handleCurrencyRateUpdated(
  payload: any,
  supabaseServer: SupabaseClient | null,
  eventId: string | undefined,
  timestamp: string,
  broadcastLiveUpdate: (event: string, payload: any) => Promise<void>,
) {
  const rawRate =
    payload.exchange_rate_usd_kzt ??
    payload.rate_usd_kzt ??
    payload.exchange_rate ??
    payload.rate ??
    payload.rates?.USD_KZT ??
    payload.rates?.usd_kzt;

  const numericRate = Number(rawRate);

  if (isNaN(numericRate) || numericRate < 100 || numericRate > 2000) {
    const errorMsg = `Invalid exchange rate value: ${rawRate}. Rate must be a valid number between 100.0 and 2000.0 KZT/USD.`;
    await recordAuditLog({
      eventType: 'currency_rate_rejected',
      direction: 'inbound',
      status: 'error',
      statusCode: 422,
      source: 'ERP Webhook',
      errorMessage: errorMsg,
      payload: { event_id: eventId || payload.event_id, rawRate },
    }).catch(() => {});

    return {
      success: false,
      error: errorMsg,
      code: 'INVALID_EXCHANGE_RATE_BOUNDS',
    };
  }

  const roundedRate = Math.round(numericRate * 10000) / 10000;
  const nowIso = new Date().toISOString();

  if (supabaseServer) {
    try {
      const { data: existing } = await supabaseServer
        .from('display_settings')
        .select('id')
        .limit(1)
        .maybeSingle();

      if (existing) {
        await supabaseServer
          .from('display_settings')
          .update({
            exchange_rate_usd_kzt: roundedRate,
            updated_at: nowIso,
          })
          .eq('id', existing.id);
      } else {
        await supabaseServer
          .from('display_settings')
          .insert({
            exchange_rate_usd_kzt: roundedRate,
            updated_at: nowIso,
          });
      }
    } catch (dbErr: any) {
      console.warn('[CurrencyRateHandler] Database update error:', dbErr?.message);
    }
  }

  // Транслируем всем подключенным клиентам и дилерам через Realtime
  await broadcastLiveUpdate('currency_rate_updated', {
    exchange_rate_usd_kzt: roundedRate,
    timestamp: timestamp || nowIso,
  });

  await recordAuditLog({
    eventType: 'currency_rate_updated',
    direction: 'inbound',
    status: 'success',
    source: 'ERP Webhook',
    payload: {
      event_id: eventId || payload.event_id,
      exchange_rate_usd_kzt: roundedRate,
      effective_timestamp: timestamp || nowIso,
    },
  });

  return {
    success: true,
    event: 'currency_rate_updated',
    exchange_rate_usd_kzt: roundedRate,
    message: `Official exchange rate updated to ${roundedRate} KZT/USD from ERP CDC.`,
    processed_at: nowIso,
  };
}
