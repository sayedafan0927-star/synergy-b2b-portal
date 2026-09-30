import type { SupabaseClient } from '@supabase/supabase-js';
import { recordAuditLog } from '../../audit/logs';

export async function handlePaymentReceived(
  payload: any,
  supabaseServer: SupabaseClient | null,
  eventId: string | undefined,
  timestamp: string,
  broadcastLiveUpdate: (event: string, payload: any) => Promise<void>,
) {
  const { client_name, currency, payment_doc_number } = payload;
  const client_id = payload.partner_id || payload.client_id;
  const amount = Number(payload.amount_usd ?? payload.amount ?? 0);

  // Канонический расчет финансового сальдо (Balance) и долга (Debt):
  // - Положительный баланс (> 0) = Аванс / переплата клиента
  // - Отрицательный баланс (< 0) = Задолженность клиента
  // - Долг (debt_usd) = строго неотрицательная величина (>= 0)
  let calculatedDebt = 0;
  let calculatedBalance = 0;

  if (payload.debt_usd !== undefined && payload.debt_usd !== null) {
    calculatedDebt = Math.max(0, Number(payload.debt_usd));
    calculatedBalance = (payload.balance_usd !== undefined || payload.new_balance_usd !== undefined)
      ? Number(payload.new_balance_usd ?? payload.balance_usd)
      : -calculatedDebt;
  } else if (payload.new_balance_usd !== undefined || payload.balance_usd !== undefined) {
    const rawBal = Number(payload.new_balance_usd ?? payload.balance_usd ?? 0);
    calculatedBalance = rawBal;
    calculatedDebt = rawBal < 0 ? Math.abs(rawBal) : 0;
  }

  const balance_usd = calculatedBalance;
  const debt_usd = calculatedDebt;

  console.log(
    `[Webhook ERP: payment_received] Client: ${client_name} (ID ${client_id}) paid ${amount} ${currency || 'USD'} (Doc: ${payment_doc_number}). New balance: ${balance_usd}, Debt: ${debt_usd}`,
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
      await supabaseServer
        .from('partner_balances')
        .upsert({
          partner_id: String(client_id),
          balance: calculatedBalance,
          currency: currency || 'USD',
          last_synced_at: new Date().toISOString(),
        }, { onConflict: 'partner_id' });

      await supabaseServer
        .from('profiles')
        .update({
          debt_usd: calculatedDebt,
          updated_at: new Date().toISOString(),
        })
        .eq('partner_id', String(client_id));
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
