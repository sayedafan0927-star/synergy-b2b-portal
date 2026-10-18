/**
 * Enterprise Financial & Debt Handler with L2 Database Caching
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../../lib/logger';

export interface NormalizedErpFinancials {
  totalDebtUsd: number;
  signedBalanceUsd: number;
  overdueUsd: number;
  overdueDays: number;
  isOverdue: boolean;
  creditLimitUsd: number;
  unpaidDocsCount: number;
  normalizedContracts: any[];
}

/**
 * Извлекает и нормализует финансовые показатели и договоры из ответа 1C:ERP (action=client_debt / reconcile_all_balances).
 * Учитывает специфику 1С: лимиты в договорах могут приходить как limit_sum_usd, а техническая заглушка $1 игнорируется.
 */
export function extractAuthoritativeClientFinancials(erpData: any, fallbackCreditLimit = 0): NormalizedErpFinancials {
  const fin = erpData?.financials || {};
  const rawDebt = fin.total_debt_usd ?? erpData?.total_debt_usd ?? fin.debt_usd ?? erpData?.debt_usd ?? erpData?.debt;
  const rawBal = fin.balance_usd ?? erpData?.balance_usd ?? erpData?.saldo ?? erpData?.balance;

  const totalDebtUsd = rawDebt !== undefined && rawDebt !== null
    ? Math.max(0, Number(rawDebt) || 0)
    : (typeof rawBal === 'number' && rawBal < 0 ? Math.abs(rawBal) : 0);

  let signedBalanceUsd = typeof rawBal === 'number' && !isNaN(rawBal)
    ? Number(rawBal)
    : -totalDebtUsd;
  if (totalDebtUsd > 0 && signedBalanceUsd === 0) {
    signedBalanceUsd = -totalDebtUsd;
  }

  const overdueUsd = Math.max(0, Number(fin.overdue_usd ?? erpData?.overdue_usd ?? erpData?.overdue ?? 0) || 0);
  const overdueDays = Math.max(0, Number(fin.max_overdue_days ?? fin.overdue_days ?? erpData?.max_overdue_days ?? erpData?.overdue_days ?? 0) || 0);
  const isOverdue = Boolean(fin.is_overdue || erpData?.is_overdue || overdueUsd > 0 || overdueDays > 0);
  const unpaidDocsCount = Math.max(
    0,
    Number(fin.unpaid_docs_count ?? (Array.isArray(erpData?.unpaid_invoices) ? erpData.unpaid_invoices.length : 0)) || 0
  );

  const rawContracts = Array.isArray(erpData?.contracts) ? erpData.contracts : [];
  const normalizedContracts = rawContracts.map((c: any) => {
    const rawContractLimit = Number(c.credit_limit_usd ?? c.limit_sum_usd ?? c.credit_limit ?? 0) || 0;
    const effectiveContractLimit = rawContractLimit > 1 ? rawContractLimit : 0;
    return {
      ...c,
      contract_number: c.contract_number || c.name || `Договор #${c.id || ''}`,
      contract_type: c.contract_type || (String(c.name || '').toLowerCase().includes('комисс') ? 'consignment' : 'deferred'),
      credit_limit_usd: effectiveContractLimit,
      limit_sum_usd: effectiveContractLimit,
      payment_delay_days: Number(c.payment_delay_days ?? c.limit_days ?? 0) || 0,
      limit_days: Number(c.limit_days ?? c.payment_delay_days ?? 0) || 0,
      debt_usd: Math.max(0, Number(c.debt_usd ?? 0) || 0),
      overdue_usd: Math.max(0, Number(c.overdue_usd ?? 0) || 0),
      overdue_days: Math.max(0, Number(c.overdue_days ?? 0) || 0),
      status: c.status || 'active',
    };
  });

  let creditLimitUsd = Math.max(
    0,
    Number(erpData?.client?.credit_limit_usd ?? erpData?.credit_limit_usd ?? fin.credit_limit_usd ?? 0) || 0
  );
  if (creditLimitUsd <= 1 && normalizedContracts.length > 0) {
    const contractsSum = normalizedContracts.reduce((sum: number, c: any) => sum + (Number(c.credit_limit_usd) || 0), 0);
    if (contractsSum > 0) {
      creditLimitUsd = contractsSum;
    }
  }
  if (creditLimitUsd <= 0 && fallbackCreditLimit > 0) {
    creditLimitUsd = fallbackCreditLimit;
  }

  return {
    totalDebtUsd: Math.round(totalDebtUsd * 100) / 100,
    signedBalanceUsd: Math.round(signedBalanceUsd * 100) / 100,
    overdueUsd: Math.round(overdueUsd * 100) / 100,
    overdueDays,
    isOverdue,
    creditLimitUsd: Math.round(creditLimitUsd * 100) / 100,
    unpaidDocsCount,
    normalizedContracts,
  };
}

