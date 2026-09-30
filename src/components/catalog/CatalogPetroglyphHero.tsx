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

      {/* Top Header Row: Title on left with thematic subtitle */}
      <div className="relative mb-3 sm:mb-4">
        <h1 className="text-2xl sm:text-3xl lg:text-4xl font-serif font-bold text-slate-900 tracking-tight">
          {title}
        </h1>
        <p className="mt-1 text-xs sm:text-sm text-slate-500 font-sans max-w-xl">
          Широкий ассортимент ковров и дорожек оптом от ведущих производителей
        </p>

        {/* Mobile-only organic art: Golden Horse & Petroglyph Banner floating freely on linen canvas */}
        <div className="sm:hidden flex items-center gap-2 pointer-events-none opacity-85 mt-2">
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

      {/* Category Pills & Dark Sun Tamga in natural flex flow */}
      {children && (
        <div className="relative z-10 flex flex-wrap items-center gap-3 sm:gap-4 mt-3 sm:mt-5">
          <div className="flex items-center gap-2 flex-wrap">
            {children}
          </div>
          {/* Dark Sun Tamga placed directly beside category pills */}
          <div className="flex items-center shrink-0 opacity-80 pointer-events-none ml-1">
            <img
              src="/petroglyph-sun-dark.png"
              alt="Солярная тамга"
              className="h-10 w-10 sm:h-12 sm:w-12 object-contain"
              loading="lazy"
            />
          </div>
        </div>
      )}
    </div>
  );
}
