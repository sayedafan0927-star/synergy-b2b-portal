import { Trash2, Plus, Minus, Filter, AlertTriangle, AlertCircle } from 'lucide-react';
import type { CartItem } from '@/types';
import { calcSqm, formatProductionEta } from '@/types';
import { useCurrency } from '@/contexts/CurrencyContext';
import { useLanguage } from '@/contexts/LanguageContext';
import ProductImage from '@/components/ProductImage';
import { fmt2, calcSizeSubtotals, calcCollectionSubtotals, matchCartItemConflict, type SizeSubtotal, type StockConflictItem } from './types';
import { CartSubtotalsPanel } from './CartSubtotalsPanel';

interface CartItemsTableProps {
  items: CartItem[];
  activeCollection: string | null;
  onSelectCollection: (col: string | null) => void;
  sizeAsc: boolean;
  onToggleSizeSort: () => void;
  onUpdateQuantity: (productId: string, size: string, warehouse: string, qty: number) => void;
  onRemoveItem: (productId: string, size: string, warehouse: string) => void;
  onClearCart: () => void;
  conflictItems?: StockConflictItem[] | null;
}

export function CartItemsTable({
  items,
  activeCollection,
  onSelectCollection,
  sizeAsc,
  onToggleSizeSort,
  onUpdateQuantity,
  onRemoveItem,
  onClearCart,
  conflictItems = null,
}: CartItemsTableProps) {
  const { formatPrice: fmtPrice } = useCurrency();
  const { t } = useLanguage();

  const collections = Array.from(new Set(items.map(it => it.collection))).filter(Boolean);
  const effectiveActiveCollection = activeCollection && collections.includes(activeCollection) ? activeCollection : null;
  const displayedItems = effectiveActiveCollection ? items.filter(it => it.collection === effectiveActiveCollection) : items;

  const rawSubtotals = calcSizeSubtotals(displayedItems);
  const sizeSubtotals: SizeSubtotal[] = sizeAsc ? rawSubtotals : [...rawSubtotals].reverse();
  const collectionSubtotals = calcCollectionSubtotals(items, sizeAsc);

  const displayedTotalQty = displayedItems.reduce((acc, it) => acc + it.quantity, 0);
  const displayedTotalSqm = displayedItems.reduce((acc, it) => acc + calcSqm(it.size, it.quantity), 0);
  const displayedTotalSum = displayedItems.reduce((acc, it) => acc + it.price * it.quantity, 0);

  const handleQtyInputChange = (item: CartItem, rawVal: string) => {
    const val = parseInt(rawVal.replace(/\D+/g, ''), 10);
    if (isNaN(val) || val < 1) return;
    const max = item.maxStock !== undefined ? item.maxStock : 9999;
    onUpdateQuantity(item.productId, item.size, item.warehouse, Math.min(val, max));
  };

  return (
    <div className="space-y-4">
      {/* Коллекции / быстрые фильтры и кнопка очистки */}
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          {collections.length >= 1 && (
            <>
              <span className="text-xs text-slate-500 mr-1 flex items-center gap-1 font-medium">
                <Filter className="h-3 w-3" /> {t('catalog.filter_collection')}:
              </span>
              <button
                type="button"
                onClick={() => onSelectCollection(null)}
                className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors cursor-pointer ${
                  effectiveActiveCollection === null
                    ? 'bg-brand-700 text-white shadow-2xs'
                    : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                {t('common.all')} ({items.reduce((s, it) => s + it.quantity, 0)})
              </button>
              {collections.map(col => {
                const colItems = items.filter(it => it.collection === col);
                const colQty = colItems.reduce((s, it) => s + it.quantity, 0);
                const colHasConflict = colItems.some(it => Boolean(matchCartItemConflict(it, conflictItems)));
                return (
                  <button
                    key={col}
                    type="button"
                    onClick={() => onSelectCollection(col)}
                    className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors cursor-pointer ${
                      colHasConflict
                        ? 'bg-red-600 text-white ring-2 ring-red-300 shadow-xs'
                        : effectiveActiveCollection === col
                        ? 'bg-brand-700 text-white shadow-2xs'
                        : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {colHasConflict ? `⚠️ ${col}` : col} ({colQty})
                  </button>
                );
              })}
            </>
          )}
        </div>

        <div className="flex items-center gap-2 ml-auto">
          <button
            type="button"
            onClick={onClearCart}
            className="text-xs text-slate-500 hover:text-red-600 transition-colors flex items-center gap-1 font-medium cursor-pointer"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>{t('cart.clear_cart')}</span>
          </button>
        </div>
      </div>

      {/* ─── 1. High-Density B2B Data Grid (Desktop & Tablet only: hidden on mobile) ─── */}
      <div className="card overflow-hidden border border-slate-200 bg-white shadow-2xs hidden sm:block">
        <div className="overflow-x-auto max-h-[620px] overflow-y-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="sticky top-0 bg-slate-50/95 backdrop-blur-xs border-b border-slate-200 z-10 text-[11px] font-bold text-slate-600 uppercase tracking-wider">
              <tr>
                <th className="py-2.5 px-3 min-w-[240px]">{t('cart.table_product')}</th>
                <th className="py-2.5 px-2 text-center whitespace-nowrap">{t('cart.table_size')}</th>
                <th className="py-2.5 px-2.5 whitespace-nowrap">{t('cart.table_warehouse')}</th>
                <th className="py-2.5 px-2 text-right whitespace-nowrap">{t('cart.table_price')}</th>
                <th className="py-2.5 px-2 text-center whitespace-nowrap">{t('cart.table_qty')}</th>
                <th className="py-2.5 px-3 text-right whitespace-nowrap">{t('cart.table_sum')}</th>
                <th className="py-2.5 px-2 text-center w-9"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {displayedItems.map(item => {
                const key = `${item.productId}-${item.size}-${item.warehouse}`;
                const sqm = calcSqm(item.size, item.quantity);
                const lineTotal = item.price * item.quantity;
                const conflict = matchCartItemConflict(item, conflictItems);
                const effectiveAvail = conflict?.available_qty !== undefined ? conflict.available_qty : item.maxStock;
                const isDepleted = effectiveAvail === 0;
                const isOverStock = typeof effectiveAvail === 'number' && effectiveAvail > 0 && item.quantity > effectiveAvail;
                const hasStockConflict = Boolean(conflict) || isDepleted || isOverStock;
                const isZeroPrice = !item.price || item.price <= 0;

                return (
                  <tr
                    key={key}
                    data-stock-conflict={hasStockConflict ? 'true' : undefined}
                    className={`transition-colors ${
                      hasStockConflict
                        ? 'bg-red-50/95 hover:bg-red-100/90 text-red-950 ring-2 ring-inset ring-red-500 border-l-4 border-l-red-600'
                        : isZeroPrice
                        ? 'bg-amber-50/50 hover:bg-amber-50/80 text-amber-950'
                        : 'hover:bg-slate-50/80 text-slate-800'
                    }`}
                  >
                    {/* Товар / Артикул с компактным превью */}
                    <td className="py-2.5 px-3">
                      <div className="flex items-start gap-2.5">
                        <ProductImage
                          src={item.image}
                          alt={item.productName}
                          loading="lazy"
                          decoding="async"
                          width={40}
                          className={`h-10 w-10 shrink-0 rounded-md object-contain bg-slate-50 p-0.5 ${
                            hasStockConflict ? 'border-2 border-red-500 ring-2 ring-red-200' : 'border border-slate-200/80'
                          }`}
                        />
                        <div className="min-w-0 flex-1">
                          <p className={`text-xs leading-snug break-words ${hasStockConflict ? 'font-extrabold text-red-900' : 'font-bold text-slate-900'}`}>
                            {item.productName}
                          </p>
                          <div className="flex flex-wrap items-center gap-1.5 text-[10.5px] text-slate-500 mt-0.5">
                            {item.collection && (
                              <span className={`px-1.5 py-0.2 rounded font-semibold ${hasStockConflict ? 'bg-red-100 text-red-800' : 'bg-slate-100 text-slate-700'}`}>{item.collection}</span>
                            )}
                            <span className={`font-mono px-1.5 py-0.2 rounded ${hasStockConflict ? 'bg-red-600 text-white font-bold' : 'bg-slate-100 text-slate-600'}`}>SKU: {item.sku || '—'}</span>
                            {isZeroPrice && !hasStockConflict && (
                              <span className="inline-flex items-center text-amber-700 font-semibold gap-0.5">
                                <AlertTriangle className="h-3 w-3" /> {t('cart.price_pending', 'Цена не установлена')}
                              </span>
                            )}
                          </div>
                          {hasStockConflict && (
                            <div className="mt-1.5 flex items-start gap-1.5 rounded-md bg-red-600/10 border border-red-400 px-2 py-1 text-[11px] font-bold text-red-800">
                              <AlertCircle className="h-3.5 w-3.5 text-red-600 shrink-0 mt-0.5" />
                              <div>
                                <span>{isDepleted ? `Закончился на складе: «${item.productName}» (${item.size})` : `Недостаточно остатка: «${item.productName}» (${item.size})`}</span>
                                <span className="block text-[10.5px] font-semibold text-red-700">
                                  Доступно на складе: {effectiveAvail ?? 0} {t('common.pcs')} • Запрошено: {conflict?.requested_qty ?? item.quantity} {t('common.pcs')}
                                </span>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Размер и площадь */}
                    <td className="py-2 px-2 text-center whitespace-nowrap">
                      <span className={`inline-block px-2 py-0.5 rounded-md font-bold text-[11px] ${hasStockConflict ? 'bg-red-100 text-red-900 border border-red-300' : 'text-slate-800 bg-slate-100 border border-slate-200/80'}`}>
                        {item.size}
                      </span>
                      <p className={`text-[10px] mt-0.5 font-medium ${hasStockConflict ? 'text-red-700' : 'text-slate-500'}`}>{fmt2(sqm)} {t('common.sqm')}</p>
                    </td>

                    {/* Склад */}
                    <td className="py-2 px-2.5 whitespace-nowrap">
                      {item.is_preorder || item.warehouse === 'Предзаказ (Фабрика)' ? (
                        <div>
                          <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 border border-amber-200 px-1.5 py-0.5 text-[10px] font-bold text-amber-900">🏭 В производстве</span>
                          {item.production_eta && <p className="text-[10px] text-amber-800 mt-0.5">Выход: ~{formatProductionEta(item.production_eta)}</p>}
                        </div>
                      ) : (
                        <p className={`text-xs font-semibold ${hasStockConflict ? 'text-red-900' : 'text-slate-800'}`} title={item.warehouse}>{item.warehouse}</p>
                      )}
                      {effectiveAvail !== undefined && (
                        <p className={`text-[10.5px] font-bold mt-0.5 ${hasStockConflict ? 'inline-block rounded bg-red-600 text-white px-1.5 py-0.5' : 'text-slate-500 font-medium'}`}>
                          {t('cart.free_qty')} <strong>{effectiveAvail} {t('common.pcs')}</strong>
                        </p>
                      )}
                    </td>

                    {/* Цена за ед. */}
                    <td className="py-2 px-2 text-right whitespace-nowrap">
                      {isZeroPrice ? (
                        <span className="text-xs font-semibold text-amber-700">{t('cart.price_pending')}</span>
                      ) : (
                        <div>
                          <p className={`font-bold text-xs ${hasStockConflict ? 'text-red-900' : 'text-slate-900'}`}>{fmtPrice(item.price)}</p>
                          {item.price_per_sqm ? <p className={`text-[10px] ${hasStockConflict ? 'text-red-700' : 'text-slate-500'}`}>{fmtPrice(item.price_per_sqm)}/{t('common.sqm')}</p> : null}
                        </div>
                      )}
                    </td>

                    {/* Ввод количества */}
                    <td className="py-2 px-2 text-center whitespace-nowrap">
                      <div className={`inline-flex items-center rounded-lg bg-white shadow-2xs ${hasStockConflict ? 'border-2 border-red-500 ring-2 ring-red-200' : 'border border-slate-300'}`}>
                        <button
                          type="button"
                          onClick={() => onUpdateQuantity(item.productId, item.size, item.warehouse, item.quantity - 1)}
                          disabled={item.quantity <= 1 || isDepleted}
                          className="h-7 w-7 flex items-center justify-center text-slate-600 hover:text-slate-900 hover:bg-slate-100 disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer rounded-l-md"
                          title="-"
                        >
                          <Minus className="h-3 w-3" />
                        </button>
                        <input
                          type="number"
                          min="1"
                          max={effectiveAvail || 9999}
                          value={item.quantity}
                          disabled={isDepleted}
                          onChange={e => handleQtyInputChange(item, e.target.value)}
                          className={`w-11 text-center font-bold text-xs focus:outline-hidden py-1 border-x ${hasStockConflict ? 'text-red-700 border-red-300 bg-red-50/40' : 'text-slate-900 border-slate-200'}`}
                        />
                        <button
                          type="button"
                          onClick={() => onUpdateQuantity(item.productId, item.size, item.warehouse, item.quantity + 1)}
                          disabled={isDepleted || (item.maxStock !== undefined && item.quantity >= item.maxStock) || (effectiveAvail !== undefined && item.quantity >= effectiveAvail)}
                          className="h-7 w-7 flex items-center justify-center text-slate-600 hover:text-slate-900 hover:bg-slate-100 disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer rounded-r-md"
                          title="+"
                        >
                          <Plus className="h-3 w-3" />
                        </button>
                      </div>
                    </td>

                    {/* Сумма по строке */}
                    <td className="py-2 px-3 text-right whitespace-nowrap">
                      {isZeroPrice ? (
                        <span className="text-xs font-semibold text-amber-700">{t('cart.price_pending')}</span>
                      ) : (
                        <span className={`text-xs font-extrabold ${hasStockConflict ? 'text-red-700' : 'text-brand-700'}`}>{fmtPrice(lineTotal)}</span>
                      )}
                    </td>

                    {/* Удаление */}
                    <td className="py-2 px-2 text-center whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => onRemoveItem(item.productId, item.size, item.warehouse)}
                        title="Удалить позицию"
                        className={`p-1.5 rounded-md transition-colors cursor-pointer ${hasStockConflict ? 'bg-red-600 text-white hover:bg-red-700 shadow-2xs' : 'text-slate-400 hover:text-rose-600 hover:bg-rose-50'}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="bg-slate-50/95 border-t border-slate-200 text-xs">
              <tr>
                <td className="py-2.5 px-3 font-bold text-slate-800">
                  {effectiveActiveCollection
                    ? `${t('cart.collection_subtotal_label', 'Итого по коллекции')} ${effectiveActiveCollection}:`
                    : `${t('cart.all_collections_subtotal_label', 'Итого по всем коллекциям')}:`}
                </td>
                <td className="py-2.5 px-2 text-center font-bold text-slate-800 whitespace-nowrap">{fmt2(displayedTotalSqm)} {t('common.sqm')}</td>
                <td colSpan={2} className="py-2.5 px-2"></td>
                <td className="py-2.5 px-2 text-center font-bold text-slate-900 whitespace-nowrap">{displayedTotalQty} {t('common.pcs')}</td>
                <td className="py-2.5 px-3 text-right font-extrabold text-brand-700 whitespace-nowrap">{fmtPrice(displayedTotalSum)}</td>
                <td className="py-2.5 px-2"></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* ─── 2. Мобильный карточный режим (адаптировано для смартфонов, 0 гориз. скролла) ─── */}
      <div className="space-y-3 block sm:hidden">
        {displayedItems.map(item => {
          const key = `${item.productId}-${item.size}-${item.warehouse}`;
          const sqm = calcSqm(item.size, item.quantity);
          const lineTotal = item.price * item.quantity;
          const conflict = matchCartItemConflict(item, conflictItems);
          const effectiveAvail = conflict?.available_qty !== undefined ? conflict.available_qty : item.maxStock;
          const isDepleted = effectiveAvail === 0;
          const isOverStock = typeof effectiveAvail === 'number' && effectiveAvail > 0 && item.quantity > effectiveAvail;
          const hasStockConflict = Boolean(conflict) || isDepleted || isOverStock;
          const isZeroPrice = !item.price || item.price <= 0;

          return (
            <div
              key={key}
              data-stock-conflict={hasStockConflict ? 'true' : undefined}
              className={`card p-3.5 flex flex-col gap-3 rounded-xl border bg-white shadow-xs ${
                hasStockConflict ? 'bg-red-50/95 border-2 border-red-500 ring-2 ring-red-500/20' : isZeroPrice ? 'bg-amber-50/60 border-amber-200' : 'border-slate-200'
              }`}
            >
              {hasStockConflict && (
                <div className="flex items-start gap-2 rounded-lg bg-red-600 text-white px-3 py-2 text-xs font-bold shadow-2xs">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <p className="leading-snug">{isDepleted ? 'Закончился на складе:' : 'Недостаточно остатка:'} {item.productName} ({item.size})</p>
                    <p className="text-[11px] font-semibold text-red-100 mt-0.5">
                      SKU: {item.sku} • Доступно: {effectiveAvail ?? 0} {t('common.pcs')} (в заказе: {conflict?.requested_qty ?? item.quantity} {t('common.pcs')})
                    </p>
                  </div>
                </div>
              )}

              <div className="flex items-start gap-3">
                <ProductImage
                  src={item.image}
                  alt={item.productName}
                  loading="lazy"
                  decoding="async"
                  width={64}
                  className={`h-16 w-16 shrink-0 rounded-lg object-contain bg-slate-50 p-1 ${hasStockConflict ? 'border-2 border-red-500' : 'border border-slate-200'}`}
                />
                <div className="flex-1 min-w-0">
                  <p className={`text-xs sm:text-sm leading-snug line-clamp-2 ${hasStockConflict ? 'font-extrabold text-red-900' : 'font-bold text-slate-900'}`}>{item.productName}</p>
                  <p className={`text-[11px] font-mono mt-0.5 ${hasStockConflict ? 'font-bold text-red-700' : 'text-slate-500'}`}>SKU: {item.sku}</p>
                  <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                    <span className={`badge text-[10px] font-bold py-0.5 px-2 ${hasStockConflict ? 'bg-red-100 text-red-900 border border-red-300' : 'bg-slate-100 text-slate-800'}`}>
                      {item.size} ({fmt2(sqm)} {t('common.sqm')})
                    </span>
                    <span className="text-[10.5px] px-1.5 py-0.5 rounded bg-brand-50 text-brand-800 font-medium">{item.warehouse}</span>
                    {typeof effectiveAvail === 'number' && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${hasStockConflict ? 'bg-red-600 text-white' : 'text-slate-500 font-normal'}`}>
                        {effectiveAvail === 0 ? `❌ ${t('cart.out_of_stock')}` : `${t('cart.free_qty')} ${effectiveAvail} ${t('common.pcs')}`}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onRemoveItem(item.productId, item.size, item.warehouse)}
                  className={`h-8 w-8 flex items-center justify-center rounded-lg transition-colors cursor-pointer shrink-0 ${hasStockConflict ? 'bg-red-600 text-white hover:bg-red-700' : 'text-slate-400 hover:text-rose-600 hover:bg-rose-50'}`}
                  title="Remove"
                  aria-label="Remove"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>

              <div className="flex items-center justify-between border-t border-slate-100 pt-2.5">
                <div className={`flex items-center rounded-lg bg-white shadow-2xs ${hasStockConflict ? 'border-2 border-red-500' : 'border border-slate-300'}`}>
                  <button
                    type="button"
                    onClick={() => onUpdateQuantity(item.productId, item.size, item.warehouse, item.quantity - 1)}
                    disabled={item.quantity <= 1 || isDepleted}
                    className="h-8 w-8 flex items-center justify-center text-slate-600 hover:text-slate-900 hover:bg-slate-100 disabled:opacity-30 disabled:pointer-events-none transition-colors rounded-l-lg"
                    title="-"
                    aria-label="-"
                  >
                    <Minus className="h-3.5 w-3.5" />
                  </button>
                  <span className={`w-9 text-center font-bold text-xs ${hasStockConflict ? 'text-red-700' : 'text-slate-900'}`}>{item.quantity}</span>
                  <button
                    type="button"
                    onClick={() => onUpdateQuantity(item.productId, item.size, item.warehouse, item.quantity + 1)}
                    disabled={isDepleted || (effectiveAvail !== undefined && item.quantity >= effectiveAvail)}
                    className="h-8 w-8 flex items-center justify-center text-slate-600 hover:text-slate-900 hover:bg-slate-100 disabled:opacity-30 disabled:pointer-events-none transition-colors rounded-r-lg"
                    title="+"
                    aria-label="+"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="text-right">
                  <div className="text-[11px] text-slate-500">{fmtPrice(item.price)} / {t('common.pcs')}</div>
                  <div className={`font-extrabold text-sm sm:text-base ${hasStockConflict ? 'text-red-700' : 'text-brand-700'}`}>
                    {isZeroPrice ? t('cart.price_pending') : fmtPrice(lineTotal)}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ─── 3. Сводные подытоги по размерам и по каждой коллекции (штуки, квадратура, сумма) ─── */}
      <CartSubtotalsPanel
        sizeSubtotals={sizeSubtotals}
        collectionSubtotals={collectionSubtotals}
        activeCollection={effectiveActiveCollection}
        onSelectCollection={onSelectCollection}
        sizeAsc={sizeAsc}
        onToggleSizeSort={onToggleSizeSort}
      />
    </div>
  );
}

export default CartItemsTable;
