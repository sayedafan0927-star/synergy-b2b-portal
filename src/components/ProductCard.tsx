import { useState } from 'react';
import type { Product, PageId, ProductVariant } from '@/types';
import { parseSizeDimensions } from '@/types';
import { useAuth } from '@/contexts/AuthContext';
import { useCart } from '@/contexts/CartContext';
import { useUserPricing } from '@/hooks/usePricing';
import { useLanguage } from '@/contexts/LanguageContext';
import { Check, ChevronDown, ChevronLeft, ChevronRight, Lock, ShoppingCart } from 'lucide-react';
import ProductImage from '@/components/ProductImage';

interface ProductCardProps {
  product: Product;
  onNavigate: (page: PageId, productId?: string) => void;
}

function getMainWarehouseStock(variant: ProductVariant) {
  const mainHub = variant.warehouses.find(w =>
    w.warehouse_id === 81 ||
    (w.warehouse_name && (w.warehouse_name.includes('Астана') || w.warehouse_name.toLowerCase().includes('основной')))
  );
  return mainHub ? mainHub.stock : 0;
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
  const base = (product.article && product.color)
    ? `${product.article} — ${product.color}`
    : product.name.replace(/^ковер\s+/i, '').replace(/^дорожка\s+/i, '').replace(new RegExp(`^${product.collection}\\s+`, 'i'), '').trim() || product.name;
  const prefix = lang === 'kz' ? 'Жол кілем' : 'Дорожка';
  return isRunner ? `${prefix} ${base}` : base;
}

