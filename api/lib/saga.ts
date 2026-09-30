/**
 * Enterprise Compensating Saga Coordinator (T-24 / P0-3)
 * Guarantees automated stock release (rollback) on partial failures or downstream rejections.
 */

import { createClient } from '@supabase/supabase-js';
import { logger } from './logger';
import { recordAuditLog } from '../audit/logs';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

const supabaseAdmin = (SUPABASE_URL && SUPABASE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })
  : null as any;

export interface ReservedStockItem {
  sku: string;
  qty: number;
  whId: number;
}

export interface SagaRollbackContext {
  correlationId?: string;
  orderId?: string;
  orderNumber?: string;
  reason: string;
  actorUserId?: string;
}

/**
 * Compensating transaction: Safely and reliably releases all reserved items.
 * Performs retries if individual RPC calls fail.
 */
export async function releaseAllReservedStock(
  items: ReservedStockItem[],
  context: SagaRollbackContext
): Promise<{ success: boolean; releasedCount: number; failedSkus: string[] }> {
  if (!items || items.length === 0) {
    return { success: true, releasedCount: 0, failedSkus: [] };
  }

  const failedSkus: string[] = [];
  let releasedCount = 0;

  logger.warn(`[Saga Compensator] Executing stock rollback for ${items.length} items. Reason: ${context.reason}`, {
    correlationId: context.correlationId,
    orderId: context.orderId,
    orderNumber: context.orderNumber,
    itemsCount: items.length,
    reason: context.reason,
  });

  for (const item of items) {
    let released = false;
    let attempts = 0;
    const maxAttempts = 3;

    while (!released && attempts < maxAttempts) {
      attempts++;
      try {
        const { error } = await supabaseAdmin.rpc('release_stock', {
          p_sku: item.sku,
          p_qty: item.qty,
          p_warehouse_id: item.whId,
        });

        if (!error) {
          released = true;
          releasedCount++;
        } else {
          logger.warn(`[Saga Compensator] Attempt ${attempts}/${maxAttempts} failed to release SKU ${item.sku}:`, {
            sku: item.sku,
            error: error.message,
          });
          if (attempts < maxAttempts) {
            await new Promise((r) => setTimeout(r, 100 * attempts));
          }
        }
      } catch (err: any) {
        logger.warn(`[Saga Compensator] Exception on release attempt for SKU ${item.sku}:`, {
          sku: item.sku,
          error: err?.message,
        });
        if (attempts < maxAttempts) {
          await new Promise((r) => setTimeout(r, 100 * attempts));
        }
      }
    }

    if (!released) {
      failedSkus.push(item.sku);
      logger.error(`[Saga Compensator] CRITICAL: Failed to release stock for SKU ${item.sku} after ${maxAttempts} attempts!`, {
        sku: item.sku,
        qty: item.qty,
        whId: item.whId,
        orderId: context.orderId,
      });
    }
  }

  // Record audit log for Saga compensation event
  try {
    await recordAuditLog({
      eventType: 'saga_stock_rollback',
      direction: 'outbound',
      status: failedSkus.length === 0 ? 'success' : 'error',
      statusCode: failedSkus.length === 0 ? 200 : 500,
      source: 'Saga Compensator',
      correlationId: context.correlationId,
      payload: {
        target_endpoint: 'supabase.rpc.release_stock',
        reason: context.reason,
        orderId: context.orderId,
        orderNumber: context.orderNumber,
        itemsToRollback: items,
        releasedCount,
        failedSkus,
        allSuccess: failedSkus.length === 0,
      },
      latencyMs: 0,
    });
  } catch (auditErr) {
    logger.warn('[Saga Compensator] Failed to record audit log:', auditErr as Error);
  }

  return {
    success: failedSkus.length === 0,
    releasedCount,
    failedSkus,
  };
}
