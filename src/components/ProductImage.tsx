import React, { useState } from 'react';

interface ProductImageProps {
  src?: string | null;
  alt?: string;
  className?: string;
  imageClassName?: string;
  fit?: 'cover' | 'contain';
  loading?: 'lazy' | 'eager';
  decoding?: 'async' | 'sync' | 'auto';
  width?: number;
  quality?: number;
  onLoad?: () => void;
  onError?: () => void;
}

export function CarpetPlaceholderIcon({ className = "w-full h-full", compact = false }: { className?: string; compact?: boolean }) {
  const isSmallThumbnail = compact || /\b(h-(?:[6-9]|1[0-6])|w-(?:[6-9]|1[0-6]))\b/.test(className);

  if (isSmallThumbnail) {
    return (
      <div className={`overflow-hidden flex items-center justify-center bg-slate-100 text-slate-400 select-none ${className}`}>
        <div className="flex flex-col items-center justify-center w-full h-full rounded border border-dashed border-slate-300 bg-white/80 p-0.5">
          <span className="text-[7px] uppercase tracking-tight font-bold text-slate-400 leading-none">Ковер</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`overflow-hidden flex flex-col items-center justify-center bg-gradient-to-b from-slate-50 via-slate-100 to-slate-200 text-slate-400 select-none p-4 ${className}`}>
      <div className="relative flex flex-col items-center justify-center w-20 h-28 sm:w-24 sm:h-32 max-w-full max-h-full rounded border-2 border-dashed border-slate-300 bg-white/80 shadow-inner p-2">
        {/* Top fringe */}
        <div className="flex justify-between w-full h-1 border-b border-slate-200 opacity-60 mb-1">
          {[...Array(8)].map((_, i) => (
            <span key={i} className="inline-block w-0.5 h-1.5 bg-slate-300 rounded-full" />
          ))}
        </div>

        {/* Inner geometric pattern with company logo */}
        <div className="flex-1 w-full border border-slate-200/70 rounded flex flex-col items-center justify-center p-1.5 bg-slate-50/70">
          <img
            src="/Вектор_Синэнергия.png"
            alt="Synergy"
            className="h-5 sm:h-6 w-auto object-contain opacity-40 grayscale"
            onError={(e) => { (e.currentTarget as HTMLElement).style.display = 'none'; }}
          />
          <span className="text-[9px] uppercase tracking-wider font-semibold text-slate-400 mt-1">Ковер</span>
        </div>

        {/* Bottom fringe */}
        <div className="flex justify-between w-full h-1 border-t border-slate-200 opacity-60 mt-1">
          {[...Array(8)].map((_, i) => (
            <span key={i} className="inline-block w-0.5 h-1.5 bg-slate-300 rounded-full" />
          ))}
        </div>
      </div>
      <span className="text-[11px] font-medium text-slate-400 mt-2">Нет фото</span>
    </div>
  );
}

const MAX_CONCURRENT_IMAGE_LOADS = 6;
let activeImageLoads = 0;
const pendingQueue: Array<() => void> = [];

function acquireImageSlot(onGrant: () => void): () => void {
  let released = false;
  let granted = false;

  const grant = () => {
    if (released) return;
    granted = true;
    activeImageLoads++;
    onGrant();
  };

  if (activeImageLoads < MAX_CONCURRENT_IMAGE_LOADS) {
    grant();
  } else {
    pendingQueue.push(grant);
  }

  return () => {
    if (released) return;
    released = true;
    if (granted) {
      granted = false;
      activeImageLoads = Math.max(0, activeImageLoads - 1);
      while (pendingQueue.length > 0 && activeImageLoads < MAX_CONCURRENT_IMAGE_LOADS) {
        const next = pendingQueue.shift();
        if (next) next();
      }
    } else {
      const idx = pendingQueue.indexOf(grant);
      if (idx !== -1) pendingQueue.splice(idx, 1);
    }
  };
}

export function getOptimizedImageUrl(
  src?: string | null,
  _options: { width?: number; quality?: number; format?: 'auto' | 'webp' } = {}
): string {
  if (!src) return '';
  return src;
}

