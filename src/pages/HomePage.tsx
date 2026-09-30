import { useMemo, useRef } from 'react';
import { Truck, Shield, Clock, Warehouse, ArrowRight } from 'lucide-react';
import type { PageId } from '@/types';
import { categories } from '@/data/categories';
import { useProducts } from '@/hooks/useProductData';
import { useAuth } from '@/contexts/AuthContext';
import { useDisplaySettings } from '@/hooks/useDisplaySettings';
import { isProductInStockForUser } from '@/lib/warehouseVisibility';
import ProductCard from '@/components/ProductCard';
import HeroBannerMedia from '@/components/home/HeroBannerMedia';
import CarpetSectionDivider from '@/components/home/CarpetSectionDivider';

const advantages = [
  {
    icon: Truck,
    title: 'Оптовые цены',
    description: 'Прямые поставки от производителей без посредников. Гибкая система скидок при крупных заказах.',
  },
  {
    icon: Shield,
    title: 'Гарантия качества',
    description: 'Все товары сертифицированы и проходят контроль качества. Работаем только с проверенными брендами.',
  },
  {
    icon: Clock,
    title: 'Быстрая доставка',
    description: 'Отгрузка в течение 24 часов со склада. Доставка по всему Казахстану и странам СНГ.',
  },
  {
    icon: Warehouse,
    title: 'Складские остатки',
    description: 'Более 1500 наименований всегда в наличии на трёх складах. Актуальные остатки онлайн.',
  },
];

