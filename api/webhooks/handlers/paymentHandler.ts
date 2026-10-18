import type { SupabaseClient } from '@supabase/supabase-js';
import { recordAuditLog } from '../../audit/logs';
import { getRedisClient } from '../../lib/redis';

export async function handlePaymentReceived(
  payload: any,
  supabaseServer: SupabaseClient | null,
  eventId: string | undefined,
  timestamp: string,
  broadcastLiveUpdate: (event: string, payload: any) => Promise<void>,
) {
  const { client_name, currency, payment_doc_number } = payload;
  const paymentDoc = payment_doc_number || payload.payment_doc || 'ПП';
  let client_id = payload.counterparty_id || payload.partner_id || payload.client_id;
  const amount = Number(payload.amount_usd ?? payload.amount ?? 0);

  // Если partner_id не передан явно, ищем по номеру телефона
  if (!client_id && payload.client_phone && supabaseServer) {
    try {
      const { data: p } = await supabaseServer
        .from('profiles')
        .select('partner_id')
        .eq('phone', payload.client_phone)
        .maybeSingle();
      if (p?.partner_id) {
        client_id = p.partner_id;
      }
    } catch {}
  }

  // Канонический расчет финансового сальдо (Balance) и долга (Debt):
  // - Положительный баланс (> 0) = Аванс / переплата клиента
  // - Отрицательный баланс (< 0) = Задолженность клиента
  // - Долг (debt_usd) = строго неотрицательная величина (>= 0)
  let calculatedDebt = 0;
  let calculatedBalance = 0;

  const rawDebt = payload.new_total_debt_usd ?? payload.total_debt_usd ?? payload.debt_usd;
  const hasExplicitBalance = payload.new_balance_usd !== undefined || payload.balance_usd !== undefined;
  let hasAuthoritativeDebt = false;

  if (rawDebt !== undefined && rawDebt !== null) {
    const numericRawDebt = Number(rawDebt);
    calculatedDebt = Math.max(0, numericRawDebt);
    calculatedBalance = hasExplicitBalance
      ? Number(payload.new_balance_usd ?? payload.balance_usd)
      : (numericRawDebt < 0 ? Math.abs(numericRawDebt) : -calculatedDebt);
    hasAuthoritativeDebt = true;
  } else if (hasExplicitBalance) {
    const rawBal = Number(payload.new_balance_usd ?? payload.balance_usd ?? 0);
    calculatedBalance = rawBal;
    calculatedDebt = rawBal < 0 ? Math.abs(rawBal) : 0;
    hasAuthoritativeDebt = true;
  } else if (client_id && supabaseServer && amount > 0) {
    // Оплата без явного поля остатка долга: учитываем частичную оплату, полное погашение и переплату (аванс)
    try {
      const [{ data: existingBal }, { data: existingProf }] = await Promise.all([
        supabaseServer.from('partner_balances').select('balance').eq('partner_id', String(client_id)).maybeSingle(),
        supabaseServer.from('profiles').select('debt_usd').eq('partner_id', String(client_id)).limit(1).maybeSingle(),
      ]);
      const prevDebt = Math.max(0, Number(existingProf?.debt_usd || 0));
      const baseBalance = existingBal?.balance !== undefined && existingBal?.balance !== null
        ? Number(existingBal.balance)
        : -prevDebt;
      const netBalance = Math.round((baseBalance + amount) * 100) / 100;
      calculatedBalance = netBalance;
      calculatedDebt = netBalance < 0 ? Math.abs(netBalance) : Math.max(0, Math.round((prevDebt - amount) * 100) / 100);
      hasAuthoritativeDebt = true;
    } catch {}
  }

  const balance_usd = calculatedBalance;
  const debt_usd = calculatedDebt;

  console.log(
    `[Webhook ERP: payment_received] Client: ${client_name} (ID ${client_id}) paid ${amount} ${currency || 'USD'} (Doc: ${paymentDoc}). New balance: ${balance_usd}, Debt: ${debt_usd}`,
  );

  // Сквозная трансляция в Realtime-шину браузеров
  await broadcastLiveUpdate('payment_received', {
    client_id,
    partner_id: client_id,
    amount,
    balance_usd,
    new_balance_usd: balance_usd,
    debt_usd,
    timestamp,
  });

  // Сохраняем обновленный баланс в базу данных Supabase
  if (client_id && supabaseServer) {
    try {
      if (hasAuthoritativeDebt) {
        await supabaseServer
          .from('partner_balances')
          .upsert({
            partner_id: String(client_id),
            balance: calculatedBalance,
            currency: currency || 'USD',
            last_synced_at: new Date().toISOString(),
          }, { onConflict: 'partner_id' });
      }

      const profileUpdate: Record<string, any> = {
        updated_at: new Date().toISOString(),
      };
      if (hasAuthoritativeDebt) {
        profileUpdate.debt_usd = calculatedDebt;
      }
      const shouldUnblock =
        payload.is_blocked_for_shipment === false ||
        payload.unblock_shipment === true ||
        (hasAuthoritativeDebt && calculatedDebt === 0 && payload.is_blocked_for_shipment !== true);
      if (payload.is_blocked_for_shipment !== undefined || shouldUnblock) {
        profileUpdate.is_blocked_for_shipment = !shouldUnblock;
      }

      await supabaseServer
        .from('profiles')
        .update(profileUpdate)
        .eq('partner_id', String(client_id));

      if (shouldUnblock) {
        const redis = getRedisClient();
        if (redis) {
          await redis.del(`revoked_partner:${client_id}`).catch(() => {});
        }
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

  return {
    success: true,
    event: 'payment_received',
    event_id: eventId || payload.event_id,
    client_id,
    amount,
    balance_usd,
    debt_usd,
    message: `Payment of ${amount} ${currency || 'USD'} recorded for client ${client_id}.`,
    processed_at: new Date().toISOString(),
  };
}
