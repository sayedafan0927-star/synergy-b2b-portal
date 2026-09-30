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
    <div className="relative mb-6 pt-1 pb-2 overflow-hidden select-none">
      {/* Right Background Petroglyphs (Ibex, Deer, Hunter, Solar Tamgas) safely inset so nothing is clipped */}
      <div className="absolute right-2 sm:right-6 lg:right-10 -top-1 w-64 sm:w-80 lg:w-[400px] pointer-events-none opacity-85 z-0">
        <img
          src="/petroglyphs-banner.png"
          alt="Ancient Petroglyphs"
          className="w-full h-auto object-contain"
          loading="lazy"
        />
      </div>

      {/* Center Golden Horse Petroglyph (Golden Steppe Stallion) */}
      <div className="hidden md:flex absolute left-1/2 -translate-x-1/2 top-1 lg:top-0 w-28 lg:w-36 pointer-events-none z-0 justify-center">
        <img
          src="/petroglyph-horse.png"
          alt="Golden Steppe Horse"
          className="w-full h-auto object-contain drop-shadow-[0_2px_10px_rgba(197,155,72,0.3)]"
          loading="lazy"
        />
      </div>

      {/* Left Typography Block (strictly isolated from any decorative elements) */}
      <div className="relative z-10 max-w-lg mb-4">
        <h1 className="text-2xl sm:text-3xl lg:text-4xl font-serif font-bold text-slate-900 tracking-tight mb-2">
          {title}
        </h1>
        <p className="text-xs sm:text-sm text-slate-600 font-medium leading-relaxed">
          {subtitle}
        </p>
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
