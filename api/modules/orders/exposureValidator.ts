import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../../lib/logger';

export interface ExposureCheckResult {
  blocked: boolean;
  blockCode?: string;
  blockError?: string;
  statusCode?: number;
  requiresApproval?: boolean;
  complianceReason?: string;
}

export async function validateClientCreditExposure(
  callerAuth: any,
  finalTotalAmount: number,
  supabase: SupabaseClient,
): Promise<ExposureCheckResult> {
  if (callerAuth.role !== 'client') {
    return { blocked: false };
  }

  try {
    const { data: userProfile } = await supabase
      .from('profiles')
      .select('credit_limit_usd, is_blocked_for_orders, overdue_days, impersonation_enabled, status')
      .eq('partner_id', callerAuth.partnerId)
      .maybeSingle();

    if (userProfile?.impersonation_enabled === false || userProfile?.status === 'inactive') {
      return {
        blocked: true,
        statusCode: 403,
        blockError: 'Создание заказа заблокировано: учетная запись контрагента деактивирована в ERP.',
      };
    }

    if (userProfile?.is_blocked_for_orders) {
      return {
        blocked: true,
        statusCode: 403,
        blockCode: 'CLIENT_BLOCKED',
        blockError: 'Оформление новых заказов временно заблокировано в связи с непогашенной задолженностью.',
      };
    }

    if (userProfile?.overdue_days && userProfile.overdue_days > 14) {
      return {
        blocked: true,
        statusCode: 403,
        blockCode: 'OVERDUE_DEBT',
        blockError: `У вас имеется просроченная задолженность (${userProfile.overdue_days} дн.). Отгрузка заблокирована до погашения.`,
      };
    }

    const clientCreditLimit = Number(userProfile?.credit_limit_usd || 0);
    let currentDebt = Math.max(0, Number((userProfile as any)?.debt_usd || 0));
    if (!currentDebt && callerAuth.partnerId) {
      const { data: pBal } = await supabase
        .from('partner_balances')
        .select('balance')
        .eq('partner_id', String(callerAuth.partnerId))
        .maybeSingle();
      if (pBal && typeof pBal.balance === 'number' && pBal.balance < 0) {
        currentDebt = Math.abs(pBal.balance);
      }
    }

    const totalExposure = Math.round((currentDebt + finalTotalAmount) * 100) / 100;
    if (clientCreditLimit > 0 && totalExposure > clientCreditLimit) {
      return {
        blocked: false,
        requiresApproval: true,
        complianceReason: `Превышен кредитный лимит с учетом текущей задолженности (Долг: $${currentDebt} + Заказ: $${finalTotalAmount} = $${totalExposure} > Лимит: $${clientCreditLimit})`,
      };
    }
  } catch (profErr) {
    logger.warn('[Order] Compliance check notice:', profErr as Error);
  }

  return { blocked: false };
}
