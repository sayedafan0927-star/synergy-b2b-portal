import { Ruler, Lock } from 'lucide-react';
import type { Product, ProductVariant } from '@/types';
import { filterClientWarehouses } from '@/hooks/useProductData';
import { getVariantShape } from './types';

interface ProductVariantSelectorProps {
  product: Product;
  variantsForShape: ProductVariant[];
  availableShapes: string[];
  activeShape: string;
  selectedSize: string;
  activeVariant?: ProductVariant;
  mainPricePerSqm: number;
  onSelectShape: (shape: string) => void;
  onSelectSize: (size: string) => void;
  onNavigate: (page: any, param?: any) => void;
  user: any;
  profile: any;
  pricing: any;
  fmtPrice: (val: number) => string;
  language: string;
  t: (key: string) => string;
  myShowroomId?: number;
  myShowroomName?: string;
  clientContext: any;
  displaySettings: any;
  isMobile?: boolean;
}

export function ProductVariantSelector({
  product,
  variantsForShape,
  availableShapes,
  activeShape,
  activeVariant,
  mainPricePerSqm,
  onSelectShape,
  onSelectSize,
  onNavigate,
  user,
  pricing,
  fmtPrice,
  language,
  t,
  myShowroomId,
  myShowroomName,
  clientContext,
  displaySettings,
  isMobile = false,
}: ProductVariantSelectorProps) {
  const getShapeDisplay = (shape: string) => {
    if (language !== 'kz') return shape;
    const lower = shape.toLowerCase();
    if (lower.includes('дорожк')) return 'Жол кілем';
    if (lower.includes('прямоуг')) return 'Тікбұрышты';
    if (lower.includes('овал')) return 'Сопақша';
    if (lower.includes('круг')) return 'Дөңгелек';
    return shape;
  };

  if (isMobile) {
    return (
      <div className="mb-4 rounded-xl border border-slate-200 bg-white p-3.5 shadow-2xs">
        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-2">
          {t('product.shape') || 'Форма'}: <span className="text-brand-700">{getShapeDisplay(activeShape)}</span>
        </p>
        <div className="flex flex-wrap gap-2">
          {availableShapes.map(shape => {
            const isShapeActive = shape === activeShape;
            return (
              <button
                key={shape}
                type="button"
                onClick={() => {
                  onSelectShape(shape);
                  const firstOfShape = product.variants.find(
                    v => getVariantShape(v, product.name, product.category || '') === shape
                  );
                  if (firstOfShape) onSelectSize(firstOfShape.size);
                }}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${
                  isShapeActive
                    ? 'bg-slate-900 text-white shadow-sm ring-2 ring-slate-900/20'
                    : 'bg-slate-50 border border-slate-200 text-slate-700 hover:bg-slate-100'
                }`}
              >
                {getShapeDisplay(shape)}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 mb-6 shadow-xs">
      {/* 1. Цена за 1 м² и готовая цена изделия */}
      <div className="flex flex-wrap items-baseline justify-between gap-3 pb-5 border-b border-slate-100">
        <div>
          <span className="text-[10px] uppercase tracking-wider font-semibold text-slate-400 block mb-0.5">
            {t('product.sqm_price')}
          </span>
          {user ? (
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className={`text-3xl font-extrabold tracking-tight ${activeVariant?.is_on_sale ? 'text-red-600' : 'text-brand-700'}`}>
                {fmtPrice(mainPricePerSqm)}
              </span>
              {activeVariant?.is_on_sale && activeVariant.old_price_per_sqm && (
                <span className="text-lg text-gray-400 line-through">
                  {fmtPrice(activeVariant.old_price_per_sqm)}
                </span>
              )}
              <span className="text-sm font-semibold text-slate-400">/ м²</span>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => onNavigate('login')}
              className="flex items-center gap-2 text-sm text-slate-500 hover:text-brand-700 transition-colors font-medium cursor-pointer"
            >
              <Lock className="h-4 w-4" />
              {t('product.login_view_prices')}
            </button>
          )}
        </div>

        {user && activeVariant && (
          <div className="text-right">
            <span className="text-[10px] uppercase tracking-wider font-semibold text-slate-400 block mb-0.5">
              {t('product.total_price')} ({activeVariant.size})
            </span>
            <div className="flex items-baseline justify-end gap-2">
              <span className={`text-2xl font-bold ${activeVariant.is_on_sale ? 'text-red-600' : 'text-slate-900'}`}>
                {fmtPrice(pricing.getVariantPrice(product.collection, activeVariant.size, activeVariant.base_price, activeVariant.price_per_sqm))}
              </span>
              {activeVariant.is_on_sale && activeVariant.old_price && (
                <span className="text-base text-gray-400 line-through">
                  {fmtPrice(activeVariant.old_price)}
                </span>
              )}
              {activeVariant.area_sqm && (
                <span className="text-xs text-slate-400 ml-1 font-normal">
                  ({activeVariant.area_sqm} м²)
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 2. ВЫБОР ФОРМЫ (КЛИКАБЕЛЬНЫЕ БЛОКИ ФОРМ) */}
      <div className="pt-4 pb-4 border-b border-slate-100">
        <p className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-2.5">
          {t('product.shape')}: <span className="text-brand-700 font-semibold">{getShapeDisplay(activeShape)}</span>
        </p>
        <div className="flex flex-wrap gap-2">
          {availableShapes.map(shape => {
            const isShapeActive = shape === activeShape;
            return (
              <button
                key={shape}
                type="button"
                onClick={() => {
                  onSelectShape(shape);
                  const firstOfShape = product.variants.find(
                    v => getVariantShape(v, product.name, product.category || '') === shape
                  );
                  if (firstOfShape) onSelectSize(firstOfShape.size);
                }}
                className={`rounded-xl px-4 py-2 text-xs font-bold uppercase tracking-wider transition-all duration-200 cursor-pointer ${
                  isShapeActive
                    ? 'bg-slate-900 text-white shadow-md ring-2 ring-slate-900/20'
                    : 'bg-slate-50 border border-slate-200 text-slate-700 hover:border-slate-400 hover:bg-white'
                }`}
              >
                {getShapeDisplay(shape)}
              </button>
            );
          })}
        </div>
      </div>

      {/* 3. ДОСТУПНЫЕ РАЗМЕРЫ ДЛЯ ВЫБРАННОЙ ФОРМЫ */}
      <div className="pt-4">
        <div className="flex items-center justify-between mb-2.5">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
            <Ruler className="h-4 w-4 text-brand-600" />
            {t('product.sizes')} ({variantsForShape.length})
          </p>
          {activeVariant?.area_sqm && (
            <span className="text-xs font-medium text-slate-500">
              {language === 'kz' ? 'Ауданы' : 'Площадь'}: {activeVariant.area_sqm} м²
            </span>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {variantsForShape.map(v => {
            const isSelected = v.size === activeVariant?.size;
            const vStock = filterClientWarehouses(v.warehouses, myShowroomId, myShowroomName, clientContext, displaySettings).reduce((sum, w) => sum + w.stock, 0);

            return (
              <button
                key={v.sku || v.size}
                type="button"
                onClick={() => onSelectSize(v.size)}
                className={`flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition-all duration-200 cursor-pointer ${
                  isSelected
                    ? 'bg-brand-700 text-white shadow-sm ring-2 ring-brand-700/20'
                    : 'bg-slate-50 border border-slate-200 text-slate-700 hover:border-brand-500 hover:bg-white'
                }`}
              >
                <span>{v.size}</span>
                {vStock > 0 && (
                  <span
                    className={`rounded-full px-1.5 py-0.2 text-[10px] font-bold ${
                      isSelected ? 'bg-white/20 text-white' : 'bg-emerald-100 text-emerald-800'
                    }`}
                  >
                    {vStock} шт
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Артикул выбранного размера */}
        {activeVariant && (
          <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {(activeVariant.article || product.article) && (
                <span>{t('product.article')}: <strong className="text-slate-800">{activeVariant.article || product.article}</strong></span>
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                const el = document.getElementById('variant-table');
                el?.scrollIntoView({ behavior: 'smooth' });
              }}
              className="text-brand-700 hover:text-brand-800 font-semibold inline-flex items-center gap-1 hover:underline text-xs cursor-pointer"
            >
              {t('product.stock_table')} ↓
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
export default ProductVariantSelector;
