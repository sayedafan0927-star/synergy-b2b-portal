import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveWarehouseId } from '../../lib/pricingValidator';

export interface SplitOrderSummary {
  doc_number: string;
  warehouse: string;
  amount: number;
  items_count: number;
}

export function buildSplitOrdersPayload(
  items: any[],
  distinctWarehouses: string[],
  incomingIdempotencyKey: string | undefined,
  rawComment: string | undefined,
): any[] {
  const splitOrdersPayload: any[] = [];
  let splitIdx = 1;

  for (const wh of distinctWarehouses) {
    const whItems = items.filter(it => (it.warehouse || 'Основной Склад Астана') === wh);
    const whAmount = Math.round(whItems.reduce((acc, it) => acc + it.total_line, 0) * 100) / 100;
    const whItemsCount = whItems.reduce((acc, it) => acc + it.quantity, 0);
    const uniqueOrderToken = incomingIdempotencyKey || (`ORD-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`);
    const subDoc = `${uniqueOrderToken}-wh-${splitIdx}`;

    splitOrdersPayload.push({
      doc_number: subDoc,
      warehouse: wh,
      notes: `[Мультисклад ${splitIdx}/${distinctWarehouses.length}: ${wh}] ${rawComment || ''}`.trim(),
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

  return splitOrdersPayload;
}

export async function insertSequentialSplitOrders(
  supabase: SupabaseClient,
  items: any[],
  distinctWarehouses: string[],
  parentOrderId: string,
  parentOrderDoc: string,
  resolvedUserId: string,
  callerAuthUserId: string,
  incomingIdempotencyKey: string | undefined,
  currency: string,
  contractId: string | null,
  rawComment: string | undefined,
  authoritativeRate?: number,
): Promise<SplitOrderSummary[]> {
  const createdSplitOrders: SplitOrderSummary[] = [];
  let splitIdx = 1;

  for (const wh of distinctWarehouses) {
    const whItems = items.filter(it => (it.warehouse || 'Основной Склад Астана') === wh);
    const whAmount = Math.round(whItems.reduce((acc, it) => acc + it.total_line, 0) * 100) / 100;
    const whItemsCount = whItems.reduce((acc, it) => acc + it.quantity, 0);
    const whSqm = Math.round(whItems.reduce((acc, it) => acc + (Number(it.area_sqm) > 0 ? Number(it.area_sqm) * it.quantity : (it.price_per_sqm > 0 ? (it.price / it.price_per_sqm) * it.quantity : 0)), 0) * 100) / 100;
    const subDoc = `${parentOrderDoc}-${splitIdx}`;

    const { data: subOrderRow } = await supabase
      .from('orders')
      .insert({
        order_number: subDoc,
        user_id: resolvedUserId,
        placed_by_id: callerAuthUserId || resolvedUserId,
        warehouse: wh,
        notes: `[Мультисклад ${splitIdx}/${distinctWarehouses.length}: ${wh}] ${rawComment || ''}`.trim(),
        total_amount: whAmount,
        total_items: whItemsCount,
        total_sqm: whSqm,
        status: 'pending',
        idempotency_key: incomingIdempotencyKey ? `${incomingIdempotencyKey}-wh-${splitIdx}` : null,
        currency,
        applied_exchange_rate: authoritativeRate !== undefined && authoritativeRate > 0 ? authoritativeRate : 1,
        contract_id: contractId,
        parent_order_id: parentOrderId,
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
        warehouse_id: resolveWarehouseId(it.warehouse_id, it.warehouse || wh),
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

  return createdSplitOrders;
}
