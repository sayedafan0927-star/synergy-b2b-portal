import { useState } from 'react';
import type { Product, PageId, ProductVariant } from '@/types';
import { parseSizeDimensions } from '@/types';
import { useAuth } from '@/contexts/AuthContext';
import { useCart } from '@/contexts/CartContext';
import { useUserPricing } from '@/hooks/usePricing';
import { useLanguage } from '@/contexts/LanguageContext';
import { useDisplaySettings } from '@/hooks/useDisplaySettings';
import { filterClientWarehouses } from '@/hooks/useProductData';
import { isWarehouseVisibleForClient } from '@/lib/warehouseVisibility';
import { Check, ChevronDown, ChevronLeft, ChevronRight, Lock, ShoppingCart } from 'lucide-react';
import ProductImage from '@/components/ProductImage';

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

function getTotalStock(variant: ProductVariant) {
  return getMainWarehouseStock(variant);
}

function getAvailableWarehouse(variant: ProductVariant) {
  return {
    warehouse_id: 81,
    warehouse_name: 'Основной Склад Астана',
    city: 'Основной Склад Астана',
    stock: getMainWarehouseStock(variant),
  };
}

export function formatProductTitle(product: { name: string; article?: string; color?: string; category?: string; collection: string }, lang: 'ru' | 'kz' = 'ru'): string {
  const isRunner = Boolean(
    (product.category && product.category.toLowerCase().includes('дорожк')) ||
    (product.name && product.name.toLowerCase().includes('дорожк'))
  );

  let art = (product.article || '').trim();
  let col = (product.color || '').trim();

  // Дедупликация повторов цвета вида "CREAM / CREAM" или "GREY / GREY"
  if (col.includes('/')) {
    const parts = col.split('/').map(p => p.trim());
    if (parts.length > 1 && parts.every(p => p.toLowerCase() === parts[0].toLowerCase())) {
      col = parts[0];
    }
  }

  let base = '';
  if (art && col) {
    if (art.toLowerCase().includes(col.toLowerCase())) {
      base = art;
    } else {
      base = `${art} — ${col}`;
    }
  } else if (art) {
    base = art;
  } else {
    base = product.name
      .replace(/^ковер\s+/i, '')
      .replace(/^дорожка\s+/i, '')
      .replace(new RegExp(`^${product.collection}\\s+`, 'i'), '')
      .trim() || product.name;
  // Очистка повторов в названии вида "L.VİZON / L.VİZON" или "CREAM / CREAM"
  base = base.replace(/([^\s/]+(?:\s+[^\s/]+)*)\s*\/\s*\1\b/gi, '$1').trim();

  const prefix = lang === 'kz' ? 'Жол кілем' : 'Дорожка';
  return isRunner ? `${prefix} ${base}` : base;
}

export default function ProductCard({ product, onNavigate }: ProductCardProps) {
  const { user, profile, isAdmin, isImpersonating } = useAuth();
  const isEffectiveAdmin = isAdmin && !isImpersonating;
  const clientContext = isEffectiveAdmin ? true : profile;
  const { settings: displaySettings } = useDisplaySettings();
  const { addItem } = useCart();
  const { language, t } = useLanguage();
  const { getMinPricePerSqm, getVariantPrice, getPricePerSqm, hasContractDiscount, tier } = useUserPricing();
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

  // Определяем ходовой размер для превью
  const primarySize = product.variants.find(v => v.size === '1.6 × 2.3' || v.size === '1.6*2.3')?.size
    || product.variants.find(v => v.size === '2 × 3' || v.size === '2*3')?.size
    || product.variants[0]?.size
    || 'Стандарт';

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

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onNavigate('product', product.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onNavigate('product', product.id);
        }
      }}
      className={`group card relative flex flex-col overflow-visible text-left cursor-pointer transition-shadow hover:shadow-lg active:scale-[0.99] touch-manipulation ${sizesOpen ? 'z-30' : ''}`}
    >
      {/* Превью фото с возможностью листать */}
      <div 
        onClick={() => onNavigate('product', product.id)}
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
        {isEffectiveAdmin && isOutOfStock && (
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
          onClick={() => onNavigate('product', product.id)}
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
                  {totalShowroomQty} шт <span className="font-normal text-emerald-600 hidden sm:inline">({totalShowroomSqm} м²)</span>
                </span>
              </div>
            )}
            {hasShowroom && totalInTransitQty > 0 && (
              <div className="flex items-center justify-between text-xs gap-1">
                <span className="inline-flex items-center gap-1 font-medium text-indigo-700 truncate max-w-[105px] sm:max-w-[130px]">
                  🚚 {t('product.in_transit')}:
                </span>
                <span className="font-semibold text-indigo-800 shrink-0">
                  {totalInTransitQty} шт <span className="font-normal text-indigo-500 hidden sm:inline">({totalInTransitSqm} м²)</span>
                </span>
              </div>
            )}
            {showHub && (
              <div className="flex items-center justify-between text-xs gap-1">
                <span className="inline-flex items-center gap-1 text-slate-500 truncate max-w-[105px] sm:max-w-[130px]" title="Основной Склад Астана">
                  🏢 {language === 'kz' ? 'Астана қоймасы' : 'Склад Астана'}:
                </span>
                <span className={`font-semibold shrink-0 ${totalHubQty > 0 ? 'text-slate-800' : 'text-slate-400'}`}>
                  {totalHubQty > 0 ? `${totalHubQty} шт` : 'под заказ'}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Блок цены и размера ВСЕГДА зафиксирован по единой нижней линии (mt-auto) */}
        <div className="mt-auto border-t border-slate-100 pt-2.5 flex items-center justify-between">
          <div>
            {user ? (
              <div className="flex items-baseline gap-1 leading-tight flex-wrap">
                <span className={`text-sm sm:text-base font-bold ${isOnSale ? 'text-red-600' : 'text-slate-900'}`}>
                  ${pricePerSqm.toFixed(2)}
                </span>
                {isOnSale && oldPricePerSqm && (
                  <span className="text-[11px] text-slate-400 line-through">
                    ${oldPricePerSqm.toFixed(2)}
                  </span>
                )}
                <span className="text-[10px] sm:text-[11px] font-normal text-slate-400">/ м²</span>
                {hasContractDiscount && !isOnSale && (
                  <span className="badge text-[9px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200/50 py-0 px-1 ml-0.5" title={tier.label}>
                    -{tier.discountPercent}%
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
            title="Показать все размеры"
          >
            <span>
              {sizeCount}{' '}
              {language === 'kz'
                ? 'өлшем'
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
        <div
          className="absolute left-0 right-0 sm:-left-3 sm:-right-3 top-full z-40 -mt-1 rounded-xl bg-white p-3 shadow-xl ring-1 ring-slate-200/80 border border-slate-100 min-w-[290px]"
          onClick={event => event.stopPropagation()}
        >
          <div className="space-y-1.5 max-h-60 overflow-y-auto overflow-x-hidden pr-0.5 select-none">
            {product.variants.filter(v => getVariantClientStock(v) > 0).length > 0 ? (
              product.variants
                .filter(v => getVariantClientStock(v) > 0)
                .map(variant => {
                  const stock = getVariantClientStock(variant);
                  const quantity = quantities[variant.sku] ?? 1;
                  const isAdded = addedSku === variant.sku;

                  return (
                    <div
                      key={variant.sku}
                      className="flex items-center justify-between py-1.5 border-b border-slate-100 last:border-b-0 gap-2"
                    >
                      <div className="flex items-baseline gap-1.5 whitespace-nowrap shrink-0">
                        <span className="font-semibold text-slate-800 text-xs sm:text-sm whitespace-nowrap">{variant.size}</span>
                        <span className="text-[10px] sm:text-[11px] text-slate-400 font-normal whitespace-nowrap">({stock} шт)</span>
                      </div>

                      <div className="flex items-center gap-1.5 ml-auto shrink-0">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setQuantity(variant.sku, Math.max(1, (quantities[variant.sku] ?? 1) - 1));
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
                            setQuantity(variant.sku, Math.max(1, Math.min(stock, val || 1)));
                          }}
                          onClick={event => event.stopPropagation()}
                          className="h-7 w-9 shrink-0 rounded-lg border border-slate-200 text-center text-xs font-semibold text-slate-800 outline-none focus:border-brand-500"
                        />
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setQuantity(variant.sku, Math.min(stock, (quantities[variant.sku] ?? 1) + 1));
                          }}
                          className="h-7 w-7 shrink-0 rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-center text-slate-700 hover:bg-slate-100 active:scale-95 transition-all text-xs font-bold cursor-pointer"
                        >
                          +
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleAdd(variant);
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
      )}
    </div>
  );
}
