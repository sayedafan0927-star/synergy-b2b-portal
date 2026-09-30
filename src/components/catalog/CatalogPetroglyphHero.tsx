import type { ReactNode } from 'react';

interface CatalogPetroglyphHeroProps {
  title?: string;
  subtitle?: string;
  children?: ReactNode;
}

export default function CatalogPetroglyphHero({
  title = 'Каталог продукции',
  subtitle = 'Широкий ассортимент ковров и дорожек оптом от ведущих производителей',
  children,
}: CatalogPetroglyphHeroProps) {
  return (
    <div className="relative mb-6 pt-3 pb-3 sm:pt-6 sm:pb-6 select-none">
      {/* Desktop Center Golden Horse Petroglyph (Golden Steppe Stallion with generous headroom & breathing space) */}
      <div className="hidden md:flex absolute left-1/2 -translate-x-1/2 top-4 lg:top-5 w-28 lg:w-36 pointer-events-none z-0 justify-center">
        <img
          src="/petroglyph-horse.png"
          alt="Golden Steppe Horse"
          className="w-full h-auto object-contain drop-shadow-[0_2px_10px_rgba(197,155,72,0.3)]"
          loading="lazy"
        />
      </div>

      {/* Desktop Right Background Petroglyphs (Solar Tamgas, Ibex, Steppe Deer, Hunter) safely spaced with full visibility */}
      <div className="hidden sm:block absolute right-2 sm:right-6 lg:right-10 top-3 lg:top-4 w-64 sm:w-80 lg:w-[400px] pointer-events-none opacity-85 z-0">
        <img
          src="/petroglyphs-banner.png"
          alt="Ancient Petroglyphs"
          className="w-full h-auto object-contain"
          loading="lazy"
        />
      </div>

      {/* Left Typography Block (exact high-end layout from Screenshot 4) */}
      <div className="relative z-10 max-w-lg mb-4">
        <h1 className="text-2xl sm:text-3xl lg:text-4xl font-serif font-bold text-slate-900 tracking-tight mb-2">
          {title}
        </h1>
        {subtitle && (
          <p className="text-xs sm:text-sm text-slate-600 font-medium leading-relaxed">
            {subtitle}
          </p>
        )}
      </div>

      {/* Mobile Dedicated Art Strip: Clean open space ("пустота") where drawings are 100% visible and NEVER covered by pills */}
      <div className="sm:hidden relative w-full my-3 py-2 px-2 flex items-center justify-around pointer-events-none opacity-85 rounded-xl bg-amber-900/[0.03] border border-amber-900/10">
        <img
          src="/petroglyph-horse.png"
          alt="Golden Steppe Horse"
          className="h-10 w-auto object-contain drop-shadow-[0_2px_6px_rgba(197,155,72,0.25)]"
          loading="lazy"
        />
        <img
          src="/petroglyphs-banner.png"
          alt="Ancient Petroglyphs"
          className="h-10 w-auto object-contain max-w-[190px]"
          loading="lazy"
        />
        <img
          src="/petroglyph-sun.png"
          alt="Solar Wheel Tamga"
          className="h-8 w-auto object-contain opacity-75"
          loading="lazy"
        />
      </div>

      {/* Category Pills & Sun Tamga in natural flex flow (100% zero overlap) */}
      {children && (
        <div className="relative z-10 flex flex-wrap items-center gap-4">
          <div className="flex-1 min-w-0">
            {children}
          </div>
          {/* Sun Tamga placed safely alongside the categories, never touching text */}
          <div className="hidden sm:flex items-center shrink-0 opacity-70 pointer-events-none">
            <img
              src="/petroglyph-sun.png"
              alt="Solar Wheel Tamga"
              className="h-10 sm:h-12 w-auto object-contain"
              loading="lazy"
            />
          </div>
        </div>
      )}
    </div>
  );
}
