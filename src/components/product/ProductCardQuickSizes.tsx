import type { Product, ProductVariant } from '@/types';
import { Check, ShoppingCart } from 'lucide-react';

interface ProductCardQuickSizesProps {
  product: Product;
  isEffectiveAdmin: boolean;
  quantities: Record<string, number>;
  addedSku: string | null;
  onSetQuantity: (sku: string, value: number) => void;
  onAdd: (variant: ProductVariant) => void;
  getVariantStock: (variant: ProductVariant) => number;
}

export default function ProductCardQuickSizes({
  product,
  isEffectiveAdmin,
  quantities,
  addedSku,
  onSetQuantity,
  onAdd,
  getVariantStock,
}: ProductCardQuickSizesProps) {
  const availableVariants = product.variants.filter(v => getVariantStock(v) > 0);

  return (
    <div
      className="absolute left-0 right-0 sm:-left-3 sm:-right-3 top-full z-40 -mt-1 rounded-xl bg-white p-3 shadow-xl ring-1 ring-slate-200/80 border border-slate-100 min-w-[290px]"
      onClick={event => event.stopPropagation()}
    >
      <div className="space-y-1.5 max-h-60 overflow-y-auto overflow-x-hidden pr-0.5 select-none">
        {availableVariants.length > 0 ? (
          availableVariants.map(variant => {
            const stock = getVariantStock(variant);
            const quantity = quantities[variant.sku] ?? 1;
            const isAdded = addedSku === variant.sku;

            return (
              <div
                key={variant.sku}
                className="flex items-center justify-between py-1.5 border-b border-slate-100 last:border-b-0 gap-2"
              >
                <div className="flex items-baseline gap-1.5 whitespace-nowrap shrink-0" data-size-cluster={variant.size_cluster}>
                  <span className="font-semibold text-slate-800 text-xs sm:text-sm whitespace-nowrap">{variant.size}</span>
                  {variant.is_runner && (
                    <span className="text-[9px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-1 py-0.2 rounded">Дорожка</span>
                  )}
                  <span className="text-[10px] sm:text-[11px] text-slate-400 font-normal whitespace-nowrap">({stock} шт)</span>
                </div>

                <div className="flex items-center gap-1.5 ml-auto shrink-0">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSetQuantity(variant.sku, Math.max(1, (quantities[variant.sku] ?? 1) - 1));
                    }}
                    className="h-7 w-7 shrink-0 rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-center text-slate-700 hover:bg-slate-100 active:scale-95 transition-all text-xs font-bold cursor-pointer"
                  >
                    -
                  </button>
                  <input
                    type="number"
                    min="1"
                    max={stock}
                    value={quantity}
                    onChange={event => {
                      const val = Number(event.target.value);
                      onSetQuantity(variant.sku, Math.max(1, Math.min(stock, val || 1)));
                    }}
                    onClick={event => event.stopPropagation()}
                    className="h-7 w-9 shrink-0 rounded-lg border border-slate-200 text-center text-xs font-semibold text-slate-800 outline-none focus:border-brand-500"
                  />
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSetQuantity(variant.sku, Math.min(stock, (quantities[variant.sku] ?? 1) + 1));
                    }}
                    className="h-7 w-7 shrink-0 rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-center text-slate-700 hover:bg-slate-100 active:scale-95 transition-all text-xs font-bold cursor-pointer"
                  >
                    +
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onAdd(variant);
                    }}
                    className={`h-7 w-8 shrink-0 rounded-lg flex items-center justify-center text-white transition-all active:scale-95 cursor-pointer ${
                      isAdded ? 'bg-emerald-600 shadow-sm' : 'bg-brand-700 hover:bg-brand-800 shadow-sm'
                    }`}
                    title="Добавить в корзину"
                  >
                    {isAdded ? <Check className="h-3.5 w-3.5 shrink-0" /> : <ShoppingCart className="h-3.5 w-3.5 shrink-0" />}
                  </button>
                </div>
              </div>
            );
          })
        ) : (
          <div className="py-3 px-2 text-center text-xs font-medium">
            {isEffectiveAdmin ? (
              <span className="text-amber-700 bg-amber-50 px-2.5 py-1 rounded-md inline-block">
                ⚠️ 0 шт на складах (карточка скрыта от клиентов)
              </span>
            ) : (
              <span className="text-slate-500">
                Нет в наличии на доступных складах
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
