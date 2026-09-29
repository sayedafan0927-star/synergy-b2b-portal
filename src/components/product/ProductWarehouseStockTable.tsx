import { ShoppingCart, Check, Minus, Plus, Ruler } from 'lucide-react';
import type { Product, ProductVariant, Warehouse } from '@/types';
import { filterClientWarehouses } from '@/hooks/useProductData';
import { rowKey } from './types';

interface ProductWarehouseStockTableProps {
  product: Product;
  variants: ProductVariant[];
  quantities: Record<string, number>;
  addedKeys: Record<string, boolean>;
  cartCountByKey: Record<string, number>;
  onSetQty: (key: string, val: number) => void;
  onIncQty: (key: string) => void;
  onDecQty: (key: string) => void;
  onAddToCart: (variant: ProductVariant, wh: Warehouse) => void;
  user: any;
  currency: string;
  fmtPrice: (val: number) => string;
  pricing: any;
  myShowroomId?: number;
  myShowroomName?: string;
  clientContext: any;
  displaySettings: any;
  isHubVisible: boolean;
  isShowroomVisible: boolean;
  hasDealerStock: boolean;
  t: (key: string) => string;
  isMobile?: boolean;
}

export function ProductWarehouseStockTable({
  product,
  variants,
  quantities,
  addedKeys,
  cartCountByKey,
  onSetQty,
  onIncQty,
  onDecQty,
  onAddToCart,
  user,
  currency,
  fmtPrice,
  pricing,
  myShowroomId,
  myShowroomName,
  clientContext,
  displaySettings,
  isHubVisible,
  isShowroomVisible,
  hasDealerStock,
  t,
  isMobile = false,
}: ProductWarehouseStockTableProps) {
  function CartButton({ variant, wh }: { variant: ProductVariant; wh: Warehouse }) {
    const whLabel = wh.warehouse_name || wh.city;
    const key = rowKey(variant.sku, whLabel);
    const qty = quantities[key] ?? 0;
    const added = addedKeys[key];
    const inStock = wh.stock > 0;
    const inCart = cartCountByKey[key] ?? 0;

    return (
      <button
        type="button"
        onClick={() => onAddToCart(variant, wh)}
        disabled={!inStock || qty < 1}
        className={`btn-primary relative inline-flex items-center gap-1.5 text-xs px-3 py-1.5 whitespace-nowrap transition-all cursor-pointer ${
          added ? '!bg-emerald-600 !ring-emerald-600' : !inStock || qty < 1 ? 'opacity-40 cursor-not-allowed' : ''
        }`}
      >
        {added ? (
          <><Check className="h-3.5 w-3.5" /> {t('product.added')}</>
        ) : (
          <>
            <ShoppingCart className="h-3.5 w-3.5" /> {t('product.add_to_cart')}
            {inCart > 0 && <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-white/30 px-1 text-[9px] font-bold">{inCart}</span>}
          </>
        )}
      </button>
    );
  }

  function MobileCartButton({ variant, wh }: { variant: ProductVariant; wh: Warehouse }) {
    const whLabel = wh.warehouse_name || wh.city;
    const key = rowKey(variant.sku, whLabel);
    const qty = quantities[key] ?? 0;
    const added = addedKeys[key];
    const inStock = wh.stock > 0;
    const inCart = cartCountByKey[key] ?? 0;

    return (
      <button
        type="button"
        onClick={() => onAddToCart(variant, wh)}
        disabled={!inStock || qty < 1}
        className={`btn-primary flex-1 relative inline-flex items-center justify-center gap-1.5 text-sm h-10 transition-all cursor-pointer ${
          added ? '!bg-emerald-600 !ring-emerald-600' : !inStock || qty < 1 ? 'opacity-40 cursor-not-allowed' : ''
        }`}
      >
        {added ? (
          <><Check className="h-4 w-4" /> {t('product.added')}</>
        ) : (
          <>
            <ShoppingCart className="h-4 w-4" /> {t('product.add_to_cart')}
            {inCart > 0 && <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-white/30 px-1.5 text-[10px] font-bold">{inCart}</span>}
          </>
        )}
      </button>
    );
  }

  if (isMobile) {
    return (
      <div className="flex flex-col gap-3 mb-6">
        {variants.map(variant => {
          const variantPrice = pricing.getVariantPrice(product.collection, variant.size, variant.base_price, variant.price_per_sqm);
          const pricePerSqm = pricing.getPricePerSqm(product.collection, variant.size, variant.base_price, variant.price_per_sqm);
          const rows = filterClientWarehouses(variant.warehouses, myShowroomId, myShowroomName, clientContext, displaySettings);

          return (
            <div key={variant.sku || variant.size} className="card p-4">
              <div className="flex items-center justify-between mb-1">
                <div>
                  <div className="flex items-center gap-1.5 flex-wrap" data-size-cluster={variant.size_cluster}>
                    <span className="text-sm font-bold text-slate-900">{variant.size}</span>
                    {variant.is_runner && (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800 uppercase">Дорожка</span>
                    )}
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-slate-500 font-normal">
                    {(variant.article || product.article) && (
                      <span>Арт: <strong className="text-slate-800 font-medium">{variant.article || product.article}</strong></span>
                    )}
                  </div>
                </div>
                {user && <span className="text-base font-bold text-slate-900">{fmtPrice(variantPrice)}</span>}
              </div>
              {user && pricePerSqm > 0 && (
                <p className="text-xs text-slate-400 mb-2 text-right">
                  {fmtPrice(pricePerSqm)} / м²
                </p>
              )}

              {(hasDealerStock || isHubVisible) && (
                <div className="mb-3 rounded-lg bg-slate-50 p-2 border border-slate-200/60 text-[11px] space-y-1">
                  {isShowroomVisible && (
                    <div className="flex items-center justify-between text-emerald-800 font-medium">
                      <span>🏪 В магазине:</span>
                      <span className="font-bold">{myShowroomId ? (variant.warehouses.find(w => w.warehouse_id === myShowroomId)?.stock || 0) : (variant.dealer_stock?.in_showroom_qty || 0)} шт</span>
                    </div>
                  )}
                  {isShowroomVisible && variant.dealer_stock?.in_transit_qty ? (
                    <div className="flex items-center justify-between text-indigo-800 font-medium">
                      <span>🚚 В пути:</span>
                      <span className="font-bold">{variant.dealer_stock.in_transit_qty} шт</span>
                    </div>
                  ) : null}
                  {isHubVisible && (
                    <div className="flex items-center justify-between text-slate-600">
                      <span>🏢 Основной Склад Астана:</span>
                      <span>{variant.warehouses.find(w => w.warehouse_id === 81 || w.is_hub || (w.warehouse_name && w.warehouse_name.includes('Астана')))?.stock || variant.dealer_stock?.available_hub_qty || 0} шт</span>
                    </div>
                  )}
                </div>
              )}

              {rows.length === 0 ? (
                <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-2.5">
                  <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold bg-slate-100 text-slate-500">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-slate-400" />
                    Нет на складах
                  </span>
                  <span className="text-xs text-slate-400 italic">Под заказ</span>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {rows.map(wh => {
                    const whLabel = wh.warehouse_name || wh.city;
                    const key = rowKey(variant.sku, whLabel);
                    const qty = quantities[key] ?? 0;

                    return (
                      <div key={key} className="border-t border-slate-100 pt-3 first:border-0 first:pt-0">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm text-slate-700 font-medium">{whLabel}</span>
                          <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${wh.stock > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-400'}`}>
                            <span className={`inline-block h-1.5 w-1.5 rounded-full ${wh.stock > 0 ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                            {wh.stock > 0 ? `${wh.stock} шт.` : '0 шт.'}
                          </span>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="inline-flex items-center">
                            <button onClick={() => onDecQty(key)} className="flex h-10 w-10 items-center justify-center rounded-l-md border border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100 transition-colors cursor-pointer">
                              <Minus className="h-4 w-4" />
                            </button>
                            <input type="number" min={0} max={wh.stock} value={qty} onChange={e => onSetQty(key, parseInt(e.target.value, 10) || 0)} className="h-10 w-14 border-y border-slate-200 bg-white text-center text-sm text-slate-900 outline-none focus:border-brand-400 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                            <button onClick={() => onIncQty(key)} className="flex h-10 w-10 items-center justify-center rounded-r-md border border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100 transition-colors cursor-pointer">
                              <Plus className="h-4 w-4" />
                            </button>
                          </div>
                          <MobileCartButton variant={variant} wh={wh} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div id="variant-table" className="hidden lg:block mb-10 border-t border-slate-200 pt-8">
      <h2 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
        <Ruler className="h-5 w-5 text-slate-400" />
        Размеры и наличие
      </h2>
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-400">
                <th className="py-3 pl-5 pr-3 font-semibold">Размер</th>
                <th className="py-3 pr-3 font-semibold">Склад</th>
                <th className="py-3 pr-3 font-semibold">Наличие</th>
                {user && <th className="py-3 pr-3 font-semibold">{currency === 'KZT' ? '₸/м²' : '$/м²'}</th>}
                {user && <th className="py-3 pr-3 font-semibold">Цена</th>}
                <th className="py-3 pr-3 font-semibold">Кол-во</th>
                <th className="py-3 pr-5 font-semibold sr-only">Действие</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {variants.map(variant => {
                const variantPrice = pricing.getVariantPrice(product.collection, variant.size, variant.base_price, variant.price_per_sqm);
                const pricePerSqm = pricing.getPricePerSqm(product.collection, variant.size, variant.base_price, variant.price_per_sqm);

                const rows = filterClientWarehouses(variant.warehouses, myShowroomId, myShowroomName, clientContext, displaySettings);
                if (rows.length === 0) {
                  return (
                    <tr key={variant.sku || variant.size} className="group hover:bg-slate-25 transition-colors opacity-80">
                      <td className="py-3 pl-5 pr-3 text-sm font-medium text-slate-900 whitespace-nowrap">
                        <div>
                          <span className="font-semibold text-slate-900">{variant.size}</span>
                          <div className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-slate-400 font-normal">
                            {(variant.article || product.article) && (
                              <span>Арт: <span className="text-slate-600 font-medium">{variant.article || product.article}</span></span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="py-3 pr-3 text-sm text-slate-400 whitespace-nowrap">—</td>
                      <td className="py-3 pr-3">
                        <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold bg-slate-100 text-slate-500">
                          <span className="inline-block h-1.5 w-1.5 rounded-full bg-slate-400" />
                          Нет на складах
                        </span>
                      </td>
                      {user && (
                        <td className="py-3 pr-3 text-sm text-slate-400 whitespace-nowrap">
                          {pricePerSqm > 0 ? fmtPrice(pricePerSqm) : '—'}
                        </td>
                      )}
                      {user && (
                        <td className="py-3 pr-3 font-bold text-slate-400 whitespace-nowrap">
                          {fmtPrice(variantPrice)}
                        </td>
                      )}
                      <td className="py-3 pr-3 text-sm text-slate-400">—</td>
                      <td className="py-3 pr-5 text-right">
                        <span className="text-xs text-slate-400 italic">Под заказ</span>
                      </td>
                    </tr>
                  );
                }

                return rows.map((wh, whIdx) => {
                  const whLabel = wh.warehouse_name || wh.city;
                  const key = rowKey(variant.sku, whLabel);
                  const qty = quantities[key] ?? 0;
                  const isFirstRow = whIdx === 0;

                  return (
                    <tr key={key} className="group hover:bg-slate-25 transition-colors">
                      <td className={`py-3 pl-5 pr-3 text-sm font-medium text-slate-900 whitespace-nowrap ${!isFirstRow ? 'pt-1' : ''}`}>
                        {isFirstRow ? (
                          <div>
                            <div className="flex items-center gap-1.5 flex-wrap" data-size-cluster={variant.size_cluster}>
                              <span className="font-semibold text-slate-900">{variant.size}</span>
                              {variant.is_runner && (
                                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800 uppercase">Дорожка</span>
                              )}
                            </div>
                            <div className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-slate-400 font-normal">
                              {(variant.article || product.article) && (
                                <span>Арт: <span className="text-slate-600 font-medium">{variant.article || product.article}</span></span>
                              )}
                            </div>
                            {(hasDealerStock || isHubVisible) && (
                              <div className="mt-1 flex flex-col gap-0.5 text-[11px]">
                                {isShowroomVisible && (
                                  <span className="inline-flex items-center gap-1 font-medium text-emerald-700">
                                    🏪 В магазине: {myShowroomId ? (variant.warehouses.find(w => w.warehouse_id === myShowroomId)?.stock || 0) : (variant.dealer_stock?.in_showroom_qty || 0)} шт
                                  </span>
                                )}
                                {isShowroomVisible && variant.dealer_stock && variant.dealer_stock.in_transit_qty > 0 && (
                                  <span className="inline-flex items-center gap-1 font-medium text-indigo-700">
                                    🚚 В пути: {variant.dealer_stock.in_transit_qty} шт
                                  </span>
                                )}
                                {isHubVisible && (
                                  <span className="inline-flex items-center gap-1 text-slate-500">
                                    🏢 Основной Склад Астана: {variant.warehouses.find(w => w.warehouse_id === 81 || w.is_hub || (w.warehouse_name && w.warehouse_name.includes('Астана')))?.stock || 0} шт
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        ) : ''}
                      </td>
                      <td className="py-3 pr-3 text-sm text-slate-600 whitespace-nowrap">{whLabel}</td>
                      <td className="py-3 pr-3">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${wh.stock > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-400'}`}>
                          <span className={`inline-block h-1.5 w-1.5 rounded-full ${wh.stock > 0 ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                          {wh.stock > 0 ? `${wh.stock} шт.` : '0 шт.'}
                        </span>
                      </td>
                      {user && (
                        <td className="py-3 pr-3 text-sm whitespace-nowrap">
                          {pricePerSqm > 0 ? (
                            <div className="flex items-center gap-1.5">
                              <span className={variant.is_on_sale ? 'font-bold text-red-600' : 'text-slate-500'}>
                                {fmtPrice(pricePerSqm)}
                              </span>
                              {variant.is_on_sale && variant.old_price_per_sqm && (
                                <span className="text-xs text-gray-400 line-through">
                                  {fmtPrice(variant.old_price_per_sqm)}
                                </span>
                              )}
                            </div>
                          ) : '—'}
                        </td>
                      )}
                      {user && (
                        <td className="py-3 pr-3 font-bold whitespace-nowrap">
                          {isFirstRow ? (
                            <div className="flex items-center gap-1.5">
                              <span className={variant.is_on_sale ? 'text-red-600' : 'text-slate-900'}>
                                {fmtPrice(variantPrice)}
                              </span>
                              {variant.is_on_sale && variant.old_price && (
                                <span className="text-xs text-gray-400 line-through font-normal">
                                  {fmtPrice(variant.old_price)}
                                </span>
                              )}
                            </div>
                          ) : ''}
                        </td>
                      )}
                      <td className="py-3 pr-3">
                        <div className="inline-flex items-center">
                          <button onClick={() => onDecQty(key)} className="flex h-8 w-8 items-center justify-center rounded-l-md border border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100 transition-colors cursor-pointer">
                            <Minus className="h-3.5 w-3.5" />
                          </button>
                          <input type="number" min={0} max={wh.stock} value={qty} onChange={e => onSetQty(key, parseInt(e.target.value, 10) || 0)} className="h-8 w-12 border-y border-slate-200 bg-white text-center text-sm text-slate-900 outline-none focus:border-brand-400 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                          <button onClick={() => onIncQty(key)} className="flex h-8 w-8 items-center justify-center rounded-r-md border border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100 transition-colors cursor-pointer">
                            <Plus className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                      <td className="py-3 pr-5">
                        <CartButton variant={variant} wh={wh} />
                      </td>
                    </tr>
                  );
                });
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
export default ProductWarehouseStockTable;
