import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { recordAuditLog } from '../audit/logs';
import { applyCorrelationId } from '../lib/trace';
import { applyCorsHeaders } from '../lib/cors';
import { getErpApiKey, getTargetErpUrl } from '../lib/erpKey';
import { getRedisClient } from '../lib/redis';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
const CRON_SECRET = process.env.CRON_SECRET || process.env.PORTAL_SECRET_KEY || '';
const TARGET_ERP_URL = getTargetErpUrl();
const SERVER_ERP_KEY = getErpApiKey();

const supabase = (SUPABASE_URL && SUPABASE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })
  : null as any;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!applyCorsHeaders(req, res)) {
    return;
  }

  const correlationId = applyCorrelationId(req, res);

  // Авторизация крона: Bearer Secret или X-Cron-Key / X-Portal-Key
  const authHeader = req.headers['authorization'] || '';
  const cronKeyHeader = req.headers['x-cron-key'] || req.headers['x-portal-key'];

  const isAuthorized =
    (process.env.NODE_ENV !== 'production' && !CRON_SECRET) ||
    (CRON_SECRET && (cronKeyHeader === CRON_SECRET || authHeader === `Bearer ${CRON_SECRET}`));

  if (!isAuthorized) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized: Invalid or missing cron authorization token.',
    });
  }

  const startTime = Date.now();

  try {
    const limit = Math.min(Math.max(parseInt(String(req.query.limit || '50'), 10) || 50, 1), 250);
    const offset = Math.max(parseInt(String(req.query.offset || '0'), 10) || 0, 0);

    // 1. Извлекаем список активных B2B-контрагентов с partner_id с пагинацией
    const { data: clients, error: clientsErr } = await supabase
      .from('profiles')
      .select('id, partner_id, full_name, company_name, phone, debt_usd, credit_limit_usd, is_blocked_for_shipment')
      .not('partner_id', 'is', null)
      .eq('role', 'client')
      .range(offset, offset + limit - 1);

    if (clientsErr) {
      throw new Error(`Failed to fetch client profiles: ${clientsErr.message}`);
    }

    if (!clients || clients.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No active partner profiles found for reconciliation.',
        checked_partners: 0,
        discrepancies_fixed: 0,
        duration_ms: Date.now() - startTime,
        correlation_id: correlationId,
      });
    }

    // 2. Получаем текущие балансы из таблицы partner_balances строго для контрагентов текущего батча (Anti-1000-Row Truncation)
    const clientPartnerIds = clients.map((c: any) => c.partner_id).filter(Boolean);
    const { data: localBalances } = await supabase
      .from('partner_balances')
      .select('partner_id, balance, currency, last_synced_at')
      .in('partner_id', clientPartnerIds);

    const localBalanceMap = new Map<string, number>();
    if (localBalances) {
      for (const b of localBalances) {
        if (b.partner_id) {
          localBalanceMap.set(String(b.partner_id), Number(b.balance || 0));
        }
      }
    }

    let checkedCount = 0;
    let matchedCount = 0;
    let fixedDiscrepancies = 0;
    const discrepanciesList: any[] = [];

    // 3. Пакетная сверка балансов (Bulk Reconciliation: action=reconcile_all_balances)
    let bulkSucceeded = false;
    try {
      const bulkParams = new URLSearchParams({ action: 'reconcile_all_balances' });
      if (SERVER_ERP_KEY) bulkParams.set('portal_key', SERVER_ERP_KEY);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const bulkRes = await fetch(`${TARGET_ERP_URL}?${bulkParams.toString()}`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'X-Correlation-ID': correlationId,
        },
        signal: controller.signal,
      }).finally(() => clearTimeout(timeout));

      if (bulkRes.ok) {
        const bulkData = await bulkRes.json();
        if (bulkData?.success && Array.isArray(bulkData.balances)) {
          bulkSucceeded = true;
          const erpBalanceMap = new Map<string, any>();
          for (const b of bulkData.balances) {
            erpBalanceMap.set(String(b.counterparty_id), b);
          }

          for (const client of clients) {
            checkedCount++;
            const partnerId = String(client.partner_id);
            const erpItem = erpBalanceMap.get(partnerId);
            if (!erpItem) continue;

            const erpDebt = Math.max(0, Number(erpItem.total_debt_usd ?? erpItem.debt_usd ?? 0));
            const erpCreditLimit = Number(erpItem.credit_limit_usd ?? client.credit_limit_usd ?? 0);
            const erpBalance = Number(
              erpItem.balance_usd !== undefined
                ? Math.max(0, Number(erpItem.balance_usd))
                : (erpDebt === 0 && Number(erpItem.balance ?? 0) > 0 ? Number(erpItem.balance) : 0)
            );
            const isBlocked = Boolean(erpItem.is_blocked_for_shipment);

            const localDebt = Number(client.debt_usd || 0);
            const localBalance = localBalanceMap.get(partnerId) ?? 0;

            const debtDiff = Math.abs(localDebt - erpDebt);
            const balanceDiff = Math.abs(localBalance - erpBalance);

            if (debtDiff > 0.01 || balanceDiff > 0.01 || (client as any).is_blocked_for_shipment !== isBlocked) {
              fixedDiscrepancies++;

              await supabase
                .from('partner_balances')
                .upsert({
                  partner_id: partnerId,
                  balance: erpBalance,
                  currency: erpItem.currency || 'USD',
                  last_synced_at: new Date().toISOString(),
                }, { onConflict: 'partner_id' });

              await supabase
                .from('profiles')
                .update({
                  debt_usd: erpDebt,
                  credit_limit_usd: erpCreditLimit,
                  is_blocked_for_shipment: isBlocked,
                  updated_at: new Date().toISOString(),
                })
                .eq('id', client.id);

              if (isBlocked) {
                const redis = getRedisClient();
                if (redis) {
                  redis.set(`revoked_partner:${partnerId}`, '1', { ex: 86400 }).catch(() => {});
                }
              } else {
                const redis = getRedisClient();
                if (redis) {
                  redis.del(`revoked_partner:${partnerId}`).catch(() => {});
                }
              }

              discrepanciesList.push({
                partner_id: partnerId,
                company: client.company_name || client.full_name,
                local_debt: localDebt,
                erp_debt: erpDebt,
                local_balance: localBalance,
                erp_balance: erpBalance,
                is_blocked: isBlocked,
              });
            } else {
              matchedCount++;
            }
          }
        }
      }
    } catch (bulkErr) {
      console.warn('[Reconciliation] Bulk endpoint exception, falling back to per-client queries:', bulkErr);
    }

    // 4. Резервный режим поштучных запросов (если батч-эндпоинт недоступен)
    if (!bulkSucceeded) {
      for (const client of clients) {
        if (Date.now() - startTime > 45000) {
          console.warn('[Reconciliation] Time budget exceeded (45s), aborting remaining per-client reconciliations.');
          break;
        }
        checkedCount++;
        const partnerId = String(client.partner_id);

        try {
          const queryParams = new URLSearchParams({
            action: 'client_debt',
            counterparty_id: partnerId,
            partner_id: partnerId,
          });
          if (SERVER_ERP_KEY) {
            queryParams.set('portal_key', SERVER_ERP_KEY);
          }

          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 6000);

          const erpRes = await fetch(`${TARGET_ERP_URL}?${queryParams.toString()}`, {
            method: 'GET',
            headers: {
              'Accept': 'application/json',
              'X-Correlation-ID': correlationId,
            },
            signal: controller.signal,
          }).finally(() => clearTimeout(timeout));

          if (!erpRes.ok) {
            console.warn(`[Reconciliation] ERP returned ${erpRes.status} for partner ${partnerId}`);
            continue;
          }

          const debtData: any = await erpRes.json();
          if (!debtData || !debtData.success) {
            continue;
          }

          const erpDebt = Math.max(0, Number(debtData.financials?.total_debt_usd ?? debtData.debt_usd ?? 0));
          const erpCreditLimit = Number(debtData.client?.credit_limit_usd ?? debtData.credit_limit_usd ?? client.credit_limit_usd ?? 0);
          const erpBalance = Number(
            debtData.financials?.balance_usd !== undefined
              ? Math.max(0, Number(debtData.financials.balance_usd))
              : (erpDebt === 0 && Number(debtData.balance_usd ?? debtData.balance ?? 0) > 0 ? Number(debtData.balance_usd ?? debtData.balance) : 0)
          );

          const isBlocked = Boolean(debtData.client?.is_blocked_for_shipment);
          const localDebt = Number(client.debt_usd || 0);
          const localBalance = localBalanceMap.get(partnerId) ?? 0;

          const debtDiff = Math.abs(localDebt - erpDebt);
          const balanceDiff = Math.abs(localBalance - erpBalance);

          if (debtDiff > 0.01 || balanceDiff > 0.01 || (client as any).is_blocked_for_shipment !== isBlocked) {
            fixedDiscrepancies++;

            await supabase
              .from('partner_balances')
              .upsert({
                partner_id: partnerId,
                balance: erpBalance,
                currency: 'USD',
                last_synced_at: new Date().toISOString(),
              }, { onConflict: 'partner_id' });

            await supabase
              .from('profiles')
              .update({
                debt_usd: erpDebt,
                credit_limit_usd: erpCreditLimit,
                is_blocked_for_shipment: isBlocked,
                updated_at: new Date().toISOString(),
              })
              .eq('id', client.id);

            if (isBlocked) {
              const redis = getRedisClient();
              if (redis) {
                redis.set(`revoked_partner:${partnerId}`, '1', { ex: 86400 }).catch(() => {});
              }
            } else {
              const redis = getRedisClient();
              if (redis) {
                redis.del(`revoked_partner:${partnerId}`).catch(() => {});
              }
            }

            discrepanciesList.push({
              partner_id: partnerId,
              company: client.company_name || client.full_name,
              local_debt: localDebt,
              erp_debt: erpDebt,
              local_balance: localBalance,
              erp_balance: erpBalance,
              is_blocked: isBlocked,
            });
          } else {
            matchedCount++;
          }
        } catch (itemErr) {
          console.warn(`[Reconciliation] Error reconciling partner ${partnerId}:`, itemErr);
        }
      }
    }

    const durationMs = Date.now() - startTime;

    if (fixedDiscrepancies > 0) {
      await recordAuditLog({
        eventType: 'reconciliation_discrepancy',
        direction: 'inbound',
        status: 'warning',
        source: 'Nightly Reconciliation Cron',
        payload: {
          discrepancies_count: fixedDiscrepancies,
          discrepancies: discrepanciesList,
        },
      });
    }

    await recordAuditLog({
      eventType: 'nightly_reconciliation_summary',
      direction: 'inbound',
      status: 'success',
      source: 'Nightly Reconciliation Cron',
      payload: {
        checked_partners: checkedCount,
        matched: matchedCount,
        discrepancies_fixed: fixedDiscrepancies,
        duration_ms: durationMs,
      },
    });

    return res.status(200).json({
      success: true,
      timestamp: new Date().toISOString(),
      checked_partners: checkedCount,
      matched: matchedCount,
      discrepancies_fixed: fixedDiscrepancies,
      discrepancies: discrepanciesList,
      duration_ms: durationMs,
      correlation_id: correlationId,
    });
  } catch (err: any) {
    console.error('[Reconciliation Cron] Critical error during reconciliation:', err);

    await recordAuditLog({
      eventType: 'nightly_reconciliation_summary',
      direction: 'inbound',
      status: 'error',
      source: 'Nightly Reconciliation Cron',
      errorMessage: err?.message,
    });

    return res.status(500).json({
      success: false,
      error: 'Nightly balance reconciliation failed',
      details: err?.message,
    });
  }
}
