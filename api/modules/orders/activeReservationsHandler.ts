import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { SupabaseClient } from '@supabase/supabase-js';

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

  try {
    const skuFilter = req.query.sku ? String(req.query.sku).trim() : null;
    const searchFilter = req.query.q ? String(req.query.q).toLowerCase().trim() : null;

    const { data: orders, error } = await supabase
      .from('orders')
      .select('id, order_number, user_id, placed_by_id, client_name, client_company, client_phone, status, warehouse, hold_expires_at, total_amount, total_sqm, total_items, items, created_at')
      .in('status', ['pending', 'reserved', 'confirmed', 'processing'])
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) {
      console.warn('[Active Reservations API] Supabase query error:', error.message);
      return res.status(500).json({ success: false, error: error.message });
    }

    let mapped = (orders || []).map((o: any) => {
      const rawItems = Array.isArray(o.items) ? o.items : [];
      const items = rawItems.map((it: any) => {
        const qty = Number(it.quantity) || 1;
        const areaSqm = Number(it.area_sqm) || 1;
        return {
          sku: it.sku || '',
          product_name: it.product_name || it.name || 'Ковер',
          collection: it.collection || '',
          size: it.size || '',
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
        client_name: o.client_name || o.client_company || 'Клиент',
        client_company: o.client_company || '',
        client_phone: o.client_phone || '',
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

    // Фильтрация по SKU если запрошено
    if (skuFilter) {
      mapped = mapped.filter((o: any) => o.items.some((it: any) => it.sku.toLowerCase() === skuFilter.toLowerCase()));
    }

    // Текстовый поиск (по клиенту, компании, телефону, номеру заказа)
    if (searchFilter) {
      mapped = mapped.filter((o: any) =>
        o.client_name.toLowerCase().includes(searchFilter) ||
        o.client_company.toLowerCase().includes(searchFilter) ||
        o.client_phone.toLowerCase().includes(searchFilter) ||
        o.order_number.toLowerCase().includes(searchFilter) ||
        o.items.some((it: any) => it.product_name.toLowerCase().includes(searchFilter) || it.collection.toLowerCase().includes(searchFilter))
      );
    }

    const uniqueClients = new Set(mapped.map((o: any) => o.client_company || o.client_name).filter(Boolean));
    const totalReservedQty = mapped.reduce((sum: number, o: any) => sum + o.total_items, 0);
    const totalReservedSqm = Math.round(mapped.reduce((sum: number, o: any) => sum + o.total_sqm, 0) * 100) / 100;

    return res.status(200).json({
      success: true,
      reservations: mapped,
      summary: {
        total_reserved_orders: mapped.length,
        total_reserved_pcs: totalReservedQty,
        total_reserved_sqm: totalReservedSqm,
        clients_count: uniqueClients.size,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'Ошибка загрузки резервов' });
  }
}
