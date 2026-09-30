import { useState } from 'react';
import { Trash2, Plus, Minus, ArrowUpDown, Filter, AlertTriangle, AlertCircle, LayoutGrid, Table } from 'lucide-react';
import type { CartItem } from '@/types';
import { calcSqm } from '@/types';
import { useCurrency } from '@/contexts/CurrencyContext';
import ProductImage from '@/components/ProductImage';
import { fmt2, calcSizeSubtotals, type SizeSubtotal } from './types';

interface CartItemsTableProps {
  items: CartItem[];
  activeCollection: string | null;
  onSelectCollection: (col: string | null) => void;
  sizeAsc: boolean;
  onToggleSizeSort: () => void;
  onUpdateQuantity: (productId: string, size: string, warehouse: string, qty: number) => void;
  onRemoveItem: (productId: string, size: string, warehouse: string) => void;
  onClearCart: () => void;
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
}: CartItemsTableProps) {
  const { formatPrice: fmtPrice } = useCurrency();
  const [mobileCardView, setMobileCardView] = useState(false);

  const collections = Array.from(new Set(items.map(it => it.collection))).filter(Boolean);
  const displayedItems = activeCollection ? items.filter(it => it.collection === activeCollection) : items;

  const rawSubtotals = calcSizeSubtotals(displayedItems);
  const sizeSubtotals: SizeSubtotal[] = sizeAsc ? rawSubtotals : [...rawSubtotals].reverse();

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
          {collections.length > 1 && (
            <>
              <span className="text-xs text-slate-500 mr-1 flex items-center gap-1 font-medium">
                <Filter className="h-3 w-3" /> Коллекция:
              </span>
              <button
                type="button"
                onClick={() => onSelectCollection(null)}
                className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors cursor-pointer ${
                  activeCollection === null
                    ? 'bg-brand-700 text-white shadow-2xs'
                    : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                Все ({items.length})
              </button>
              {collections.map(col => (
                <button
                  key={col}
                  type="button"
                  onClick={() => onSelectCollection(col)}
                  className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors cursor-pointer ${
                    activeCollection === col
                      ? 'bg-brand-700 text-white shadow-2xs'
                    : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {col} ({items.filter(it => it.collection === col).length})
                </button>
              ))}
            </>
          )}
        </div>

        <div className="flex items-center gap-2 ml-auto">
          {/* Переключатель вида на мобильных */}
          <div className="sm:hidden flex items-center border border-slate-200 rounded-md bg-white p-0.5">
            <button
              type="button"
              onClick={() => setMobileCardView(false)}
              className={`p-1 rounded ${!mobileCardView ? 'bg-slate-100 text-slate-900' : 'text-slate-400'}`}
              title="Таблица"
            >
              <Table className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setMobileCardView(true)}
              className={`p-1 rounded ${mobileCardView ? 'bg-slate-100 text-slate-900' : 'text-slate-400'}`}
              title="Карточки"
            >
              <LayoutGrid className="h-3.5 w-3.5" />
            </button>
          </div>

          <button
            type="button"
            onClick={onClearCart}
            className="text-xs text-slate-500 hover:text-red-600 transition-colors flex items-center gap-1 font-medium cursor-pointer"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>Очистить корзину</span>
          </button>
        </div>
      </div>

      {/* ─── 1. High-Density B2B Data Grid (Desktop & Tablet) ─── */}
      <div className={`card overflow-hidden border border-slate-200 bg-white shadow-2xs ${mobileCardView ? 'hidden sm:block' : 'block'}`}>
        <div className="overflow-x-auto max-h-[620px] overflow-y-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="sticky top-0 bg-slate-50/95 backdrop-blur-xs border-b border-slate-200 z-10 text-[11px] font-bold text-slate-600 uppercase tracking-wider">
              <tr>
                <th className="py-2.5 px-3 min-w-[200px]">Товар / Артикул</th>
                <th className="py-2.5 px-2 text-center min-w-[90px]">Размер</th>
                <th className="py-2.5 px-2.5 min-w-[130px]">Склад</th>
                <th className="py-2.5 px-2 text-right min-w-[95px]">Цена</th>
                <th className="py-2.5 px-2 text-center min-w-[130px]">Кол-во (шт)</th>
                <th className="py-2.5 px-3 text-right min-w-[110px]">Сумма</th>
                <th className="py-2.5 px-2 text-center w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {displayedItems.map(item => {
                const key = `${item.productId}-${item.size}-${item.warehouse}`;
                const sqm = calcSqm(item.size, item.quantity);
                const lineTotal = item.price * item.quantity;
                const isDepleted = item.maxStock === 0;
                const isZeroPrice = !item.price || item.price <= 0;

                return (
                  <tr
                    key={key}
                    className={`transition-colors hover:bg-slate-50/80 ${
                      isDepleted
                        ? 'bg-rose-50/60 text-rose-900'
                        : isZeroPrice
                        ? 'bg-amber-50/50 text-amber-950'
                        : 'text-slate-800'
                    }`}
                  >
                    {/* Товар / Артикул с компактным превью */}
                    <td className="py-2 px-3">
                      <div className="flex items-center gap-2.5">
                        <ProductImage
                          src={item.image}
                          alt={item.productName}
                          loading="lazy"
                          decoding="async"
                          width={40}
                          className="h-9 w-9 shrink-0 rounded-md object-contain bg-slate-50 border border-slate-200/80 p-0.5"
                        />
                        <div className="min-w-0">
                          <p className="font-bold text-slate-900 text-xs truncate max-w-[180px] sm:max-w-[240px]">
                            {item.productName}
                          </p>
                          <div className="flex items-center gap-1.5 text-[10.5px] text-slate-500 mt-0.5">
                            <span className="font-mono bg-slate-100 px-1 py-0.2 rounded text-slate-600">
                              {item.sku || 'SKU'}
                            </span>
                            {isDepleted && (
                              <span className="inline-flex items-center text-rose-600 font-semibold gap-0.5">
                                <AlertCircle className="h-3 w-3" /> Закончился на складе
                              </span>
                            )}
                            {isZeroPrice && !isDepleted && (
                              <span className="inline-flex items-center text-amber-700 font-semibold gap-0.5">
                                <AlertTriangle className="h-3 w-3" /> Цена не установлена
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Размер и площадь */}
                    <td className="py-2 px-2 text-center whitespace-nowrap">
                      <span className="inline-block px-2 py-0.5 rounded-md font-bold text-slate-800 bg-slate-100 border border-slate-200/80 text-[11px]">
                        {item.size}
                      </span>
                      <p className="text-[10px] text-slate-500 mt-0.5 font-medium">{fmt2(sqm)} м²</p>
                    </td>

                    {/* Склад */}
                    <td className="py-2 px-2.5 whitespace-nowrap">
                      <p className="text-xs font-semibold text-slate-800 truncate max-w-[120px]" title={item.warehouse}>
                        {item.warehouse}
                      </p>
                      {item.maxStock !== undefined && (
                        <p className="text-[10px] text-slate-500 font-medium">
                          Свободно: <strong className="text-slate-700">{item.maxStock} шт</strong>
                        </p>
                      )}
                    </td>

                    {/* Цена за ед. */}
                    <td className="py-2 px-2 text-right whitespace-nowrap">
                      {isZeroPrice ? (
                        <span className="text-xs font-semibold text-amber-700">Уточняется</span>
                      ) : (
                        <div>
                          <p className="font-bold text-slate-900 text-xs">{fmtPrice(item.price)}</p>
                          {item.price_per_sqm ? (
                            <p className="text-[10px] text-slate-500">{fmtPrice(item.price_per_sqm)}/м²</p>
                          ) : null}
                        </div>
                      )}
                    </td>

                    {/* Ввод количества (с поддержкой Tab, прямого набора и touch-кнопок) */}
                    <td className="py-2 px-2 text-center whitespace-nowrap">
                      <div className="inline-flex items-center rounded-lg border border-slate-300 bg-white shadow-2xs">
                        <button
                          type="button"
                          onClick={() => onUpdateQuantity(item.productId, item.size, item.warehouse, item.quantity - 1)}
                          disabled={item.quantity <= 1 || isDepleted}
                          className="h-7 w-7 flex items-center justify-center text-slate-600 hover:text-slate-900 hover:bg-slate-100 disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer rounded-l-md"
                          title="Уменьшить"
                        >
                          <Minus className="h-3 w-3" />
                        </button>
                        <input
                          type="number"
                          min="1"
                          max={item.maxStock || 9999}
                          value={item.quantity}
                          disabled={isDepleted}
                          onChange={e => handleQtyInputChange(item, e.target.value)}
                          className="w-11 text-center font-bold text-xs text-slate-900 focus:outline-hidden py-1 border-x border-slate-200"
                        />
                        <button
                          type="button"
                          onClick={() => onUpdateQuantity(item.productId, item.size, item.warehouse, item.quantity + 1)}
                          disabled={isDepleted || (item.maxStock !== undefined && item.quantity >= item.maxStock)}
                          className="h-7 w-7 flex items-center justify-center text-slate-600 hover:text-slate-900 hover:bg-slate-100 disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer rounded-r-md"
                          title="Увеличить"
                        >
                          <Plus className="h-3 w-3" />
                        </button>
                      </div>
                    </td>

                    {/* Сумма по строке */}
                    <td className="py-2 px-3 text-right whitespace-nowrap">
                      {isZeroPrice ? (
                        <span className="text-xs font-semibold text-amber-700">Уточняется</span>
                      ) : (
                        <span className="text-xs font-extrabold text-brand-700">{fmtPrice(lineTotal)}</span>
                      )}
                    </td>

                    {/* Удаление */}
                    <td className="py-2 px-2 text-center whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => onRemoveItem(item.productId, item.size, item.warehouse)}
                        title="Удалить позицию"
                        className="p-1 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ─── 2. Мобильный карточный режим (при включении на смартфонах) ─── */}
      <div className={`space-y-2.5 ${mobileCardView ? 'block sm:hidden' : 'hidden'}`}>
        {displayedItems.map(item => {
          const key = `${item.productId}-${item.size}-${item.warehouse}`;
          const sqm = calcSqm(item.size, item.quantity);
          const lineTotal = item.price * item.quantity;
          const isDepleted = item.maxStock === 0;
          const isZeroPrice = !item.price || item.price <= 0;

          return (
            <div
              key={key}
              className={`card p-3 flex flex-col gap-2.5 ${
                isDepleted ? 'bg-rose-50/70 border-rose-200' : isZeroPrice ? 'bg-amber-50/60 border-amber-200' : ''
              }`}
            >
              <div className="flex items-start gap-2.5">
                <ProductImage
                  src={item.image}
                  alt={item.productName}
                  loading="lazy"
                  decoding="async"
                  width={48}
                  className="h-12 w-12 shrink-0 rounded-md object-contain bg-slate-50 border border-slate-200 p-0.5"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-slate-900 truncate">{item.productName}</p>
                  <p className="text-[10px] text-slate-500 font-mono mt-0.5">{item.sku} • {item.warehouse}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="badge text-[10px] py-0.5">{item.size}</span>
                    <span className="text-[10.5px] text-slate-600">{fmt2(sqm)} м²</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onRemoveItem(item.productId, item.size, item.warehouse)}
                  className="p-1 text-slate-400 hover:text-rose-600"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>

              <div className="flex items-center justify-between border-t border-slate-100 pt-2 text-xs">
                <div className="flex items-center rounded-md border border-slate-300 bg-white">
                  <button
                    type="button"
                    onClick={() => onUpdateQuantity(item.productId, item.size, item.warehouse, item.quantity - 1)}
                    disabled={item.quantity <= 1 || isDepleted}
                    className="h-7 w-7 flex items-center justify-center text-slate-600 disabled:opacity-30"
                  >
                    <Minus className="h-3 w-3" />
                  </button>
                  <span className="w-8 text-center font-bold text-xs">{item.quantity}</span>
                  <button
                    type="button"
                    onClick={() => onUpdateQuantity(item.productId, item.size, item.warehouse, item.quantity + 1)}
                    disabled={isDepleted || (item.maxStock !== undefined && item.quantity >= item.maxStock)}
                    className="h-7 w-7 flex items-center justify-center text-slate-600 disabled:opacity-30"
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                </div>
                <div className="text-right">
                  <span className="font-extrabold text-brand-700 text-sm">
                    {isZeroPrice ? 'Уточняется' : fmtPrice(lineTotal)}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ─── 3. Сводный подытог по размерам ─── */}
      {sizeSubtotals.length > 1 && (
        <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-2xs">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-600">Итого по размерам партии</h4>
            <button
              type="button"
              onClick={onToggleSizeSort}
              className="text-xs text-brand-700 hover:text-brand-800 font-semibold inline-flex items-center gap-1 cursor-pointer"
            >
              <ArrowUpDown className="h-3 w-3" />
              <span>{sizeAsc ? 'По возрастанию' : 'По убыванию'}</span>
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 text-xs">
            {sizeSubtotals.map(st => (
              <div key={st.size} className="flex items-center justify-between p-2 rounded-lg bg-slate-50 border border-slate-100">
                <span className="font-bold text-slate-800">{st.size}</span>
                <div className="flex items-center gap-2.5 text-slate-600">
                  <span className="font-medium">{st.qty} шт</span>
                  <span className="font-bold text-slate-900">{fmtPrice(st.sum)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default CartItemsTable;
