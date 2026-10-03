import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getTargetErpUrl, getErpApiKey } from '../../lib/erpKey';

export async function handleActiveReservations(
  req: VercelRequest,
  res: VercelResponse,
  supabase: SupabaseClient | null,
  callerAuth: any
) {
  if (!supabase) {
    return res.status(503).json({ success: false, error: 'БД Supabase недоступна' });
  }

  const role = callerAuth?.profile?.role || callerAuth?.role;
  const isPrivileged = role === 'admin' || role === 'manager_rm' || role === 'manager_lm';

  // Проверка прав для обычных клиентов: разрешено только если в client_warehouse_rules включен show_stock_summary
  if (!isPrivileged) {
    const clientId = callerAuth?.profile?.partner_id || callerAuth?.profile?.id || callerAuth?.userId;
    if (!clientId) {
      return res.status(403).json({ success: false, error: 'Доступ к просмотру резервов ограничен' });
    }

    const { data: rule } = await supabase
      .from('client_warehouse_rules')
      .select('show_stock_summary')
      .eq('client_id', String(clientId))
      .maybeSingle();

    if (rule?.show_stock_summary !== true) {
      return res.status(403).json({ success: false, error: 'У вас нет разрешения на просмотр складских резервов' });
    }
  }

function parseSizeArea(sizeStr?: string): number {
  if (!sizeStr) return 1;
  const parts = String(sizeStr).replace(',', '.').split(/[*×xXхХ]/).map(s => parseFloat(s.trim()));
  if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1]) && parts[0] > 0 && parts[1] > 0) {
    return Math.round(parts[0] * parts[1] * 100) / 100;
  }
  return 1;
}

