/**
 * Enterprise Financial & Debt Handler with L2 Database Caching
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../../lib/logger';

export async function handleCachedClientDebt(
  req: VercelRequest,
  res: VercelResponse,
  supabase: SupabaseClient,
  callerAuth?: any
): Promise<boolean> {
  const isRefresh = req.query.refresh === 'true' || req.query.refresh === '1';
  let pId = String(req.query.partner_id || req.query.counterparty_id || req.query.client_id || (req.body && (req.body.partner_id || req.body.counterparty_id || req.body.client_id)) || '').trim();

  // Anti-IDOR: Если запрашивает оптовый клиент, он имеет доступ ТОЛЬКО к своим финансовым данным
  if (callerAuth && callerAuth.role === 'client' && !callerAuth.isServer) {
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

  if (pId && !isRefresh) {
    try {
      const { data: cachedBal } = await supabase
        .from('partner_balances')
        .select('*')
        .eq('partner_id', pId)
        .maybeSingle();

      const syncAgeMs = cachedBal?.last_synced_at ? Date.now() - new Date(cachedBal.last_synced_at).getTime() : Infinity;
      if (cachedBal && syncAgeMs < 5 * 60 * 1000) {
        res.setHeader('X-Cache', 'HIT');
        res.setHeader('X-Cache-Age-Ms', String(syncAgeMs));
        res.status(200).json({
          success: true,
          found: true,
          client: {
            partner_id: pId,
            is_overdue: Boolean(cachedBal.is_overdue),
          },
          financials: {
            balance_usd: Number(cachedBal.balance || 0),
            total_debt_usd: Math.max(0, -Number(cachedBal.balance || 0)),
            is_overdue: Boolean(cachedBal.is_overdue),
            overdue_days: Number(cachedBal.overdue_days || 0),
          },
          source: 'cache_partner_balances',
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
      const { data: cachedBal } = await supabase
        .from('partner_balances')
        .select('*')
        .eq('partner_id', pId)
        .maybeSingle();

      if (cachedBal) {
        res.setHeader('X-Cache', 'STALE_FALLBACK');
        res.status(200).json({
          success: true,
          found: true,
          client: {
            partner_id: pId,
            is_overdue: Boolean(cachedBal.is_overdue),
          },
          financials: {
            balance_usd: Number(cachedBal.balance || 0),
            total_debt_usd: Math.max(0, -Number(cachedBal.balance || 0)),
            is_overdue: Boolean(cachedBal.is_overdue),
            overdue_days: Number(cachedBal.overdue_days || 0),
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
