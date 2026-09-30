import React from 'react';
import { Layers, Warehouse, ShoppingCart, Check, ArrowRight } from 'lucide-react';
import type { Product, ProductVariant } from '@/types';

export interface CommandPaletteItemProps {
  product: Product;
  isSelected: boolean;
  isShowroomMode: boolean;
  displayPrice: number;
  addedVariantSku: string | null;
  onSelect: (product: Product) => void;
  onMouseEnter: () => void;
  onQuickAdd: (e: React.MouseEvent, product: Product) => void;
  formatPrice: (amount: number) => string;
}

export const CommandPaletteItem: React.FC<CommandPaletteItemProps> = ({
  product,
  isSelected,
  isShowroomMode,
  displayPrice,
  addedVariantSku,
  onSelect,
  onMouseEnter,
  onQuickAdd,
  formatPrice,
}) => {
  const totalStock = product.variants.reduce((acc, v) => acc + (v.stock || v.free_stock || 0), 0);
  const isAdded = Boolean(addedVariantSku && product.variants.some(v => v.sku === addedVariantSku));

  return (
    <div
      onClick={() => onSelect(product)}
      onMouseEnter={onMouseEnter}
      className={`flex items-center gap-3 p-2.5 sm:p-3 rounded-xl transition-all cursor-pointer ${
        isSelected ? 'bg-brand-50/70 border-brand-200 shadow-2xs' : 'hover:bg-slate-50'
      }`}
    >
      {/* Rug Thumbnail with Object-Contain (RugsUSA standard) */}
      <div className="w-12 h-15 sm:w-14 sm:h-18 rounded-lg bg-slate-100 border border-slate-200/70 overflow-hidden shrink-0 flex items-center justify-center p-1">
        {product.images?.[0] ? (
          <img
            src={product.images[0]}
            alt={product.name}
            className="w-full h-full object-contain"
            loading="lazy"
          />
        ) : (
          <Layers className="h-5 w-5 text-slate-400" />
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-bold text-xs sm:text-sm text-slate-900 truncate">
            {product.collection || product.name}
          </span>
          {product.article && (
            <span className="text-[10px] font-mono bg-slate-150 text-slate-600 px-1.5 py-0.5 rounded">
              {product.article}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 mt-1 text-xs text-slate-500">
          <span>{product.variants.length} разм.</span>
          <span>•</span>
          <span className="flex items-center gap-1">
            <Warehouse className="h-3 w-3 text-slate-400" />
            Остаток: <strong>{totalStock} шт</strong>
          </span>
        </div>

        {/* Sizes badges list */}
        <div className="flex flex-wrap gap-1 mt-1.5">
          {product.variants.slice(0, 4).map(v => (
            <span
              key={v.id || v.size}
              className="text-[10px] font-medium bg-white border border-slate-200 px-1.5 py-0.2 rounded text-slate-600"
            >
              {v.size}
            </span>
          ))}
          {product.variants.length > 4 && (
            <span className="text-[10px] text-slate-400">
              +{product.variants.length - 4}
            </span>
          )}
        </div>
      </div>

      {/* Price & Quick Add */}
      <div className="flex flex-col items-end gap-1 shrink-0">
        {!isShowroomMode ? (
          <span className="font-bold text-xs sm:text-sm text-brand-700">
            от {formatPrice(displayPrice)}
          </span>
        ) : (
          <span className="text-[11px] font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
            В наличии
          </span>
        )}

        <div className="flex items-center gap-1 mt-1">
          <button
            type="button"
            onClick={e => onQuickAdd(e, product)}
            disabled={totalStock <= 0}
            title={totalStock > 0 ? 'Быстро добавить в корзину' : 'Нет в наличии'}
            className={`h-7 px-2 rounded-lg flex items-center gap-1 text-[11px] font-medium transition-all ${
              isAdded
                ? 'bg-emerald-600 text-white shadow-2xs'
                : 'bg-white hover:bg-brand-50 text-slate-700 hover:text-brand-700 border border-slate-200'
            } disabled:opacity-40 disabled:pointer-events-none cursor-pointer`}
          >
            {isAdded ? (
              <>
                <Check className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">В корзине</span>
              </>
            ) : (
              <>
                <ShoppingCart className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">+1</span>
              </>
            )}
          </button>
          <ArrowRight className="h-4 w-4 text-slate-400 hidden sm:block" />
        </div>
      </div>
    </div>
  );
};