function appendRetryParam(url: string, attempt: number): string {
  if (attempt <= 0) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}r=${attempt}`;
}

export default function ProductImage({
  src,
  alt = 'Ковер',
  className = '',
  imageClassName = '',
  fit = 'cover',
  loading = 'lazy',
  decoding = 'async',
  width,
  quality,
  onLoad,
  onError,
}: ProductImageProps) {
  const [hasError, setHasError] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [retryAttempt, setRetryAttempt] = useState(0);
  const [isSlotGranted, setIsSlotGranted] = useState(() => !src || !src.includes('image.php'));
  const releaseSlotRef = React.useRef<(() => void) | null>(null);
  const retryTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    setHasError(false);
    setIsLoaded(false);
    setRetryAttempt(0);
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    if (releaseSlotRef.current) {
      releaseSlotRef.current();
      releaseSlotRef.current = null;
    }

    if (!src || !src.trim()) {
      setIsSlotGranted(false);
      return;
    }

    // Static assets (not served via PHP-FPM image.php) do not need concurrency throttling
    if (!src.includes('image.php')) {
      setIsSlotGranted(true);
      return;
    }

    setIsSlotGranted(false);
    let observer: IntersectionObserver | null = null;
    let cancelled = false;

    const requestSlot = () => {
      if (cancelled || releaseSlotRef.current) return;
      releaseSlotRef.current = acquireImageSlot(() => {
        if (!cancelled) {
          setIsSlotGranted(true);
        }
      });
    };

    if (loading === 'eager' || typeof IntersectionObserver === 'undefined' || !containerRef.current) {
      requestSlot();
    } else {
      observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            observer?.disconnect();
            observer = null;
            requestSlot();
          }
        },
        { rootMargin: '250px 0px' }
      );
      observer.observe(containerRef.current);
    }

    return () => {
      cancelled = true;
      if (observer) {
        observer.disconnect();
      }
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      if (releaseSlotRef.current) {
        releaseSlotRef.current();
        releaseSlotRef.current = null;
      }
    };
  }, [src, loading]);

  // Если фото нет или произошла фатальная ошибка после повторов — показываем стандартную UI-заглушку ковра с логотипом
  if (!src || !src.trim() || hasError) {
    return <CarpetPlaceholderIcon className={className} compact={Boolean(width && width <= 80)} />;
  }

  const baseOptimizedSrc = getOptimizedImageUrl(src, { width, quality });
  const finalSrc = appendRetryParam(baseOptimizedSrc, retryAttempt);
  const fitClass = fit === 'contain' ? 'object-contain' : 'object-cover';

  return (
    <div
      ref={containerRef}
      className={`relative overflow-hidden ${className.includes('bg-') ? '' : 'bg-slate-100'} ${className}`}
    >
      {!isLoaded && (
        <div className="absolute inset-0 bg-slate-200 animate-pulse" />
      )}
      {isSlotGranted && (
        <img
          src={finalSrc}
          alt={alt}
          loading={loading}
          decoding={decoding}
          onLoad={() => {
            if (releaseSlotRef.current) {
              releaseSlotRef.current();
              releaseSlotRef.current = null;
            }
            setIsLoaded(true);
            onLoad?.();
          }}
          onError={() => {
            if (releaseSlotRef.current) {
              releaseSlotRef.current();
              releaseSlotRef.current = null;
            }
            if (retryAttempt < 3) {
              const nextAttempt = retryAttempt + 1;
              const delayMs = 300 * nextAttempt + Math.floor(Math.random() * 250);
              setIsSlotGranted(false);
              retryTimerRef.current = setTimeout(() => {
                setRetryAttempt(nextAttempt);
                releaseSlotRef.current = acquireImageSlot(() => {
                  setIsSlotGranted(true);
                });
              }, delayMs);
            } else {
              setHasError(true);
              onError?.();
            }
          }}
          className={`w-full h-full ${fitClass} transition-opacity duration-300 ${
            isLoaded ? 'opacity-100' : 'opacity-0'
          } ${imageClassName}`}
        />
      )}
    </div>
  );
}