export async function handleCachedClientDebt(
  req: VercelRequest,
  res: VercelResponse,
  supabase: SupabaseClient,
  callerAuth?: any
): Promise<boolean> {
  const isRefresh =
    req.query.refresh === 'true' ||
    req.query.refresh === '1' ||
    req.query.include_invoices === '1';
  let pId = String(req.query.partner_id || req.query.counterparty_id || req.query.client_id || (req.body && (req.body.partner_id || req.body.counterparty_id || req.body.client_id)) || '').trim();

  // Anti-IDOR & B2B RBAC: Если запрашивает оптовый клиент, он имеет доступ ТОЛЬКО к своим финансовым данным
  if (callerAuth && callerAuth.role === 'client' && !callerAuth.isServer) {
    if (callerAuth.b2bRole === 'buyer') {
      res.status(403).json({
        success: false,
        code: 'FORBIDDEN_FINANCIAL_ACCESS',
        error: 'Доступ к финансовым взаиморасчетам и задолженности компании ограничен для роли закупщика.',
      });
      return true;
    }
    const callerPartnerId = String(callerAuth.partnerId || '');
    if (!callerPartnerId) {
      res.status(403).json({ success: false, error: 'Доступ запрещен: партнерский ID клиента не привязан к профилю.' });
      return true;
    }
    if (pId && pId !== callerPartnerId) {
      res.status(403).json({ success: false, error: 'Доступ запрещен: просмотр задолженности других контрагентов запрещен (Anti-IDOR Guard).' });
      return true;
    }
    pId = callerPartnerId;
  }

  // Multi-Tenancy Scoping: Менеджеры могут просматривать только прикрепленных контрагентов
  if (callerAuth && (callerAuth.role === 'manager_rm' || callerAuth.role === 'manager_lm') && !callerAuth.isServer) {
    if (pId && callerAuth.userId) {
      const { data: clientManaged } = await supabase
        .from('profiles')
        .select('id')
        .eq('partner_id', pId)
        .eq('manager_id', callerAuth.userId)
        .maybeSingle();

      if (!clientManaged) {
        res.status(403).json({
          success: false,
          error: 'Доступ запрещен: данный контрагент не относится к вашей региональной зоне ответственности.',
          code: 'FORBIDDEN_COUNTERPARTY_SCOPE',
        });
        return true;
      }
    }
  }

  // Гарантируем проброс counterparty_id для совместимости с api_portal.php?action=client_debt
  if (pId) {
    req.query.counterparty_id = pId;
    req.query.partner_id = pId;
  }

  if (pId && !isRefresh) {
    try {
      const [{ data: cachedBal }, { data: profileRow }] = await Promise.all([
        supabase.from('partner_balances').select('*').eq('partner_id', pId).maybeSingle(),
        supabase.from('profiles').select('full_name, company_name, phone, debt_usd, credit_limit_usd, overdue_days, is_blocked_for_shipment').eq('partner_id', pId).limit(1).maybeSingle(),
      ]);

      if (cachedBal) {
        const syncAgeMs = cachedBal.last_synced_at ? Date.now() - new Date(cachedBal.last_synced_at).getTime() : Infinity;
        const isFresh = syncAgeMs < 5 * 60 * 1000;
        const rawBal = Number(cachedBal.balance || 0);
        const canonicalDebt = Math.max(Number(profileRow?.debt_usd || 0), Math.max(0, -rawBal));
        const effectiveOverdueDays = Math.max(Number(cachedBal.overdue_days || 0), Number(profileRow?.overdue_days || 0));
        const isOverdue = Boolean(cachedBal.is_overdue || effectiveOverdueDays > 0);
        const creditLimit = Number(profileRow?.credit_limit_usd || 0);
        res.setHeader('X-Cache', isFresh ? 'HIT' : 'STALE');
        res.setHeader('X-Cache-Age-Ms', String(syncAgeMs));
        res.status(200).json({
          success: true,
          found: true,
          client: {
            id: Number(pId) || pId,
            partner_id: pId,
            name: profileRow?.company_name || profileRow?.full_name || `Контрагент #${pId}`,
            phone: profileRow?.phone || '',
            debt_usd: canonicalDebt,
            credit_limit_usd: creditLimit,
            is_blocked_for_shipment: Boolean(profileRow?.is_blocked_for_shipment),
            is_overdue: isOverdue,
          },
          financials: {
            currency: 'USD',
            balance_usd: rawBal !== 0 ? rawBal : -canonicalDebt,
            total_debt_usd: canonicalDebt,
            overdue_usd: isOverdue ? canonicalDebt : 0,
            max_overdue_days: effectiveOverdueDays,
            overdue_days: effectiveOverdueDays,
            is_overdue: isOverdue,
            available_credit_usd: Math.max(0, creditLimit - canonicalDebt),
          },
          source: isFresh ? 'cache_partner_balances' : 'stale_partner_balances',
        });
        return true;
      }
    } catch (cacheErr) {
      logger.warn('[Financial Cache] Lookup warning:', cacheErr as Error);
    }
  }

  return false;
}

