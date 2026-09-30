import type { ReactNode } from 'react';

interface CatalogPetroglyphHeroProps {
  title?: string;
  children?: ReactNode;
}

export default function CatalogPetroglyphHero({
  title = 'Каталог продукции',
  children,
}: CatalogPetroglyphHeroProps) {
  return (
    <div className="relative mb-5 sm:mb-6 pt-2 pb-2 sm:pt-6 sm:pb-6 select-none">
      {/* Desktop Center Golden Horse Petroglyph (Golden Steppe Stallion with generous headroom & breathing space) */}
      <div className="hidden md:flex absolute left-1/2 -translate-x-1/2 top-3 lg:top-4 w-28 lg:w-36 pointer-events-none z-0 justify-center">
        <img
          src="/petroglyph-horse.png"
          alt="Golden Steppe Horse"
          className="w-full h-auto object-contain drop-shadow-[0_2px_10px_rgba(197,155,72,0.3)]"
          loading="lazy"
        />
      </div>

      {/* Desktop Right Background Petroglyphs (Solar Tamgas, Ibex, Steppe Deer, Hunter) safely spaced with full visibility */}
      <div className="hidden sm:block absolute right-2 sm:right-6 lg:right-10 top-2 lg:top-3 w-64 sm:w-80 lg:w-[400px] pointer-events-none opacity-85 z-0">
        <img
          src="/petroglyphs-banner.png"
          alt="Ancient Petroglyphs"
          className="w-full h-auto object-contain"
          loading="lazy"
        />
      </div>

      {/* Top Header Row: Title on left, and on mobile the art floats naturally on linen canvas (no box, no overlap) */}
      <div className="flex items-center justify-between sm:block relative mb-3 sm:mb-4">
        <h1 className="text-xl sm:text-3xl lg:text-4xl font-serif font-bold text-slate-900 tracking-tight shrink-0">
          {title}
        </h1>

        {/* Mobile-only organic art: Golden Horse & Petroglyph Banner floating freely on linen canvas (matching desktop aesthetics) */}
        <div className="sm:hidden flex items-center gap-2 pointer-events-none opacity-85 shrink-0 pl-2">
          <img
            src="/petroglyph-horse.png"
            alt="Golden Steppe Horse"
            className="h-8 w-auto object-contain drop-shadow-[0_2px_6px_rgba(197,155,72,0.25)]"
            loading="lazy"
          />
          <img
            src="/petroglyphs-banner.png"
            alt="Ancient Petroglyphs"
            className="h-8 w-auto object-contain max-w-[130px]"
            loading="lazy"
          />
        </div>
      </div>

      {/* Category Pills & Sun Tamga in natural flex flow (100% zero overlap) */}
      {children && (
        <div className="relative z-10 flex flex-wrap items-center gap-3 sm:gap-4 mt-2 sm:mt-4">
          <div className="flex-1 min-w-0">
            {children}
          </div>
          {/* Sun Tamga placed safely alongside the categories, never touching text */}
          <div className="flex items-center shrink-0 opacity-70 pointer-events-none">
            <img
              src="/petroglyph-sun.png"
              alt="Solar Wheel Tamga"
              className="h-8 sm:h-11 w-auto object-contain"
              loading="lazy"
            />
          </div>
        </div>
      )}
    </div>
  );
}
