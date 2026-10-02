import { useState } from 'react';
import type { Product, PageId, ProductVariant } from '@/types';
import { parseSizeDimensions } from '@/types';
import { useAuth } from '@/contexts/AuthContext';
import { useCart } from '@/contexts/CartContext';
import { useUserPricing } from '@/hooks/usePricing';
import { useLanguage, type Language } from '@/contexts/LanguageContext';
import { useCurrency } from '@/contexts/CurrencyContext';
import { useDisplaySettings } from '@/hooks/useDisplaySettings';
import { filterClientWarehouses } from '@/hooks/useProductData';
import { isWarehouseVisibleForClient } from '@/lib/warehouseVisibility';
import { ChevronLeft, ChevronRight, Lock } from 'lucide-react';
import ProductImage from '@/components/ProductImage';
import ProductCardQuickSizes from '@/components/product/ProductCardQuickSizes';
import { cacheProduct } from '@/lib/productCache';
import { useShowroomMode } from '@/contexts/ShowroomModeContext';

const prefetchProductPage = () => {
  import('@/pages/ProductPage');
};

interface ProductCardProps {
  product: Product;
  onNavigate: (page: PageId, productId?: string) => void;
}

function getMainWarehouseStock(variant: ProductVariant) {
  const mainHub = variant.warehouses.find(w =>
    w.warehouse_id === 81 ||
    w.is_hub ||
    (w.warehouse_name && (w.warehouse_name.includes('Астана') || w.warehouse_name.toLowerCase().includes('основной')))
  );
  if (mainHub) {
    if (typeof mainHub.free_stock === 'number') return Math.max(0, mainHub.free_stock);
    return Math.max(0, mainHub.stock ?? 0);
  }
  if (typeof variant.free_stock === 'number') return Math.max(0, variant.free_stock);
  return Math.max(0, variant.stock ?? 0);
}

export function formatProductTitle(product: { name: string; article?: string; color?: string; category?: string; collection: string }, lang: Language | string = 'ru'): string {
  const isRunner = Boolean(
    (product.category && product.category.toLowerCase().includes('дорожк')) ||
    (product.name && product.name.toLowerCase().includes('дорожк'))
  );

  const art = (product.article || '').trim();
  const col = (product.color || '').trim();

  let base = '';
  if (art && col) {
    base = `${art} — ${col}`;
  } else if (art) {
    base = art;
  } else {
    base = product.name
      .replace(/^ковер\s+/i, '')
      .replace(/^дорожка\s+/i, '')
      .replace(new RegExp(`^${product.collection}\\s+`, 'i'), '')
      .trim() || product.name;
    // Если после удаления коллекции остался только голый цвет без артикула, возвращаем полное название
    if (col && base.toLowerCase() === col.toLowerCase()) {
      base = product.name;
    }
  }

  const prefix = lang === 'kz' ? 'Жол кілем' : 'Дорожка';
  return isRunner ? `${prefix} ${base}` : base;
}