export async function handleDebtFallbackOnFailure(
  req: VercelRequest,
  res: VercelResponse,
  supabase: SupabaseClient
): Promise<boolean> {
  const pId = String(req.query.partner_id || req.query.counterparty_id || req.query.client_id || (req.body && (req.body.partner_id || req.body.counterparty_id || req.body.client_id)) || '').trim();
  if (pId) {
    try {
      const [{ data: cachedBal }, { data: profileRow }] = await Promise.all([
        supabase.from('partner_balances').select('*').eq('partner_id', pId).maybeSingle(),
        supabase.from('profiles').select('full_name, company_name, phone, debt_usd, credit_limit_usd, overdue_days, is_blocked_for_shipment').eq('partner_id', pId).limit(1).maybeSingle(),
      ]);

      if (cachedBal || profileRow) {
        const rawBal = Number(cachedBal?.balance || 0);
        const canonicalDebt = Math.max(Number(profileRow?.debt_usd || 0), Math.max(0, -rawBal));
        const effectiveOverdueDays = Math.max(Number(cachedBal?.overdue_days || 0), Number(profileRow?.overdue_days || 0));
        const isOverdue = Boolean(cachedBal?.is_overdue || effectiveOverdueDays > 0);
        const creditLimit = Number(profileRow?.credit_limit_usd || 0);
        res.setHeader('X-Cache', 'STALE_FALLBACK');
        res.status(200).json({
          success: true,
          found: true,
          client: {
            id: Number(pId) || pId,
            partner_id: pId,
            name: profileRow?.company_name || profileRow?.full_name || `Контрагент #${pId}`,
            phone: profileRow?.phone || '',
            debt_usd: canonicalDebt,
            credit_limit_usd: creditLimit,
            is_blocked_for_shipment: Boolean(profileRow?.is_blocked_for_shipment),
            is_overdue: isOverdue,
          },
          financials: {
            currency: 'USD',
            balance_usd: rawBal !== 0 ? rawBal : -canonicalDebt,
            total_debt_usd: canonicalDebt,
            overdue_usd: isOverdue ? canonicalDebt : 0,
            max_overdue_days: effectiveOverdueDays,
            overdue_days: effectiveOverdueDays,
            is_overdue: isOverdue,
            available_credit_usd: Math.max(0, creditLimit - canonicalDebt),
          },
          source: 'stale_db_fallback',
        });
        return true;
      }
    } catch (dbErr) {
      logger.warn('[Debt Fallback] DB Lookup error:', dbErr as Error);
    }
  }
  return false;
}
