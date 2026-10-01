/**
 * Enterprise Order Creation Handler with Compensating Saga (T-24 / P0-3)
 * Provides:
 * - Anti-Tamper pricing validation
 * - Atomic PostgreSQL stock reservations (SELECT FOR UPDATE)
 * - Guaranteed Compensating Saga rollback on any partial failure
 * - Multi-warehouse order splitting
 * - Transactional Outbox resilience (2.5s timeout fallback)
 */

import { randomUUID } from 'crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { SupabaseClient } from '@supabase/supabase-js';
import { validateOrderPricing, resolveWarehouseId } from '../../lib/pricingValidator';
import { releaseAllReservedStock, ReservedStockItem } from '../../lib/saga';
import { logger } from '../../lib/logger';
import { dispatchApprovalRequest } from '../../approvals/whatsapp';
import { recordFailure, recordSuccess } from '../../lib/circuitBreaker';
import { validateClientCreditExposure } from './exposureValidator';
import { buildSplitOrdersPayload, insertSequentialSplitOrders, SplitOrderSummary } from './orderSplitter';
import { preloadInventoryBalancesForOrder, verifyItemsStockAvailability } from './stockPreloader';

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

import { triggerImmediateOutboxSync, dispatchErpCheckoutWithFallback } from './orderDispatcher';

