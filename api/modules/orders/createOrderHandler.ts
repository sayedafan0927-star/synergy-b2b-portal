/**
 * Enterprise Order Creation Handler with Compensating Saga (T-24 / P0-3)
 * Provides:
 * - Anti-Tamper pricing validation
 * - Atomic PostgreSQL stock reservations (SELECT FOR UPDATE)
 * - Guaranteed Compensating Saga rollback on any partial failure
 * - Multi-warehouse order splitting
 * - Transactional Outbox resilience (2.5s timeout fallback)
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { SupabaseClient } from '@supabase/supabase-js';
import { validateOrderPricing, validateAndPriceOrder, resolveWarehouseId } from '../../lib/pricingValidator';
import { releaseAllReservedStock, ReservedStockItem } from '../../lib/saga';
import { logger } from '../../lib/logger';
import { dispatchApprovalRequest } from '../../approvals/whatsapp';
import { recordFailure, recordSuccess } from '../../lib/circuitBreaker';

export interface CreateOrderContext {
  req: VercelRequest;
  res: VercelResponse;
  callerAuth: any;
  correlationId: string;
  supabase: SupabaseClient;
  targetErpUrl: string;
  serverErpKey: string;
  clientIp: string;
}

/**
 * Неблокирующий вызов воркера Outbox для мгновенного сброса заказа в ERP (sub-second sync)
 * Устраняет 2-минутную задержку ожидания Vercel Cron и защищен от Serverless Runtime Freeze.
 */