export default function HomePage({ 
  onNavigate, 
  isReady = true 
}: { 
  onNavigate: (page: PageId, productId?: string) => void; 
  isReady?: boolean; 
}) {
  const { products } = useProducts();
  const { profile, isAdmin, isImpersonating } = useAuth();
  const isEffectiveAdmin = isAdmin && !isImpersonating;
  const { settings: displaySettings } = useDisplaySettings();
  const hideOutOfStock = displaySettings.hide_out_of_stock_products !== false;

  const featuredProducts = useMemo(() => {
    const available = products.filter(p => isProductInStockForUser(p, profile, isEffectiveAdmin, hideOutOfStock));
    return available.slice(0, 4);
  }, [products, profile, isEffectiveAdmin, hideOutOfStock]);

  const countryCounts = useMemo(() => {
    const counts: Record<string, number> = { 'Турция': 0, 'Иран': 0, 'Китай': 0 };
    for (const p of products) {
      const c = p.country?.trim() || '';
      if (c.toLowerCase().includes('турц') || c.toLowerCase().includes('turkey')) counts['Турция']++;
      else if (c.toLowerCase().includes('иран') || c.toLowerCase().includes('iran')) counts['Иран']++;
      else if (c.toLowerCase().includes('китай') || c.toLowerCase().includes('china')) counts['Китай']++;
    }
    return counts;
  }, [products]);

  // Touch scroll guard to prevent accidental navigation while swiping
  const touchStartY = useRef<number | null>(null);
  const touchStartX = useRef<number | null>(null);
  const hasMoved = useRef(false);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    hasMoved.current = false;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchStartX.current === null || touchStartY.current === null) return;
    const dx = Math.abs(e.touches[0].clientX - touchStartX.current);
    const dy = Math.abs(e.touches[0].clientY - touchStartY.current);
    if (dx > 8 || dy > 8) {
      hasMoved.current = true;
    }
  };

  const handleCatalogNavigate = (e: React.MouseEvent) => {
    if (hasMoved.current) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    onNavigate('catalog');
  };

  return (
    <div className="pb-16 lg:pb-0">
      {/* ── Hero Video Banner (Pure animation + Harmonious End-State CTA) ── */}
      <section className="relative w-full bg-slate-950 pt-16 sm:pt-20 lg:pt-24">
        <HeroBannerMedia onNavigate={onNavigate} isReady={isReady} />
        {/* Mobile Action Bar: Golden button on dark canvas under video */}
        <div className="block sm:hidden px-4 pb-4 select-none">
          <button
            type="button"
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onClick={handleCatalogNavigate}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 via-amber-400 to-amber-500 text-slate-950 py-3.5 px-4 text-xs font-bold uppercase tracking-wider shadow-lg shadow-amber-500/25 active:scale-[0.98] transition-all cursor-pointer"
          >
            <span>ПЕРЕЙТИ В КАТАЛОГ КОВРОВ</span>
            <ArrowRight className="w-4 h-4 text-slate-950" />
          </button>
        </div>
      </section>

      {/* ── Woven Carpet Kilim Fringe Divider (Dark Hero to Clean White) ── */}
      <CarpetSectionDivider variant="dark-to-linen" />

      {/* ── 1. Advantages Section (Clean White) ── */}
      <section className="py-16 lg:py-24 bg-white">
        <div className="container-w">
          <h2 className="section-heading text-center text-slate-900">Почему выбирают нас</h2>
          <p className="section-subheading text-center mx-auto text-slate-600">
            Synergy Group — надёжный оптовый поставщик ковровых покрытий с собственными складами
          </p>

          <div className="mt-10 lg:mt-14 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {advantages.map((item) => (
              <div
                key={item.title}
                className="card p-6 text-center sm:text-left bg-white/95 border border-amber-900/10 hover:border-amber-400/50 shadow-xs hover:shadow-xl transition-all duration-300 relative group rounded-2xl"
              >
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-amber-400/10 text-brand-800 border border-amber-400/25 mb-4 group-hover:scale-105 transition-transform">
                  <item.icon className="h-6 w-6 text-brand-700" />
                </div>
                <h3 className="font-display text-base font-semibold text-slate-900">
                  {item.title}
                </h3>
                <p className="mt-2 text-sm text-slate-600 font-body leading-relaxed">
                  {item.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Kilim Border (Warm Linen to Deep Midnight Sapphire) ── */}
      <CarpetSectionDivider variant="linen-to-sapphire" />

      {/* ── 2. Categories Section (Deep Midnight Sapphire #051325) ── */}
      <section className="py-16 lg:py-24 bg-[#051325] text-white">
        <div className="container-w">
          <div className="text-center">
            <span className="font-mono text-xs text-amber-300/80 uppercase tracking-widest block mb-2">
              — Коллекции фабрик
            </span>
            <h2 className="font-display text-2xl sm:text-3xl lg:text-4xl font-bold text-white tracking-tight">
              Категории ковров
            </h2>
            <p className="mt-3 text-sm sm:text-base text-slate-300 font-body max-w-xl mx-auto">
              Подберите идеальное ковровое покрытие по типу и стилю для любого интерьера
            </p>
          </div>

          <div className="mt-8 lg:mt-12 grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-6">
            {categories.map((category, idx) => {
              const isFirst = idx === 0;
              const actualCount = countryCounts[category.name] || category.count || 0;
              return (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => onNavigate('catalog', category.id)}
                  className={`group flex flex-col items-center rounded-2xl cursor-pointer transition-all duration-300 text-center ${
                    isFirst
                      ? 'col-span-2 md:col-span-1 bg-white/[0.03] border border-amber-500/30 hover:border-amber-400/60 p-3 md:p-4 shadow-xl'
                      : 'col-span-1 bg-white/[0.02] border border-white/10 hover:border-amber-400/50 p-2.5 md:p-4 shadow-md'
                  }`}
                >
                  {/* Video Frame Box - 100% full square frame visible, zero text overlay */}
                  <div className={`aspect-square rounded-xl overflow-hidden bg-black/40 border border-white/5 ${
                    isFirst ? 'w-[180px] sm:w-[220px] md:w-full' : 'w-full'
                  }`}>
                    {category.video ? (
                      <video
                        autoPlay
                        loop
                        muted
                        playsInline
                        preload="metadata"
                        poster={category.poster || category.image}
                        className="h-full w-full object-contain transition-transform duration-500 group-hover:scale-105"
                      >
                        <source src={category.video} type="video/mp4" />
                      </video>
                    ) : (
                      <img
                        src={category.image}
                        alt={category.name}
                        loading="lazy"
                        className="h-full w-full object-contain transition-transform duration-500 group-hover:scale-105"
                      />
                    )}
                  </div>

                  {/* Centered Text strictly UNDER the animation */}
                  <div className="mt-2.5 md:mt-3 flex flex-col items-center">
                    <span className="font-mono text-[9px] md:text-[10px] text-amber-300/80 uppercase tracking-widest block mb-0.5">
                      {isFirst ? 'Прямые поставки • Хит продаж' : 'Прямые поставки'}
                    </span>
                    <h3 className="font-display text-base md:text-xl font-bold text-white group-hover:text-amber-300 transition-colors">
                      {isFirst ? 'Ковры Турции' : category.name}
                    </h3>
                    <span className="inline-block mt-1 md:mt-2 font-mono text-[9px] md:text-[11px] font-semibold text-amber-300 bg-amber-500/15 border border-amber-500/30 px-2.5 py-0.5 md:py-1 rounded-full">
                      {actualCount > 0 ? (isFirst ? `${actualCount} товаров в наличии` : `${actualCount} товаров`) : 'В наличии'}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Kilim Border (Deep Midnight Sapphire to Warm Linen Canvas) ── */}
      <CarpetSectionDivider variant="sapphire-to-light" />

      {/* ── 3. Featured Products Section (Clean Slate-50) ── */}
      <section className="py-16 lg:py-24 bg-slate-50">
        <div className="container-w">
          <div className="flex items-end justify-between mb-10 lg:mb-14">
            <div>
              <span className="font-mono text-xs text-brand-700/80 uppercase tracking-widest block mb-1">
                — Выбор оптовых клиентов
              </span>
              <h2 className="section-heading text-slate-900">Популярные товары</h2>
              <p className="section-subheading text-slate-600">
                Самые востребованные ковры из нашего каталога
              </p>
            </div>
            <button
              onClick={() => onNavigate('catalog')}
              className="hidden sm:inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 hover:text-brand-900 transition-colors"
            >
              Смотреть все
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
            {featuredProducts.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                onNavigate={onNavigate}
              />
            ))}
          </div>

          <div className="mt-8 text-center sm:hidden">
            <button
              onClick={() => onNavigate('catalog')}
              className="btn-primary inline-flex items-center gap-2"
            >
              Смотреть все
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </section>

      {/* ── Carpet Weave Line before CTA ── */}
      <CarpetSectionDivider variant="light-to-accent" />

      {/* ── 4. CTA Banner Section (Royal Sapphire #003365 + Gold) ── */}
      <section className="py-16 lg:py-24 bg-white">
        <div className="container-w">
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-[#003365] via-[#072142] to-[#041224] px-6 py-12 sm:px-12 sm:py-16 lg:px-16 lg:py-20 text-center border border-amber-400/30 shadow-2xl">
            {/* Top golden hairline */}
            <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-amber-400/60 to-transparent" />

            {/* Decorative shapes */}
            <div className="absolute top-0 right-0 -translate-y-1/3 translate-x-1/3 h-64 w-64 rounded-full bg-amber-400/5 blur-xl" />
            <div className="absolute bottom-0 left-0 translate-y-1/3 -translate-x-1/3 h-48 w-48 rounded-full bg-brand-500/10 blur-xl" />

            <div className="relative max-w-2xl mx-auto">
              <span className="font-mono text-xs text-amber-300 uppercase tracking-widest block mb-3">
                ✦ B2B Сотрудничество ✦
              </span>
              <h2 className="font-display text-2xl sm:text-3xl lg:text-4xl font-bold text-white leading-tight">
                Станьте нашим партнёром
              </h2>
              <p className="mt-4 text-base sm:text-lg text-slate-200 font-body leading-relaxed font-light">
                Специальные условия для оптовых покупателей: прямые цены фабрик, персональный менеджер,
                приоритетная отгрузка за 24 часа и резервирование складских остатков.
              </p>
              <button
                onClick={() => onNavigate('contacts')}
                className="mt-8 inline-flex items-center gap-2 text-xs uppercase tracking-widest font-bold px-7 py-4 rounded-xl bg-gradient-to-r from-amber-500 via-amber-400 to-amber-500 text-slate-950 shadow-lg shadow-amber-400/30 hover:shadow-amber-400/50 hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer"
              >
                Оставить заявку на сотрудничество
                <ArrowRight className="h-4 w-4 text-slate-950" />
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