export { triggerImmediateOutboxSync };

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

  // 1.5. B2B Multi-Role Guard: Бухгалтер не может создавать заказы
  if (callerAuth.role === 'client' && callerAuth.b2bRole === 'accountant') {
    logger.warn('[Order] Accountant attempted to submit order', { userId: callerAuth.userId, correlationId });
    res.status(403).json({ success: false, code: 'ACCOUNTANT_CANNOT_ORDER', error: 'Учетная запись бухгалтера не имеет прав на оформление заказов.' });
    return;
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
  const finalTotalAmount = pricingResult.totalAmount;
  const finalTotalItems = pricingResult.totalItems;
  const finalTotalSqm = Math.round(pricingResult.items.reduce((s, it) => s + (it.area_sqm > 0 ? it.area_sqm * it.quantity : (it.price_per_sqm > 0 ? (it.price / it.price_per_sqm) * it.quantity : 0)), 0) * 100) / 100;

  const [exposureCheck, clientRulesResult, dispSettingsResult] = await Promise.all([
    validateClientCreditExposure(callerAuth, finalTotalAmount, supabase),
    callerAuth.role === 'client'
      ? supabase.from('display_settings').select('hidden_warehouses').eq('target_role', 'client').maybeSingle()
      : Promise.resolve({ data: null, error: null } as any),
    supabase.from('display_settings').select('exchange_rate_usd_kzt').order('updated_at', { ascending: false }).limit(1).maybeSingle(),
  ]);

  if (exposureCheck.blocked) {
    res.status(exposureCheck.statusCode || 403).json({
      success: false,
      code: exposureCheck.blockCode,
      error: exposureCheck.blockError || 'Создание заказа заблокировано.',
    });
    return;
  }

  // 3.1. Валидация прав доступа дилера к указанным складам (Anti-Bypass)
  if (callerAuth.role === 'client' && clientRulesResult?.data?.hidden_warehouses) {
    const forbiddenWhs = Array.isArray(clientRulesResult.data.hidden_warehouses) ? clientRulesResult.data.hidden_warehouses : [];
    for (const it of pricingResult.items) {
      const whId = resolveWarehouseId(it.warehouse_id, it.warehouse);
      if (forbiddenWhs.includes(whId)) {
        res.status(403).json({
          success: false,
          error: `Заказ со склада "${it.warehouse || whId}" недоступен для вашей учетной записи.`,
          code: 'FORBIDDEN_WAREHOUSE',
        });
        return;
      }
    }
  }

  // 3.2. Авторитетный курс валют из базы данных (display_settings)
  const authoritativeRate = Number(dispSettingsResult?.data?.exchange_rate_usd_kzt) || 520.00;

  const serverRequiresApproval = Boolean(exposureCheck.requiresApproval);
  const complianceReason = exposureCheck.complianceReason || '';

  // 4. Попытка высокопроизводительного атомарного чекаута через create_order_atomic (PostgreSQL Transaction)
  let outboxOrderId: string | null = null;
  let outboxOrderDoc: string | null = null;
  let createdSplitOrders: SplitOrderSummary[] = [];
  const reservedSkuItems: ReservedStockItem[] = [];
  const primaryWarehouseId = 81;

  const distinctWarehouses = Array.from(new Set(pricingResult.items.map(it => it.warehouse || 'Основной Склад Астана')));
  const isMultiWarehouse = distinctWarehouses.length > 1;
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const isManagerOrAdmin = callerAuth.role === 'admin' || callerAuth.role === 'manager_rm' || callerAuth.role === 'manager_lm';
  const rawTargetId = isManagerOrAdmin && rawPayload.user_id ? rawPayload.user_id : (callerAuth.userId || rawPayload.user_id);
  const resolvedUserId = (typeof rawTargetId === 'string' && UUID_REGEX.test(rawTargetId.trim()))
    ? rawTargetId.trim()
    : ((callerAuth.userId && UUID_REGEX.test(callerAuth.userId)) ? callerAuth.userId : '00000000-0000-0000-0000-000000000000');

  for (const it of pricingResult.items) {
    const itemSku = String(it.sku || '');
    const itemQty = Number(it.quantity || 1);
    const whId = resolveWarehouseId(it.warehouse_id, it.warehouse);
    if (itemSku) reservedSkuItems.push({ sku: itemSku, qty: itemQty, whId });
  }

  const safeContractId = typeof rawPayload.contract_id === 'string' && UUID_REGEX.test(rawPayload.contract_id.trim())
    ? rawPayload.contract_id.trim()
    : null;

  const effectivePartnerId = String(
    (callerAuth.role === 'client' ? callerAuth.partnerId : (rawPayload.partner_id || callerAuth.partnerId)) || ''
  ).trim() || null;

  let atomicExecuted = false;
  try {
    const orderMasterPayload = {
      user_id: resolvedUserId,
      placed_by_id: (callerAuth.userId && UUID_REGEX.test(callerAuth.userId)) ? callerAuth.userId : resolvedUserId,
      partner_id: effectivePartnerId,
      warehouse: pricingResult.items[0]?.warehouse || 'Основной Склад Астана',
      notes: isMultiWarehouse ? `[Мультисклад (${distinctWarehouses.length} склада)] ${rawPayload.comment || ''}`.trim() : (rawPayload.comment || ''),
      total_amount: finalTotalAmount,
      total_items: finalTotalItems,
      total_sqm: finalTotalSqm,
      idempotency_key: incomingIdempotencyKey || null,
      currency: rawPayload.currency || 'USD',
      applied_exchange_rate: authoritativeRate,
      contract_id: safeContractId,
    };

    const orderItemsPayload = pricingResult.items.map(it => ({
      product_id: String(it.productId || it.item_id || it.sku || ''),
      product_name: String(it.sku || 'Ковровое изделие'), size: String(it.size || 'Стандарт'), sku: String(it.sku || ''),
      warehouse: String(it.warehouse || 'Основной Склад Астана'), warehouse_id: resolveWarehouseId(it.warehouse_id, it.warehouse),
      price: Number(it.price) || 0, quantity: Number(it.quantity) || 1,
    }));

    const splitOrdersPayload = isMultiWarehouse
      ? buildSplitOrdersPayload(pricingResult.items, distinctWarehouses, incomingIdempotencyKey, rawPayload.comment)
      : [];

    await preloadInventoryBalancesForOrder(supabase, pricingResult.items, correlationId);

    const { data: atomicData, error: atomicErr } = await supabase.rpc('create_order_atomic', {
      p_order: orderMasterPayload,
      p_items: orderItemsPayload,
      p_split_orders: splitOrdersPayload,
    });

    if (atomicErr) {
      const errMsg = atomicErr.message || '';
      if (errMsg.includes('CLIENT_BLOCKED') || errMsg.includes('OVERDUE_DEBT') || errMsg.includes('CLIENT_DEACTIVATED')) {
        res.status(403).json({ success: false, code: errMsg.split(':')[0].trim(), error: errMsg.replace(/^[A-Z_]+:\s*/, '').trim() });
        return;
      }
      if (errMsg.includes('INSUFFICIENT_STOCK')) {
        const stockCheck = await verifyItemsStockAvailability(pricingResult.items, correlationId);
        if (!stockCheck.allAvailable && stockCheck.conflictingItem) {
          logger.warn('[Order] Atomic checkout rejected: item is truly depleted in ERP catalog:', {
            sku: stockCheck.conflictingItem.sku,
            avail: stockCheck.conflictingItem.available_qty,
            req: stockCheck.conflictingItem.requested_qty,
            correlationId,
          });
          res.status(409).json({
            success: false,
            code: 'INSUFFICIENT_STOCK',
            error: `Недостаточно свободного остатка для артикула "${stockCheck.conflictingItem.sku}" (доступно: ${stockCheck.conflictingItem.available_qty}, запрошено: ${stockCheck.conflictingItem.requested_qty}).`,
            details: {
              code: 'INSUFFICIENT_STOCK',
              sku: stockCheck.conflictingItem.sku,
              available_qty: stockCheck.conflictingItem.available_qty,
              requested_qty: stockCheck.conflictingItem.requested_qty,
            },
          });
          return;
        }

        logger.warn('[Order] create_order_atomic INSUFFICIENT_STOCK bypassed: ERP catalog has authoritative stock. Proceeding to direct 1C ERP dispatch', {
          correlationId,
          skus: pricingResult.items.map(i => i.sku),
        });
      }
      if (incomingIdempotencyKey && (errMsg.includes('unique') || errMsg.includes('orders_idempotency_key_key') || (atomicErr as any).code === '23505')) {
        const { data: replayOrder } = await supabase.from('orders').select('id, order_number, status, total_amount').eq('idempotency_key', incomingIdempotencyKey).maybeSingle();
        if (replayOrder) {
          logger.info('[Order] Returning order via concurrent Idempotency Key collision', { orderId: replayOrder.id });
          res.status(200).json({
            success: true,
            is_idempotent_replay: true,
            order_number: replayOrder.order_number,
            order_id: replayOrder.id,
            status: replayOrder.status,
            total_amount: replayOrder.total_amount,
            message: 'Заказ уже зарегистрирован параллельным запросом (Idempotency Key Concurrent HIT).',
          });
          return;
        }
      }
      logger.warn('[Order] create_order_atomic RPC notice, falling back to sequential saga:', atomicErr);
    } else if (atomicData && (atomicData.success || atomicData.order_id)) {
      outboxOrderId = atomicData.order_id;
      outboxOrderDoc = atomicData.order_number;
      const splitList = (Array.isArray(atomicData.split_orders) && atomicData.split_orders.length > 0)
        ? atomicData.split_orders
        : ((Array.isArray(atomicData.sub_orders) && atomicData.sub_orders.length > 0) ? atomicData.sub_orders : []);
      createdSplitOrders = splitList.length > 0
        ? splitList
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
          totalSqm: finalTotalSqm,
          itemsCount: finalTotalItems,
          reason: complianceReason || 'Превышение кредитного лимита (серверный контроль)',
        }).catch(e => logger.warn('[Order Approval Warning]', e as Error));
      }
    }
  } catch (atomicEx: any) {
    logger.warn('[Order] Exception during create_order_atomic call, falling back:', atomicEx);
  }

  // Fallback на последовательное создание заказа и прямую отправку в ERP
  if (!atomicExecuted) {
    const genDoc = 'ORD-' + Math.floor(Date.now() / 1000) + '-' + Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    outboxOrderDoc = genDoc;
    outboxOrderId = randomUUID();
    createdSplitOrders = [{
      doc_number: outboxOrderDoc,
      warehouse: distinctWarehouses[0] || 'Основной Склад Астана',
      amount: finalTotalAmount,
      items_count: finalTotalItems,
    }];

    try {
      const { data: createdRow } = await supabase
        .from('orders')
        .insert({
          id: outboxOrderId,
          user_id: resolvedUserId,
          placed_by_id: callerAuth.userId || resolvedUserId,
          partner_id: (callerAuth.role === 'client' ? callerAuth.partnerId : (rawPayload.partner_id || callerAuth.partnerId)) || null,
          warehouse: pricingResult.items[0]?.warehouse || 'Основной Склад Астана',
          notes: isMultiWarehouse ? `[Мультисклад (${distinctWarehouses.length} склада)] ${rawPayload.comment || ''}`.trim() : (rawPayload.comment || ''),
          total_amount: finalTotalAmount,
          total_items: finalTotalItems,
          total_sqm: finalTotalSqm,
          status: 'pending',
          idempotency_key: incomingIdempotencyKey || null,
          currency: rawPayload.currency || 'USD',
          applied_exchange_rate: authoritativeRate,
          contract_id: safeContractId,
        })
        .select('id, order_number')
        .maybeSingle();

      if (createdRow?.id) {
        outboxOrderId = createdRow.id;
        outboxOrderDoc = createdRow.order_number || outboxOrderDoc;
      }

      if (isMultiWarehouse) {
        createdSplitOrders = await insertSequentialSplitOrders(
          supabase,
          pricingResult.items,
          distinctWarehouses,
          outboxOrderId,
          outboxOrderDoc,
          resolvedUserId,
          callerAuth.userId,
          incomingIdempotencyKey,
          rawPayload.currency || 'USD',
          safeContractId,
          rawPayload.comment,
          authoritativeRate,
          effectivePartnerId,
        );
      } else {
        createdSplitOrders = [{ doc_number: outboxOrderDoc, warehouse: distinctWarehouses[0] || 'Основной Склад Астана', amount: finalTotalAmount, items_count: finalTotalItems }];
      }

      const targetOrderId = outboxOrderId;
      const orderItemRows = pricingResult.items.map(it => ({
        order_id: targetOrderId,
        product_id: String(it.productId || it.item_id || it.sku || ''),
        product_name: String(it.sku || 'Ковровое изделие'),
        size: String(it.size || 'Стандарт'),
        sku: String(it.sku || ''),
        warehouse: String(it.warehouse || 'Основной Склад Астана'),
        warehouse_id: resolveWarehouseId(it.warehouse_id, it.warehouse),
        price: Number(it.price) || 0,
        quantity: Number(it.quantity) || 1,
      }));

      if (orderItemRows.length > 0) {
        await supabase.from('order_items').insert(orderItemRows);
      }

      if (serverRequiresApproval) {
        dispatchApprovalRequest({
          orderId: targetOrderId,
          orderDocNumber: outboxOrderDoc,
          clientName: rawPayload.client_name || rawPayload.buyer?.name || 'Клиент B2B',
          clientPhone: rawPayload.client_phone || rawPayload.buyer?.phone,
          totalAmount: finalTotalAmount,
          totalSqm: finalTotalSqm,
          itemsCount: finalTotalItems,
          reason: complianceReason || 'Превышение кредитного лимита (серверный контроль)',
        }).catch(e => logger.warn('[Order Approval Warning]', e as Error));
      }
    } catch (dbErr: any) {
      logger.warn('[Order] Local database persistence notice, proceeding to direct 1C ERP dispatch:', {
        error: dbErr?.message,
        correlationId,
      });
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
        item_id: it.item_id, sku: it.sku, width: it.width, length: it.length, area_sqm: it.area_sqm,
        quantity: it.quantity, price: it.price, total_line: it.total_line, warehouse: it.warehouse,
        warehouse_id: it.warehouse_id || primaryWarehouseId,
      };
      delete itemObj.cell; delete itemObj.cell_code; delete itemObj.rack; delete itemObj.location;
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

  // 6. Быстрая синхронизация с 1C:ERP с тайм-аутом 2.5s и отказоустойчивым фоллбэком в Outbox
  await dispatchErpCheckoutWithFallback({
    req,
    res,
    targetErpUrl,
    serverErpKey,
    incomingIdempotencyKey,
    outboxOrderDoc,
    outboxOrderId,
    correlationId,
    clientIp,
    outboundPayload,
    createdSplitOrders,
    reservedSkuItems,
    supabase,
  });
}
