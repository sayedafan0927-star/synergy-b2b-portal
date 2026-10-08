import React, { useRef, useState, useEffect, useCallback } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { Product } from '@/types';
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
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);
  const [dragOffset, setDragOffset] = useState<number>(0);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const isSwiping = useRef(false);
  const preventClickUntilRef = useRef<number>(0);

  useEffect(() => {
    onIndexChange(0);
    setDragOffset(0);
    setIsDragging(false);
  }, [product.id, onIndexChange]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (allImages.length <= 1) return;
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    isSwiping.current = false;
    setIsDragging(true);
    setDragOffset(0);
  }, [allImages.length]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (touchStartX.current === null || touchStartY.current === null || allImages.length <= 1) return;
    const dx = e.touches[0].clientX - touchStartX.current;
    const dy = e.touches[0].clientY - touchStartY.current;

    // Don't interfere with vertical catalog page scroll
    if (Math.abs(dy) > Math.abs(dx) && !isSwiping.current) {
      return;
    }

    if (Math.abs(dx) > 6) {
      isSwiping.current = true;
      preventClickUntilRef.current = Date.now() + 600;
      setDragOffset(dx);
    }
  }, [allImages.length]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (touchStartX.current !== null && allImages.length > 1) {
      const deltaX = e.changedTouches[0].clientX - touchStartX.current;
      const deltaY = touchStartY.current !== null ? Math.abs(e.changedTouches[0].clientY - touchStartY.current) : 0;

      if (Math.abs(deltaX) > 28 && Math.abs(deltaX) > deltaY) {
        preventClickUntilRef.current = Date.now() + 600;
        if (deltaX < 0) {
          const nextIdx = currentImgIndex === allImages.length - 1 ? 0 : currentImgIndex + 1;
          onIndexChange(nextIdx);
        } else {
          const nextIdx = currentImgIndex === 0 ? allImages.length - 1 : currentImgIndex - 1;
          onIndexChange(nextIdx);
        }
      }
    }

    setIsDragging(false);
    setDragOffset(0);
    if (isSwiping.current) {
      preventClickUntilRef.current = Date.now() + 600;
      setTimeout(() => {
        isSwiping.current = false;
      }, 250);
    }
    touchStartX.current = null;
    touchStartY.current = null;
  }, [allImages.length, currentImgIndex, onIndexChange]);

  const handlePrevImage = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    preventClickUntilRef.current = Date.now() + 600;
    const nextIdx = currentImgIndex === 0 ? allImages.length - 1 : currentImgIndex - 1;
    onIndexChange(nextIdx);
  }, [currentImgIndex, allImages.length, onIndexChange]);

  const handleNextImage = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    preventClickUntilRef.current = Date.now() + 600;
    const nextIdx = currentImgIndex === allImages.length - 1 ? 0 : currentImgIndex + 1;
    onIndexChange(nextIdx);
  }, [currentImgIndex, allImages.length, onIndexChange]);

  const handleImageAreaClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (isSwiping.current || Date.now() < preventClickUntilRef.current) {
      e.preventDefault();
      return;
    }
    onOpenProduct();
  }, [onOpenProduct]);

  return (
    <div 
      onClick={handleImageAreaClick}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={() => {
        setIsDragging(false);
        setDragOffset(0);
        touchStartX.current = null;
        touchStartY.current = null;
      }}
      className="relative aspect-[4/5] sm:aspect-[3/4] overflow-hidden rounded-t-xl bg-slate-50 flex items-center justify-center cursor-pointer select-none"
      style={{ touchAction: 'pan-y' }}
    >
      {allImages.length > 1 ? (
        <div
          className="w-full h-full flex"
          style={{
            transform: `translateX(calc(-${currentImgIndex * 100}% + ${dragOffset}px))`,
            transition: isDragging ? 'none' : 'transform 300ms cubic-bezier(0.25, 1, 0.5, 1)',
            willChange: 'transform',
          }}
        >
          {allImages.map((img, idx) => (
            <div
              key={idx}
              className="w-full h-full shrink-0 flex items-center justify-center p-2 sm:p-2.5"
            >
              <ProductImage
                src={img}
                alt={`${product.name} — фото ${idx + 1}`}
                loading={idx === 0 ? 'lazy' : 'lazy'}
                decoding="async"
                width={600}
                fit="contain"
                className="h-full w-full bg-transparent flex items-center justify-center pointer-events-none"
                imageClassName="transition-transform duration-500 ease-apple sm:group-hover:scale-105"
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
            onMouseDown={(e) => e.stopPropagation()}
            aria-label="Предыдущее фото"
            className="hidden sm:flex absolute left-1.5 sm:left-2 top-1/2 -translate-y-1/2 z-20 h-7 w-7 sm:h-8 sm:w-8 items-center justify-center rounded-full bg-white/90 hover:bg-white text-slate-700 hover:text-slate-900 shadow-md border border-slate-200/80 transition-all duration-200 hover:scale-110 active:scale-95 opacity-0 group-hover:opacity-100 cursor-pointer"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={handleNextImage}
            onMouseDown={(e) => e.stopPropagation()}
            aria-label="Следующее фото"
            className="hidden sm:flex absolute right-1.5 sm:right-2 top-1/2 -translate-y-1/2 z-20 h-7 w-7 sm:h-8 sm:w-8 items-center justify-center rounded-full bg-white/90 hover:bg-white text-slate-700 hover:text-slate-900 shadow-md border border-slate-200/80 transition-all duration-200 hover:scale-110 active:scale-95 opacity-0 group-hover:opacity-100 cursor-pointer"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </>
      )}

      {/* Точки-индикаторы снизу (dots) */}
      {allImages.length > 1 && (
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
                        onIndexChange(idx);
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
        )}
      </div>
    );
}

export default ProductCardCarousel;