function clean1CName(rawName?: string): { name: string; sku: string; collection: string } {
  if (!rawName) return { name: 'Ковер', sku: '', collection: '' };
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
        collection: coll,
      };
    }
  }
  const clean = rawName.replace(/<[^>]+>/g, '').trim();
  const coll = clean.split(' ')[0] || '';
  return { name: clean, sku: '', collection: coll };
}

  try {
    const skuFilter = req.query.sku ? String(req.query.sku).trim() : null;
    const searchFilter = req.query.q ? String(req.query.q).toLowerCase().trim() : null;

    let { data: orders, error } = await supabase
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
      .limit(200);

    // Resilient fallback if PostgREST schema cache lacks the foreign key relationship between orders and user_id
    if (error && error.message?.includes('relationship')) {
      const fallback = await supabase
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
        .limit(200);

      orders = fallback.data as any;
      error = fallback.error;
    }

    if (error) {
      console.warn('[Active Reservations API] Supabase query error:', error.message);
      return res.status(500).json({ success: false, error: error.message });
    }

    // Resolve profiles independently if embedded join was bypassed by fallback
    const userIds = [...new Set((orders || []).flatMap((o: any) => [o.user_id, o.placed_by_id]).filter(Boolean))];
    const profileMap = new Map<string, any>();
    if (userIds.length > 0) {
      try {
        const { data: profs } = await supabase
          .from('profiles')
          .select('id, full_name, company_name, phone')
          .in('id', userIds);
        (profs || []).forEach((p: any) => {
          if (p?.id) profileMap.set(String(p.id), p);
        });
      } catch (err) {
        console.warn('[Active Reservations API] Profile resolution error:', err);
      }
    }

    let mapped = (orders || []).map((o: any) => {
      const profile = o.profiles || profileMap.get(String(o.user_id)) || profileMap.get(String(o.placed_by_id)) || {};
      const clientName = profile.full_name || profile.company_name || 'Клиент B2B';
      const clientCompany = profile.company_name || '';
      const clientPhone = profile.phone || '';
      const rawItems = Array.isArray(o.order_items) ? o.order_items : [];

      const items = rawItems.map((it: any) => {
        const qty = Number(it.quantity) || 1;
        const areaSqm = parseSizeArea(it.size);
        const cleaned = clean1CName(it.product_name || it.name || '');
        return {
          sku: it.sku || cleaned.sku || '',
          product_name: cleaned.name || it.product_name || 'Ковер',
          collection: it.collection || cleaned.collection || '',
          size: it.size || 'Стандарт',
          warehouse: it.warehouse || o.warehouse || 'Основной Склад Астана',
          quantity: qty,
          area_sqm: areaSqm,
          total_sqm: Math.round(qty * areaSqm * 100) / 100,
        };
      });

      const calculatedQty = items.reduce((sum: number, it: any) => sum + it.quantity, 0);
      const calculatedSqm = Math.round(items.reduce((sum: number, it: any) => sum + it.total_sqm, 0) * 100) / 100;

      return {
        id: String(o.id),
        order_number: o.order_number || `ORD-${o.id.slice(0, 8)}`,
        client_name: clientName,
        client_company: clientCompany,
        client_phone: clientPhone,
        status: o.status,
        warehouse: o.warehouse || 'Основной Склад Астана',
        created_at: o.created_at,
        hold_expires_at: o.hold_expires_at,
        total_items: Number(o.total_items) || calculatedQty,
        total_sqm: Number(o.total_sqm) || calculatedSqm,
        total_amount: Number(o.total_amount) || 0,
        items,
      };
    });

    // 1. Запрос живых броней и статусов из ERP (первичный источник складских WMS-резервов)
    let erpMapped: any[] = [];
    try {
      const erpUrl = `${getTargetErpUrl()}?action=orders`;
      const erpKey = getErpApiKey();
      const erpRes = await fetch(erpUrl, {
        headers: { 'x-portal-key': erpKey },
        signal: AbortSignal.timeout(6000),
      });
      if (erpRes.ok) {
        const erpData = await erpRes.json();
        if (erpData?.success && Array.isArray(erpData.orders)) {
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
            const items = rawItems.map((it: any) => {
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
            const calculatedQty = items.reduce((sum: number, it: any) => sum + it.quantity, 0);
            const calculatedSqm = Math.round(items.reduce((sum: number, it: any) => sum + it.total_sqm, 0) * 100) / 100;

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
      }
    } catch (erpErr) {
      console.warn('[Active Reservations API] ERP live orders warning:', erpErr);
    }

    // 2. Слияние с заказами Supabase (для заказов в пути, еще не отраженных в 1С/ERP)
    const knownDocNumbers = new Set(erpMapped.map((m: any) => String(m.order_number).trim()));
    const extraSupabase = (mapped || []).filter((sb: any) => !knownDocNumbers.has(String(sb.order_number).trim()));
    let combined = [...erpMapped, ...extraSupabase];

    // Фильтрация по SKU если запрошено
    if (skuFilter) {
      const qSku = skuFilter.toLowerCase().trim();
      combined = combined.filter((o: any) =>
        o.items.some(
          (it: any) =>
            it.sku.toLowerCase() === qSku ||
            it.sku.toLowerCase().includes(qSku) ||
            qSku.includes(it.sku.toLowerCase()) ||
            it.product_name.toLowerCase().includes(qSku) ||
            it.collection.toLowerCase().includes(qSku)
        )
      );
    }

    // Текстовый поиск (по клиенту, компании, телефону, номеру заказа, товарам)
    if (searchFilter) {
      combined = combined.filter((o: any) =>
        o.client_name.toLowerCase().includes(searchFilter) ||
        o.client_company.toLowerCase().includes(searchFilter) ||
        o.client_phone.toLowerCase().includes(searchFilter) ||
        o.order_number.toLowerCase().includes(searchFilter) ||
        o.items.some((it: any) => it.product_name.toLowerCase().includes(searchFilter) || it.collection.toLowerCase().includes(searchFilter))
      );
    }

    const uniqueClients = new Set(combined.map((o: any) => o.client_company || o.client_name).filter(Boolean));
    const totalReservedQty = combined.reduce((sum: number, o: any) => sum + o.total_items, 0);
    const totalReservedSqm = Math.round(combined.reduce((sum: number, o: any) => sum + o.total_sqm, 0) * 100) / 100;

    return res.status(200).json({
      success: true,
      reservations: combined,
      summary: {
        total_reserved_orders: combined.length,
        total_reserved_pcs: totalReservedQty,
        total_reserved_sqm: totalReservedSqm,
        clients_count: uniqueClients.size,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'Ошибка загрузки резервов' });
  }
}
