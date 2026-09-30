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
    <div className="relative mb-5 pt-1 pb-2 overflow-hidden select-none">
      {/* Right Background Petroglyphs (Ibex, Deer, Hunter, Solar Tamga) strictly in header zone */}
      <div className="absolute right-0 -top-2 w-64 sm:w-80 lg:w-[420px] pointer-events-none opacity-85 z-0">
        <img
          src="/petroglyphs-banner.png"
          alt="Ancient Petroglyphs"
          className="w-full h-auto object-contain"
          loading="lazy"
        />
      </div>

      {/* Center Golden Horse Petroglyph (Golden Steppe Stallion) */}
      <div className="hidden md:flex absolute left-1/2 -translate-x-1/2 top-2 lg:top-1 w-28 lg:w-36 pointer-events-none z-0 justify-center">
        <img
          src="/petroglyph-horse.png"
          alt="Golden Steppe Horse"
          className="w-full h-auto object-contain drop-shadow-[0_2px_10px_rgba(197,155,72,0.35)]"
          loading="lazy"
        />
      </div>

      {/* Left Sun Tamga (Accent near categories) */}
      <div className="hidden sm:block absolute left-48 sm:left-56 lg:left-64 top-10 sm:top-12 w-12 sm:w-14 pointer-events-none opacity-70 z-0">
        <img
          src="/petroglyph-sun.png"
          alt="Solar Wheel Tamga"
          className="w-full h-auto object-contain"
          loading="lazy"
        />
      </div>

      {/* Left Typography Block */}
      <div className="relative z-10 max-w-xl">
        <h1 className="text-2xl sm:text-3xl lg:text-4xl font-serif font-bold text-slate-900 tracking-tight mb-1.5">
          {title}
        </h1>
        <p className="text-xs sm:text-sm text-slate-600 font-medium leading-relaxed max-w-md">
          {subtitle}
        </p>
      </div>

      {/* Category Pills & Secondary Badges container */}
      {children && <div className="relative z-10 mt-4">{children}</div>}
    </div>
  );
}