export default function ProductCard({ product, onNavigate }: ProductCardProps) {
  const { user, profile, isAdmin, isImpersonating } = useAuth();
  const isEffectiveAdmin = isAdmin && !isImpersonating;
  const clientContext = isEffectiveAdmin ? true : profile;
  const { settings: displaySettings } = useDisplaySettings();
  const { isShowroomMode } = useShowroomMode();
  const { addItem } = useCart();
  const { language, t } = useLanguage();
  const { formatPrice } = useCurrency();
  const { getMinPricePerSqm, getVariantPrice, getPricePerSqm } = useUserPricing();
  const [sizesOpen, setSizesOpen] = useState(false);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [addedSku, setAddedSku] = useState<string | null>(null);

  const myShowroomId = profile?.showroom_warehouse_id;
  const myShowroomName = profile?.showroom_warehouse_name || 'В моем магазине';
  const showHub = isEffectiveAdmin || isWarehouseVisibleForClient({ warehouse_id: 81, warehouse_name: 'Основной Склад Астана' }, profile);
  const showShowroom = isEffectiveAdmin || Boolean(myShowroomId && isWarehouseVisibleForClient({ warehouse_id: myShowroomId, warehouse_name: myShowroomName }, profile));
  const hasShowroom = Boolean(user && myShowroomId && showShowroom);

  // Изображения для карусели
  const validImages = (product.images || []).filter(img => typeof img === 'string' && img.trim().length > 0 && !img.includes('unsplash.com'));
  const allImages = validImages.length > 0 ? validImages : (product.image_thumb ? [product.image_thumb] : []);
  const [currentImgIndex, setCurrentImgIndex] = useState(0);

  const activeImage = allImages[currentImgIndex] || allImages[0] || product.image_thumb || '';

  const handlePrevImage = (e: React.MouseEvent) => {
    e.stopPropagation();
    setCurrentImgIndex(idx => (idx === 0 ? allImages.length - 1 : idx - 1));
  };

  const handleNextImage = (e: React.MouseEvent) => {
    e.stopPropagation();
    setCurrentImgIndex(idx => (idx === allImages.length - 1 ? 0 : idx + 1));
  };

  const sizeCount = product.variants.length;
  const pricePerSqm = getMinPricePerSqm(product);
  const activeVariantForSale = product.variants.find(v => (v.price_per_sqm ?? 0) === pricePerSqm) || product.variants[0];
  const isOnSale = Boolean(activeVariantForSale?.is_on_sale || product.is_on_sale);
  const oldPricePerSqm = activeVariantForSale?.old_price_per_sqm || product.old_price_per_sqm || null;

  const setQuantity = (sku: string, value: number) => {
    setQuantities(previous => ({ ...previous, [sku]: Math.max(1, value || 1) }));
  };

  const getVariantClientStock = (variant: ProductVariant) => {
    const rows = filterClientWarehouses(variant.warehouses, myShowroomId, myShowroomName, clientContext, displaySettings);
    return rows.reduce((sum, w) => sum + w.stock, 0);
  };

  const getVariantClientWarehouse = (variant: ProductVariant) => {
    const rows = filterClientWarehouses(variant.warehouses, myShowroomId, myShowroomName, clientContext, displaySettings);
    return rows.find(w => w.stock > 0) || rows[0] || null;
  };

  const handleAdd = (variant: ProductVariant) => {
    const warehouse = getVariantClientWarehouse(variant);
    if (!warehouse) return;

    const stock = getVariantClientStock(variant);
    if (stock <= 0) {
      alert('Данного размера нет в наличии на доступных складах');
      return;
    }

    const quantity = Math.min(quantities[variant.sku] ?? 1, stock);
    const price = getVariantPrice(product.collection, variant.size, variant.base_price, variant.price_per_sqm);
    const itemSqmPrice = getPricePerSqm(product.collection, variant.size, variant.base_price, variant.price_per_sqm);

    addItem({
      productId: product.id,
      item_id: (variant as any).item_id || (Number(variant.id) > 0 ? Number(variant.id) : (Number(product.id) > 0 ? Number(product.id) : undefined)),
      productName: product.name,
      collection: product.collection,
      image: activeImage,
      size: variant.size,
      sku: variant.sku,
      warehouse: warehouse.warehouse_name || warehouse.city,
      warehouse_id: warehouse.warehouse_id || 81,
      price,
      price_per_sqm: itemSqmPrice,
      area_sqm: variant.area_sqm,
      maxStock: stock,
    }, quantity);
    setAddedSku(variant.sku);
    window.setTimeout(() => setAddedSku(current => current === variant.sku ? null : current), 1400);
  };

  const totalShowroomQty = hasShowroom
    ? product.variants.reduce((sum, v) => {
        const wh = v.warehouses.find(w => w.warehouse_id === myShowroomId);
        return sum + (wh?.stock || 0);
      }, 0)
    : 0;

  const totalShowroomSqm = hasShowroom
    ? Math.round(product.variants.reduce((sum, v) => {
        const wh = v.warehouses.find(w => w.warehouse_id === myShowroomId);
        const { w, h } = parseSizeDimensions(v.size);
        const area = v.area_sqm || (w * h) || 1;
        return sum + ((wh?.stock || 0) * area);
      }, 0) * 10) / 10
    : 0;

  const totalInTransitQty = hasShowroom ? product.variants.reduce((sum, v) => sum + (v.dealer_stock?.in_transit_qty || 0), 0) : 0;
  const totalInTransitSqm = hasShowroom ? Math.round(product.variants.reduce((sum, v) => sum + (v.dealer_stock?.in_transit_sqm || 0), 0) * 10) / 10 : 0;
  const totalHubQty = showHub ? product.variants.reduce((sum, v) => sum + getMainWarehouseStock(v), 0) : 0;

  const totalStockForCard = product.variants.reduce((sum, v) => sum + getVariantClientStock(v), 0);
  const isOutOfStock = totalStockForCard <= 0;

  const handleCardPrefetch = () => {
    cacheProduct(product);
    prefetchProductPage();
  };

  const handleOpenProduct = () => {
    cacheProduct(product);
    onNavigate('product', product.id);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      data-product-id={product.id}
      onMouseEnter={handleCardPrefetch}
      onPointerEnter={handleCardPrefetch}
      onClick={handleOpenProduct}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleOpenProduct();
        }
      }}
      className={`group card relative flex flex-col overflow-visible text-left cursor-pointer transition-shadow hover:shadow-lg active:scale-[0.99] touch-manipulation ${sizesOpen ? 'z-30' : ''}`}
    >
      {/* Превью фото с возможностью листать */}
      <div 
        onClick={handleOpenProduct}
        className="relative aspect-[4/5] sm:aspect-[3/4] overflow-hidden rounded-t-xl bg-slate-50 p-2 sm:p-2.5 flex items-center justify-center cursor-pointer"
      >
        <ProductImage
          src={activeImage}
          alt={product.name}
          loading="lazy"
          decoding="async"
          width={600}
          fit="contain"
          className="h-full w-full bg-transparent flex items-center justify-center pointer-events-none"
          imageClassName="transition-transform duration-500 ease-apple group-hover:scale-105"
        />

        {/* Бейдж наличия */}
        {hasShowroom && totalShowroomQty > 0 && (
          <div className="absolute top-2.5 left-2.5 z-10 pointer-events-none">
            <span className="inline-flex items-center gap-1 rounded-md bg-emerald-600/90 backdrop-blur-sm px-2 py-0.5 text-[11px] font-bold text-white shadow-sm">
              🏪 В наличии: {totalShowroomQty} шт
            </span>
          </div>
        )}

        {/* Бейдж для админа: если у товара 0 остаток и он скрыт от клиентов */}
        {isEffectiveAdmin && isOutOfStock && !isShowroomMode && (
          <div className="absolute top-2.5 right-2.5 z-10 pointer-events-none">
            <span className="inline-flex items-center gap-1 rounded-md bg-amber-600/90 backdrop-blur-sm px-2 py-0.5 text-[10px] font-bold text-white shadow-sm" title="Товар с нулевым остатком скрыт от клиентов">
              ⚠️ 0 шт · Скрыт от клиентов
            </span>
          </div>
        )}

        {/* Кнопки перелистывания фото при наведении (скрыты на мобильных, активны только на десктопе) */}
        {allImages.length > 1 && (
          <>
            <button
              type="button"
              onClick={handlePrevImage}
              aria-label="Предыдущее фото"
              className="hidden sm:flex absolute left-2 top-1/2 -translate-y-1/2 z-20 h-8 w-8 items-center justify-center rounded-full bg-white/90 text-slate-700 shadow-md backdrop-blur-sm border border-slate-200/80 transition-all hover:bg-white hover:scale-110 opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={handleNextImage}
              aria-label="Следующее фото"
              className="hidden sm:flex absolute right-2 top-1/2 -translate-y-1/2 z-20 h-8 w-8 items-center justify-center rounded-full bg-white/90 text-slate-700 shadow-md backdrop-blur-sm border border-slate-200/80 transition-all hover:bg-white hover:scale-110 opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto"
            >
              <ChevronRight className="h-4 w-4" />
            </button>

            {/* Точки-индикаторы снизу (dots) - контейнер не перехватывает клики */}
            <div className="absolute bottom-2 left-0 right-0 z-20 flex items-center justify-center gap-1 pointer-events-none">
              {allImages.slice(0, 6).map((_, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setCurrentImgIndex(idx);
                  }}
                  className={`h-1.5 rounded-full transition-all pointer-events-auto ${
                    idx === currentImgIndex
                      ? 'w-3.5 bg-slate-900 shadow'
                      : 'w-1.5 bg-white/90 border border-slate-300 hover:bg-slate-400'
                  }`}
                  aria-label={`Фото ${idx + 1}`}
                />
              ))}
            </div>
          </>
        )}
      </div>

      <div className="flex-1 flex flex-col p-3 sm:p-4">
        {/* Название товара: Артикул — Цвет (фиксированная 2-строчная высота для идеального выравнивания) */}
        <h3 
          onClick={handleOpenProduct}
          className="text-xs sm:text-sm font-bold text-slate-900 leading-snug line-clamp-2 min-h-[2.5rem] sm:min-h-[2.75rem] flex items-center group-hover:text-brand-700 transition-colors cursor-pointer"
        >
          {formatProductTitle(product, language)}
        </h3>

        {/* Коллекция */}
        <div className="mt-1 min-h-[1.25rem] flex items-center">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onNavigate('catalog', product.collection);
            }}
            className="inline-flex items-center text-xs text-brand-700 hover:text-brand-900 hover:underline transition-colors w-fit font-bold uppercase tracking-wider"
          >
            {product.collection}
          </button>
        </div>

        {/* Склады: свой склад (если привязан) + центральный склад Астана */}
        {user && (
          <div className="mt-2 flex flex-col gap-1 border-t border-slate-100 pt-2 min-h-[38px] justify-center">
            {hasShowroom && totalShowroomQty > 0 && (
              <div className="flex items-center justify-between text-xs gap-1">
                <span className="inline-flex items-center gap-1 font-semibold text-emerald-700 truncate max-w-[105px] sm:max-w-[130px]" title={myShowroomName}>
                  🏪 {myShowroomName}:
                </span>
                <span className="font-bold text-emerald-800 shrink-0">
                  {totalShowroomQty} {t('common.pcs')} <span className="font-normal text-emerald-600 hidden sm:inline">({totalShowroomSqm} {t('common.sqm')})</span>
                </span>
              </div>
            )}
            {hasShowroom && totalInTransitQty > 0 && (
              <div className="flex items-center justify-between text-xs gap-1">
                <span className="inline-flex items-center gap-1 font-medium text-indigo-700 truncate max-w-[105px] sm:max-w-[130px]">
                  🚚 {t('product.in_transit')}:
                </span>
                <span className="font-semibold text-indigo-800 shrink-0">
                  {totalInTransitQty} {t('common.pcs')} <span className="font-normal text-indigo-500 hidden sm:inline">({totalInTransitSqm} {t('common.sqm')})</span>
                </span>
              </div>
            )}
            {showHub && (
              <div className="flex items-center justify-between text-xs gap-1">
                <span className="inline-flex items-center gap-1 text-slate-500 truncate max-w-[105px] sm:max-w-[130px]" title="Основной Склад Астана">
                  🏢 {language === 'kz' ? 'Астана қоймасы' : language === 'tr' ? 'Astana Deposu' : language === 'en' ? 'Astana Hub' : 'Склад Астана'}:
                </span>
                <span className={`font-semibold shrink-0 ${totalHubQty > 0 ? 'text-slate-800' : 'text-slate-400'}`}>
                  {totalHubQty > 0 ? `${totalHubQty} ${t('common.pcs')}` : t('product.in_transit')}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Блок цены и размера ВСЕГДА зафиксирован по единой нижней линии (mt-auto) */}
        <div className="mt-auto border-t border-slate-100 pt-2.5 flex items-center justify-between">
          <div>
            {isShowroomMode ? (
              <div className="flex items-center gap-1.5 leading-tight">
                <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200/80 px-2 py-0.5 text-xs font-bold shadow-2xs">
                  {t('product.in_stock')}
                </span>
              </div>
            ) : user ? (
              <div className="flex items-baseline gap-1 leading-tight flex-wrap">
                <span className={`text-sm sm:text-base font-bold ${isOnSale ? 'text-red-600' : 'text-slate-900'}`}>
                  {formatPrice(pricePerSqm)}
                </span>
                {isOnSale && oldPricePerSqm && (
                  <span className="text-[11px] text-slate-400 line-through">
                    {formatPrice(oldPricePerSqm)}
                  </span>
                )}
                <span className="text-[10px] sm:text-[11px] font-normal text-slate-400">/ {t('common.sqm')}</span>
                {isOnSale && (
                  <span className="badge text-[9px] font-bold bg-red-50 text-red-700 border border-red-200/50 py-0 px-1 ml-0.5">
                    SALE
                  </span>
                )}
              </div>
            ) : (
              <p className="flex items-center gap-1 text-xs text-slate-400 font-medium">
                <Lock className="h-3 w-3" />
                {t('product.login_for_prices')}
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setSizesOpen(open => !open);
            }}
            className="flex items-center gap-1 rounded-full bg-slate-100 hover:bg-slate-200 px-2.5 sm:px-3 py-1 sm:py-1.5 text-xs font-semibold text-slate-700 transition-colors cursor-pointer shrink-0"
            title={t('product.sizes')}
          >
            <span>
              {sizeCount}{' '}
              {language === 'kz'
                ? 'өлшем'
                : language === 'en'
                ? (sizeCount === 1 ? 'size' : 'sizes')
                : language === 'tr'
                ? 'ebat'
                : sizeCount === 1
                ? 'размер'
                : sizeCount > 1 && sizeCount < 5
                ? 'размера'
                : 'размеров'}
            </span>
          </button>
        </div>
      </div>

      {sizesOpen && (
        <ProductCardQuickSizes
          product={product}
          isEffectiveAdmin={isEffectiveAdmin}
          quantities={quantities}
          addedSku={addedSku}
          onSetQuantity={setQuantity}
          onAdd={handleAdd}
          getVariantStock={getVariantClientStock}
        />
      )}
    </div>
  );
}
