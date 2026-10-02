import type { VercelRequest, VercelResponse } from '@vercel/node';

export function normalizeSupplierStockDistribution(jsonData: any) {
  if (!jsonData || !Array.isArray(jsonData.items)) return;
  jsonData.items.forEach((item: any) => {
    if (Array.isArray(item.distribution)) {
      item.distribution.forEach((dist: any) => {
        if (
          dist.warehouse_id === 81 ||
          (dist.warehouse_name && dist.warehouse_name.includes('Астана')) ||
          dist.type === 'central_hub'
        ) {
          dist.city = 'Астана';
          if (!dist.warehouse_name || dist.warehouse_name.includes('Алматы')) {
            dist.warehouse_name = 'Основной Склад Астана';
          }
        }
      });
    }
  });
}

export function filterSupplierShipments(jsonData: any, rawSupplierId: string | string[] | undefined) {
  if (!jsonData || !Array.isArray(jsonData.shipments)) return;

  // 1. Нормализация складов хаба (Основной Склад Астана)
  jsonData.shipments.forEach((s: any) => {
    if (s.warehouse_id === 81 || (s.warehouse_name && s.warehouse_name.includes('Астана'))) {
      s.city = 'Астана';
      s.warehouse_name = 'Основной Склад Астана';
    } else if (s.warehouse_id === 82 || (s.warehouse_name && s.warehouse_name.includes('Алматы'))) {
      s.city = 'Алматы';
      s.warehouse_name = 'Филиал Алматы';
    } else if (s.warehouse_id === 83 || (s.warehouse_name && s.warehouse_name.includes('Шымкент'))) {
      s.city = 'Шымкент';
      s.warehouse_name = 'Филиал Шымкент';
    } else if (s.warehouse_id === 84 || (s.warehouse_name && (s.warehouse_name.includes('Караганд') || s.warehouse_name.includes('Karaganda')))) {
      s.city = 'Караганда';
      s.warehouse_name = 'Филиал Караганда';
    } else if (!s.city) {
      s.city = 'Астана';
      s.warehouse_name = s.warehouse_name || 'Основной Склад Астана';
    }

    // Нормализация безопасного URL скачивания акта через внутренний прокси
    if (s.receipt_id) {
      s.excel_download_url = `/api/erp?action=download_discrepancy_act&receipt_id=${s.receipt_id}`;
    }
  });

  // 2. Интеллектуальное сопоставление партий с выбранной фабрикой
  if (rawSupplierId && rawSupplierId !== '0' && rawSupplierId !== 'all') {
    const sId = Number(rawSupplierId);
    const matched = jsonData.shipments.filter((s: any) => {
      if (s.supplier_id === sId) return true;
      return (
        Array.isArray(s.items) &&
        s.items.some((it: any) => {
          const iname = (it.name || '').toLowerCase();
          const ibrand = (it.brand || '').toLowerCase();
          if (sId === 11 || sId === 26) {
            return iname.includes('saydam') || iname.includes('flora') || ibrand.includes('saydam') || ibrand.includes('flora');
          }
          if (sId === 6) {
            return iname.includes('ismen') || iname.includes('linea') || ibrand.includes('ismen');
          }
          if (sId === 1 || sId === 7) {
            return iname.includes('merinos') || iname.includes('octavia') || iname.includes('oslo') || ibrand.includes('merinos');
          }
          if (sId === 8 || sId === 9 || sId === 31) {
            return (
              iname.includes('iran') ||
              iname.includes('gheytaran') ||
              iname.includes('гейтаран') ||
              iname.includes('исфахан') ||
              iname.includes('afgan')
            );
          }
          if (sId === 10) {
            return iname.includes('karmen');
          }
          if (sId === 12) {
            return iname.includes('lysandra');
          }
          return false;
        })
      );
    });

    if (matched.length > 0) {
      jsonData.shipments = matched;
      jsonData.total_shipments = matched.length;
      jsonData.supplier_id = sId;
    } else {
      jsonData.filter_notice = 'Показан общий реестр склада Астана';
    }
  }
}

export async function handleSupplierDefects(
  req: VercelRequest,
  res: VercelResponse,
  supabase?: any
) {
  if (req.method === 'POST') {
    const payload = req.body || {};
    if (supabase) {
      try {
        const { data, error } = await supabase.from('defect_reports').insert(payload).select().single();
        if (!error && data) {
          return res.status(201).json({ success: true, defect: data });
        }
      } catch (err: any) {
        console.warn('[handleSupplierDefects] Supabase insert notice:', err);
      }
    }
    return res.status(200).json({ success: true, defect: payload });
  }

  const rawId = req.query.supplier_id || req.body?.supplier_id;
  const supplierId = rawId !== undefined && rawId !== 'all' ? Number(rawId) : 0;
  let defects: any[] = [];

  if (supabase) {
    try {
      let query = supabase.from('defect_reports').select('*');
      if (supplierId > 0) {
        query = query.eq('supplier_id', supplierId);
      }
      if (req.query.status && req.query.status !== 'all') {
        query = query.eq('status', String(req.query.status));
      }
      if (req.query.defect_type && req.query.defect_type !== 'all') {
        query = query.eq('defect_type', String(req.query.defect_type));
      }
      const { data, error } = await query.order('created_at', { ascending: false });
      if (!error && Array.isArray(data)) {
        defects = data.map((d: any) => ({
          defect_id: d.defect_id || d.id || `def-${d.act_number || Date.now()}`,
          act_number: d.act_number || `АКТ-${d.id || '001'}`,
          act_date: d.act_date || (d.created_at ? d.created_at.slice(0, 10) : ''),
          supplier_id: d.supplier_id,
          supplier_name: d.supplier_name || 'Фабрика',
          article: d.article || '',
          collection: d.collection || '',
          size: d.size || '',
          warehouse_id: d.warehouse_id || 81,
          warehouse_name: d.warehouse_name || 'Основной Склад Астана',
          city: d.city || 'Астана',
          qty_pcs: Number(d.qty_pcs || 1),
          area_sqm: Number(d.area_sqm || 0),
          defect_type: d.defect_type || 'factory_defect',
          defect_type_label:
            d.defect_type === 'factory_defect'
              ? 'Фабричный брак (разнооттеночность/нить)'
              : d.defect_type === 'transit_damage'
              ? 'Транспортное повреждение / залом'
              : 'Возврат дилера с рекламацией',
          responsible_party: d.responsible_party || 'Фабрика-изготовитель',
          comment: d.comment,
          photo_urls: d.photo_urls,
          status: d.status || 'inspecting',
          status_label:
            d.status === 'discounted'
              ? 'Уценено'
              : d.status === 'scrapped'
              ? 'Утилизировано'
              : 'На экспертизе',
        }));
      }
    } catch (e) {
      console.warn('[handleSupplierDefects] Supabase query notice:', e);
    }
  }

  return res.status(200).json({
    success: true,
    supplier_id: supplierId,
    total_defects: defects.length,
    defects,
  });
}
