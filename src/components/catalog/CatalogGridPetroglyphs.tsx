import React from 'react';

/**
 * Atmospheric Steppe Petroglyphs positioned around and between product cards,
 * replicating the authentic composition from the design reference (Screen 3)
 * without obscuring or covering the carpet products.
 */
export default function CatalogGridPetroglyphs() {
  return (
    <>
      {/* 1. Golden Sun Tamga (above gutter between Card 1 & Card 2) */}
      <div 
        aria-hidden="true"
        className="hidden xl:block absolute left-[19.1%] top-2 lg:top-3 -translate-x-1/2 z-10 pointer-events-none opacity-85"
        title="Солярная тамга"
      >
        <img
          src="/petroglyph-sun.png"
          alt=""
          className="w-14 h-14 lg:w-16 lg:h-16 object-contain drop-shadow-xs"
          loading="lazy"
        />
      </div>

      {/* 2. Tamgaly Sun-Headed Shaman Deity (standing vertically between Card 2 & Card 3) */}
      <div 
        aria-hidden="true"
        className="hidden xl:block absolute left-[39.7%] top-4 lg:top-5 -translate-x-1/2 z-10 pointer-events-none opacity-90"
        title="Солнцеголовое божество Тамгалы"
      >
        <img
          src="/petroglyph-shaman.png"
          alt=""
          className="w-16 lg:w-20 h-auto object-contain drop-shadow-xs"
          loading="lazy"
        />
      </div>

      {/* 3. Golden Sun Tamga (above gutter between Card 3 & Card 4) */}
      <div 
        aria-hidden="true"
        className="hidden xl:block absolute left-[60.4%] -top-4 lg:-top-5 -translate-x-1/2 z-10 pointer-events-none opacity-85"
        title="Солярная тамга"
      >
        <img
          src="/petroglyph-sun.png"
          alt=""
          className="w-14 h-14 lg:w-16 lg:h-16 object-contain drop-shadow-xs"
          loading="lazy"
        />
      </div>
    </>
  );
}
