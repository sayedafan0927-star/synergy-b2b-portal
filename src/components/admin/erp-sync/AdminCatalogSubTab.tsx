import { useLanguage } from '@/contexts/LanguageContext';

export interface AdminCatalogSubTabProps {
  products: any[];
}

export function AdminCatalogSubTab({ products }: AdminCatalogSubTabProps) {
  const { t } = useLanguage();

  return (
    <div className="space-y-3">
      {products.map((p: any) => {
        const totalStock = (p.variants || []).reduce((acc: number, v: any) => {
          return acc + (v.warehouses || []).reduce((s: number, w: any) => s + (w.stock || 0), 0);
        }, 0);

        return (
          <div key={p.id} className="card p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
              <div className="flex items-center gap-2">
                <span className="badge font-mono text-[10px]">ID {p.id}</span>
                <h4 className="text-sm font-bold text-slate-900">{p.name}</h4>
                <span className="badge bg-slate-100 text-slate-600 text-[10px]">{p.collection}</span>
                <span className="text-xs text-slate-400">({p.manufacturer})</span>
              </div>
              <span className={`badge ${totalStock > 0 ? 'bg-emerald-50 text-emerald-700 font-semibold' : 'bg-slate-100 text-slate-400'}`}>
                {t('admin.erp_stock_pcs', { count: totalStock }, `Остаток: ${totalStock} шт.`)}
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-50 text-slate-500 font-semibold">
                    <th className="py-1.5 px-3 text-left">{t('catalog.size', 'Размер')}</th>
                    <th className="py-1.5 px-3 text-left">SKU</th>
                    <th className="py-1.5 px-3 text-left">{t('admin.erp_base_price', 'Базовая цена')}</th>
                    <th className="py-1.5 px-3 text-left">{t('admin.erp_stock_warehouses', 'Склады с наличием')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y border-slate-100">
                  {(p.variants || []).map((v: any) => {
                    const inStockWh = (v.warehouses || []).filter((w: any) => (w.stock || 0) > 0);
                    const vStock = inStockWh.reduce((s: number, w: any) => s + w.stock, 0);

                    return (
                      <tr key={v.sku} className="hover:bg-slate-25">
                        <td className="py-1.5 px-3 font-semibold text-slate-800">{v.size}</td>
                        <td className="py-1.5 px-3 font-mono text-slate-500">{v.sku}</td>
                        <td className="py-1.5 px-3 text-slate-700">${v.base_price}</td>
                        <td className="py-1.5 px-3">
                          {vStock > 0 ? (
                            <div className="flex flex-wrap gap-1.5">
                              {inStockWh.map((w: any) => (
                                <span key={w.city} className="badge bg-emerald-50 text-emerald-700 text-[10px]">
                                  {w.city}: {w.stock} {t('common.pcs', 'шт.')}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-slate-300">{t('admin.erp_no_stock_wh', 'Нет на складах')}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
      {products.length === 0 && (
        <p className="py-8 text-center text-xs text-slate-400">{t('admin.erp_no_products', 'Товары в ERP не найдены')}</p>
      )}
    </div>
  );
}

export default AdminCatalogSubTab;
