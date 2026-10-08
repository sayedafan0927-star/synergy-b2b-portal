import { supabase } from '@/lib/supabase';
import { fetchClientOrdersFromErp } from './ordersApi';

export interface ActiveReservationItem {
  sku: string;
  product_name: string;
  collection: string;
  size: string;
  warehouse: string;
  quantity: number;
  area_sqm: number;
  total_sqm: number;
}

export interface ActiveReservation {
  id: string;
  order_number: string;
  client_name: string;
  client_company: string;
  client_phone: string;
  status: string;
  warehouse: string;
  created_at: string;
  hold_expires_at?: string;
  total_items: number;
  total_sqm: number;
  total_amount: number;
  currency?: string;
  status_label?: string;
  assembly_progress?: string;
  items: ActiveReservationItem[];
}

export interface ActiveReservationsResponse {
  success: boolean;
  reservations: ActiveReservation[];
  summary: {
    total_reserved_orders: number;
    total_reserved_pcs: number;
    total_reserved_sqm: number;
    clients_count: number;
  };
  error?: string;
}

export function parseSizeArea(sizeStr?: string): number {
  if (!sizeStr) return 1;
  const parts = String(sizeStr).replace(',', '.').split(/[*×xXхХ]/).map(s => parseFloat(s.trim()));
  if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1]) && parts[0] > 0 && parts[1] > 0) {
    return Math.round(parts[0] * parts[1] * 100) / 100;
  }
  return 1;
}

export function clean1CName(rawName?: string): { name: string; sku: string; color: string; collection: string } {
  if (!rawName) return { name: 'Ковер', sku: '', color: '', collection: '' };
  const m = rawName.match(/^([A-ZА-Я0-9\s-]+?)(?:\s*<[^>]*>)?\s*\(([^)]+)\)/i);
  if (m) {
    const coll = m[1].replace(/^(ковер|дорожка)\s+/i, '').trim();
    const inside = m[2].trim();
    const firstComma = inside.indexOf(',');
    if (firstComma > 0) {
      const sku = inside.slice(0, firstComma).trim();
      const afterFirst = inside.slice(firstComma + 1).trim();
      const typeMatch = afterFirst.match(/\b(STAN|R|СТАН|РУЛОН)\b\s*,\s*([^)]+)$/i);
      const color = typeMatch ? typeMatch[2].trim() : '';
      return {
        name: `${coll} ${sku}${color ? ` • ${color}` : ''}`,
        sku,
        color,
        collection: coll,
      };
    }
  }
  const clean = rawName.replace(/<[^>]+>/g, '').trim();
  const coll = clean.split(' ')[0] || '';
  return { name: clean, sku: '', color: '', collection: coll };
}

/**
 * Получить список активных складских резервов с разбивкой по клиентам и позициям.
 * Извлекает данные из 1С:ERP (action=orders) и объединяет с буфером Supabase.
 */
