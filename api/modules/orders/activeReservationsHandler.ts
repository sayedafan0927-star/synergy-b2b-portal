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

      orders = fallback.data;
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
        return {
          sku: it.sku || '',
          product_name: it.product_name || 'Ковер',
          collection: it.collection || '',
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

    // 2. Интеграция с ERP: если в локальной БД Supabase нет активных заказов, получаем актуальные брони из ERP
    if (mapped.length === 0) {
      try {
        const erpUrl = `${getTargetErpUrl()}?action=orders`;
        const erpKey = getErpApiKey();
        const erpRes = await fetch(erpUrl, {
          headers: {
            'x-portal-key': erpKey,
          },
        });
        if (erpRes.ok) {
          const erpData = await erpRes.json();
          if (erpData?.success && Array.isArray(erpData.orders)) {
            const activeErp = erpData.orders.filter((o: any) =>
              ['pending', 'reserved', 'processing', 'confirmed'].includes(o.status_code) ||
              ['Новый', 'В резерве', 'На сборке'].includes(o.status)
            );
            mapped = activeErp.map((o: any) => {
              const rawItems = Array.isArray(o.items) ? o.items : [];
              const items = rawItems.map((it: any) => {
                const qty = Number(it.quantity) || 1;
                const area = Number(it.area_sqm) || parseSizeArea(it.size);
                return {
                  sku: it.sku || '',
                  product_name: it.name || 'Ковер',
                  collection: it.name?.split(' ')[0] || '',
                  size: it.size || (it.width && it.length ? `${it.width} × ${it.length}` : 'Стандарт'),
                  warehouse: o.warehouse_name || 'Основной Склад Астана',
                  quantity: qty,
                  area_sqm: area,
                  total_sqm: Number(it.total_sqm) || Math.round(qty * area * 100) / 100,
                };
              });
              const calculatedQty = items.reduce((sum: number, it: any) => sum + it.quantity, 0);
              const calculatedSqm = Math.round(items.reduce((sum: number, it: any) => sum + it.total_sqm, 0) * 100) / 100;
              return {
                id: String(o.id),
                order_number: o.doc_number || `ORD-${o.id}`,
                client_name: o.client_name || 'Клиент B2B',
                client_company: o.client_name || '',
                client_phone: o.client_phone || '',
                status: o.status_code === 'processing' ? 'processing' : 'pending',
                warehouse: o.warehouse_name || 'Основной Склад Астана',
                created_at: o.date,
                hold_expires_at: o.hold_expires_at || (o.date ? new Date(new Date(o.date).getTime() + 24 * 3600 * 1000).toISOString() : undefined),
                total_items: calculatedQty || Number(o.items_count) || 1,
                total_sqm: calculatedSqm || Number(o.total_sqm) || 0,
                total_amount: Number(o.total_amount) || 0,
                items,
              };
            });
          }
        }
      } catch (erpErr) {
        console.warn('[Active Reservations API] ERP fallback warning:', erpErr);
      }
    }

    // Фильтрация по SKU если запрошено
    if (skuFilter) {
      const qSku = skuFilter.toLowerCase();
      mapped = mapped.filter((o: any) =>
        o.items.some(
          (it: any) =>
            it.sku.toLowerCase() === qSku ||
            it.sku.toLowerCase().includes(qSku) ||
            qSku.includes(it.sku.toLowerCase()) ||
            it.product_name.toLowerCase().includes(qSku)
        )
      );
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
