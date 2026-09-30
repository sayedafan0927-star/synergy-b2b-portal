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

      {/* Mobile Top Header: Sacred Solar Arch (Golden Sun on left ☼, Title in center, Shaman Deity on right 🧝) */}
      <div className="sm:hidden flex items-center justify-between gap-2 px-0.5 mb-3 pt-0.5">
        <div className="shrink-0 flex items-center justify-center w-10 pointer-events-none">
          <img
            src="/petroglyph-sun.png"
            alt="Солярная тамга"
            className="w-9 h-9 object-contain drop-shadow-[0_2px_8px_rgba(202,138,4,0.3)]"
            loading="lazy"
          />
        </div>
        <h1 className="text-xl font-bold font-serif text-slate-900 text-center tracking-tight flex-1">
          {title}
        </h1>
        <div className="shrink-0 flex items-center justify-center w-10 pointer-events-none">
          <img
            src="/petroglyph-shaman.png"
            alt="Божество Тамгалы"
            className="h-10 w-auto object-contain drop-shadow-[0_2px_8px_rgba(100,116,139,0.3)]"
            loading="lazy"
          />
        </div>
      </div>

      {/* Desktop Top Header Row: Title on left */}
      <div className="hidden sm:block relative mb-2 sm:mb-4">
        <h1 className="text-2xl sm:text-3xl lg:text-4xl font-serif font-bold text-slate-900 tracking-tight">
          {title}
        </h1>
      </div>

      {/* Mobile Categories Row: Clean non-breaking horizontal row */}
      {children && (
        <div className="sm:hidden relative z-10 flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1 mb-2">
          {children}
        </div>
      )}

      {/* Desktop Categories Row: Natural flex wrap with dark sun tamga */}
      {children && (
        <div className="hidden sm:flex relative z-10 flex-wrap items-center gap-3 sm:gap-4 mt-2 sm:mt-5">
          <div className="flex items-center gap-2 flex-wrap">
            {children}
          </div>
          {/* Dark Sun Tamga placed directly beside category pills on desktop */}
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
