import { useMemo, useRef } from 'react';
import { ArrowRight } from 'lucide-react';
import type { PageId } from '@/types';
import { categories } from '@/data/categories';
import { useProducts } from '@/hooks/useProductData';
import { useAuth } from '@/contexts/AuthContext';
import { useDisplaySettings } from '@/hooks/useDisplaySettings';
import { isProductInStockForUser } from '@/lib/warehouseVisibility';
import ProductCard from '@/components/ProductCard';
import HeroBannerMedia from '@/components/home/HeroBannerMedia';
import TechnoLuxuryButton from '@/components/home/TechnoLuxuryButton';
import B2BPartnerCtaSection from '@/components/home/B2BPartnerCtaSection';
import TiltCard from '@/components/home/TiltCard';
import AtmosphericFogTransition from '@/components/home/AtmosphericFogTransition';
import { useSynchronizedCategoryVideos } from '@/hooks/useSynchronizedCategoryVideos';

const advantages = [
  {
    image: '/images/advantages/advantage_loom.webp',
    title: 'Прямой доступ к станкам',
    description: 'Уникальная возможность работать напрямую с производственными мощностями ведущих фабрик.',
  },
  {
    image: '/images/advantages/advantage_rolls.webp',
    title: 'Автоматизация остатков',
    description: 'Точное управление и минимизация тканевых отходов при нарезке и комплектации заказов.',
  },
  {
    image: '/images/advantages/advantage_compass.webp',
    title: 'Персональная логистика',
    description: 'Индивидуальные маршруты и гарантированные сроки доставки по всему Казахстану и СНГ.',
  },
  {
    image: '/images/advantages/advantage_paisley.webp',
    title: 'Эксклюзивные коллекции',
    description: 'Доступ к лимитированным дизайнам ковровых коллекций и уникальным премиальным текстурам.',
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

  const {
    sectionRef: categoriesSectionRef,
    registerVideoRef,
  } = useSynchronizedCategoryVideos();

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
      <section className="relative w-full bg-[#0a0a0c] pt-0">
        <HeroBannerMedia onNavigate={onNavigate} isReady={isReady} />
        {/* Mobile Action Bar: Variant 4 (Editorial Minimal Outline Pill) - Compact, zero blue bloat */}
        <div className="block sm:hidden px-6 pt-2 pb-6 max-w-xs mx-auto select-none relative z-20">
          <button
            type="button"
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onClick={handleCatalogNavigate}
            className="w-full flex items-center justify-center gap-2 h-11 px-5 rounded-full border border-white/40 bg-white/[0.04] backdrop-blur-xs text-white text-xs font-semibold uppercase tracking-[0.16em] transition-all duration-200 active:scale-[0.98] hover:bg-white/[0.08] hover:border-white/60 cursor-pointer shadow-sm shadow-black/60"
            aria-label="Перейти в каталог ковров"
          >
            <span>Перейти в каталог</span>
            <ArrowRight className="h-3.5 w-3.5 text-white/80" />
          </button>
        </div>
      </section>

      {/* ── 1. Advantages Section (Clean White) ── */}
      <section className="relative py-16 lg:py-24 bg-white">
        {/* ── Top Organic Wave: Seamlessly drapes UP over the bottom of Hero Banner ── */}
        <div className="absolute -top-[30px] sm:-top-[46px] lg:-top-[62px] inset-x-0 pointer-events-none select-none z-20">
          <svg
            className="w-full h-8 sm:h-12 lg:h-16 block overflow-visible"
            viewBox="0 0 1440 96"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <path
              d="M 0,50 C 290,15 490,95 720,55 C 950,15 1150,95 1440,50 L 1440,98 L 0,98 Z"
              fill="#ffffff"
            />
          </svg>
        </div>

        {/* ── Bottom Organic Wave: Seamlessly drapes DOWN over the top of Categories Section ── */}
        <div className="absolute -bottom-[30px] sm:-bottom-[46px] lg:-bottom-[62px] inset-x-0 pointer-events-none select-none z-20">
          <svg
            className="w-full h-8 sm:h-12 lg:h-16 block overflow-visible"
            viewBox="0 0 1440 96"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <path
              d="M 0,-2 L 1440,-2 L 1440,50 C 1150,95 950,15 720,55 C 490,95 290,15 0,50 Z"
              fill="#ffffff"
            />
          </svg>
        </div>

        <div className="container-w relative z-10">
          <div className="text-center max-w-3xl mx-auto mb-12 lg:mb-16">
            <span className="font-mono text-xs sm:text-sm text-brand-700 font-semibold uppercase tracking-[0.25em] block mb-2">
              SYNERGIYA GROUP
            </span>
            <h2 className="font-display text-2xl sm:text-4xl lg:text-5xl font-light tracking-wide text-slate-900 uppercase">
              Ваши преимущества
            </h2>
            <p className="mt-3 text-sm sm:text-base text-slate-600 font-body max-w-xl mx-auto">
              Прямые оптовые поставки ковровых покрытий от ведущих мировых фабрик с собственными распределительными центрами
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 lg:gap-6">
            {advantages.map((item) => (
              <div
                key={item.title}
                className="card flex flex-col justify-between p-6 sm:p-7 text-left bg-white border border-slate-200/90 hover:border-brand-600/70 shadow-xs hover:shadow-xl hover:-translate-y-1 transition-all duration-300 relative group rounded-2xl cursor-default"
              >
                <div>
                  {/* Clean Transparent Ink Illustration */}
                  <div className="h-32 sm:h-36 flex items-center justify-center mb-6 overflow-hidden">
                    <img
                      src={item.image}
                      alt={item.title}
                      loading="lazy"
                      decoding="async"
                      className="max-h-full max-w-full object-contain filter drop-shadow-xs group-hover:scale-105 transition-transform duration-500"
                    />
                  </div>
                  <h3 className="font-display text-sm sm:text-base font-bold text-slate-900 uppercase tracking-wide leading-snug group-hover:text-brand-800 transition-colors">
                    {item.title}
                  </h3>
                  <p className="mt-2.5 text-xs sm:text-sm text-slate-600 font-body leading-relaxed">
                    {item.description}
                  </p>
                </div>

                {/* Minimalist corner arrow strictly matching reference design */}
                <div className="mt-5 pt-3 flex justify-end items-center border-t border-slate-100 group-hover:border-slate-200/80 transition-colors">
                  <ArrowRight className="h-4 w-4 text-slate-400 group-hover:text-brand-700 group-hover:translate-x-1 transition-all duration-300" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 2. Categories Section (Dark Slate Stone Texture with Seamless Organic Waves) ── */}
      <section
        ref={categoriesSectionRef}
        className="relative py-20 lg:py-28 text-white bg-cover bg-center bg-no-repeat"
        style={{
          backgroundImage: `linear-gradient(to bottom, rgba(15,23,42,0.35), rgba(15,23,42,0.15), rgba(15,23,42,0.45)), url('/images/dark_slate_texture.webp')`
        }}
      >
        <div className="container-w">
          <div className="text-center">
            <h2 className="font-display text-2xl sm:text-3xl lg:text-4xl font-bold text-white tracking-tight drop-shadow-md">
              Категории ковров
            </h2>
          </div>

          <div className="mt-8 lg:mt-12 grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-6">
            {categories.map((category, idx) => {
              const isFirst = idx === 0;
              const mediaScale = isFirst
                ? 'scale-110 sm:scale-115 md:scale-110 lg:scale-115 group-hover:scale-[1.22]'
                : 'scale-[1.32] sm:scale-[1.35] md:scale-110 lg:scale-115 group-hover:scale-[1.22]';
              return (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => onNavigate('catalog', category.id)}
                  className={`group flex flex-col items-center rounded-2xl cursor-pointer transition-all duration-300 text-center bg-transparent border border-slate-500/35 hover:border-slate-300/70 shadow-lg shadow-black/20 hover:shadow-slate-400/10 ${
                    isFirst ? 'col-span-2 md:col-span-1 p-3 md:p-4' : 'col-span-1 p-2 sm:p-3 md:p-4'
                  }`}
                >
                  {/* Clean Frameless Symbol - Sits directly on stone background with zero box fill */}
                  <div className={`aspect-square flex items-center justify-center overflow-visible ${
                    isFirst ? 'w-[230px] sm:w-[270px] md:w-full' : 'w-full'
                  }`}>
                    {category.video ? (
                      <video
                        ref={registerVideoRef(idx)}
                        autoPlay
                        muted
                        playsInline
                        {...({ 'webkit-playsinline': 'true' } as any)}
                        disablePictureInPicture
                        disableRemotePlayback
                        preload="auto"
                        poster={category.poster || category.image}
                        style={{ willChange: 'transform' }}
                        className={`h-full w-full object-contain mix-blend-screen transition-transform duration-500 ${mediaScale}`}
                      >
                        <source src={category.video} type="video/mp4" />
                      </video>
                    ) : (
                      <img
                        src={category.image}
                        alt={category.name}
                        loading="lazy"
                        className={`h-full w-full object-contain mix-blend-screen transition-transform duration-500 ${mediaScale}`}
                      />
                    )}
                  </div>

                  {/* Centered Text: Pure country name */}
                  <div className="mt-2.5 md:mt-3 flex flex-col items-center">
                    <h3 className="font-display text-base md:text-xl font-bold text-white group-hover:text-slate-200 transition-colors tracking-wide">
                      {category.name}
                    </h3>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── 3. Featured Products Section (Clean Slate-50) ── */}
      <section className="relative py-16 lg:py-24 bg-slate-50 [content-visibility:auto] [contain-intrinsic-size:1px_800px]">
        {/* ── Top Organic Wave: Seamlessly drapes UP over the bottom of Categories Section ── */}
        <div className="absolute -top-[30px] sm:-top-[46px] lg:-top-[62px] inset-x-0 pointer-events-none select-none z-20">
          <svg
            className="w-full h-8 sm:h-12 lg:h-16 block overflow-visible"
            viewBox="0 0 1440 96"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <path
              d="M 0,50 C 290,15 490,95 720,55 C 950,15 1150,95 1440,50 L 1440,98 L 0,98 Z"
              fill="#f8fafc"
            />
          </svg>
        </div>

        <div className="container-w relative z-10">
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

          {/* Mobile: Tactile Horizontal Swipe Carousel with peek | Desktop: 4-Column Grid with 3D Tilt */}
          <div className="flex sm:grid sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 overflow-x-auto sm:overflow-visible snap-x snap-mandatory no-scrollbar -mx-4 px-4 sm:mx-0 sm:px-0 pb-4 sm:pb-0">
            {featuredProducts.map((product) => (
              <div
                key={product.id}
                className="w-[78vw] max-w-[290px] shrink-0 snap-start sm:w-auto sm:max-w-none"
              >
                <TiltCard maxTilt={10} glare={true}>
                  <ProductCard
                    product={product}
                    onNavigate={onNavigate}
                  />
                </TiltCard>
              </div>
            ))}
          </div>

          <div className="mt-8 text-center sm:hidden">
            <button
              onClick={() => onNavigate('catalog')}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-7 py-3 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 active:scale-[0.98] transition-all duration-200 border border-slate-800 group"
            >
              Смотреть все
              <ArrowRight className="h-4 w-4 text-amber-400 group-hover:translate-x-0.5 transition-transform" />
            </button>
          </div>
        </div>
      </section>

      {/* ── Atmospheric Scroll: Volumetric Fog / Smoke Transition ── */}
      <AtmosphericFogTransition className="h-28 sm:h-40 -mt-16 sm:-mt-24 relative z-20" />

      {/* ── 4. CTA Banner Section (Concept 2: Pure Macro Glassmorphism + Techno-Luxury Button) ── */}
      <B2BPartnerCtaSection onNavigate={(tab) => onNavigate(tab as PageId)} />
    </div>
  );
}
