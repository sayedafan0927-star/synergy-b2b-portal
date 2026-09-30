import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../../lib/logger';
import { recordAuditLog } from '../../audit/logs';

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

  // Клиент может обновлять только свой баланс, админ/менеджер — любой
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
      throw new Error(jsonData?.error || 'Некорректный ответ шлюза 1С');
    }

    const fin = jsonData.financials || {};
    const rawDebt = fin.total_debt_usd ?? jsonData.debt_usd ?? jsonData.total_debt_usd;
    const totalDebtUsd = rawDebt !== undefined
      ? Math.max(0, Number(rawDebt))
      : (typeof fin.balance_usd === 'number' && fin.balance_usd < 0 ? Math.abs(fin.balance_usd) : 0);

    const balanceUsd = typeof fin.balance_usd === 'number'
      ? Math.max(0, fin.balance_usd)
      : (typeof jsonData.balance_usd === 'number'
          ? Math.max(0, jsonData.balance_usd)
          : (totalDebtUsd === 0 && Number(jsonData.balance || 0) > 0 ? Number(jsonData.balance) : 0));
    const isOverdue = Boolean(fin.is_overdue || jsonData.is_overdue);
    const overdueDays = Number(fin.max_overdue_days || fin.overdue_days || 0);
    const refreshedAt = new Date().toISOString();

    // 1. Атомарно сохраняем в partner_balances
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

      // 2. Также обновляем поле debt_usd в профиле клиента для быстрого UI-селектора
      await supabase
        .from('profiles')
        .update({
          debt_usd: totalDebtUsd,
          updated_at: refreshedAt,
        })
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
      is_overdue: isOverdue,
      overdue_days: overdueDays,
      refreshed_at: refreshedAt,
      source: 'live_erp',
    });
  } catch (err: any) {
    logger.warn('[RefreshBalance] Live query failed, falling back to cached debt', {
      partnerId: effectivePartnerId,
      error: err?.message,
    });

    // Graceful fallback на локальный кэш
    let cachedBal: any = null;
    if (supabase) {
      const { data } = await supabase
        .from('partner_balances')
        .select('*')
        .eq('partner_id', effectivePartnerId)
        .maybeSingle();
      cachedBal = data;
    }

    res.status(200).json({
      success: true,
      partner_id: effectivePartnerId,
      balance_usd: Number(cachedBal?.balance || 0),
      total_debt_usd: Math.max(0, -Number(cachedBal?.balance || 0)),
      is_overdue: Boolean(cachedBal?.is_overdue),
      overdue_days: Number(cachedBal?.overdue_days || 0),
      refreshed_at: cachedBal?.last_synced_at || new Date().toISOString(),
      source: 'stale_cache_fallback',
      warning: 'Шлюз 1С временно недоступен; возвращены актуальные данные локального кэша.',
    });
  }
}
