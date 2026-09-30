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

          <div className="mt-10 lg:mt-14 flex sm:grid sm:grid-cols-3 gap-4 sm:gap-6 overflow-x-auto sm:overflow-visible pb-4 sm:pb-0 snap-x snap-mandatory scroll-smooth no-scrollbar -mx-4 px-4 sm:mx-0 sm:px-0">
            {categories.map((category) => {
              const actualCount = countryCounts[category.name] || category.count || 0;
              return (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => onNavigate('catalog', category.id)}
                  className="group relative min-w-[84vw] sm:min-w-0 snap-center aspect-[4/3] sm:aspect-[4/3] overflow-hidden rounded-2xl border border-white/10 hover:border-amber-400/50 shadow-2xl transition-all duration-300 bg-slate-900 cursor-pointer text-left focus:outline-hidden"
                >
                  {category.video ? (
                    <video
                      autoPlay
                      loop
                      muted
                      playsInline
                      preload="metadata"
                      poster={category.poster || category.image}
                      className="h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-105"
                    >
                      <source src={category.video} type="video/mp4" />
                    </video>
                  ) : (
                    <img
                      src={category.image}
                      alt={category.name}
                      loading="lazy"
                      className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-110"
                    />
                  )}

                  <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-slate-950/20 to-black/20 group-hover:via-slate-950/10 transition-all duration-300 pointer-events-none" />

                  <div className="absolute inset-x-0 bottom-0 p-4 sm:p-5 text-left pointer-events-none">
                    <div className="flex items-end justify-between gap-2">
                      <div>
                        <span className="font-mono text-[10px] text-amber-300/80 uppercase tracking-widest block mb-0.5">
                          Прямые поставки
                        </span>
                        <h3 className="font-display text-lg sm:text-xl font-bold text-white drop-shadow-md">
                          {category.name}
                        </h3>
                      </div>
                      <span className="inline-flex items-center gap-1 font-mono text-[11px] text-amber-200 bg-amber-500/20 border border-amber-400/40 backdrop-blur-md px-2.5 py-1 rounded-full shadow-xs shrink-0">
                        {actualCount > 0 ? `${actualCount} товаров` : 'В наличии'}
                      </span>
                    </div>
                  </div>

                  <div className="absolute top-3.5 right-3.5 w-8 h-8 rounded-full bg-slate-900/60 border border-amber-400/40 backdrop-blur-md flex items-center justify-center transition-all duration-300 group-hover:scale-110 group-hover:bg-amber-400 group-hover:border-amber-400">
                    <ArrowRight className="h-4 w-4 text-amber-300 group-hover:text-slate-950 transition-colors" />
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