export async function fetchActiveReservations(params?: { sku?: string; q?: string }): Promise<ActiveReservationsResponse> {
  let erpMapped: ActiveReservation[] = [];

  // 1. Извлечение живых заказов из ERP через action=orders
  try {
    const erpData = await fetchClientOrdersFromErp({ limit: 200 });
    if (erpData && erpData.success && Array.isArray(erpData.orders)) {
      const isOrderActiveHold = (o: any) => {
        const sc = String(o.status_code || '').toLowerCase().trim();
        const st = String(o.status || '').toLowerCase().trim();
        if (['shipped', 'cancelled', 'completed', 'delivered', 'rejected'].includes(sc)) return false;
        if (['отгружен', 'отменен', 'выполнен', 'доставлен', 'отклонён', 'отклонен'].some(k => st.includes(k))) return false;
        if (o.is_posted === true && (sc === 'shipped' || st.includes('отгруз'))) return false;
        return true;
      };

      const activeErp = erpData.orders.filter(isOrderActiveHold);
      erpMapped = activeErp.map((o: any) => {
        const sc = String(o.status_code || '').toLowerCase().trim();
        const st = String(o.status || '').toLowerCase().trim();
        const isAssembly = sc === 'picking' || sc === 'processing' || sc === 'assembly' || st.includes('сборк');
        const rawItems = Array.isArray(o.items) ? o.items : [];
        const items: ActiveReservationItem[] = rawItems.map((it: any) => {
          const qty = Number(it.quantity) || 1;
          const area = Number(it.area_sqm) || parseSizeArea(it.size);
          const cleaned = clean1CName(it.name || it.product_name || '');
          return {
            sku: it.sku || cleaned.sku || '',
            product_name: cleaned.name || it.name || 'Ковер',
            collection: it.collection || cleaned.collection || it.name?.split(' ')[0] || '',
            size: it.size || (it.width && it.length ? `${it.width} × ${it.length}` : 'Стандарт'),
            warehouse: o.warehouse_name || 'Основной Склад Астана',
            quantity: qty,
            area_sqm: area,
            total_sqm: Number(it.total_sqm) || Math.round(qty * area * 100) / 100,
          };
        });

        const calculatedQty = items.reduce((sum: number, it) => sum + it.quantity, 0);
        const calculatedSqm = Math.round(items.reduce((sum: number, it) => sum + it.total_sqm, 0) * 100) / 100;

        let clientCompany = o.client_company || '';
        let clientName = o.client_name || 'Клиент B2B';
        if (!clientCompany && clientName.includes('(')) {
          const compMatch = clientName.match(/\((.+)\)$/);
          if (compMatch) {
            clientCompany = compMatch[1].trim();
            clientName = clientName.replace(/\((.+)\)$/, '').trim() || clientName;
          }
        }

        const totalItems = calculatedQty || Number(o.items_count) || 1;
        const pickedItems = Number(o.picked_items ?? o.picked_count ?? 0);
        const progressPercent = totalItems > 0 ? Math.round((pickedItems / totalItems) * 100) : 0;
        const assemblyProgress = isAssembly
          ? (o.assembly_progress || o.picking_progress || `${pickedItems} / ${totalItems} шт. (${progressPercent}%)`)
          : undefined;

        return {
          id: String(o.id),
          order_number: o.doc_number || `ORD-${o.id}`,
          client_name: clientName,
          client_company: clientCompany || clientName,
          client_phone: o.client_phone || '',
          status: isAssembly ? 'processing' : 'pending',
          status_label: o.status || (isAssembly ? 'В сборке' : 'Авторезерв'),
          warehouse: o.warehouse_name || 'Основной Склад Астана',
          created_at: o.date,
          hold_expires_at: o.hold_expires_at || (o.date ? new Date(new Date(o.date).getTime() + 24 * 3600 * 1000).toISOString() : undefined),
          total_items: totalItems,
          total_sqm: calculatedSqm || Number(o.total_sqm) || 0,
          total_amount: Number(o.total_amount) || 0,
          currency: o.currency || 'USD',
          assembly_progress: assemblyProgress,
          items,
        };
      });
    }
  } catch (erpErr) {
    console.warn('[fetchActiveReservations] ERP live orders warning:', erpErr);
  }

  // 2. Слияние с заказами Supabase (для локальных/буферизованных заказов)
  let sbMapped: ActiveReservation[] = [];
  try {
    const { data: dbOrders } = await supabase
      .from('orders')
      .select(`
        id,
        order_number,
        user_id,
        placed_by_id,
        status,
        warehouse,
        hold_expires_at,
        total_amount,
        total_sqm,
        total_items,
        created_at,
        profiles:user_id (
          full_name,
          company_name,
          phone
        ),
        order_items (
          id,
          sku,
          product_name,
          collection,
          size,
          warehouse,
          quantity,
          price
        )
      `)
      .in('status', ['pending', 'reserved', 'confirmed', 'processing'])
      .is('parent_order_id', null)
      .order('created_at', { ascending: false })
      .limit(100);

    if (dbOrders && Array.isArray(dbOrders)) {
      sbMapped = dbOrders.map((o: any) => {
        const prof = o.profiles || {};
        const clientName = prof.full_name || prof.company_name || 'Клиент B2B';
        const clientCompany = prof.company_name || '';
        const clientPhone = prof.phone || '';
        const rawItems = Array.isArray(o.order_items) ? o.order_items : [];

        const items: ActiveReservationItem[] = rawItems.map((it: any) => {
          const qty = Number(it.quantity) || 1;
          const area = parseSizeArea(it.size);
          const cleaned = clean1CName(it.product_name || '');
          return {
            sku: it.sku || cleaned.sku || '',
            product_name: cleaned.name || it.product_name || 'Ковер',
            collection: it.collection || cleaned.collection || '',
            size: it.size || 'Стандарт',
            warehouse: it.warehouse || o.warehouse || 'Основной Склад Астана',
            quantity: qty,
            area_sqm: area,
            total_sqm: Math.round(qty * area * 100) / 100,
          };
        });

        const calculatedQty = items.reduce((sum, it) => sum + it.quantity, 0);
        const calculatedSqm = Math.round(items.reduce((sum, it) => sum + it.total_sqm, 0) * 100) / 100;

        let statusLabel = 'Резерв';
        if (o.status === 'processing') statusLabel = 'На сборке';
        else if (o.status === 'confirmed') statusLabel = 'Подтвержден';
        else if (o.status === 'pending') statusLabel = 'Авторезерв';

        return {
          id: String(o.id),
          order_number: o.order_number || `ORD-${String(o.id).slice(0, 8)}`,
          client_name: clientName,
          client_company: clientCompany || clientName,
          client_phone: clientPhone,
          status: o.status === 'processing' ? 'processing' : 'pending',
          status_label: statusLabel,
          warehouse: o.warehouse || 'Основной Склад Астана',
          created_at: o.created_at,
          hold_expires_at: o.hold_expires_at,
          total_items: Number(o.total_items) || calculatedQty,
          total_sqm: Number(o.total_sqm) || calculatedSqm,
          total_amount: Number(o.total_amount) || 0,
          currency: 'USD',
          items,
        };
      });
    }
  } catch (sbErr) {
    console.warn('[fetchActiveReservations] Supabase orders fallback notice:', sbErr);
  }

  // 3. Дедупликация и объединение
  const knownDocNumbers = new Set(erpMapped.map(m => String(m.order_number).trim().toUpperCase()));
  const extraSb = sbMapped.filter(sb => !knownDocNumbers.has(String(sb.order_number).trim().toUpperCase()));
  let combined = [...erpMapped, ...extraSb];

  // 4. Фильтрация по SKU
  if (params?.sku) {
    const qSku = params.sku.toLowerCase().trim();
    combined = combined.filter(o =>
      o.items.some(
        it =>
          it.sku.toLowerCase() === qSku ||
          it.sku.toLowerCase().includes(qSku) ||
          qSku.includes(it.sku.toLowerCase()) ||
          it.product_name.toLowerCase().includes(qSku) ||
          it.collection.toLowerCase().includes(qSku)
      )
    );
  }

  // 5. Фильтрация по строке поиска
  if (params?.q) {
    const q = params.q.toLowerCase().trim();
    combined = combined.filter(o =>
      o.client_name.toLowerCase().includes(q) ||
      o.client_company.toLowerCase().includes(q) ||
      o.client_phone.toLowerCase().includes(q) ||
      o.order_number.toLowerCase().includes(q) ||
      o.items.some(it => it.product_name.toLowerCase().includes(q) || it.collection.toLowerCase().includes(q) || it.sku.toLowerCase().includes(q))
    );
  }

  const uniqueClients = new Set(combined.map(o => o.client_company || o.client_name).filter(Boolean));
  const totalReservedQty = combined.reduce((sum, o) => sum + o.total_items, 0);
  const totalReservedSqm = Math.round(combined.reduce((sum, o) => sum + o.total_sqm, 0) * 100) / 100;

  return {
    success: true,
    reservations: combined,
    summary: {
      total_reserved_orders: combined.length,
      total_reserved_pcs: totalReservedQty,
      total_reserved_sqm: totalReservedSqm,
      clients_count: uniqueClients.size,
    },
  };
}
