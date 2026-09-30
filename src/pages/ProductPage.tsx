import { useState, useEffect, useCallback, useMemo } from 'react';
import { ChevronRight, ArrowLeft, PackageSearch, Loader2, Lock } from 'lucide-react';
import type { PageId, ProductVariant, Warehouse } from '@/types';
import { parseSizeDimensions } from '@/types';
import { useProduct, filterClientWarehouses } from '@/hooks/useProductData';
import { isWarehouseVisibleForClient, isProductInStockForUser } from '@/lib/warehouseVisibility';
import { useUserPricing } from '@/hooks/usePricing';
import { useDisplaySettings } from '@/hooks/useDisplaySettings';
import { useCart } from '@/contexts/CartContext';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useCurrency } from '@/contexts/CurrencyContext';
import { formatProductTitle } from '@/components/ProductCard';
import {
  ProductGallery,
  ProductVariantSelector,
  ProductWarehouseStockTable,
  ProductSpecs,
  rowKey,
  getVariantShape,
} from '@/components/product';

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
  const { currency, formatPrice: fmtPrice } = useCurrency();
  const pricing = useUserPricing();

  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [addedKeys, setAddedKeys] = useState<Record<string, boolean>>({});
  const [selectedShape, setSelectedShape] = useState<string>('');
  const [selectedSize, setSelectedSize] = useState<string>('');

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
          image: product.images[0] || product.image_thumb || '',
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
          <button onClick={() => onNavigate('catalog')} className="btn-primary inline-flex items-center gap-2 cursor-pointer">
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

  const isOutOfStockForClient = product ? !isProductInStockForUser(product, profile, false, true) : false;
  const cleanTitle = formatProductTitle(product, language);

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
            <button onClick={() => onNavigate('catalog')} className="hover:text-brand-600 transition-colors cursor-pointer">{t('nav.catalog')}</button>
            <ChevronRight className="h-3 w-3 shrink-0" />
            <button onClick={() => onNavigate('catalog', product.collection)} className="hover:text-brand-600 transition-colors font-medium text-slate-600 cursor-pointer">{product.collection}</button>
          </nav>
        </div>

        {/* БАННЕР ОТСУТСТВИЯ ТОВАРА НА СКЛАДАХ */}
        {isOutOfStockForClient && !isEffectiveAdmin && (
          <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50/90 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-amber-900 shadow-2xs">
            <div className="flex items-start sm:items-center gap-3">
              <span className="text-2xl shrink-0">⚠️</span>
              <div>
                <h4 className="text-sm font-bold text-amber-950">Товара временно нет в наличии</h4>
                <p className="text-xs text-amber-800 mt-0.5">
                  Данная модель полностью закончилась на доступных складах. Вы можете подобрать похожие позиции в каталоге или уточнить дату следующей поставки у вашего менеджера.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('catalog')}
              className="btn-primary !bg-amber-800 hover:!bg-amber-900 text-xs py-2 px-4 shrink-0 self-start sm:self-center cursor-pointer"
            >
              Перейти в каталог
            </button>
          </div>
        )}

        {isOutOfStockForClient && isEffectiveAdmin && (
          <div className="mb-6 rounded-xl border border-amber-300 bg-amber-50/80 px-4 py-3 flex items-center justify-between gap-3 text-xs text-amber-900 shadow-2xs">
            <div className="flex items-center gap-2">
              <span className="font-bold">⚠️ Внимание администратора:</span>
              <span>Остаток товара на складах равен 0 шт. Карточка автоматически скрыта от клиентов в каталоге.</span>
            </div>
          </div>
        )}

        {/* DESKTOP LAYOUT (ГАЛЕРЕЯ + ИНФО О ТОВАРЕ) */}
        <div className="hidden lg:grid lg:grid-cols-[460px,1fr] xl:grid-cols-[500px,1fr] 2xl:grid-cols-[540px,1fr] gap-10 xl:gap-14 mb-10 items-start">
          <ProductGallery
            images={product.images || []}
            productName={product.name}
            cleanTitle={cleanTitle}
          />

          {/* Правая колонка с информацией о товаре */}
          <div className="flex flex-col">
            <h1 className="font-display text-2xl xl:text-3xl font-extrabold text-slate-900 leading-tight mb-1">
              {cleanTitle}
            </h1>

            <button
              type="button"
              onClick={() => onNavigate('catalog', product.collection)}
              className="text-xs font-bold uppercase tracking-wider text-brand-700 hover:text-brand-900 hover:underline transition-colors w-fit mb-5 cursor-pointer"
            >
              {product.collection}
            </button>

            <ProductVariantSelector
              product={product}
              variantsForShape={variantsForShape}
              availableShapes={availableShapes}
              activeShape={activeShape}
              selectedSize={selectedSize}
              activeVariant={activeVariant}
              mainPricePerSqm={mainPricePerSqm}
              onSelectShape={setSelectedShape}
              onSelectSize={setSelectedSize}
              onNavigate={onNavigate}
              user={user}
              profile={profile}
              pricing={pricing}
              fmtPrice={fmtPrice}
              language={language}
              t={t}
              myShowroomId={myShowroomId ?? undefined}
              myShowroomName={myShowroomName}
              clientContext={clientContext}
              displaySettings={displaySettings}
            />

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
        <ProductWarehouseStockTable
          product={product}
          variants={product.variants}
          quantities={quantities}
          addedKeys={addedKeys}
          cartCountByKey={cartCountByKey}
          onSetQty={setQty}
          onIncQty={incQty}
          onDecQty={decQty}
          onAddToCart={handleAdd}
          user={user}
          currency={currency}
          fmtPrice={fmtPrice}
          pricing={pricing}
          myShowroomId={myShowroomId ?? undefined}
          myShowroomName={myShowroomName}
          clientContext={clientContext}
          displaySettings={displaySettings}
          isHubVisible={isHubVisible}
          isShowroomVisible={isShowroomVisible}
          hasDealerStock={hasDealerStock}
          t={t}
          isMobile={false}
        />

        {/* DESKTOP SPECIFICATIONS */}
        <ProductSpecs specs={specs} isMobile={false} />

        {/* MOBILE LAYOUT */}
        <div className="lg:hidden">
          <ProductGallery
            images={product.images || []}
            productName={product.name}
            cleanTitle={cleanTitle}
          />

          <div className="flex items-baseline justify-between mb-2">
            <h1 className="font-display text-xl font-bold text-slate-900 leading-tight">{cleanTitle}</h1>
            {user ? (
              <div className="flex items-baseline gap-1 shrink-0 ml-3">
                <span className="text-xl font-bold text-brand-700">{fmtPrice(mainPricePerSqm)}</span>
                <span className="text-xs text-slate-400">/ м²</span>
              </div>
            ) : (
              <button onClick={() => onNavigate('login')} className="flex items-center gap-1 text-xs text-slate-400 hover:text-brand-600 ml-3 shrink-0 cursor-pointer">
                <Lock className="h-3 w-3" />
                Цены
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 mb-4">
            <button
              type="button"
              onClick={() => onNavigate('catalog', product.collection)}
              className="text-xs font-bold uppercase tracking-wider text-brand-700 hover:underline cursor-pointer"
            >
              {product.collection}
            </button>
          </div>

          <ProductVariantSelector
            product={product}
            variantsForShape={variantsForShape}
            availableShapes={availableShapes}
            activeShape={activeShape}
            selectedSize={selectedSize}
            activeVariant={activeVariant}
            mainPricePerSqm={mainPricePerSqm}
            onSelectShape={setSelectedShape}
            onSelectSize={setSelectedSize}
            onNavigate={onNavigate}
            user={user}
            profile={profile}
            pricing={pricing}
            fmtPrice={fmtPrice}
            language={language}
            t={t}
            myShowroomId={myShowroomId ?? undefined}
            myShowroomName={myShowroomName}
            clientContext={clientContext}
            displaySettings={displaySettings}
            isMobile={true}
          />

          {hasDealerStock && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3.5 mb-4">
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

          {/* MOBILE VARIANT CARDS */}
          <ProductWarehouseStockTable
            product={product}
            variants={variantsForShape}
            quantities={quantities}
            addedKeys={addedKeys}
            cartCountByKey={cartCountByKey}
            onSetQty={setQty}
            onIncQty={incQty}
            onDecQty={decQty}
            onAddToCart={handleAdd}
            user={user}
            currency={currency}
            fmtPrice={fmtPrice}
            pricing={pricing}
            myShowroomId={myShowroomId ?? undefined}
            myShowroomName={myShowroomName}
            clientContext={clientContext}
            displaySettings={displaySettings}
            isHubVisible={isHubVisible}
            isShowroomVisible={isShowroomVisible}
            hasDealerStock={hasDealerStock}
            t={t}
            isMobile={true}
          />

          {/* MOBILE SPECIFICATIONS */}
          <ProductSpecs specs={specs} isMobile={true} />
        </div>
      </div>
    </section>
  );
}
