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

export async function resolveTargetPartnerPriceType(
  callerAuth: any,
  rawPayload: any,
  safeContractId: string | null,
  supabase: SupabaseClient,
): Promise<string> {
  let userPriceType = callerAuth.priceType || 'wholesale';
  const targetPartnerId = callerAuth.role === 'client'
    ? callerAuth.partnerId
    : (rawPayload?.partner_id || rawPayload?.client_id || callerAuth.partnerId);

  if (callerAuth.role !== 'client' && targetPartnerId) {
    try {
      const { data: prof } = await supabase
        .from('profiles')
        .select('price_type')
        .eq('partner_id', String(targetPartnerId))
        .limit(1)
        .maybeSingle();
      if (prof?.price_type) {
        userPriceType = String(prof.price_type);
      }
    } catch {}
  }

  if (safeContractId) {
    try {
      const { data: contractData } = await supabase
        .from('contracts')
        .select('price_type, partner_id, status')
        .eq('id', safeContractId)
        .maybeSingle();
      if (contractData?.price_type && (!targetPartnerId || String(contractData.partner_id) === String(targetPartnerId))) {
        userPriceType = String(contractData.price_type);
      }
    } catch {}
  }

  return userPriceType;
}

export async function validateClientCreditExposure(
  callerAuth: any,
  finalTotalAmount: number,
  supabase: SupabaseClient,
  contractId?: string | null,
  rawPartnerId?: string | number | null,
): Promise<ExposureCheckResult> {
  const effectivePartnerId = callerAuth.role === 'client'
    ? callerAuth.partnerId
    : (rawPartnerId || callerAuth.partnerId);

  if (callerAuth.role !== 'client' && !effectivePartnerId) {
    return { blocked: false };
  }

  try {
    const { data: userProfile } = await supabase
      .from('profiles')
      .select('credit_limit_usd, debt_usd, is_blocked_for_orders, overdue_days, impersonation_enabled, status, manager_id')
      .eq('partner_id', String(effectivePartnerId))
      .limit(1)
      .maybeSingle();

    // Anti-BOLA: Менеджер филиала может оформлять заказы только за закрепленных за ним контрагентов
    if (
      (callerAuth.role === 'manager_rm' || callerAuth.role === 'manager_lm') &&
      !callerAuth.isServer &&
      callerAuth.userId &&
      userProfile?.manager_id &&
      String(userProfile.manager_id) !== String(callerAuth.userId) &&
      (!callerAuth.managerId || String(userProfile.manager_id) !== String(callerAuth.managerId))
    ) {
      return {
        blocked: true,
        statusCode: 403,
        blockCode: 'FORBIDDEN_COUNTERPARTY_SCOPE',
        blockError: 'Доступ запрещен: данный контрагент закреплен за другим региональным менеджером (Anti-BOLA).',
      };
    }

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

    const { data: partnerBal } = effectivePartnerId
      ? await supabase
          .from('partner_balances')
          .select('balance, overdue_days, is_overdue')
          .eq('partner_id', String(effectivePartnerId))
          .maybeSingle()
      : { data: null as any };

    const effectiveOverdueDays = Math.max(
      Number(userProfile?.overdue_days || 0),
      Number(partnerBal?.overdue_days || 0)
    );

    if (effectiveOverdueDays > 14) {
      return {
        blocked: true,
        statusCode: 403,
        blockCode: 'OVERDUE_DEBT',
        blockError: `У вас имеется просроченная задолженность (${effectiveOverdueDays} дн.). Отгрузка заблокирована до погашения.`,
      };
    }

    let clientCreditLimit = Number(userProfile?.credit_limit_usd || 0);
    if (contractId) {
      try {
        const { data: contractRow } = await supabase
          .from('contracts')
          .select('credit_limit_usd, status')
          .eq('id', contractId)
          .maybeSingle();
        if (contractRow && Number(contractRow.credit_limit_usd) > 0) {
          clientCreditLimit = Number(contractRow.credit_limit_usd);
        }
      } catch {}
    }

    let currentDebt = Math.max(0, Number((userProfile as any)?.debt_usd || 0));
    if (!currentDebt && partnerBal && typeof partnerBal.balance === 'number' && partnerBal.balance < 0) {
      currentDebt = Math.abs(partnerBal.balance);
    }

    // 4. Подсчет суммы незавершенных заказов («в пути»), включая ожидающие согласования (waiting_approval)
    let inFlightOrdersSum = 0;
    const partnerKey = effectivePartnerId ? String(effectivePartnerId).trim() : null;
    if (partnerKey || callerAuth.userId) {
      try {
        let q = supabase
          .from('orders')
          .select('total_amount')
          .in('status', ['pending', 'processing_sync', 'waiting_approval', 'confirmed', 'processing'])
          .is('parent_order_id', null);

        if (partnerKey) {
          q = q.eq('partner_id', partnerKey);
        } else {
          q = q.eq('user_id', callerAuth.userId);
        }

        const { data: inFlightOrders } = await q;

        if (inFlightOrders && inFlightOrders.length > 0) {
          inFlightOrdersSum = inFlightOrders.reduce((sum, o) => sum + Number(o.total_amount || 0), 0);
        }
      } catch (inFlightErr) {
        logger.warn('[Order] In-flight orders lookup notice:', inFlightErr as Error);
      }
    }

    const totalExposure = Math.round((currentDebt + inFlightOrdersSum + finalTotalAmount) * 100) / 100;
    if (clientCreditLimit > 0 && totalExposure > clientCreditLimit) {
      return {
        blocked: false,
        requiresApproval: true,
        complianceReason: `Превышен кредитный лимит с учетом текущей задолженности и заказов в пути (Долг: $${currentDebt} + В обработке: $${inFlightOrdersSum} + Заказ: $${finalTotalAmount} = $${totalExposure} > Лимит: $${clientCreditLimit})`,
      };
    }
  } catch (profErr) {
    logger.warn('[Order] Compliance check notice (activating fail-safe approval):', profErr as Error);
    return {
      blocked: false,
      requiresApproval: true,
      complianceReason: 'Требуется согласование менеджера (резервная проверка кредитного лимита)',
    };
  }

  return { blocked: false };
}
