import React, { useRef, useEffect, useCallback } from 'react';
import type { Product } from '@/types';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import ProductImage from '@/components/ProductImage';

interface ProductCardCarouselProps {
  product: Product;
  allImages: string[];
  activeImage: string;
  currentImgIndex: number;
  onIndexChange: (idx: number) => void;
  onOpenProduct: () => void;
  hasShowroom: boolean;
  totalShowroomQty: number;
  isEffectiveAdmin: boolean;
  isOutOfStock: boolean;
  isShowroomMode: boolean;
}

export function ProductCardCarousel({
  product,
  allImages,
  activeImage,
  currentImgIndex,
  onIndexChange,
  onOpenProduct,
  hasShowroom,
  totalShowroomQty,
  isEffectiveAdmin,
  isOutOfStock,
  isShowroomMode,
}: ProductCardCarouselProps) {
  const carouselRef = useRef<HTMLDivElement | null>(null);
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);
  const isSwiping = useRef(false);
  const preventClickUntilRef = useRef<number>(0);

  useEffect(() => {
    onIndexChange(0);
    if (carouselRef.current) {
      carouselRef.current.scrollLeft = 0;
    }
  }, [product.id, onIndexChange]);

  const scrollToIndex = useCallback((nextIdx: number) => {
    preventClickUntilRef.current = Date.now() + 600;
    onIndexChange(nextIdx);
    if (carouselRef.current) {
      carouselRef.current.scrollTo({
        left: nextIdx * carouselRef.current.clientWidth,
        behavior: 'smooth',
      });
    }
  }, [onIndexChange]);

  const handlePrevImage = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    preventClickUntilRef.current = Date.now() + 600;
    const nextIdx = currentImgIndex === 0 ? allImages.length - 1 : currentImgIndex - 1;
    scrollToIndex(nextIdx);
  }, [currentImgIndex, allImages.length, scrollToIndex]);

  const handleNextImage = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    preventClickUntilRef.current = Date.now() + 600;
    const nextIdx = currentImgIndex === allImages.length - 1 ? 0 : currentImgIndex + 1;
    scrollToIndex(nextIdx);
  }, [currentImgIndex, allImages.length, scrollToIndex]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    isSwiping.current = false;
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (touchStartX.current === null || touchStartY.current === null) return;
    const dx = Math.abs(e.touches[0].clientX - touchStartX.current);
    const dy = Math.abs(e.touches[0].clientY - touchStartY.current);
    if (dx > 6 || dy > 6) {
      isSwiping.current = true;
      preventClickUntilRef.current = Date.now() + 600;
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (isSwiping.current) {
      preventClickUntilRef.current = Date.now() + 600;
      setTimeout(() => {
        isSwiping.current = false;
      }, 300);
    }
    touchStartX.current = null;
    touchStartY.current = null;
  }, []);

  const handleCarouselScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    preventClickUntilRef.current = Date.now() + 600;
    const el = e.currentTarget;
    if (!el || el.clientWidth === 0) return;
    const idx = Math.round(el.scrollLeft / el.clientWidth);
    if (idx >= 0 && idx < allImages.length && idx !== currentImgIndex) {
      onIndexChange(idx);
    }
  }, [allImages.length, currentImgIndex, onIndexChange]);

  const handleImageAreaClick = useCallback((e: React.MouseEvent) => {
    if (isSwiping.current || Date.now() < preventClickUntilRef.current) {
      e.stopPropagation();
      e.preventDefault();
      return;
    }
    onOpenProduct();
  }, [onOpenProduct]);

  return (
    <div 
      onClick={handleImageAreaClick}
      className="relative aspect-[4/5] sm:aspect-[3/4] overflow-hidden rounded-t-xl bg-slate-50 flex items-center justify-center cursor-pointer select-none"
    >
      {allImages.length > 1 ? (
        <div
          ref={carouselRef}
          onScroll={handleCarouselScroll}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          className="w-full h-full flex overflow-x-auto snap-x snap-mandatory scroll-smooth no-scrollbar"
          style={{ WebkitOverflowScrolling: 'touch', touchAction: 'pan-y' }}
        >
          {allImages.map((img, idx) => (
            <div
              key={idx}
              className="w-full h-full shrink-0 snap-center flex items-center justify-center p-2 sm:p-2.5"
            >
              <ProductImage
                src={img}
                alt={`${product.name} — фото ${idx + 1}`}
                loading={idx === 0 ? 'lazy' : 'lazy'}
                decoding="async"
                width={600}
                fit="contain"
                className="h-full w-full bg-transparent flex items-center justify-center pointer-events-none"
                imageClassName="transition-transform duration-500 ease-apple group-hover:scale-105"
              />
            </div>
          ))}
        </div>
      ) : (
        <div className="w-full h-full flex items-center justify-center p-2 sm:p-2.5">
          <ProductImage
            src={activeImage}
            alt={product.name}
            loading="lazy"
            decoding="async"
            width={600}
            fit="contain"
            className="h-full w-full bg-transparent flex items-center justify-center pointer-events-none"
            imageClassName="transition-transform duration-500 ease-apple group-hover:scale-105"
          />
        </div>
      )}

      {/* Бейдж наличия */}
      {hasShowroom && totalShowroomQty > 0 && (
        <div className="absolute top-2.5 left-2.5 z-10 pointer-events-none">
          <span className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-0.5 text-[11px] font-bold text-white shadow-sm">
            🏪 В наличии: {totalShowroomQty} шт
          </span>
        </div>
      )}

      {/* Бейдж для админа: если у товара 0 остаток и он скрыт от клиентов */}
      {isEffectiveAdmin && isOutOfStock && !isShowroomMode && (
        <div className="absolute top-2.5 right-2.5 z-10 pointer-events-none">
          <span className="inline-flex items-center gap-1 rounded-md bg-amber-600 px-2 py-0.5 text-[10px] font-bold text-white shadow-sm" title="Товар с нулевым остатком скрыт от клиентов">
            ⚠️ 0 шт · Скрыт от клиентов
          </span>
        </div>
      )}

      {/* Кнопки перелистывания фото (десктоп при наведении) */}
      {allImages.length > 1 && (
        <>
          <button
            type="button"
            onClick={handlePrevImage}
            aria-label="Предыдущее фото"
            className="flex absolute left-1 sm:left-2 top-1/2 -translate-y-1/2 z-20 h-7 w-7 sm:h-8 sm:w-8 items-center justify-center rounded-full bg-white/90 sm:bg-white text-slate-700 shadow-md border border-slate-200/80 transition-all hover:bg-slate-50 hover:scale-110 opacity-70 sm:opacity-0 sm:group-hover:opacity-100 cursor-pointer active:scale-95"
          >
            <ChevronLeft className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
          </button>
          <button
            type="button"
            onClick={handleNextImage}
            aria-label="Следующее фото"
            className="flex absolute right-1 sm:right-2 top-1/2 -translate-y-1/2 z-20 h-7 w-7 sm:h-8 sm:w-8 items-center justify-center rounded-full bg-white/90 sm:bg-white text-slate-700 shadow-md border border-slate-200/80 transition-all hover:bg-slate-50 hover:scale-110 opacity-70 sm:opacity-0 sm:group-hover:opacity-100 cursor-pointer active:scale-95"
          >
            <ChevronRight className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
          </button>

          {/* Точки-индикаторы снизу (dots) */}
          <div className="absolute bottom-2 left-0 right-0 z-20 flex items-center justify-center pointer-events-none">
            <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-slate-900/40 backdrop-blur-xs pointer-events-auto">
              {(() => {
                const MAX_DOTS = 8;
                const total = allImages.length;
                const start = total <= MAX_DOTS
                  ? 0
                  : Math.min(Math.max(0, currentImgIndex - Math.floor(MAX_DOTS / 2)), total - MAX_DOTS);
                const end = Math.min(total, start + MAX_DOTS);
                return allImages.slice(start, end).map((_, i) => {
                  const idx = start + i;
                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        scrollToIndex(idx);
                      }}
                      className={`h-1.5 rounded-full transition-all cursor-pointer ${
                        idx === currentImgIndex
                          ? 'w-3.5 bg-white shadow-xs'
                          : 'w-1.5 bg-white/50 hover:bg-white/90'
                      }`}
                      aria-label={`Фото ${idx + 1}`}
                    />
                  );
                });
              })()}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default ProductCardCarousel;
