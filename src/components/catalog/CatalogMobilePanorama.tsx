import React from 'react';
import type { Product, PageId } from '@/types';
import ProductCard from '@/components/ProductCard';
import { Sparkles, MoveHorizontal } from 'lucide-react';

interface CatalogMobilePanoramaProps {
  products: Product[];
  onNavigate: (page: PageId, productId?: string) => void;
}

/**
 * Mobile Panorama Showcase reproducing the Screen 3 composition:
 * 5 signature carpets side-by-side with Golden Sun Tamgas and the
 * Tamgaly Shaman Deity floating seamlessly across the card gutters.
 */
export default function CatalogMobilePanorama({
  products,
  onNavigate,
}: CatalogMobilePanoramaProps) {
  const panoramaProducts = products.slice(0, 5);
  if (panoramaProducts.length < 2) return null;

  return (
    <div className="sm:hidden mb-6 select-none">
      <div className="flex items-center justify-between px-1 mb-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
          <Sparkles className="h-3.5 w-3.5 text-amber-500" />
          <span>Панорама коллекции</span>
        </div>
        <div className="flex items-center gap-1 text-[11px] text-slate-400 font-medium">
          <MoveHorizontal className="h-3 w-3" />
          <span>свайп (5 ковров)</span>
        </div>
      </div>

      <div className="relative overflow-x-auto no-scrollbar scroll-smooth snap-x snap-mandatory flex gap-4 px-1 pb-3 pt-3">
        {panoramaProducts.map((p, idx) => (
          <div key={p.id} className="w-[230px] shrink-0 snap-start relative">
            <ProductCard product={p} onNavigate={onNavigate} />

            {/* 1. Golden Sun Tamga between Card 0 & Card 1 */}
            {idx === 0 && (
              <div
                aria-hidden="true"
                className="absolute -right-5 top-3 z-20 pointer-events-none opacity-90"
              >
                <img
                  src="/petroglyph-sun.png"
                  alt=""
                  className="w-11 h-11 object-contain drop-shadow-xs"
                  loading="lazy"
                />
              </div>
            )}

            {/* 2. Tamgaly Sun-Headed Shaman Deity between Card 1 & Card 2 */}
            {idx === 1 && (
              <div
                aria-hidden="true"
                className="absolute -right-6 top-6 z-20 pointer-events-none opacity-95"
              >
                <img
                  src="/petroglyph-shaman.png"
                  alt=""
                  className="w-13 h-auto object-contain drop-shadow-xs"
                  loading="lazy"
                />
              </div>
            )}

            {/* 3. Golden Sun Tamga between Card 2 & Card 3 */}
            {idx === 2 && (
              <div
                aria-hidden="true"
                className="absolute -right-5 -top-2 z-20 pointer-events-none opacity-90"
              >
                <img
                  src="/petroglyph-sun.png"
                  alt=""
                  className="w-11 h-11 object-contain drop-shadow-xs"
                  loading="lazy"
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
