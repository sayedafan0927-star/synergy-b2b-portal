import { useState, useEffect, useCallback, useRef } from 'react';
import { ChevronRight, ChevronLeft, ZoomIn, X } from 'lucide-react';
import ProductImage, { CarpetPlaceholderIcon } from '@/components/ProductImage';

interface ProductGalleryProps {
  images: string[];
  productName: string;
  cleanTitle: string;
  isMobileOnly?: boolean;
}

export function ProductGallery({
  images,
  cleanTitle,
}: ProductGalleryProps) {
  const [selectedImage, setSelectedImage] = useState(0);
  const [failedImages, setFailedImages] = useState<Record<number, boolean>>({});
  const [lightboxOpen, setLightboxOpen] = useState(false);

  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);
  const isSwiping = useRef(false);
  const thumbsContainerRef = useRef<HTMLDivElement | null>(null);
  const thumbRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const mobileScrollRef = useRef<HTMLDivElement | null>(null);
  const mobileThumbsRef = useRef<HTMLDivElement | null>(null);
  const mobileThumbRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const lightboxTouchStartX = useRef<number | null>(null);
  const lightboxTouchStartY = useRef<number | null>(null);

  const validImages = images.filter(img => typeof img === 'string' && img.trim().length > 0);
  const imageCount = validImages.length;

  useEffect(() => {
    setSelectedImage(0);
    setFailedImages({});
    if (mobileScrollRef.current) {
      mobileScrollRef.current.scrollLeft = 0;
    }
  }, [images]);

  // Автопрокрутка колонки миниатюр к активному фото на десктопе
  useEffect(() => {
    const container = thumbsContainerRef.current;
    const thumb = thumbRefs.current[selectedImage];
    if (!container || !thumb) return;
    const cRect = container.getBoundingClientRect();
    const tRect = thumb.getBoundingClientRect();
    const thumbTop = tRect.top - cRect.top + container.scrollTop;
    const target = thumbTop - (container.clientHeight - tRect.height) / 2;
    const maxScroll = container.scrollHeight - container.clientHeight;
    const top = Math.min(Math.max(0, target), Math.max(0, maxScroll));
    if (Math.abs(container.scrollTop - top) > 1) {
      container.scrollTo({ top, behavior: 'smooth' });
    }
  }, [selectedImage, imageCount]);

  // Автопрокрутка горизонтальной ленты миниатюр на мобильном
  useEffect(() => {
    const container = mobileThumbsRef.current;
    const thumb = mobileThumbRefs.current[selectedImage];
    if (!container || !thumb) return;
    const cRect = container.getBoundingClientRect();
    const tRect = thumb.getBoundingClientRect();
    const target = tRect.left - cRect.left + container.scrollLeft - (container.clientWidth - tRect.width) / 2;
    container.scrollTo({ left: Math.max(0, target), behavior: 'smooth' });
  }, [selectedImage, imageCount]);

  const scrollToIndex = useCallback((idx: number) => {
    setSelectedImage(idx);
    if (mobileScrollRef.current) {
      mobileScrollRef.current.scrollTo({
        left: idx * mobileScrollRef.current.clientWidth,
        behavior: 'smooth',
      });
    }
  }, []);

  const prevImage = useCallback(() => {
    const nextIdx = selectedImage === 0 ? imageCount - 1 : selectedImage - 1;
    scrollToIndex(nextIdx);
  }, [imageCount, selectedImage, scrollToIndex]);

  const nextImage = useCallback(() => {
    const nextIdx = selectedImage === imageCount - 1 ? 0 : selectedImage + 1;
    scrollToIndex(nextIdx);
  }, [imageCount, selectedImage, scrollToIndex]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    isSwiping.current = false;
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (touchStartX.current === null || touchStartY.current === null) return;
    const dx = Math.abs(e.touches[0].clientX - touchStartX.current);
    const dy = Math.abs(e.touches[0].clientY - touchStartY.current);
    if (dx > 8 && dx > dy) {
      isSwiping.current = true;
    }
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (touchStartX.current !== null && touchStartY.current !== null && imageCount > 1) {
      const deltaX = e.changedTouches[0].clientX - touchStartX.current;
      const deltaY = Math.abs(e.changedTouches[0].clientY - touchStartY.current);
      if (Math.abs(deltaX) > 30 && Math.abs(deltaX) > deltaY) {
        if (deltaX < 0) nextImage();
        else prevImage();
      }
    }
    if (isSwiping.current) {
      setTimeout(() => {
        isSwiping.current = false;
      }, 250);
    }
    touchStartX.current = null;
    touchStartY.current = null;
  }, [imageCount, nextImage, prevImage]);

  const handleMobileScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const container = e.currentTarget;
    if (!container || container.clientWidth === 0) return;
    const newIndex = Math.round(container.scrollLeft / container.clientWidth);
    if (newIndex >= 0 && newIndex < imageCount && newIndex !== selectedImage) {
      setSelectedImage(newIndex);
    }
  }, [imageCount, selectedImage]);

  const handleMobileImageTap = useCallback((idx: number) => {
    if (isSwiping.current) return;
    setSelectedImage(idx);
    setLightboxOpen(true);
  }, []);

  const handleLightboxTouchStart = useCallback((e: React.TouchEvent) => {
    lightboxTouchStartX.current = e.touches[0].clientX;
    lightboxTouchStartY.current = e.touches[0].clientY;
  }, []);

  const handleLightboxTouchEnd = useCallback((e: React.TouchEvent) => {
    if (lightboxTouchStartX.current === null || lightboxTouchStartY.current === null) return;
    const deltaX = e.changedTouches[0].clientX - lightboxTouchStartX.current;
    const deltaY = e.changedTouches[0].clientY - lightboxTouchStartY.current;
    if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 40) {
      if (deltaX > 0) prevImage();
      else nextImage();
    } else if (deltaY > 80 && Math.abs(deltaY) > Math.abs(deltaX) * 1.5) {
      setLightboxOpen(false);
    } else if (Math.abs(deltaX) < 15 && Math.abs(deltaY) < 15) {
      const target = e.target as HTMLElement;
      if (target === e.currentTarget || target.dataset.backdrop === 'true') {
        setLightboxOpen(false);
      }
    }
    lightboxTouchStartX.current = null;
    lightboxTouchStartY.current = null;
  }, [prevImage, nextImage]);

  useEffect(() => {
    if (!lightboxOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightboxOpen(false);
      if (e.key === 'ArrowLeft') prevImage();
      if (e.key === 'ArrowRight') nextImage();
    };
    window.addEventListener('keydown', handler);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', handler);
      document.body.style.overflow = '';
    };
  }, [lightboxOpen, prevImage, nextImage]);

  return (
    <>
      {/* DESKTOP GALLERY (Hidden on mobile) */}
      <div className="hidden lg:flex items-start gap-3.5 select-none">
        {/* THUMBNAILS (LEFT) */}
        {imageCount > 1 && (
          <div
            ref={thumbsContainerRef}
            className="flex w-20 xl:w-22 shrink-0 flex-col gap-2.5 max-h-[500px] xl:max-h-[540px] overflow-y-auto pr-1 select-none scrollbar-thin"
          >
            {validImages.map((img, idx) => (
              <button
                key={idx}
                ref={el => { thumbRefs.current[idx] = el; }}
                type="button"
                onClick={() => setSelectedImage(idx)}
                className={`relative aspect-[4/5] w-full rounded-xl overflow-hidden border-2 transition-all shrink-0 cursor-pointer ${
                  idx === selectedImage
                    ? 'border-slate-900 shadow-sm ring-2 ring-slate-900/10 opacity-100'
                    : 'border-slate-200/80 opacity-60 hover:opacity-100 hover:border-slate-400'
                }`}
              >
                <ProductImage src={img} alt="" fit="contain" className="h-full w-full object-contain p-1" />
              </button>
            ))}
          </div>
        )}

        {/* MAIN LARGE PHOTO (RIGHT) */}
        <div
          className={`relative aspect-[4/5] min-w-0 flex-1 rounded-2xl overflow-hidden bg-slate-50 border border-slate-200/80 ${imageCount > 0 ? 'cursor-zoom-in group' : ''}`}
          onClick={() => imageCount > 0 && setLightboxOpen(true)}
        >
          {imageCount > 0 && validImages[selectedImage] && !failedImages[selectedImage] ? (
            <>
              <img
                src={validImages[selectedImage]}
                alt={`${cleanTitle} — фото ${selectedImage + 1}`}
                className="h-full w-full object-contain p-4 transition-transform duration-300 group-hover:scale-105"
                onError={() => setFailedImages(prev => ({ ...prev, [selectedImage]: true }))}
                draggable={false}
              />
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/5 transition-colors flex items-center justify-center pointer-events-none">
                <ZoomIn className="h-8 w-8 text-white opacity-0 group-hover:opacity-75 transition-opacity drop-shadow-lg" />
              </div>
            </>
          ) : (
            <CarpetPlaceholderIcon className="h-full w-full" />
          )}

          {imageCount > 1 && (
            <>
              <button
                type="button"
                onClick={e => { e.stopPropagation(); prevImage(); }}
                className="absolute left-3 top-1/2 z-10 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full border border-slate-300/80 bg-white/95 text-slate-700 shadow-md hover:scale-105 hover:bg-white transition-all opacity-0 group-hover:opacity-100"
                aria-label="Предыдущее фото"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={e => { e.stopPropagation(); nextImage(); }}
                className="absolute right-3 top-1/2 z-10 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full border border-slate-300/80 bg-white/95 text-slate-700 shadow-md hover:scale-105 hover:bg-white transition-all opacity-0 group-hover:opacity-100"
                aria-label="Следующее фото"
              >
                <ChevronRight className="h-5 w-5" />
              </button>

              <div className="absolute bottom-3 right-3 rounded-md bg-slate-900/60 backdrop-blur-sm px-2 py-0.5 text-[11px] font-medium text-white">
                {selectedImage + 1} / {imageCount}
              </div>
            </>
          )}
        </div>
      </div>

      {/* MOBILE GALLERY (Hidden on desktop) */}
      <div className="lg:hidden select-none">
        <div className="relative aspect-[4/5] rounded-2xl overflow-hidden bg-slate-50 border border-slate-200/80 mb-3 shadow-2xs">
          {imageCount > 0 ? (
            <div
              ref={mobileScrollRef}
              onScroll={handleMobileScroll}
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
              className="w-full h-full flex overflow-x-auto snap-x snap-mandatory no-scrollbar"
              style={{ WebkitOverflowScrolling: 'touch' }}
            >
              {validImages.map((img, idx) => (
                <div
                  key={idx}
                  className="w-full h-full shrink-0 snap-center p-3 flex items-center justify-center relative select-none"
                >
                  {!failedImages[idx] ? (
                    <img
                      src={img}
                      alt={`${cleanTitle} — фото ${idx + 1}`}
                      className="h-full w-full object-contain pointer-events-none drop-shadow-sm select-none"
                      draggable={false}
                      loading={idx === 0 ? 'eager' : 'lazy'}
                      onError={() => setFailedImages(prev => ({ ...prev, [idx]: true }))}
                    />
                  ) : (
                    <CarpetPlaceholderIcon className="h-full w-full" />
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="w-full h-full p-4 flex items-center justify-center">
              <CarpetPlaceholderIcon className="h-full w-full" />
            </div>
          )}

          {/* Кнопка увеличения на весь экран (отдельная кнопка) */}
          {imageCount > 0 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setLightboxOpen(true);
              }}
              className="absolute top-2.5 right-2.5 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white/90 backdrop-blur-sm text-slate-700 shadow-md border border-slate-200/80 hover:bg-white active:scale-95 cursor-pointer"
              aria-label="Увеличить фото на весь экран"
              title="На весь экран"
            >
              <ZoomIn className="h-4 w-4" />
            </button>
          )}

          {/* Стрелки перелистывания на мобильном */}
          {imageCount > 1 && (
            <>
              <button
                type="button"
                onClick={e => {
                  e.stopPropagation();
                  prevImage();
                }}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white/90 backdrop-blur-sm text-slate-700 shadow-md border border-slate-200/80 hover:bg-white transition-all active:scale-95 cursor-pointer"
                aria-label="Предыдущее фото"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={e => {
                  e.stopPropagation();
                  nextImage();
                }}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white/90 backdrop-blur-sm text-slate-700 shadow-md border border-slate-200/80 hover:bg-white transition-all active:scale-95 cursor-pointer"
                aria-label="Следующее фото"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
              <div className="absolute bottom-2.5 right-2.5 z-10 rounded-md bg-slate-900/60 backdrop-blur-sm px-2 py-0.5 text-[10px] font-medium text-white pointer-events-none">
                {selectedImage + 1} / {imageCount}
              </div>
            </>
          )}
        </div>

        {/* Индикаторы и миниатюры под главным фото */}
        {imageCount > 1 && (
          <div className="mb-4 flex flex-col gap-2">
            {/* Точки-индикаторы */}
            <div className="flex justify-center gap-1.5 items-center">
              {validImages.map((_, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => scrollToIndex(idx)}
                  className={`h-1.5 rounded-full transition-all cursor-pointer ${
                    idx === selectedImage ? 'w-4 bg-slate-900 shadow-xs' : 'w-1.5 bg-slate-300 hover:bg-slate-400'
                  }`}
                  aria-label={`Фото ${idx + 1}`}
                />
              ))}
            </div>

            {/* Горизонтальная лента миниатюр */}
            <div
              ref={mobileThumbsRef}
              className="flex gap-2 overflow-x-auto no-scrollbar py-1 px-1"
            >
              {validImages.map((img, idx) => (
                <button
                  key={idx}
                  ref={el => { mobileThumbRefs.current[idx] = el; }}
                  type="button"
                  onClick={() => scrollToIndex(idx)}
                  className={`relative aspect-[4/5] w-12 shrink-0 rounded-lg overflow-hidden border-2 transition-all cursor-pointer ${
                    idx === selectedImage
                      ? 'border-slate-900 shadow-sm ring-1 ring-slate-900/20 opacity-100'
                      : 'border-slate-200/80 opacity-60 hover:opacity-100'
                  }`}
                  aria-label={`Миниатюра ${idx + 1}`}
                >
                  <img src={img} alt="" className="h-full w-full object-contain p-0.5 pointer-events-none" />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* FULLSCREEN LIGHTBOX */}
      {lightboxOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Просмотр изображения ${selectedImage + 1} из ${imageCount}`}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm select-none"
          data-backdrop="true"
          onClick={(e) => {
            if (e.target === e.currentTarget || (e.target as HTMLElement).dataset.backdrop === 'true') {
              setLightboxOpen(false);
            }
          }}
          onTouchStart={handleLightboxTouchStart}
          onTouchEnd={handleLightboxTouchEnd}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setLightboxOpen(false);
            }}
            aria-label="Закрыть"
            autoFocus
            className="absolute top-4 right-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors z-20 cursor-pointer"
          >
            <X className="h-6 w-6" />
          </button>
          {imageCount > 1 && (
            <>
              <button
                type="button"
                onClick={e => { e.stopPropagation(); prevImage(); }}
                aria-label="Предыдущее изображение"
                className="absolute left-4 top-1/2 -translate-y-1/2 flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors z-20 cursor-pointer"
              >
                <ChevronLeft className="h-7 w-7" />
              </button>
              <button
                type="button"
                onClick={e => { e.stopPropagation(); nextImage(); }}
                aria-label="Следующее изображение"
                className="absolute right-4 top-1/2 -translate-y-1/2 flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors z-20 cursor-pointer"
              >
                <ChevronRight className="h-7 w-7" />
              </button>
            </>
          )}
          {imageCount > 0 && validImages[selectedImage] && (
            <div className="relative max-h-[85vh] max-w-[90vw] flex items-center justify-center p-2 z-10 pointer-events-none">
              <img
                src={validImages[selectedImage]}
                alt={`${cleanTitle} — фото ${selectedImage + 1}`}
                onClick={e => e.stopPropagation()}
                className="max-h-[85vh] max-w-[90vw] object-contain rounded-lg shadow-2xl pointer-events-auto select-none"
              />
            </div>
          )}
          {imageCount > 1 && (
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex gap-2 z-20" onClick={e => e.stopPropagation()}>
              {validImages.map((_, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={e => { e.stopPropagation(); scrollToIndex(idx); }}
                  aria-label={`Изображение ${idx + 1}`}
                  aria-current={idx === selectedImage}
                  className={`h-2.5 w-2.5 rounded-full transition-all cursor-pointer ${idx === selectedImage ? 'bg-white scale-125' : 'bg-white/40 hover:bg-white/60'}`}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}
export default ProductGallery;
