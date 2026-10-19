import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../../lib/logger';
import { recordAuditLog } from '../../audit/logs';
import { extractAuthoritativeClientFinancials } from './debtHandler';

export interface RefreshBalanceContext {
  req: VercelRequest;
  res: VercelResponse;
  callerAuth: any;
  correlationId: string;
  supabase: SupabaseClient;
  targetErpUrl: string;
  serverErpKey: string;
}

/**
 * Принудительный онлайн-опрос свежего финансового баланса контрагента из 1C:ERP
 * Обходит локальный кэш, обновляет PostgreSQL partner_balances и возвращает живые данные.
 */
export async function handleRefreshClientBalance(ctx: RefreshBalanceContext): Promise<void> {
  const { req, res, callerAuth, correlationId, supabase, targetErpUrl, serverErpKey } = ctx;

  const requestedPartnerId = String(
    req.body?.partner_id ||
    req.query.partner_id ||
    req.body?.client_id ||
    req.query.client_id ||
    callerAuth.partnerId ||
    ''
  ).trim();

  if (callerAuth && callerAuth.role === 'supplier' && !callerAuth.isServer) {
    res.status(403).json({
      success: false,
      code: 'FORBIDDEN_SUPPLIER_FINANCIAL_ACCESS',
      error: 'Forbidden: Учетные записи поставщиков не имеют доступа к финансовым балансам дилеров.',
    });
    return;
  }

  // Anti-IDOR & B2B RBAC: Клиент может обновлять только свой баланс, закупщикам доступ запрещен
  if (callerAuth && callerAuth.role === 'client' && !callerAuth.isServer) {
    if (callerAuth.b2bRole === 'buyer') {
      res.status(403).json({
        success: false,
        code: 'FORBIDDEN_FINANCIAL_ACCESS',
        error: 'Доступ к финансовым взаиморасчетам и задолженности компании ограничен для роли закупщика.',
      });
      return;
    }
    if (!callerAuth.partnerId) {
      res.status(403).json({
        success: false,
        error: 'Доступ запрещен: партнерский ID клиента не привязан к профилю.',
      });
      return;
    }
  }

  const effectivePartnerId = (callerAuth.role === 'client' && callerAuth.partnerId)
    ? String(callerAuth.partnerId)
    : requestedPartnerId;

  if (!effectivePartnerId) {
    res.status(400).json({
      success: false,
      error: 'partner_id is required for balance refresh',
    });
    return;
  }

  // Multi-Tenancy Scoping: Менеджеры могут обновлять баланс только прикрепленных контрагентов своего региона
  if (callerAuth && (callerAuth.role === 'manager_rm' || callerAuth.role === 'manager_lm') && !callerAuth.isServer) {
    if (effectivePartnerId && callerAuth.userId) {
      const allowedMgrIds = [String(callerAuth.userId), callerAuth.managerId ? String(callerAuth.managerId) : ''].filter(Boolean);
      const { data: clientManaged } = await supabase
        .from('profiles')
        .select('id, manager_id')
        .eq('partner_id', effectivePartnerId)
        .in('manager_id', allowedMgrIds)
        .maybeSingle();

      if (!clientManaged) {
        res.status(403).json({
          success: false,
          error: 'Доступ запрещен: данный контрагент не относится к вашей региональной зоне ответственности.',
          code: 'FORBIDDEN_COUNTERPARTY_SCOPE',
        });
        return;
      }
    }
  }

  const startTime = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3500); // 3.5s быстрый опрос

  try {
    const erpUrl = `${targetErpUrl}?action=client_debt&counterparty_id=${encodeURIComponent(effectivePartnerId)}`;
    const erpRes = await fetch(erpUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'X-Portal-Key': serverErpKey,
        'X-Correlation-ID': correlationId,
      },
      signal: controller.signal,
    }).finally(() => clearTimeout(timeoutId));

    if (!erpRes.ok) {
      throw new Error(`ERP returned HTTP ${erpRes.status}`);
    }

    const jsonData = await erpRes.json().catch(() => null);
    if (!jsonData || !jsonData.success) {
      throw new Error(jsonData?.error || 'Некорректный ответ шлюза Synergy ERP');
    }

    const fin = jsonData.financials || {};
    const rawDebt = fin.total_debt_usd ?? fin.debt_usd ?? jsonData.total_debt_usd ?? jsonData.debt_usd;
    const parsedFin = extractAuthoritativeClientFinancials(jsonData);
    const totalDebtUsd = rawDebt !== undefined ? Math.max(0, Number(rawDebt)) : parsedFin.totalDebtUsd;
    const balanceUsd = parsedFin.signedBalanceUsd;
    const isOverdue = parsedFin.isOverdue;
    const overdueDays = parsedFin.overdueDays;
    const refreshedAt = new Date().toISOString();

    // 1. Атомарно сохраняем знаковое сальдо в partner_balances (отрицательное = долг, положительное = аванс)
    if (supabase) {
      await supabase
        .from('partner_balances')
        .upsert({
          partner_id: effectivePartnerId,
          balance: balanceUsd,
          is_overdue: isOverdue,
          overdue_days: overdueDays,
          currency: 'USD',
          last_synced_at: refreshedAt,
        }, { onConflict: 'partner_id' });

      // 2. Также обновляем поле debt_usd, overdue_days и credit_limit_usd (из contracts[0] / limit_sum_usd) в профиле контрагента
      const firstContract = Array.isArray(jsonData.contracts) && jsonData.contracts.length > 0 ? jsonData.contracts[0] : null;
      const erpCreditLimit = parsedFin.creditLimitUsd || (firstContract?.credit_limit_usd ?? firstContract?.limit_sum_usd ?? firstContract?.credit_limit);
      const profileUpdate: Record<string, any> = {
        debt_usd: totalDebtUsd,
        overdue_days: overdueDays,
        updated_at: refreshedAt,
      };
      if (erpCreditLimit !== undefined && !isNaN(Number(erpCreditLimit)) && Number(erpCreditLimit) > 0) {
        profileUpdate.credit_limit_usd = Number(erpCreditLimit);
      }
      await supabase
        .from('profiles')
        .update(profileUpdate)
        .eq('partner_id', effectivePartnerId);
    }

    await recordAuditLog({
      eventType: 'refresh_balance_success',
      direction: 'outbound',
      status: 'success',
      statusCode: 200,
      latencyMs: Date.now() - startTime,
      source: 'Financial API',
      correlationId,
      payload: { partner_id: effectivePartnerId, balanceUsd, totalDebtUsd, isOverdue },
    });

    res.status(200).json({
      success: true,
      partner_id: effectivePartnerId,
      balance_usd: balanceUsd,
      total_debt_usd: totalDebtUsd,
      overdue_usd: parsedFin.overdueUsd,
      credit_limit_usd: parsedFin.creditLimitUsd,
      is_overdue: isOverdue,
      overdue_days: overdueDays,
      contracts: parsedFin.normalizedContracts,
      unpaid_invoices: Array.isArray(jsonData.unpaid_invoices) ? jsonData.unpaid_invoices : [],
      refreshed_at: refreshedAt,
      source: 'live_erp',
    });
  } catch (err: any) {
    logger.warn('[RefreshBalance] Live query failed, falling back to cached debt', {
      partnerId: effectivePartnerId,
      error: err?.message,
    });

    // Graceful fallback на локальный кэш (partner_balances + profiles.debt_usd)
    let cachedBal: any = null;
    let profileRow: any = null;
    if (supabase) {
      const [balRes, profRes] = await Promise.all([
        supabase.from('partner_balances').select('*').eq('partner_id', effectivePartnerId).maybeSingle(),
        supabase.from('profiles').select('debt_usd, credit_limit_usd, overdue_days').eq('partner_id', effectivePartnerId).limit(1).maybeSingle(),
      ]);
      cachedBal = balRes.data;
      profileRow = profRes.data;
    }

    const rawBal = Number(cachedBal?.balance || 0);
    const canonicalDebt = Math.max(Number(profileRow?.debt_usd || 0), Math.max(0, -rawBal));

    res.status(200).json({
      success: true,
      partner_id: effectivePartnerId,
      balance_usd: rawBal !== 0 ? rawBal : -canonicalDebt,
      total_debt_usd: canonicalDebt,
      credit_limit_usd: Number(profileRow?.credit_limit_usd || 0),
      is_overdue: Boolean(cachedBal?.is_overdue || Number(profileRow?.overdue_days || 0) > 0),
      overdue_days: Math.max(Number(cachedBal?.overdue_days || 0), Number(profileRow?.overdue_days || 0)),
      refreshed_at: cachedBal?.last_synced_at || new Date().toISOString(),
      source: 'stale_cache_fallback',
      warning: 'Шлюз Synergy ERP временно недоступен; возвращены актуальные данные локального кэша.',
    });
  }
}