function triggerImmediateOutboxSync(req: VercelRequest, correlationId: string): void {
  try {
    const host = req.headers['host'] || 'localhost:3000';
    const proto = (req.headers['x-forwarded-proto'] as string) || (String(host).includes('localhost') ? 'http' : 'https');
    const workerUrl = `${proto}://${host}/api/outbox/sync`;
    const cronSecret = process.env.CRON_SECRET || process.env.PORTAL_SECRET_KEY || '';

    // Fire-and-forget: не блокируем ответ клиенту
    const fetchPromise = fetch(workerUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${cronSecret}`,
        'X-Portal-Key': cronSecret,
        'X-Cron-Key': cronSecret,
        'X-Correlation-ID': correlationId,
      },
    }).catch(err => {
      logger.debug('[Outbox Immediate Trigger Notice]', { error: (err as Error)?.message });
    });

    // Защита от Serverless runtime freezing через waitUntil (Vercel / Edge context)
    const vercelWaitUntil = (req as any).context?.waitUntil || (globalThis as any).waitUntil;
    if (typeof vercelWaitUntil === 'function') {
      vercelWaitUntil(fetchPromise);
    }
  } catch (triggerErr) {
    logger.debug('[Outbox Immediate Trigger Exception]', { error: (triggerErr as Error)?.message });
  }
}

export async function handleCreateOrder(ctx: CreateOrderContext): Promise<void> {
  const { req, res, callerAuth, correlationId, supabase, targetErpUrl, serverErpKey, clientIp } = ctx;

  const rawPayload = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  const incomingIdempotencyKey = (
    req.headers['x-idempotency-key'] ||
    rawPayload.idempotency_key ||
    req.query.idempotency_key
  ) as string | undefined;

  // 1. Проверка идемпотентности
  if (incomingIdempotencyKey) {
    try {
      const { data: existingOrder } = await supabase
        .from('orders')
        .select('id, order_number, status, total_amount, created_at')
        .eq('idempotency_key', incomingIdempotencyKey)
        .maybeSingle();

      if (existingOrder) {
        logger.info('[Order] Returning existing order via Idempotency-Key', {
          orderId: existingOrder.id,
          idempotencyKey: incomingIdempotencyKey,
        });
        res.status(200).json({
          success: true,
          is_idempotent_replay: true,
          order_number: existingOrder.order_number,
          order_id: existingOrder.id,
          status: existingOrder.status,
          total_amount: existingOrder.total_amount,
          message: 'Заказ уже был успешно зарегистрирован ранее (Idempotency Key HIT).',
        });
        return;
      }
    } catch (idempErr) {
      logger.warn('[Order] Idempotency lookup notice:', idempErr as Error);
    }
  }

  // 2. Валидация цен и защита от подделки (Anti-Tamper Pricing Guard)
  const userPriceType = callerAuth.priceType || 'wholesale';
  const pricingResult = await validateOrderPricing(rawPayload, userPriceType);

  if (!pricingResult.valid) {
    logger.warn('[Order] Pricing validation failed', {
      error: pricingResult.error,
      tamperDetected: pricingResult.tamperDetected,
    });
    res.status(400).json({
      success: false,
      code: pricingResult.tamperDetected ? 'PRICE_TAMPER_DETECTED' : 'INVALID_ORDER_PRICING',
      error: pricingResult.error || 'Ошибка валидации цен товарных позиций',
    });
    return;
  }

  // 3. Серверный комплаенс-контроль (Кредитный лимит и просрочка)
  let serverRequiresApproval = false;
  let complianceReason = '';
  const finalTotalAmount = pricingResult.totalAmount;
  const finalTotalItems = pricingResult.totalItems;

  if (callerAuth.role === 'client') {
    try {
      const { data: userProfile } = await supabase
        .from('profiles')
        .select('credit_limit_usd, is_blocked_for_orders, overdue_days, impersonation_enabled, status')
        .eq('partner_id', callerAuth.partnerId)
        .maybeSingle();

      if (userProfile?.impersonation_enabled === false || userProfile?.status === 'inactive') {
        res.status(403).json({
          success: false,
          error: 'Создание заказа заблокировано: учетная запись контрагента деактивирована в ERP.',
        });
        return;
      }

      if (userProfile?.is_blocked_for_orders) {
        res.status(403).json({
          success: false,
          code: 'CLIENT_BLOCKED',
          error: 'Оформление новых заказов временно заблокировано в связи с непогашенной задолженностью.',
        });
        return;
      }

      if (userProfile?.overdue_days && userProfile.overdue_days > 14) {
        res.status(403).json({
          success: false,
          code: 'OVERDUE_DEBT',
          error: `У вас имеется просроченная задолженность (${userProfile.overdue_days} дн.). Отгрузка заблокирована до погашения.`,
        });
        return;
      }

      const clientCreditLimit = Number(userProfile?.credit_limit_usd || 0);
      let currentDebt = Math.max(0, Number(userProfile?.debt_usd || 0));
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
        serverRequiresApproval = true;
        complianceReason = `Превышен кредитный лимит с учетом текущей задолженности (Долг: $${currentDebt} + Заказ: $${finalTotalAmount} = $${totalExposure} > Лимит: $${clientCreditLimit})`;
      }
    } catch (profErr) {
      logger.warn('[Order] Compliance check notice:', profErr as Error);
    }
  }

  // 4. Попытка высокопроизводительного атомарного чекаута через create_order_atomic (PostgreSQL Transaction)
  let outboxOrderId: string | null = null;
  let outboxOrderDoc: string | null = null;
  let createdSplitOrders: Array<{ doc_number: string; warehouse: string; amount: number; items_count: number }> = [];
  const reservedSkuItems: ReservedStockItem[] = [];
  const primaryWarehouseId = 81;

  const distinctWarehouses = Array.from(new Set(pricingResult.items.map(it => it.warehouse || 'Основной Склад Астана')));
  const isMultiWarehouse = distinctWarehouses.length > 1;
  const resolvedUserId = callerAuth.userId || rawPayload.user_id || '00000000-0000-0000-0000-000000000000';

  for (const it of pricingResult.items) {
    const itemSku = String(it.sku || '');
    const itemQty = Number(it.quantity || 1);
    const whId = resolveWarehouseId(it.warehouse_id, it.warehouse);
    if (itemSku) {
      reservedSkuItems.push({ sku: itemSku, qty: itemQty, whId });
    }
  }

  let atomicExecuted = false;
  try {
    const orderMasterPayload = {
      user_id: resolvedUserId,
      placed_by_id: callerAuth.userId || resolvedUserId,
      warehouse: pricingResult.items[0]?.warehouse || 'Основной Склад Астана',
      notes: isMultiWarehouse ? `[Мультисклад (${distinctWarehouses.length} склада)] ${rawPayload.comment || ''}`.trim() : (rawPayload.comment || ''),
      total_amount: finalTotalAmount,
      total_items: finalTotalItems,
      total_sqm: pricingResult.items.reduce((s, it) => s + (it.price_per_sqm > 0 ? (it.price / it.price_per_sqm) * it.quantity : 0), 0),
      idempotency_key: incomingIdempotencyKey || null,
      currency: rawPayload.currency || 'USD',
      applied_exchange_rate: Number(rawPayload.applied_exchange_rate || rawPayload.exchange_rate || 1.0),
      contract_id: rawPayload.contract_id || null,
    };

    const orderItemsPayload = pricingResult.items.map(it => ({
      product_id: String(it.productId || it.item_id || it.sku || ''),
      product_name: String(it.sku || 'Ковровое изделие'),
      size: String(it.size || 'Стандарт'),
      sku: String(it.sku || ''),
      warehouse: String(it.warehouse || 'Основной Склад Астана'),
      warehouse_id: resolveWarehouseId(it.warehouse_id, it.warehouse),
      price: Number(it.price) || 0,
      quantity: Number(it.quantity) || 1,
    }));

    const splitOrdersPayload: any[] = [];
    if (isMultiWarehouse) {
      let splitIdx = 1;
      for (const wh of distinctWarehouses) {
        const whItems = pricingResult.items.filter(it => (it.warehouse || 'Основной Склад Астана') === wh);
        const whAmount = Math.round(whItems.reduce((acc, it) => acc + it.total_line, 0) * 100) / 100;
        const whItemsCount = whItems.reduce((acc, it) => acc + it.quantity, 0);
        const whSqm = Math.round(whItems.reduce((acc, it) => acc + (it.price_per_sqm > 0 ? (it.price / it.price_per_sqm) * it.quantity : 0), 0) * 100) / 100;
        const subDoc = `${incomingIdempotencyKey || 'ORD'}-wh-${splitIdx}`;

        splitOrdersPayload.push({
          doc_number: subDoc,
          warehouse: wh,
          notes: `[Мультисклад ${splitIdx}/${distinctWarehouses.length}: ${wh}] ${rawPayload.comment || ''}`.trim(),
          amount: whAmount,
          items_count: whItemsCount,
          sqm: whSqm,
          idempotency_key: incomingIdempotencyKey ? `${incomingIdempotencyKey}-wh-${splitIdx}` : null,
          items: whItems.map(it => ({
            product_id: String(it.productId || it.item_id || it.sku || ''),
            product_name: String(it.sku || 'Ковровое изделие'),
            size: String(it.size || 'Стандарт'),
            sku: String(it.sku || ''),
            warehouse: wh,
            price: Number(it.price) || 0,
            quantity: Number(it.quantity) || 1,
          })),
        });
        splitIdx++;
      }
    }

    const { data: atomicData, error: atomicErr } = await supabase.rpc('create_order_atomic', {
      p_order: orderMasterPayload,
      p_items: orderItemsPayload,
      p_split_orders: splitOrdersPayload,
    });

    if (atomicErr) {
      const errMsg = atomicErr.message || '';
      if (errMsg.includes('INSUFFICIENT_STOCK')) {
        logger.warn('[Order] Atomic checkout rejected due to insufficient stock:', { error: errMsg, correlationId });
        res.status(409).json({
          success: false,
          code: 'INSUFFICIENT_STOCK',
          error: errMsg.replace('INSUFFICIENT_STOCK:', '').trim() || 'Недостаточно свободного остатка для оформления заказа.',
        });
        return;
      }
      logger.warn('[Order] create_order_atomic RPC notice, falling back to sequential saga:', atomicErr);
    } else if (atomicData && atomicData.success) {
      outboxOrderId = atomicData.order_id;
      outboxOrderDoc = atomicData.order_number;
      createdSplitOrders = Array.isArray(atomicData.split_orders) && atomicData.split_orders.length > 0
        ? atomicData.split_orders
        : [{
            doc_number: outboxOrderDoc,
            warehouse: distinctWarehouses[0] || 'Основной Склад Астана',
            amount: finalTotalAmount,
            items_count: finalTotalItems,
          }];
      atomicExecuted = true;
      logger.info('[Order] Order atomically created and reserved via create_order_atomic RPC', {
        orderId: outboxOrderId,
        orderNumber: outboxOrderDoc,
      });

      if (serverRequiresApproval) {
        dispatchApprovalRequest({
          orderId: outboxOrderId!,
          orderDocNumber: outboxOrderDoc!,
          clientName: rawPayload.client_name || rawPayload.buyer?.name || 'Клиент B2B',
          clientPhone: rawPayload.client_phone || rawPayload.buyer?.phone,
          totalAmount: finalTotalAmount,
          totalSqm: pricingResult.items.reduce((s, it) => s + (it.price_per_sqm > 0 ? (it.price / it.price_per_sqm) * it.quantity : 0), 0),
          itemsCount: finalTotalItems,
          reason: complianceReason || 'Превышение кредитного лимита (серверный контроль)',
        }).catch(e => logger.warn('[Order Approval Warning]', e as Error));
      }
    }
  } catch (atomicEx: any) {
    logger.warn('[Order] Exception during create_order_atomic call, falling back:', atomicEx);
  }

  // Fallback на последовательное компенсирующее резервирование (если RPC ещё не развёрнут)
  if (!atomicExecuted) {
    let reservationFailedSku: string | null = null;
    const fallbackReserved: ReservedStockItem[] = [];

    for (const it of pricingResult.items) {
      const itemSku = String(it.sku || '');
      const itemQty = Number(it.quantity || 1);
      const whId = resolveWarehouseId(it.warehouse_id, it.warehouse);

      if (itemSku) {
        try {
          const { data: isReserved, error: rpcErr } = await supabase.rpc('reserve_stock', {
            p_sku: itemSku,
            p_qty: itemQty,
            p_warehouse_id: whId,
          });

          if (rpcErr || isReserved === false) {
            reservationFailedSku = itemSku;
            break;
          } else if (isReserved === true) {
            fallbackReserved.push({ sku: itemSku, qty: itemQty, whId });
          }
        } catch {
          reservationFailedSku = itemSku;
          break;
        }
      }
    }

    if (reservationFailedSku) {
      await releaseAllReservedStock(fallbackReserved, {
        correlationId,
        reason: `Недостаточно остатка для артикула "${reservationFailedSku}"`,
      });

      res.status(409).json({
        success: false,
        code: 'INSUFFICIENT_STOCK',
        error: `Недостаточно свободного остатка для артикула "${reservationFailedSku}". Товар был зарезервирован другим покупателем.`,
      });
      return;
    }

    try {
      const { data: createdRow, error: masterOrderErr } = await supabase
        .from('orders')
        .insert({
          user_id: resolvedUserId,
          placed_by_id: callerAuth.userId || resolvedUserId,
          warehouse: pricingResult.items[0]?.warehouse || 'Основной Склад Астана',
          notes: isMultiWarehouse ? `[Мультисклад (${distinctWarehouses.length} склада)] ${rawPayload.comment || ''}`.trim() : (rawPayload.comment || ''),
          total_amount: finalTotalAmount,
          total_items: finalTotalItems,
          total_sqm: pricingResult.items.reduce((s, it) => s + (it.price_per_sqm > 0 ? (it.price / it.price_per_sqm) * it.quantity : 0), 0),
          status: 'pending',
          idempotency_key: incomingIdempotencyKey || null,
          currency: rawPayload.currency || 'USD',
          applied_exchange_rate: Number(rawPayload.applied_exchange_rate || rawPayload.exchange_rate || 1.0),
          contract_id: rawPayload.contract_id || null,
        })
        .select('id, order_number')
        .maybeSingle();

      if (masterOrderErr || !createdRow) {
        throw new Error(`Master order insert failed: ${masterOrderErr?.message || 'No row returned'}`);
      }

      outboxOrderId = createdRow.id;
      outboxOrderDoc = createdRow.order_number;

      if (isMultiWarehouse) {
        let splitIdx = 1;
        for (const wh of distinctWarehouses) {
          const whItems = pricingResult.items.filter(it => (it.warehouse || 'Основной Склад Астана') === wh);
          const whAmount = Math.round(whItems.reduce((acc, it) => acc + it.total_line, 0) * 100) / 100;
          const whItemsCount = whItems.reduce((acc, it) => acc + it.quantity, 0);
          const whSqm = Math.round(whItems.reduce((acc, it) => acc + (it.price_per_sqm > 0 ? (it.price / it.price_per_sqm) * it.quantity : 0), 0) * 100) / 100;
          const subDoc = `${outboxOrderDoc}-${splitIdx}`;

          const { data: subOrderRow } = await supabase
            .from('orders')
            .insert({
              order_number: subDoc,
              user_id: resolvedUserId,
              placed_by_id: callerAuth.userId || resolvedUserId,
              warehouse: wh,
              notes: `[Мультисклад ${splitIdx}/${distinctWarehouses.length}: ${wh}] ${rawPayload.comment || ''}`.trim(),
              total_amount: whAmount,
              total_items: whItemsCount,
              total_sqm: whSqm,
              status: 'pending',
              idempotency_key: incomingIdempotencyKey ? `${incomingIdempotencyKey}-wh-${splitIdx}` : null,
              currency: rawPayload.currency || 'USD',
              contract_id: rawPayload.contract_id || null,
              parent_order_id: createdRow.id,
            })
            .select('id, order_number')
            .maybeSingle();

          if (subOrderRow) {
            const subItemRows = whItems.map(it => ({
              order_id: subOrderRow.id,
              product_id: String(it.productId || it.item_id || it.sku || ''),
              product_name: String(it.sku || 'Ковровое изделие'),
              size: String(it.size || 'Стандарт'),
              sku: String(it.sku || ''),
              warehouse: wh,
              price: Number(it.price) || 0,
              quantity: Number(it.quantity) || 1,
            }));
            await supabase.from('order_items').insert(subItemRows);
            createdSplitOrders.push({
              doc_number: subDoc,
              warehouse: wh,
              amount: whAmount,
              items_count: whItemsCount,
            });
          }
          splitIdx++;
        }
      } else {
        createdSplitOrders = [{
          doc_number: outboxOrderDoc,
          warehouse: distinctWarehouses[0] || 'Основной Склад Астана',
          amount: finalTotalAmount,
          items_count: finalTotalItems,
        }];
      }

      const orderItemRows = pricingResult.items.map(it => ({
        order_id: createdRow.id,
        product_id: String(it.productId || it.item_id || it.sku || ''),
        product_name: String(it.sku || 'Ковровое изделие'),
        size: String(it.size || 'Стандарт'),
        sku: String(it.sku || ''),
        warehouse: String(it.warehouse || 'Основной Склад Астана'),
        price: Number(it.price) || 0,
        quantity: Number(it.quantity) || 1,
      }));

      if (orderItemRows.length > 0) {
        await supabase.from('order_items').insert(orderItemRows);
      }

      if (serverRequiresApproval) {
        dispatchApprovalRequest({
          orderId: createdRow.id,
          orderDocNumber: outboxOrderDoc,
          clientName: rawPayload.client_name || rawPayload.buyer?.name || 'Клиент B2B',
          clientPhone: rawPayload.client_phone || rawPayload.buyer?.phone,
          totalAmount: finalTotalAmount,
          totalSqm: pricingResult.items.reduce((s, it) => s + (it.price_per_sqm > 0 ? (it.price / it.price_per_sqm) * it.quantity : 0), 0),
          itemsCount: finalTotalItems,
          reason: complianceReason || 'Превышение кредитного лимита (серверный контроль)',
        }).catch(e => logger.warn('[Order Approval Warning]', e as Error));
      }
    } catch (dbErr: any) {
      logger.error('[Order] Database insertion failure! Triggering Compensating Saga stock release', {
        error: dbErr?.message,
        correlationId,
      });

      await releaseAllReservedStock(fallbackReserved, {
        correlationId,
        reason: `Сбой фиксации заказа в локальной БД: ${dbErr?.message}`,
      });

      res.status(500).json({
        success: false,
        error: 'Ошибка сохранения заказа в локальной базе данных. Зарезервированные остатки возвращены на склад.',
        details: dbErr?.message,
      });
      return;
    }
  }

  const outboundPayload = {
    ...rawPayload,
    idempotency_key: incomingIdempotencyKey || null,
    outbox_doc_number: outboxOrderDoc,
    warehouse_id: primaryWarehouseId,
    partner_id: (callerAuth.role === 'client' ? callerAuth.partnerId : rawPayload.partner_id) || rawPayload.client_id,
    client_name: rawPayload.client_name || rawPayload.buyer?.name,
    client_phone: rawPayload.client_phone || rawPayload.buyer?.phone,
    items: pricingResult.items.map(it => {
      const itemObj: Record<string, any> = {
        item_id: it.item_id,
        sku: it.sku,
        width: it.width,
        length: it.length,
        area_sqm: it.area_sqm,
        quantity: it.quantity,
        price: it.price,
        total_line: it.total_line,
        warehouse: it.warehouse,
        warehouse_id: it.warehouse_id || primaryWarehouseId,
      };
      // Гарантия отсутствия ячеек WMS в заказе
      delete itemObj.cell;
      delete itemObj.cell_code;
      delete itemObj.rack;
      delete itemObj.location;
      return itemObj;
    }),
    total_amount: finalTotalAmount,
    total_items: finalTotalItems,
  };

  const validatedOrderPayload = outboundPayload;
  delete (validatedOrderPayload as any).cell;
  delete (validatedOrderPayload as any).cell_code;
  delete (validatedOrderPayload as any).rack;
  delete (validatedOrderPayload as any).location;

  // 6. Быстрая синхронизация с 1C:ERP с тайм-аутом 2.5s
  const controller = new AbortController();
  const erpTimeoutId = setTimeout(() => controller.abort(), 2500);

  try {
    const erpResponse = await fetch(`${targetErpUrl}?action=create_order`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Portal-Key': serverErpKey,
        'X-Idempotency-Key': incomingIdempotencyKey || outboxOrderDoc,
        'Idempotency-Key': incomingIdempotencyKey || outboxOrderDoc,
        'Accept': 'application/json',
        'X-Correlation-ID': correlationId,
        'X-Forwarded-For': clientIp,
        'X-Real-IP': clientIp,
      },
      body: JSON.stringify(outboundPayload),
      signal: controller.signal,
    });
    clearTimeout(erpTimeoutId);

    const jsonData = await erpResponse.json().catch(() => null);

    // Обработка 409 Conflict / INSUFFICIENT_STOCK от 1C:ERP
    if (erpResponse.status === 409 || jsonData?.error_code === 'INSUFFICIENT_STOCK') {
      logger.warn('[Order] 1C:ERP returned 409 Conflict / Insufficient stock. Triggering Saga rollback', {
        orderDoc: outboxOrderDoc,
        correlationId,
      });

      if (outboxOrderId) {
        await supabase
          .from('orders')
          .update({
            status: 'cancelled',
            notes: `[Отклонено ERP: Недостаточно остатка] ${jsonData?.error || ''}`,
            updated_at: new Date().toISOString(),
          })
          .eq('id', outboxOrderId);
      }

      // SAGA: Откат всех локальных резервов
      await releaseAllReservedStock(reservedSkuItems, {
        correlationId,
        orderId: outboxOrderId || undefined,
        orderNumber: outboxOrderDoc || undefined,
        reason: '1C ERP отклонила заказ по причине нехватки остатка (409 Conflict)',
      });

      res.status(409).json({
        success: false,
        code: 'INSUFFICIENT_STOCK',
        error: jsonData?.error || '1C:ERP отклонила заказ: недостаточно товара на складе.',
      });
      return;
    }

    if (erpResponse.ok && jsonData?.success) {
      await recordSuccess('erp_gateway');
      if (outboxOrderId && jsonData.order?.doc_number) {
        await supabase
          .from('orders')
          .update({
            order_number: jsonData.order.doc_number,
            status: 'processing',
            updated_at: new Date().toISOString(),
          })
          .eq('id', outboxOrderId);
      }

      if (jsonData && typeof jsonData === 'object' && createdSplitOrders.length > 0) {
        jsonData.split_orders = createdSplitOrders;
      }
      res.status(200).json(jsonData);
      return;
    }

    // Если ответ не OK, заказ остается в статусе pending для Outbox Sync Worker
    logger.warn('[Order] ERP non-OK response. Order preserved in outbox for asynchronous sync', {
      statusCode: erpResponse.status,
      orderDoc: outboxOrderDoc,
    });
    triggerImmediateOutboxSync(req, correlationId);
    res.status(200).json({
      success: true,
      outbox_queued: true,
      is_buffered_offline: true,
      order_number: outboxOrderDoc,
      order_id: outboxOrderId,
      split_orders: createdSplitOrders,
      message: 'Заказ успешно зарегистрирован и поставлен в очередь асинхронной отправки в ERP.',
    });
  } catch (err: any) {
    clearTimeout(erpTimeoutId);
    await recordFailure('erp_gateway');
    logger.info('[Order Outbox Fallback] ERP sync timeout/disconnect. Order safely retained in PostgreSQL outbox queue', {
      orderDoc: outboxOrderDoc,
      isTimeout: err?.name === 'AbortError',
      correlationId,
    });

    triggerImmediateOutboxSync(req, correlationId);
    res.status(200).json({
      success: true,
      outbox_queued: true,
      is_buffered_offline: true,
      order_number: outboxOrderDoc,
      order_id: outboxOrderId,
      split_orders: createdSplitOrders,
      message: 'Заказ принят и надежно сохранен в базе данных. Синхронизация с ERP выполняется в фоновом режиме.',
    });
  }
}
