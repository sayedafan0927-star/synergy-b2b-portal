import { Trash2, Plus, Minus, ArrowUpDown, Filter } from 'lucide-react';
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

  const collections = Array.from(new Set(items.map(it => it.collection))).filter(Boolean);

  const displayedItems = activeCollection ? items.filter(it => it.collection === activeCollection) : items;

  const rawSubtotals = calcSizeSubtotals(displayedItems);
  const sizeSubtotals: SizeSubtotal[] = sizeAsc ? rawSubtotals : [...rawSubtotals].reverse();

  return (
    <div className="space-y-6">
      {/* Коллекции / фильтры */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {collections.length > 1 && (
            <>
              <span className="text-xs text-slate-400 mr-1 flex items-center gap-1">
                <Filter className="h-3 w-3" /> Коллекция:
              </span>
              <button
                type="button"
                onClick={() => onSelectCollection(null)}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer ${
                  activeCollection === null
                    ? 'bg-brand-700 text-white'
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
                  className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer ${
                    activeCollection === col
                      ? 'bg-brand-700 text-white'
                      : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {col} ({items.filter(it => it.collection === col).length})
                </button>
              ))}
            </>
          )}
        </div>
        <button
          type="button"
          onClick={onClearCart}
          className="text-xs text-slate-400 hover:text-red-500 transition-colors flex items-center gap-1 cursor-pointer"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Очистить корзину
        </button>
      </div>

      {/* Список позиций */}
      <div className="space-y-3">
        {displayedItems.map(item => {
          const key = `${item.productId}-${item.size}-${item.warehouse}`;
          const sqm = calcSqm(item.size, item.quantity);
          const lineTotal = item.price * item.quantity;

          return (
            <div key={key} className="card flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
              <ProductImage
                src={item.image}
                alt={item.productName}
                loading="lazy"
                decoding="async"
                width={120}
                className="h-16 w-16 shrink-0 rounded-lg object-contain bg-slate-50 p-1"
              />
              <div className="flex-1 min-w-0 space-y-1">
                <h3 className="text-sm font-semibold text-slate-900 truncate">{item.productName}</h3>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="badge">{item.size}</span>
                  <span className="text-xs text-slate-400">{item.warehouse}</span>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                  <span>
                    Шт.: <span className="font-medium text-slate-700">{item.quantity}</span>
                  </span>
                  <span>
                    М²: <span className="font-medium text-slate-700">{fmt2(sqm)}</span>
                  </span>
                  <span>
                    Сумма: <span className="font-medium text-slate-700">{fmtPrice(lineTotal)}</span>
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-3 sm:gap-4">
                <div className="flex items-center rounded-lg border border-slate-200">
                  <button
                    type="button"
                    onClick={() => onUpdateQuantity(item.productId, item.size, item.warehouse, item.quantity - 1)}
                    disabled={item.quantity <= 1}
                    className="flex h-8 w-8 items-center justify-center text-slate-500 transition-colors hover:text-slate-700 disabled:opacity-30 cursor-pointer"
                  >
                    <Minus className="h-3.5 w-3.5" />
                  </button>
                  <span className="w-10 text-center text-sm font-medium text-slate-900">{item.quantity}</span>
                  <button
                    type="button"
                    onClick={() => onUpdateQuantity(item.productId, item.size, item.warehouse, item.quantity + 1)}
                    disabled={item.maxStock !== undefined && item.quantity >= item.maxStock}
                    title={item.maxStock !== undefined && item.quantity >= item.maxStock ? `Максимально доступно на складе: ${item.maxStock} шт.` : 'Увеличить количество'}
                    className="flex h-8 w-8 items-center justify-center text-slate-500 transition-colors hover:text-slate-700 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>
                {item.maxStock !== undefined && item.quantity >= item.maxStock && (
                  <span className="hidden sm:inline-block text-[10px] text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded font-medium">
                    Максимум на складе ({item.maxStock} шт)
                  </span>
                )}
                <span className="w-24 text-right text-sm font-bold text-slate-900">{fmtPrice(lineTotal)}</span>
                <button
                  type="button"
                  onClick={() => onRemoveItem(item.productId, item.size, item.warehouse)}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500 cursor-pointer"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Подытог по размерам */}
      {sizeSubtotals.length > 1 && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">Итого по размерам</h4>
            <button
              type="button"
              onClick={onToggleSizeSort}
              className="text-xs text-brand-700 hover:text-brand-800 font-medium inline-flex items-center gap-1 cursor-pointer"
            >
              <ArrowUpDown className="h-3 w-3" />
              {sizeAsc ? 'По возрастанию' : 'По убыванию'}
            </button>
          </div>
          <div className="divide-y divide-slate-100 text-xs">
            {sizeSubtotals.map(st => (
              <div key={st.size} className="flex items-center justify-between py-1.5">
                <span className="font-semibold text-slate-800">{st.size}</span>
                <div className="flex items-center gap-4 text-slate-600">
                  <span>{st.qty} шт</span>
                  <span className="w-16 text-right">{fmt2(st.sqm)} м²</span>
                  <span className="w-24 text-right font-bold text-slate-900">{fmtPrice(st.sum)}</span>
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
