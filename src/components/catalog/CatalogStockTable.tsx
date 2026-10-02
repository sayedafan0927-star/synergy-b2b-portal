import { useState, useMemo, useCallback } from 'react';
import { Download, Minus, Plus, ShoppingCart, Check } from 'lucide-react';
import type { PageId, Product, ProductVariant, Warehouse } from '@/types';
import { parseSizeDimensions } from '@/types';
import { useCart } from '@/contexts/CartContext';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useCurrency } from '@/contexts/CurrencyContext';
import { useUserPricing } from '@/hooks/usePricing';
import { useDisplaySettings } from '@/hooks/useDisplaySettings';
import ProductImage from '@/components/ProductImage';
import { getTotalStock, sizeArea } from './types';

interface CatalogStockTableProps {
  filteredProducts: Product[];
  selectedWarehouse: string;
  onNavigate: (page: PageId, productId?: string) => void;
}

export function CatalogStockTable({
  filteredProducts,
  selectedWarehouse,
  onNavigate,
}: CatalogStockTableProps) {
  const { t } = useLanguage();
  const { addItem, items } = useCart();
  const { user } = useAuth();
  const { currency, formatPrice } = useCurrency();
  const pricing = useUserPricing();
  const { settings } = useDisplaySettings();
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [addedKeys, setAddedKeys] = useState<Record<string, boolean>>({});

  const allSizes = useMemo(() => {
    const set = new Set<string>();
    filteredProducts.forEach(p => p.variants.forEach(v => set.add(v.size)));
    return [...set].sort((a, b) => sizeArea(a) - sizeArea(b));
  }, [filteredProducts]);

  const grouped = useMemo(() => {
    const map = new Map<string, Product[]>();
    for (const p of filteredProducts) {
      const arr = map.get(p.collection) ?? [];
      arr.push(p);
      map.set(p.collection, arr);
    }
    return map;
  }, [filteredProducts]);

  const cartCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const item of items) {
      const key = `${item.productId}::${item.size}::${item.warehouse}`;
      map[key] = (map[key] ?? 0) + item.quantity;
    }
    return map;
  }, [items]);

  const cellKey = (productId: string, sku: string, whName: string) => `${productId}::${sku}::${whName}`;

  const setQty = useCallback((key: string, val: number) => {
    setQuantities(prev => ({ ...prev, [key]: Math.max(0, val) }));
  }, []);

  const handleAdd = useCallback(
    (product: Product, variant: ProductVariant, wh: Warehouse) => {
      const whLabel = wh.warehouse_name || wh.city;
      const key = cellKey(product.id, variant.sku, whLabel);
      const qty = quantities[key] ?? 0;
      if (qty < 1 || wh.stock < 1) return;
      const price = pricing.getVariantPrice(product.collection, variant.size, variant.base_price, variant.price_per_sqm);
      const pricePerSqm = pricing.getPricePerSqm(product.collection, variant.size, variant.base_price, variant.price_per_sqm);
      addItem(
        {
          productId: product.id,
          item_id: (variant as any).item_id || (Number(variant.id) > 0 ? Number(variant.id) : (Number(product.id) > 0 ? Number(product.id) : undefined)),
          productName: product.name,
          collection: product.collection,
          image: product.images[0],
          size: variant.size,
          sku: variant.sku,
          warehouse: whLabel,
          warehouse_id: wh.warehouse_id || 81,
          price,
          price_per_sqm: pricePerSqm,
          area_sqm: variant.area_sqm,
          maxStock: wh.stock,
        },
        qty,
      );
      setAddedKeys(prev => ({ ...prev, [key]: true }));
      setTimeout(() => setAddedKeys(prev => ({ ...prev, [key]: false })), 1500);
    },
    [addItem, quantities, pricing],
  );

  function exportCollectionToExcel(collection: string, prods: Product[], sizes: string[], warehouse: string) {
    const BOM = '\uFEFF';
    const sep = '\t';
    const headerParts = ['Товар', 'Производитель'];
    if (settings.show_price) headerParts.push('$/м²');
    headerParts.push(
      ...sizes.flatMap(s => {
        const p = [];
        if (settings.show_total_pcs) p.push(`${s} шт.`);
        if (settings.show_sqm) p.push(`${s} м²`);
        return p;
      }),
    );
    if (settings.show_total_pcs) headerParts.push('Итого шт.');
    if (settings.show_sqm) headerParts.push('Итого м²');
    const header = headerParts.join(sep);
    const rows = prods.map(product => {
      const variantMap = new Map(product.variants.map(v => [v.size, v]));
      const pricePerSqm = pricing.getMinPricePerSqm(product);
      let totalPcs = 0;
      let totalSqm = 0;
      const sizeCells = sizes.flatMap(size => {
        const variant = variantMap.get(size);
        if (!variant) {
          const cells = [];
          if (settings.show_total_pcs) cells.push('');
          if (settings.show_sqm) cells.push('');
          return cells;
        }
        const wh = variant.warehouses.find(w => (w.warehouse_name || w.city) === warehouse);
        const stock = wh?.stock ?? 0;
        const { w, h } = parseSizeDimensions(size);
        const sqm = stock * w * h;
        totalPcs += stock;
        totalSqm += sqm;
        const cells = [];
        if (settings.show_total_pcs) cells.push(String(stock));
        if (settings.show_sqm) cells.push(sqm.toFixed(2));
        return cells;
      });
      const rowParts = [product.name, product.manufacturer];
      if (settings.show_price) rowParts.push(`${pricePerSqm.toFixed(2)}`);
      rowParts.push(...sizeCells);
      if (settings.show_total_pcs) rowParts.push(String(totalPcs));
      if (settings.show_sqm) rowParts.push(totalSqm.toFixed(2));
      return rowParts.join(sep);
    });
    const content = BOM + [header, ...rows].join('\n');
    const blob = new Blob([content], { type: 'application/vnd.ms-excel;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${collection}_${warehouse}.xls`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (filteredProducts.length === 0) return null;

  return (
    <div className="space-y-8">
      {Array.from(grouped.entries()).map(([collection, prods]) => {
        const collTotalStock = prods.reduce((s, p) => s + getTotalStock(p), 0);
        return (
          <div key={collection} className="card overflow-hidden">
            <div className="bg-slate-50 border-b border-slate-200 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900">{collection}</h3>
                <p className="text-xs text-slate-500">
                  {prods.length} поз.{settings.show_total_pcs ? ` / ${collTotalStock} шт. на складе` : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => exportCollectionToExcel(collection, prods, allSizes, selectedWarehouse)}
                className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
              >
                <Download className="h-3.5 w-3.5" />
                Excel
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-25">
                    <th className="sticky left-0 z-10 bg-white py-2.5 pl-4 pr-3 text-left font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap min-w-[200px]">
                      {t('cart.table_product')}
                    </th>
                    {settings.show_price && (
                      <th className="py-2.5 px-2 text-center font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">
                        {currency === 'KZT' ? '₸/м²' : '$/м²'}
                      </th>
                    )}
                    {allSizes.map(size => (
                      <th
                        key={size}
                        className="py-2.5 px-2 text-center font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap border-l border-slate-100"
                      >
                        {size}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {prods.map(product => {
                    const variantMap = new Map(product.variants.map(v => [v.size, v]));
                    const pricePerSqm = pricing.getMinPricePerSqm(product);

                    return (
                      <tr key={product.id} data-product-id={product.id} className="hover:bg-slate-25 group">
                        <td className="sticky left-0 z-10 bg-white group-hover:bg-slate-50 py-2 pl-4 pr-3 transition-colors">
                          <button type="button" onClick={() => onNavigate('product', product.id)} className="text-left cursor-pointer">
                            <div className="flex items-center gap-2.5">
                              <ProductImage
                                src={product.image_thumb || product.images[0]}
                                alt={product.name}
                                loading="lazy"
                                decoding="async"
                                width={72}
                                className="h-9 w-9 rounded object-contain shrink-0"
                              />
                              <div className="min-w-0">
                                <p className="text-xs font-semibold text-slate-900 truncate max-w-[180px] sm:max-w-[220px] lg:max-w-[280px] hover:text-brand-700 transition-colors">
                                  {product.name}
                                </p>
                                <p className="text-[10px] text-slate-400">{product.manufacturer}</p>
                                {(settings.show_total_pcs || settings.show_sqm) && (
                                  <p className="text-[10px] text-slate-400">
                                    {(() => {
                                      let pcs = 0;
                                      let sqm = 0;
                                      product.variants.forEach(v => {
                                        const wh = v.warehouses.find(w => (w.warehouse_name || w.city) === selectedWarehouse);
                                        if (wh) {
                                          pcs += wh.stock;
                                          const { w: vw, h: vh } = parseSizeDimensions(v.size);
                                          sqm += wh.stock * vw * vh;
                                        }
                                      });
                                      const parts = [];
                                      if (settings.show_total_pcs) parts.push(`${pcs} ${t('common.pcs')}`);
                                      if (settings.show_sqm) parts.push(`${sqm.toFixed(1)} ${t('common.sqm')}`);
                                      return parts.join(' / ');
                                    })()}
                                  </p>
                                )}
                              </div>
                            </div>
                          </button>
                        </td>

                        {settings.show_price && (
                          <td className="py-2 px-2 text-center font-bold text-slate-700 whitespace-nowrap">
                            {formatPrice(pricePerSqm)}
                          </td>
                        )}

                        {allSizes.map(size => {
                          const variant = variantMap.get(size);
                          if (!variant) {
                            return (
                              <td key={size} className="py-2 px-2 text-center text-slate-200 border-l border-slate-50">
                                —
                              </td>
                            );
                          }
                          const wh = variant.warehouses.find(w => (w.warehouse_name || w.city) === selectedWarehouse);
                          if (!wh || wh.stock === 0) {
                            const totalForSize = variant.warehouses.reduce((s, w) => s + w.stock, 0);
                            return (
                              <td key={size} className="py-2 px-2 text-center border-l border-slate-50">
                                {totalForSize > 0 ? (
                                  <span className="text-[10px] text-slate-300" title="Нет на выбранном складе">
                                    {totalForSize}
                                  </span>
                                ) : (
                                  <span className="text-slate-200">—</span>
                                )}
                              </td>
                            );
                          }

                          const whLabel = wh.warehouse_name || wh.city;
                          const key = cellKey(product.id, variant.sku, whLabel);
                          const qty = quantities[key] ?? 0;
                          const added = addedKeys[key];
                          const cartKey = `${product.id}::${variant.size}::${whLabel}`;
                          const inCart = cartCounts[cartKey] ?? 0;

                          return (
                            <td key={size} className="py-1.5 px-1.5 border-l border-slate-50">
                              <div className="flex flex-col items-center gap-1">
                                {settings.show_stock && (
                                  <span className="text-[10px] text-emerald-600 font-medium">{wh.stock}</span>
                                )}
                                <div className="flex items-center">
                                  <button
                                    type="button"
                                    onClick={() => setQty(key, Math.max(0, qty - 1))}
                                    className="flex h-6 w-5 items-center justify-center rounded-l border border-slate-200 bg-slate-50 text-slate-400 hover:bg-slate-100 cursor-pointer"
                                  >
                                    <Minus className="h-2.5 w-2.5" />
                                  </button>
                                  <input
                                    type="number"
                                    value={qty}
                                    onChange={e => setQty(key, parseInt(e.target.value, 10) || 0)}
                                    className="h-6 w-8 border-y border-slate-200 bg-white text-center text-[11px] text-slate-900 outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => setQty(key, qty + 1)}
                                    className="flex h-6 w-5 items-center justify-center rounded-r border border-slate-200 bg-slate-50 text-slate-400 hover:bg-slate-100 cursor-pointer"
                                  >
                                    <Plus className="h-2.5 w-2.5" />
                                  </button>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => handleAdd(product, variant, wh)}
                                  disabled={qty < 1}
                                  className={`flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[9px] font-medium transition-all cursor-pointer ${
                                    added
                                      ? 'bg-emerald-600 text-white'
                                      : qty < 1
                                      ? 'bg-slate-100 text-slate-300 cursor-not-allowed'
                                      : 'bg-brand-700 text-white hover:bg-brand-800'
                                  }`}
                                >
                                  {added ? <Check className="h-2.5 w-2.5" /> : <ShoppingCart className="h-2.5 w-2.5" />}
                                  {inCart > 0 && !added && (
                                    <span className="bg-white/30 rounded-full px-1 text-[8px]">{inCart}</span>
                                  )}
                                </button>
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}
export default CatalogStockTable;
