import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  ChevronRight,
  ChevronLeft,
  ShoppingCart,
  Check,
  Minus,
  Plus,
  PackageSearch,
  ArrowLeft,
  Ruler,
  ListChecks,
  ZoomIn,
  X,
  Lock,
  Loader2,
} from 'lucide-react';
import type { PageId, ProductVariant, Warehouse } from '@/types';
import { parseSizeDimensions } from '@/types';
import { useProduct, filterClientWarehouses } from '@/hooks/useProductData';
import { isWarehouseVisibleForClient } from '@/lib/warehouseVisibility';
import { useUserPricing } from '@/hooks/usePricing';
import { useDisplaySettings } from '@/hooks/useDisplaySettings';
import { useCart } from '@/contexts/CartContext';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import ProductImage, { CarpetPlaceholderIcon } from '@/components/ProductImage';


function rowKey(sku: string, city: string) {
  return `${sku}::${city}`;
}

function fmtPrice(n: number) {
  if (typeof n !== 'number' || isNaN(n)) return '$0.00';
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function getVariantShape(v: ProductVariant, productName = '', productCategory = ''): string {
  const s = (v.size || '').toLowerCase();
  const name = (productName + ' ' + (v.name || '')).toLowerCase();
  const { w, h } = parseSizeDimensions(v.size);

  if (name.includes('овал') || s.includes('овал')) return 'Овальный';
  if (name.includes('круг') || s.includes('круг')) return 'Круглый';
  if (v.type === 'Рулон' || productCategory.toLowerCase().includes('дорожк') || name.includes('дорожк')) {
    return 'Дорожка';
  }
  if (w > 0 && h > 0) {
    const ratio = Math.max(w, h) / Math.min(w, h);
    if (ratio >= 2.5) return 'Дорожка';
    if (Math.abs(w - h) < 0.05) return 'Квадратный';
  }
  return 'Прямоугольный';
}

export default function ProductPage({
  productId,
  onNavigate,
}: {
  productId: string;
  onNavigate: (page: PageId, productId?: string) => void;
}) {
  const { product, loading } = useProduct(productId);
  const { addItem, items } = useCart();
  const { user, profile, isAdmin, isImpersonating } = useAuth();
  const isEffectiveAdmin = isAdmin && !isImpersonating;
  const clientContext = isEffectiveAdmin ? true : profile;
  const { settings: displaySettings } = useDisplaySettings();
  const { language, t } = useLanguage();
  const pricing = useUserPricing();

  const [selectedImage, setSelectedImage] = useState(0);
  const [imageError, setImageError] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);
  const isHorizontalSwipe = useRef(false);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [addedKeys, setAddedKeys] = useState<Record<string, boolean>>({});
  const [selectedShape, setSelectedShape] = useState<string>('');
  const [selectedSize, setSelectedSize] = useState<string>('');

  useEffect(() => {
    setImageError(false);
  }, [product, selectedImage]);

  useEffect(() => {
    if (!product) return;
    const init: Record<string, number> = {};
    product.variants.forEach(v => {
      filterClientWarehouses(v.warehouses, profile?.showroom_warehouse_id, profile?.showroom_warehouse_name, clientContext, displaySettings).forEach(wh => {
        const whLabel = wh.warehouse_name || wh.city;
        init[rowKey(v.sku, whLabel)] = 0;
      });
    });
    setQuantities(init);
    setSelectedImage(0);
    setImageError(false);
    setAddedKeys({});
  }, [product, profile]);

  const cartCountByKey = useMemo(() => {
    const map: Record<string, number> = {};
    if (!product) return map;
    for (const item of items) {
      if (item.productId === product.id) {
        const key = rowKey(item.sku, item.warehouse);
        map[key] = (map[key] ?? 0) + item.quantity;
      }
    }
    return map;
  }, [items, product]);

  const validImages = useMemo(() => {
    return (product?.images || []).filter(img => typeof img === 'string' && img.trim().length > 0);
  }, [product?.images]);

  const imageCount = validImages.length;

  const prevImage = useCallback(() => {
    setSelectedImage(prev => (prev === 0 ? imageCount - 1 : prev - 1));
  }, [imageCount]);

  const nextImage = useCallback(() => {
    setSelectedImage(prev => (prev === imageCount - 1 ? 0 : prev + 1));
  }, [imageCount]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    isHorizontalSwipe.current = false;
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (touchStartX.current === null || touchStartY.current === null) return;
    const dx = Math.abs(e.touches[0].clientX - touchStartX.current);
    const dy = Math.abs(e.touches[0].clientY - touchStartY.current);
    if (dx > dy && dx > 10) {
      isHorizontalSwipe.current = true;
    }
  }, []);

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (touchStartX.current === null) return;
      if (isHorizontalSwipe.current) {
        const delta = e.changedTouches[0].clientX - touchStartX.current;
        if (delta > 50) prevImage();
        else if (delta < -50) nextImage();
      }
      touchStartX.current = null;
      touchStartY.current = null;
      isHorizontalSwipe.current = false;
    },
    [prevImage, nextImage],
  );

  const setQty = useCallback((key: string, val: number) => {
    setQuantities(prev => ({ ...prev, [key]: Math.max(0, val) }));
  }, []);

  const incQty = useCallback((key: string) => {
    setQuantities(prev => ({ ...prev, [key]: (prev[key] ?? 0) + 1 }));
  }, []);

  const decQty = useCallback((key: string) => {
    setQuantities(prev => ({ ...prev, [key]: Math.max(0, (prev[key] ?? 0) - 1) }));
  }, []);

  const handleAdd = useCallback(
    (variant: ProductVariant, wh: Warehouse) => {
      if (!product) return;
      const whLabel = wh.warehouse_name || wh.city;
      const key = rowKey(variant.sku, whLabel);
      const qty = quantities[key] ?? 0;
      if (qty < 1 || wh.stock < 1) return;

      const price = pricing.getVariantPrice(product.collection, variant.size, variant.base_price, variant.price_per_sqm);
      const pricePerSqm = pricing.getPricePerSqm(product.collection, variant.size, variant.base_price, variant.price_per_sqm);
      addItem(
        {
          productId: product.id,
          item_id: (variant as any).item_id || (Number(variant.id) > 0 ? Number(variant.id) : (Number(product.id) > 0 ? Number(product.id) : undefined)),
          productName: product.name,
          collection: product.collection,
          image: product.images[0] || product.image_thumb,
          size: variant.size,
          sku: variant.sku,
          warehouse: whLabel,
          warehouse_id: wh.warehouse_id || 81,
          price,
          price_per_sqm: pricePerSqm,
          area_sqm: variant.area_sqm,
        },
        qty,
      );

      setAddedKeys(prev => ({ ...prev, [key]: true }));
      setTimeout(() => {
        setAddedKeys(prev => ({ ...prev, [key]: false }));
      }, 1500);
    },
    [product, addItem, quantities, pricing],
  );

  useEffect(() => {
    if (!lightboxOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightboxOpen(false);
      if (e.key === 'ArrowLeft') prevImage();
      if (e.key === 'ArrowRight') nextImage();
    };
    window.addEventListener('keydown', handler);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', handler);
      document.body.style.overflow = '';
    };
  }, [lightboxOpen, prevImage, nextImage]);

  useEffect(() => {
    if (!product) return;
    const minPrice = product.variants.reduce((min, v) => Math.min(min, v.base_price), Infinity);
    const maxPrice = product.variants.reduce((max, v) => Math.max(max, v.base_price), 0);
    const inStock = product.variants.some(v => filterClientWarehouses(v.warehouses, profile?.showroom_warehouse_id, profile?.showroom_warehouse_name, isAdmin, displaySettings).some(w => w.stock > 0));
    const ld = {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: product.name,
      image: product.images,
      description: `${product.name} — ${product.collection}. ${product.material}, ${product.style}, ${product.country}. ${product.density}, ворс ${product.pile_height}.`,
      brand: { '@type': 'Brand', name: product.manufacturer },
      sku: product.variants[0]?.sku ?? product.id,
      category: product.category,
      material: product.material,
      countryOfOrigin: { '@type': 'Country', name: product.country },
      offers: {
        '@type': 'AggregateOffer',
        priceCurrency: 'USD',
        lowPrice: minPrice,
        highPrice: maxPrice,
        offerCount: product.variants.length,
        availability: inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
        seller: { '@type': 'Organization', name: 'Synergy-Group' },
      },
    };
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.id = 'product-jsonld';
    script.textContent = JSON.stringify(ld);
    document.getElementById('product-jsonld')?.remove();
    document.head.appendChild(script);
    return () => { document.getElementById('product-jsonld')?.remove(); };
  }, [product]);

  const specs = useMemo(() => {
    if (!product) return [];
    const list: Array<{ label: string; value: string }> = [];
    const seen = new Set<string>();

    if (product.characteristics && product.characteristics.length > 0) {
      for (const c of product.characteristics) {
        if (c.name && c.value && !seen.has(c.name.trim().toLowerCase())) {
          list.push({ label: c.name.trim(), value: c.value.trim() });
          seen.add(c.name.trim().toLowerCase());
        }
      }
    }

    const fallbacks = [
      { label: 'Коллекция', value: product.collection },
      { label: 'Артикул / Дизайн', value: product.article },
      { label: 'Цвет', value: product.color },
      { label: 'Форма', value: product.shape_label || product.shape },
      { label: 'Производитель', value: product.manufacturer },
      { label: 'Страна производства', value: product.country },
      { label: 'Материал', value: product.material },
      { label: 'Стиль', value: product.style },
      { label: 'Плотность', value: product.density },
      { label: 'Высота ворса', value: product.pile_height },
    ];

    for (const f of fallbacks) {
      if (f.value && !seen.has(f.label.trim().toLowerCase())) {
        list.push({ label: f.label, value: f.value });
        seen.add(f.label.trim().toLowerCase());
      }
    }

    return list;
  }, [product]);

  const availableShapes = useMemo(() => {
    if (!product?.variants) return ['Прямоугольный'];
    const shapes = Array.from(new Set(product.variants.map(v => getVariantShape(v, product.name, product.category || ''))));
    return shapes.length > 0 ? shapes : ['Прямоугольный'];
  }, [product]);

  const activeShape = selectedShape && availableShapes.includes(selectedShape)
    ? selectedShape
    : (availableShapes[0] || 'Прямоугольный');

  const variantsForShape = useMemo(() => {
    if (!product?.variants) return [];
    const matched = product.variants.filter(v => getVariantShape(v, product.name, product.category || '') === activeShape);
    return matched.length > 0 ? matched : product.variants;
  }, [product, activeShape]);

  if (loading) {
    return (
      <div className="pt-20 pb-24 lg:pb-8 min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="h-8 w-8 animate-spin text-brand-700" />
      </div>
    );
  }

  if (!product) {
    return (
      <div className="pt-20 pb-24 lg:pb-8 min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center max-w-md mx-auto px-4">
          <PackageSearch className="mx-auto h-16 w-16 text-slate-300 mb-4" />
          <h1 className="font-display text-2xl font-bold text-slate-900 mb-2">Товар не найден</h1>
          <p className="text-slate-500 mb-6">Запрашиваемый товар не существует или был удалён из каталога.</p>
          <button onClick={() => onNavigate('catalog')} className="btn-primary inline-flex items-center gap-2">
            <ArrowLeft className="h-4 w-4" />
            Вернуться в каталог
          </button>
        </div>
      </div>
    );
  }

  const activeVariant = variantsForShape.find(v => v.size === selectedSize)
    || variantsForShape[0]
    || product.variants[0];

  const mainPricePerSqm = activeVariant
    ? pricing.getPricePerSqm(product.collection, activeVariant.size, activeVariant.base_price, activeVariant.price_per_sqm)
    : pricing.getMinPricePerSqm(product);


  const myShowroomId = profile?.showroom_warehouse_id;
  const myShowroomName = profile?.showroom_warehouse_name || 'В моем магазине';

  const isHubVisible = isEffectiveAdmin || isWarehouseVisibleForClient({ warehouse_id: 81, warehouse_name: 'Основной Склад Астана' }, profile);
  const isShowroomVisible = isEffectiveAdmin || Boolean(myShowroomId && isWarehouseVisibleForClient({ warehouse_id: myShowroomId, warehouse_name: myShowroomName }, profile));

  const totalStock = product.variants.reduce((s, v) => s + filterClientWarehouses(v.warehouses, myShowroomId, myShowroomName, clientContext, displaySettings).reduce((a, w) => a + w.stock, 0), 0);
  const sizeRange = product.variants.length > 1
    ? `${product.variants[0].size} — ${product.variants[product.variants.length - 1].size}`
    : product.variants[0]?.size ?? '';
  const availableForms = [product.shape_label, product.style, product.category].filter(Boolean).join(', ');

  const hasDealerStock = Boolean(user && isShowroomVisible && (product.variants.some(v => v.dealer_stock) || myShowroomId));
  const totalShowroomQty = isShowroomVisible ? product.variants.reduce((sum, v) => {
    if (myShowroomId) {
      const wh = v.warehouses.find(w => w.warehouse_id === myShowroomId);
      return sum + (wh?.stock || 0);
    }
    return sum + (v.dealer_stock?.in_showroom_qty || 0);
  }, 0) : 0;
  const totalShowroomSqm = isShowroomVisible ? Math.round(product.variants.reduce((sum, v) => {
    if (myShowroomId) {
      const wh = v.warehouses.find(w => w.warehouse_id === myShowroomId);
      const { w, h } = parseSizeDimensions(v.size);
      const area = v.area_sqm || (w * h) || 1;
      return sum + ((wh?.stock || 0) * area);
    }
    return sum + (v.dealer_stock?.in_showroom_sqm || 0);
  }, 0) * 10) / 10 : 0;
  const totalInTransitQty = isShowroomVisible ? product.variants.reduce((sum, v) => sum + (v.dealer_stock?.in_transit_qty || 0), 0) : 0;
  const totalInTransitSqm = isShowroomVisible ? Math.round(product.variants.reduce((sum, v) => sum + (v.dealer_stock?.in_transit_sqm || 0), 0) * 10) / 10 : 0;
  const totalHubQty = isHubVisible ? product.variants.reduce((sum, v) => {
    const hub = v.warehouses.find(w => w.warehouse_id === 81 || w.is_hub || (w.warehouse_name && w.warehouse_name.includes('Астана')));
    return sum + (hub ? hub.stock : (v.dealer_stock?.available_hub_qty || 0));
  }, 0) : 0;

  function CartButton({ variant, wh }: { variant: ProductVariant; wh: Warehouse }) {
    const whLabel = wh.warehouse_name || wh.city;
    const key = rowKey(variant.sku, whLabel);
    const qty = quantities[key] ?? 0;
    const added = addedKeys[key];
    const inStock = wh.stock > 0;
    const inCart = cartCountByKey[key] ?? 0;

    return (
      <button
        onClick={() => handleAdd(variant, wh)}
        disabled={!inStock || qty < 1}
        className={`btn-primary relative inline-flex items-center gap-1.5 text-xs px-3 py-1.5 whitespace-nowrap transition-all ${
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
        onClick={() => handleAdd(variant, wh)}
        disabled={!inStock || qty < 1}
        className={`btn-primary flex-1 relative inline-flex items-center justify-center gap-1.5 text-sm h-10 transition-all ${
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

  const isRunner = Boolean(
    (product.category && product.category.toLowerCase().includes('дорожк')) ||
    (product.name && product.name.toLowerCase().includes('дорожк'))
  );
  const baseTitle = (product.article && product.color)
    ? `${product.article} — ${product.color}`
    : product.name.replace(/^ковер\s+/i, '').replace(/^дорожка\s+/i, '').replace(new RegExp(`^${product.collection}\\s+`, 'i'), '').trim() || product.name;
  const runnerPrefix = language === 'kz' ? 'Жол кілем' : 'Дорожка';
  const cleanTitle = isRunner ? `${runnerPrefix} ${baseTitle}` : baseTitle;

  return (
    <section className="pt-20 pb-24 lg:pb-8 bg-white min-h-screen">
      <div className="container-w">
        {/* КНОПКА НАЗАД В КАТАЛОГ И ХЛЕБНЫЕ КРОШКИ */}
        <div className="flex items-center gap-3 mb-6">
          <button
            type="button"
            onClick={() => onNavigate('catalog')}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 hover:border-slate-300 shadow-2xs transition-all cursor-pointer group"
          >
            <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
            <span>{t('product.back_catalog')}</span>
          </button>
          <span className="text-slate-300">/</span>
          <nav className="flex items-center gap-1.5 text-xs text-slate-400">
            <button onClick={() => onNavigate('catalog')} className="hover:text-brand-600 transition-colors">{t('nav.catalog')}</button>
            <ChevronRight className="h-3 w-3 shrink-0" />
            <button onClick={() => onNavigate('catalog', product.collection)} className="hover:text-brand-600 transition-colors font-medium text-slate-600">{product.collection}</button>
          </nav>
        </div>

        {/* DESKTOP LAYOUT (ТОЛЬКО ГАЛЕРЕЯ + ИНФО О ТОВАРЕ) */}
        <div className="hidden lg:grid lg:grid-cols-[460px,1fr] xl:grid-cols-[500px,1fr] 2xl:grid-cols-[540px,1fr] gap-10 xl:gap-14 mb-10 items-start">
          {/* LEFT: Gallery (RugsUSA style: vertical thumbnails on the LEFT, main large photo on the RIGHT) */}
          <div className="flex items-start gap-3.5 select-none">
            {/* THUMBNAILS (LEFT) */}
            {imageCount > 1 && (
              <div className="flex w-20 xl:w-22 shrink-0 flex-col gap-2.5 max-h-[500px] xl:max-h-[540px] overflow-y-auto pr-1 select-none scrollbar-thin">
                {validImages.map((img, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setSelectedImage(idx)}
                    className={`relative aspect-[4/5] w-full rounded-xl overflow-hidden border-2 transition-all shrink-0 cursor-pointer ${
                      idx === selectedImage
                        ? 'border-slate-900 shadow-sm ring-2 ring-slate-900/10 opacity-100'
                        : 'border-slate-200/80 opacity-60 hover:opacity-100 hover:border-slate-400'
                    }`}
                  >
                    <ProductImage src={img} alt="" className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            )}

            {/* MAIN LARGE PHOTO (RIGHT) */}
            <div
              className={`relative aspect-[4/5] min-w-0 flex-1 rounded-2xl overflow-hidden bg-slate-50 border border-slate-200/80 ${imageCount > 0 ? 'cursor-zoom-in group' : ''}`}
              onClick={() => imageCount > 0 && setLightboxOpen(true)}
            >
              {imageCount > 0 && validImages[selectedImage] && !imageError ? (
                <>
                  <img
                    src={validImages[selectedImage]}
                    alt={`${cleanTitle} — фото ${selectedImage + 1}`}
                    className="h-full w-full object-contain p-4 transition-transform duration-300 group-hover:scale-105"
                    onError={() => setImageError(true)}
                    draggable={false}
                  />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/5 transition-colors flex items-center justify-center pointer-events-none">
                    <ZoomIn className="h-8 w-8 text-white opacity-0 group-hover:opacity-75 transition-opacity drop-shadow-lg" />
                  </div>
                </>
              ) : (
                <CarpetPlaceholderIcon className="h-full w-full" />
              )}
              {imageCount > 1 && (
                <>
                  <button
                    type="button"
                    onClick={e => { e.stopPropagation(); prevImage(); }}
                    className="absolute left-3 top-1/2 z-10 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full border border-slate-300/80 bg-white/95 text-slate-700 shadow-md hover:scale-105 hover:bg-white transition-all opacity-0 group-hover:opacity-100"
                    aria-label="Предыдущее фото"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                  <button
                    type="button"
                    onClick={e => { e.stopPropagation(); nextImage(); }}
                    className="absolute right-3 top-1/2 z-10 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full border border-slate-300/80 bg-white/95 text-slate-700 shadow-md hover:scale-105 hover:bg-white transition-all opacity-0 group-hover:opacity-100"
                    aria-label="Следующее фото"
                  >
                    <ChevronRight className="h-5 w-5" />
                  </button>

                  <div className="absolute bottom-3 right-3 rounded-md bg-slate-900/60 backdrop-blur-sm px-2 py-0.5 text-[11px] font-medium text-white">
                    {selectedImage + 1} / {imageCount}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* RIGHT: Product info card */}
          <div className="flex flex-col">
            {/* Заголовок как на 2-м скриншоте: Артикул — Цвет */}
            <h1 className="font-display text-2xl xl:text-3xl font-extrabold text-slate-900 leading-tight mb-1">
              {cleanTitle}
            </h1>

            {/* Коллекция */}
            <button
              type="button"
              onClick={() => onNavigate('catalog', product.collection)}
              className="text-xs font-bold uppercase tracking-wider text-brand-700 hover:text-brand-900 hover:underline transition-colors w-fit mb-5"
            >
              {product.collection}
            </button>

            {/* БЛОК ЦЕНЫ, ФОРМЫ И РАЗМЕРОВ (БЕЗ МАТЕРИАЛА И СТИЛЯ) */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 mb-6 shadow-xs">
              {/* 1. Цена за 1 м² и готовая цена изделия */}
              <div className="flex flex-wrap items-baseline justify-between gap-3 pb-5 border-b border-slate-100">
                <div>
                  <span className="text-[10px] uppercase tracking-wider font-semibold text-slate-400 block mb-0.5">
                    {t('product.sqm_price')}
                  </span>
                  {user ? (
                    <div className="flex items-baseline gap-2">
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
                      className="flex items-center gap-2 text-sm text-slate-500 hover:text-brand-700 transition-colors font-medium"
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
                  {t('product.shape')}: <span className="text-brand-700 font-semibold">{activeShape}</span>
                </p>
                <div className="flex flex-wrap gap-2">
                  {availableShapes.map(shape => {
                    const isShapeActive = shape === activeShape;
                    const shapeDisplay = language === 'kz'
                      ? (shape.toLowerCase().includes('дорожк') ? 'Жол кілем' : (shape.toLowerCase().includes('прямоуг') ? 'Тікбұрышты' : (shape.toLowerCase().includes('овал') ? 'Сопақша' : (shape.toLowerCase().includes('круг') ? 'Дөңгелек' : shape))))
                      : shape;

                    return (
                      <button
                        key={shape}
                        type="button"
                        onClick={() => {
                          setSelectedShape(shape);
                          const firstOfShape = product.variants.find(v => getVariantShape(v, product.name, product.category || '') === shape);
                          if (firstOfShape) setSelectedSize(firstOfShape.size);
                        }}
                        className={`rounded-xl px-4 py-2 text-xs font-bold uppercase tracking-wider transition-all duration-200 cursor-pointer ${
                          isShapeActive
                            ? 'bg-slate-900 text-white shadow-md ring-2 ring-slate-900/20'
                            : 'bg-slate-50 border border-slate-200 text-slate-700 hover:border-slate-400 hover:bg-white'
                        }`}
                      >
                        {shapeDisplay}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 3. ДОСТУПНЫЕ РАЗМЕРЫ ДЛЯ ВЫБРАННОЙ ФОРМЫ (КЛИКАБЕЛЬНЫЕ БЛОКИ) */}
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
                        onClick={() => setSelectedSize(v.size)}
                        className={`flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition-all duration-200 ${
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
                      className="text-brand-700 hover:text-brand-800 font-semibold inline-flex items-center gap-1 hover:underline text-xs"
                    >
                      {t('product.stock_table')} ↓
                    </button>
                  </div>
                )}
              </div>
            </div>

            {hasDealerStock && (
              <div className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50/50 p-4">
                <p className="text-xs font-bold uppercase tracking-wider text-emerald-900 mb-2.5 flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                  Персональные остатки дилера
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <div className="rounded-lg bg-white p-3 border border-emerald-200/80 shadow-xs">
                    <p className="text-[11px] font-semibold text-emerald-800">
                      🏪 В наличии в магазине
                    </p>
                    <p className="text-lg font-bold text-emerald-950 mt-0.5">
                      {totalShowroomQty} <span className="text-xs font-normal text-emerald-700">шт ({totalShowroomSqm} м²)</span>
                    </p>
                  </div>

                  <div className="rounded-lg bg-white p-3 border border-indigo-200/80 shadow-xs">
                    <p className="text-[11px] font-semibold text-indigo-800">
                      🚚 В пути ко мне
                    </p>
                    <p className="text-lg font-bold text-indigo-950 mt-0.5">
                      {totalInTransitQty} <span className="text-xs font-normal text-indigo-700">шт ({totalInTransitSqm} м²)</span>
                    </p>
                  </div>

                  <div className="rounded-lg bg-white p-3 border border-slate-200/80 shadow-xs">
                    <p className="text-[11px] font-semibold text-slate-700">
                      🏢 Основной Склад Астана
                    </p>
                    <p className="text-lg font-bold text-slate-900 mt-0.5">
                      {totalHubQty} <span className="text-xs font-normal text-slate-500">шт</span>
                    </p>
                  </div>
                </div>
              </div>
            )}

          </div>
        </div>

        {/* DESKTOP VARIANT TABLE */}
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
                    {user && <th className="py-3 pr-3 font-semibold">$/м²</th>}
                    {user && <th className="py-3 pr-3 font-semibold">Цена</th>}
                    <th className="py-3 pr-3 font-semibold">Кол-во</th>
                    <th className="py-3 pr-5 font-semibold sr-only">Действие</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {product.variants.map(variant => {
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
                              {pricePerSqm > 0 ? `$${pricePerSqm.toFixed(2)}` : '—'}
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
                                <span className="font-semibold text-slate-900">{variant.size}</span>
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
                                    ${pricePerSqm.toFixed(2)}
                                  </span>
                                  {variant.is_on_sale && variant.old_price_per_sqm && (
                                    <span className="text-xs text-gray-400 line-through">
                                      ${variant.old_price_per_sqm.toFixed(2)}
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
                              <button onClick={() => decQty(key)} className="flex h-8 w-8 items-center justify-center rounded-l-md border border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100 transition-colors">
                                <Minus className="h-3.5 w-3.5" />
                              </button>
                              <input type="number" min={0} max={wh.stock} value={qty} onChange={e => setQty(key, parseInt(e.target.value, 10) || 0)} className="h-8 w-12 border-y border-slate-200 bg-white text-center text-sm text-slate-900 outline-none focus:border-brand-400 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                              <button onClick={() => incQty(key)} className="flex h-8 w-8 items-center justify-center rounded-r-md border border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100 transition-colors">
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

        {/* DESKTOP SPECIFICATIONS */}
        <div className="hidden lg:block mb-10 border-t border-slate-200 pt-8">
          <h2 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
            <ListChecks className="h-5 w-5 text-slate-400" />
            Характеристики
          </h2>
          <div className="grid grid-cols-2 gap-x-10 gap-y-3 rounded-xl border border-slate-200 bg-slate-50/50 p-5">
            {specs.map(spec => (
              <div key={spec.label} className="flex items-baseline justify-between gap-3 border-b border-dashed border-slate-200 pb-2">
                <span className="text-xs text-slate-400">{spec.label}</span>
                <span className="text-sm font-medium text-slate-700 text-right">{spec.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* MOBILE LAYOUT */}
        <div className="lg:hidden">
          <div
            className="relative aspect-[4/3] rounded-xl overflow-hidden bg-slate-100 select-none mb-4"
            onTouchStart={imageCount > 1 ? handleTouchStart : undefined}
            onTouchMove={imageCount > 1 ? handleTouchMove : undefined}
            onTouchEnd={imageCount > 1 ? handleTouchEnd : undefined}
          >
            {imageCount > 0 && validImages[selectedImage] && !imageError ? (
              <img
                src={validImages[selectedImage]}
                alt={`${product.name} — фото ${selectedImage + 1}`}
                className="h-full w-full object-cover pointer-events-none"
                draggable={false}
                onError={() => setImageError(true)}
              />
            ) : (
              <CarpetPlaceholderIcon className="h-full w-full" />
            )}
            {imageCount > 1 && (
              <>
                <button onClick={prevImage} className="absolute left-2 top-1/2 -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-full bg-white/80 backdrop-blur text-slate-700 shadow hover:bg-white transition-colors">
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <button onClick={nextImage} className="absolute right-2 top-1/2 -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-full bg-white/80 backdrop-blur text-slate-700 shadow hover:bg-white transition-colors">
                  <ChevronRight className="h-5 w-5" />
                </button>
              </>
            )}
          </div>

          {imageCount > 1 && (
            <div className="mb-4 flex justify-center gap-2">
              {validImages.map((_, idx) => (
                <button key={idx} onClick={() => setSelectedImage(idx)} className={`h-2 w-2 rounded-full transition-all ${idx === selectedImage ? 'bg-brand-600 scale-125' : 'bg-slate-300 hover:bg-slate-400'}`} />
              ))}
            </div>
          )}

          <div className="flex items-baseline justify-between mb-2">
            <h1 className="font-display text-xl font-bold text-slate-900 leading-tight">{cleanTitle}</h1>
            {user ? (
              <div className="flex items-baseline gap-1 shrink-0 ml-3">
                <span className="text-xl font-bold text-brand-700">{fmtPrice(mainPricePerSqm)}</span>
                <span className="text-xs text-slate-400">/ м²</span>
              </div>
            ) : (
              <button onClick={() => onNavigate('login')} className="flex items-center gap-1 text-xs text-slate-400 hover:text-brand-600 ml-3 shrink-0">
                <Lock className="h-3 w-3" />
                Цены
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 mb-4">
            <button
              type="button"
              onClick={() => onNavigate('catalog', product.collection)}
              className="text-xs font-bold uppercase tracking-wider text-brand-700 hover:underline"
            >
              {product.collection}
            </button>
          </div>

          {/* МОБИЛЬНЫЙ ВЫБОР ФОРМЫ (КЛИКАБЕЛЬНЫЕ БЛОКИ) */}
          <div className="mb-4 rounded-xl border border-slate-200 bg-white p-3.5 shadow-2xs">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-2">
              Форма: <span className="text-brand-700">{activeShape}</span>
            </p>
            <div className="flex flex-wrap gap-2">
              {availableShapes.map(shape => {
                const isShapeActive = shape === activeShape;
                return (
                  <button
                    key={shape}
                    type="button"
                    onClick={() => {
                      setSelectedShape(shape);
                      const firstOfShape = product.variants.find(v => getVariantShape(v, product.name, product.category || '') === shape);
                      if (firstOfShape) setSelectedSize(firstOfShape.size);
                    }}
                    className={`rounded-lg px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-all ${
                      isShapeActive
                        ? 'bg-slate-900 text-white shadow-sm ring-2 ring-slate-900/20'
                        : 'bg-slate-50 border border-slate-200 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    {shape}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col gap-3 mb-6">
            {hasDealerStock && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3.5 mb-1">
                <p className="text-xs font-bold uppercase tracking-wider text-emerald-900 mb-2 flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                  Ваши персональные остатки
                </p>
                <div className="space-y-1.5 text-xs">
                  <div className="flex items-center justify-between font-semibold text-emerald-800">
                    <span>🏪 В наличии в магазине:</span>
                    <span>{totalShowroomQty} шт ({totalShowroomSqm} м²)</span>
                  </div>
                  {totalInTransitQty > 0 && (
                    <div className="flex items-center justify-between font-medium text-indigo-800">
                      <span>🚚 В пути:</span>
                      <span>{totalInTransitQty} шт ({totalInTransitSqm} м²)</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between text-slate-600">
                    <span>🏢 Основной Склад Астана:</span>
                    <span className="font-medium">{totalHubQty} шт</span>
                  </div>
                </div>
              </div>
            )}

            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Ruler className="h-3.5 w-3.5 text-brand-600" />
                Размеры для формы {activeShape} ({variantsForShape.length})
              </span>
            </h3>

            {variantsForShape.map(variant => {
              const variantPrice = pricing.getVariantPrice(product.collection, variant.size, variant.base_price, variant.price_per_sqm);
              const pricePerSqm = pricing.getPricePerSqm(product.collection, variant.size, variant.base_price, variant.price_per_sqm);
              const rows = filterClientWarehouses(variant.warehouses, myShowroomId, myShowroomName, clientContext, displaySettings);

              return (
                <div key={variant.sku || variant.size} className="card p-4">
                  <div className="flex items-center justify-between mb-1">
                    <div>
                      <span className="text-sm font-bold text-slate-900">{variant.size}</span>
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
                      ${pricePerSqm.toFixed(2)} / м²
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
                                <button onClick={() => decQty(key)} className="flex h-10 w-10 items-center justify-center rounded-l-md border border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100 transition-colors">
                                  <Minus className="h-4 w-4" />
                                </button>
                                <input type="number" min={0} max={wh.stock} value={qty} onChange={e => setQty(key, parseInt(e.target.value, 10) || 0)} className="h-10 w-14 border-y border-slate-200 bg-white text-center text-sm text-slate-900 outline-none focus:border-brand-400 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                                <button onClick={() => incQty(key)} className="flex h-10 w-10 items-center justify-center rounded-r-md border border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100 transition-colors">
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

          <div className="mb-6">
            <div className="flex gap-1 border-b border-slate-200 mb-4">
              <span className="inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px border-brand-600 text-brand-700">
                <ListChecks className="h-4 w-4" />
                Характеристики
              </span>
            </div>
            <div className="grid grid-cols-1 gap-y-3">
              {specs.map(spec => (
                <div key={spec.label} className="flex items-baseline justify-between gap-4 border-b border-dashed border-slate-100 pb-2">
                  <span className="text-xs uppercase tracking-wide text-slate-400">{spec.label}</span>
                  <span className="text-sm font-medium text-slate-700 text-right">{spec.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* LIGHTBOX */}
      {lightboxOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Просмотр изображения ${selectedImage + 1} из ${imageCount}`}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm"
          onClick={() => setLightboxOpen(false)}
        >
          <button
            aria-label="Закрыть"
            autoFocus
            className="absolute top-4 right-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors z-10"
          >
            <X className="h-6 w-6" />
          </button>
          {imageCount > 1 && (
            <>
              <button onClick={e => { e.stopPropagation(); prevImage(); }} aria-label="Предыдущее изображение" className="absolute left-4 top-1/2 -translate-y-1/2 flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors z-10">
                <ChevronLeft className="h-7 w-7" />
              </button>
              <button onClick={e => { e.stopPropagation(); nextImage(); }} aria-label="Следующее изображение" className="absolute right-4 top-1/2 -translate-y-1/2 flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors z-10">
                <ChevronRight className="h-7 w-7" />
              </button>
            </>
          )}
          {imageCount > 0 && validImages[selectedImage] && (
            <img
              src={validImages[selectedImage]}
              alt={`${product.name} — фото ${selectedImage + 1}`}
              className="max-h-[85vh] max-w-[90vw] object-contain rounded-lg shadow-2xl"
              onClick={e => e.stopPropagation()}
            />
          )}
          {imageCount > 1 && (
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex gap-2">
              {validImages.map((_, idx) => (
                <button key={idx} onClick={e => { e.stopPropagation(); setSelectedImage(idx); }} aria-label={`Изображение ${idx + 1}`} aria-current={idx === selectedImage} className={`h-2.5 w-2.5 rounded-full transition-all ${idx === selectedImage ? 'bg-white scale-125' : 'bg-white/40 hover:bg-white/60'}`} />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
