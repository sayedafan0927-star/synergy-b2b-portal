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
  const [imageError, setImageError] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);
  const isHorizontalSwipe = useRef(false);

  const validImages = images.filter(img => typeof img === 'string' && img.trim().length > 0);
  const imageCount = validImages.length;

  useEffect(() => {
    setSelectedImage(0);
    setImageError(false);
  }, [images]);

  const prevImage = useCallback(() => {
    setSelectedImage(prev => (prev === 0 ? imageCount - 1 : prev - 1));
  }, [imageCount]);

  const nextImage = useCallback(() => {
    setSelectedImage(prev => (prev === imageCount - 1 ? 0 : prev + 1));
  }, [imageCount]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    isHorizontalSwipe.current = false;
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (touchStartX.current === null || touchStartY.current === null) return;
    const dx = Math.abs(e.touches[0].clientX - touchStartX.current);
    const dy = Math.abs(e.touches[0].clientY - touchStartY.current);
    if (dx > dy && dx > 10) {
      isHorizontalSwipe.current = true;
    }
  }, []);

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (touchStartX.current === null) return;
      if (isHorizontalSwipe.current) {
        const delta = e.changedTouches[0].clientX - touchStartX.current;
        if (delta > 50) prevImage();
        else if (delta < -50) nextImage();
      }
      touchStartX.current = null;
      touchStartY.current = null;
      isHorizontalSwipe.current = false;
    },
    [prevImage, nextImage],
  );

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
          <div className="flex w-20 xl:w-22 shrink-0 flex-col gap-2.5 max-h-[500px] xl:max-h-[540px] overflow-y-auto pr-1 select-none scrollbar-thin">
            {validImages.map((img, idx) => (
              <button
                key={idx}
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
          {imageCount > 0 && validImages[selectedImage] && !imageError ? (
            <>
              <img
                src={validImages[selectedImage]}
                alt={`${cleanTitle} — фото ${selectedImage + 1}`}
                className="h-full w-full object-contain p-4 transition-transform duration-300 group-hover:scale-105"
                onError={() => setImageError(true)}
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
      <div className="lg:hidden">
        <div
          className="relative aspect-[4/5] rounded-2xl overflow-hidden bg-slate-50 border border-slate-200/80 p-3 flex items-center justify-center select-none mb-4 cursor-zoom-in"
          onClick={() => imageCount > 0 && setLightboxOpen(true)}
          onTouchStart={imageCount > 1 ? handleTouchStart : undefined}
          onTouchMove={imageCount > 1 ? handleTouchMove : undefined}
          onTouchEnd={imageCount > 1 ? handleTouchEnd : undefined}
        >
          {imageCount > 0 && validImages[selectedImage] && !imageError ? (
            <img
              src={validImages[selectedImage]}
              alt={`${cleanTitle} — фото ${selectedImage + 1}`}
              className="h-full w-full object-contain pointer-events-none drop-shadow-sm transition-transform duration-300"
              draggable={false}
              onError={() => setImageError(true)}
            />
          ) : (
            <CarpetPlaceholderIcon className="h-full w-full" />
          )}

          {imageCount > 1 && (
            <>
              <button
                type="button"
                onClick={e => { e.stopPropagation(); prevImage(); }}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-full bg-white/90 backdrop-blur-sm text-slate-700 shadow-md border border-slate-200/80 hover:bg-white transition-all active:scale-95"
                aria-label="Предыдущее фото"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={e => { e.stopPropagation(); nextImage(); }}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-full bg-white/90 backdrop-blur-sm text-slate-700 shadow-md border border-slate-200/80 hover:bg-white transition-all active:scale-95"
                aria-label="Следующее фото"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
              <div className="absolute bottom-2.5 right-2.5 rounded-md bg-slate-900/60 backdrop-blur-sm px-2 py-0.5 text-[10px] font-medium text-white">
                {selectedImage + 1} / {imageCount}
              </div>
            </>
          )}
        </div>

        {imageCount > 1 && (
          <div className="mb-4 flex justify-center gap-1.5">
            {validImages.map((_, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => setSelectedImage(idx)}
                className={`h-1.5 rounded-full transition-all ${idx === selectedImage ? 'w-4 bg-slate-900 shadow-xs' : 'w-1.5 bg-slate-300 hover:bg-slate-400'}`}
                aria-label={`Фото ${idx + 1}`}
              />
            ))}
          </div>
        )}
      </div>

      {/* FULLSCREEN LIGHTBOX */}
      {lightboxOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Просмотр изображения ${selectedImage + 1} из ${imageCount}`}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm"
          onClick={() => setLightboxOpen(false)}
        >
          <button
            aria-label="Закрыть"
            autoFocus
            className="absolute top-4 right-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors z-10 cursor-pointer"
          >
            <X className="h-6 w-6" />
          </button>
          {imageCount > 1 && (
            <>
              <button
                onClick={e => { e.stopPropagation(); prevImage(); }}
                aria-label="Предыдущее изображение"
                className="absolute left-4 top-1/2 -translate-y-1/2 flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors z-10 cursor-pointer"
              >
                <ChevronLeft className="h-7 w-7" />
              </button>
              <button
                onClick={e => { e.stopPropagation(); nextImage(); }}
                aria-label="Следующее изображение"
                className="absolute right-4 top-1/2 -translate-y-1/2 flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors z-10 cursor-pointer"
              >
                <ChevronRight className="h-7 w-7" />
              </button>
            </>
          )}
          {imageCount > 0 && validImages[selectedImage] && (
            <img
              src={validImages[selectedImage]}
              alt={`${cleanTitle} — фото ${selectedImage + 1}`}
              className="max-h-[85vh] max-w-[90vw] object-contain rounded-lg shadow-2xl"
              onClick={e => e.stopPropagation()}
            />
          )}
          {imageCount > 1 && (
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex gap-2">
              {validImages.map((_, idx) => (
                <button
                  key={idx}
                  onClick={e => { e.stopPropagation(); setSelectedImage(idx); }}
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
