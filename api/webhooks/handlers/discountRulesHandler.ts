import type { SupabaseClient } from '@supabase/supabase-js';
import { recordAuditLog } from '../../audit/logs';
import { invalidateCatalogCache } from '../../lib/catalogCache';

export async function handleDiscountRulesUpdated(
  payload: any,
  supabaseServer: SupabaseClient | null,
  eventId: string | undefined,
  timestamp: string,
  broadcastLiveUpdate: (event: string, payload: any) => Promise<void>,
) {
  const rawRules = Array.isArray(payload.rules) ? payload.rules : payload.rule ? [payload.rule] : [];
  let savedCount = 0;
  if (rawRules.length > 0 && supabaseServer) {
    try {
      for (const r of rawRules) {
        const priceTypeId = String(r.price_type_id || r.price_type || '').toLowerCase().trim();
        const rawPercent = Number(r.discount_percent ?? r.discount ?? 0);
        // Безопасные границы скидок: от 0% до 90%
        const discountPercent = Math.max(0, Math.min(90, isNaN(rawPercent) ? 0 : Math.round(rawPercent * 100) / 100));
        if (priceTypeId) {
          await supabaseServer.from('discount_rules').upsert({
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
      // Сбрасываем кэш каталога, чтобы новые скидки применились мгновенно
      await invalidateCatalogCache();
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

  return {
    success: true,
    event: 'discount_rules_updated',
    saved_rules: savedCount,
    message: `Successfully synced ${savedCount} discount rules from ERP.`,
    processed_at: new Date().toISOString(),
  };
}
