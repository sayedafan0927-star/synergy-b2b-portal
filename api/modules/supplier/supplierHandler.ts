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
    if (s.warehouse_id === 81 || (s.warehouse_name && s.warehouse_name.includes('Астана')) || !s.city) {
      s.city = 'Астана';
      s.warehouse_name = 'Основной Склад Астана';
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

export function handleSupplierDefects(req: VercelRequest, res: VercelResponse) {
  return res.status(200).json({
    success: true,
    supplier_id: Number(req.query.supplier_id || req.body?.supplier_id || 0),
    total_defects: 0,
    defects: [],
  });
}