export default function ProductCard({ product, onNavigate }: ProductCardProps) {
  const { user, profile } = useAuth();
  const { addItem } = useCart();
  const { language, t } = useLanguage();
  const { getMinPricePerSqm, getVariantPrice, getPricePerSqm } = useUserPricing();
  const [sizesOpen, setSizesOpen] = useState(false);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [addedSku, setAddedSku] = useState<string | null>(null);

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

  // Определяем ходовой размер для превью
  const primarySize = product.variants.find(v => v.size === '1.6 × 2.3' || v.size === '1.6*2.3')?.size
    || product.variants.find(v => v.size === '2 × 3' || v.size === '2*3')?.size
    || product.variants[0]?.size
    || 'Стандарт';

  const setQuantity = (sku: string, value: number) => {
    setQuantities(previous => ({ ...previous, [sku]: Math.max(1, value || 1) }));
  };

  const handleAdd = (variant: ProductVariant) => {
    const warehouse = getAvailableWarehouse(variant);
    if (!warehouse) return;

    const stock = getTotalStock(variant);
    if (stock <= 0) {
      alert('Данного размера нет в наличии на складе в Астане');
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

  const myShowroomId = profile?.showroom_warehouse_id;
  const hasDealerStock = Boolean(user && (product.variants.some(v => v.dealer_stock) || myShowroomId));
  const totalShowroomQty = product.variants.reduce((sum, v) => {
    if (myShowroomId) {
      const wh = v.warehouses.find(w => w.warehouse_id === myShowroomId);
      return sum + (wh?.stock || 0);
    }
    return sum + (v.dealer_stock?.in_showroom_qty || 0);
  }, 0);
  const totalShowroomSqm = Math.round(product.variants.reduce((sum, v) => {
    if (myShowroomId) {
      const wh = v.warehouses.find(w => w.warehouse_id === myShowroomId);
      const { w, h } = parseSizeDimensions(v.size);
      const area = v.area_sqm || (w * h) || 1;
      return sum + ((wh?.stock || 0) * area);
    }
    return sum + (v.dealer_stock?.in_showroom_sqm || 0);
  }, 0) * 10) / 10;
  const totalInTransitQty = product.variants.reduce((sum, v) => sum + (v.dealer_stock?.in_transit_qty || 0), 0);
  const totalInTransitSqm = Math.round(product.variants.reduce((sum, v) => sum + (v.dealer_stock?.in_transit_sqm || 0), 0) * 10) / 10;
  const totalHubQty = product.variants.reduce((sum, v) => sum + getMainWarehouseStock(v), 0);

  return (
    <div
      onClick={() => onNavigate('product', product.id)}
      className={`group card relative flex flex-col overflow-visible text-left cursor-pointer transition-shadow hover:shadow-lg ${sizesOpen ? 'z-30' : ''}`}
    >
      {/* Превью фото с возможностью листать */}
      <div className="relative aspect-[4/3] overflow-hidden rounded-t-xl bg-slate-100 select-none">
        <ProductImage
          src={activeImage}
          alt={product.name}
          loading="lazy"
          decoding="async"
          width={400}
          className="h-full w-full object-cover transition-transform duration-500 ease-apple group-hover:scale-105"
        />

        {/* Бейдж наличия */}
        {hasDealerStock && totalShowroomQty > 0 && (
          <div className="absolute top-2.5 left-2.5 z-10 pointer-events-none">
            <span className="inline-flex items-center gap-1 rounded-md bg-emerald-600/90 backdrop-blur-sm px-2 py-0.5 text-[11px] font-bold text-white shadow-sm">
              🏪 В наличии: {totalShowroomQty} шт
            </span>
          </div>
        )}

        {/* Кнопки перелистывания фото при наведении */}
        {allImages.length > 1 && (
          <>
            <button
              type="button"
              onClick={handlePrevImage}
              aria-label="Предыдущее фото"
              className="absolute left-2 top-1/2 -translate-y-1/2 z-20 flex h-7 w-7 sm:h-8 sm:w-8 items-center justify-center rounded-full bg-white/90 text-slate-700 shadow-md backdrop-blur-sm border border-slate-200/80 transition-all hover:bg-white hover:scale-110 opacity-0 group-hover:opacity-100"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={handleNextImage}
              aria-label="Следующее фото"
              className="absolute right-2 top-1/2 -translate-y-1/2 z-20 flex h-7 w-7 sm:h-8 sm:w-8 items-center justify-center rounded-full bg-white/90 text-slate-700 shadow-md backdrop-blur-sm border border-slate-200/80 transition-all hover:bg-white hover:scale-110 opacity-0 group-hover:opacity-100"
            >
              <ChevronRight className="h-4 w-4" />
            </button>

            {/* Точки-индикаторы снизу (dots) */}
            <div className="absolute bottom-2 left-0 right-0 z-20 flex items-center justify-center gap-1 pointer-events-auto">
              {allImages.slice(0, 6).map((_, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setCurrentImgIndex(idx);
                  }}
                  className={`h-1.5 rounded-full transition-all ${
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

      <div className="flex flex-col p-3 sm:p-4">
        {/* Название товара: Артикул — Цвет (для дорожек с приставкой Дорожка / Жол кілем) */}
        <h3 className="text-sm font-bold text-slate-900 leading-snug line-clamp-2 group-hover:text-brand-700 transition-colors">
          {formatProductTitle(product, language)}
        </h3>

        {/* Коллекция */}
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onNavigate('catalog', product.collection);
          }}
          className="mt-1 inline-flex items-center text-xs text-brand-700 hover:text-brand-900 hover:underline transition-colors w-fit font-bold uppercase tracking-wider"
        >
          {product.collection}
        </button>

        {/* Остатки дилера (если есть) */}
        {hasDealerStock && (
          <div className="mt-2 flex flex-col gap-1 border-t border-slate-100 pt-2">
            <div className="flex items-center justify-between text-xs">
              <span className="inline-flex items-center gap-1 font-semibold text-emerald-700">
                🏪 {t('product.in_showroom')}:
              </span>
              <span className="font-bold text-emerald-800">
                {totalShowroomQty} шт <span className="font-normal text-emerald-600">({totalShowroomSqm} м²)</span>
              </span>
            </div>
            {totalInTransitQty > 0 && (
              <div className="flex items-center justify-between text-xs">
                <span className="inline-flex items-center gap-1 font-medium text-indigo-700">
                  🚚 {t('product.in_transit')}:
                </span>
                <span className="font-semibold text-indigo-800">
                  {totalInTransitQty} шт <span className="font-normal text-indigo-500">({totalInTransitSqm} м²)</span>
                </span>
              </div>
            )}
            <div className="flex items-center justify-between text-xs">
              <span className="inline-flex items-center gap-1 text-slate-500">
                🏢 {language === 'kz' ? 'Негізгі қойма (Астана)' : 'Основной Склад Астана'}:
              </span>
              <span className="font-medium text-slate-700">
                {totalHubQty} шт
              </span>
            </div>
          </div>
        )}

        {/* Блок цены и размера в одной компактной строке напротив друг друга без серых подписей */}
        <div className="mt-3 border-t border-slate-100 pt-2.5 flex items-center justify-between">
          <div>
            {user ? (
              <p className="text-sm sm:text-base font-bold text-slate-900 leading-tight">
                ${pricePerSqm.toFixed(2)} <span className="text-[11px] font-normal text-slate-400">/ м²</span>
              </p>
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
            className="flex items-center gap-1.5 rounded-full bg-slate-100 hover:bg-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors cursor-pointer"
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
          className="absolute left-2 right-2 top-full z-40 -mt-1 rounded-xl bg-white p-3 shadow-xl ring-1 ring-slate-200/80 border border-slate-100"
          onClick={event => event.stopPropagation()}
        >
          <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1 select-none">
            {product.variants.filter(v => getTotalStock(v) > 0).length > 0 ? (
              product.variants
                .filter(v => getTotalStock(v) > 0)
                .map(variant => {
                  const stock = getTotalStock(variant);
                  const quantity = quantities[variant.sku] ?? 1;
                  const isAdded = addedSku === variant.sku;

                  return (
                    <div
                      key={variant.sku}
                      className="flex items-center justify-between py-1.5 border-b border-slate-100 last:border-b-0 gap-2"
                    >
                      <div className="flex items-baseline gap-1.5">
                        <span className="font-semibold text-slate-800 text-sm whitespace-nowrap">{variant.size}</span>
                        <span className="text-[11px] text-slate-400 font-normal">({stock} шт)</span>
                      </div>

                      <div className="flex items-center gap-1.5 ml-auto">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setQuantity(variant.sku, Math.max(1, (quantities[variant.sku] ?? 1) - 1));
                          }}
                          className="h-7 w-7 rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-center text-slate-600 hover:bg-slate-100 active:scale-95 transition-all text-xs font-bold"
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
                          className="h-7 w-10 rounded-lg border border-slate-200 text-center text-xs font-semibold text-slate-800 outline-none focus:border-brand-500"
                        />
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setQuantity(variant.sku, Math.min(stock, (quantities[variant.sku] ?? 1) + 1));
                          }}
                          className="h-7 w-7 rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-center text-slate-600 hover:bg-slate-100 active:scale-95 transition-all text-xs font-bold"
                        >
                          +
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleAdd(variant);
                          }}
                          className={`h-7 w-8 rounded-lg flex items-center justify-center text-white transition-all active:scale-95 ${
                            isAdded ? 'bg-emerald-600 shadow-sm' : 'bg-brand-700 hover:bg-brand-800 shadow-sm'
                          }`}
                          title="Добавить в корзину"
                        >
                          {isAdded ? <Check className="h-3.5 w-3.5" /> : <ShoppingCart className="h-3.5 w-3.5" />}
                        </button>
                      </div>
                    </div>
                  );
                })
            ) : (
              <div className="py-3 px-2 text-center text-xs text-slate-500 font-medium">
                Нет в наличии на складе в Астане
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
