import React, { useState, useEffect, useRef } from 'react';

interface ProductImageProps {
  src?: string | null;
  alt?: string;
  className?: string;
  imageClassName?: string;
  fit?: 'cover' | 'contain';
  loading?: 'lazy' | 'eager';
  decoding?: 'async' | 'sync' | 'auto';
  fetchPriority?: 'high' | 'low' | 'auto';
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

function getPrimaryStaticBase(): string {
  if (typeof window !== 'undefined' && window.location.hostname.includes('synergy-group.kz')) {
    return '/uploads/nomenclature/';
  }
  return 'https://synergy-group.kz/uploads/nomenclature/';
}

const ERP_STATIC_FALLBACK_BASE = 'https://erp.synergy-tech.kz/uploads/nomenclature/';
const ERP_PHP_FALLBACK_BASE = 'https://erp.synergy-tech.kz/image.php?f=';

/**
 * Extracts raw filename from ERP image.php or /uploads/nomenclature/ URLs.
 */
function extractErpFileName(rawUrl: string): string | null {
  const clean = rawUrl.trim();
  const phpMatch = clean.match(/\/image\.php\?(?:[^#]*&)?f=([^&#]+)/i);
  if (phpMatch && phpMatch[1]) {
    try {
      return decodeURIComponent(phpMatch[1]).replace(/^\/+/, '');
    } catch {
      return phpMatch[1].replace(/^\/+/, '');
    }
  }
  const staticMatch = clean.match(/\/uploads\/nomenclature\/([^?#]+)/i);
  if (staticMatch && staticMatch[1]) {
    try {
      return decodeURIComponent(staticMatch[1]).replace(/^\/+/, '');
    } catch {
      return staticMatch[1].replace(/^\/+/, '');
    }
  }
  return null;
}

/**
 * Converts ERP image URLs to same-origin Nginx static delivery (/uploads/nomenclature/)
 * with `Cache-Control: public, max-age=2592000, immutable` and selects 600x800 `thumb_` (~110 KB)
 * when width <= 800, or 1200x1600 full-res otherwise.
 */
export function getOptimizedImageUrl(
  src?: string | null,
  options: { width?: number; quality?: number; format?: 'auto' | 'webp' } = {}
): string {
  if (!src) return '';
  const fileName = extractErpFileName(src);
  if (!fileName) return src;

  const baseName = fileName.replace(/^thumb_/i, '');
  const useThumb = Boolean(options.width && options.width <= 800) || /^thumb_/i.test(fileName);
  const targetFile = useThumb ? `thumb_${baseName}` : baseName;
  return `${getPrimaryStaticBase()}${targetFile}`;
}

function buildFallbackCandidates(src: string, width?: number): string[] {
  const fileName = extractErpFileName(src);
  if (!fileName) {
    return [src];
  }
  const baseName = fileName.replace(/^thumb_/i, '');
  const preferThumb = Boolean(width && width <= 800) || /^thumb_/i.test(fileName);
  const primaryBase = getPrimaryStaticBase();

  const candidates: string[] = [];
  if (preferThumb) {
    candidates.push(`${primaryBase}thumb_${baseName}`);
    candidates.push(`${primaryBase}${baseName}`);
    candidates.push(`${ERP_STATIC_FALLBACK_BASE}thumb_${baseName}`);
    candidates.push(`${ERP_PHP_FALLBACK_BASE}thumb_${baseName}`);
  } else {
    candidates.push(`${primaryBase}${baseName}`);
    candidates.push(`${primaryBase}thumb_${baseName}`);
    candidates.push(`${ERP_STATIC_FALLBACK_BASE}${baseName}`);
    candidates.push(`${ERP_PHP_FALLBACK_BASE}${baseName}`);
  }
  return Array.from(new Set(candidates));
}

// Fast memory set of already-loaded image URLs so remounting cards render in 0ms without skeleton flicker
const loadedImageCache = new Set<string>();

export default function ProductImage({
  src,
  alt = 'Ковер',
  className = '',
  imageClassName = '',
  fit = 'cover',
  loading = 'lazy',
  decoding = 'async',
  fetchPriority,
  width,
  onLoad,
  onError,
}: ProductImageProps) {
  const candidates = React.useMemo(
    () => (src && src.trim() ? buildFallbackCandidates(src, width) : []),
    [src, width]
  );
  const primaryUrl = candidates[0] || '';

  // Check if a 600x800 thumb_ of this carpet is already in browser memory cache (for instant Progressive HD view in ProductGallery)
  const cachedThumbBackdrop = React.useMemo(() => {
    if (!src || (width && width <= 800)) return '';
    const fileName = extractErpFileName(src);
    if (!fileName) return '';
    const baseName = fileName.replace(/^thumb_/i, '');
    const thumbUrl = `${getPrimaryStaticBase()}thumb_${baseName}`;
    return loadedImageCache.has(thumbUrl) ? thumbUrl : '';
  }, [src, width]);

  const [candidateIndex, setCandidateIndex] = useState(0);
  const [hasError, setHasError] = useState(false);
  const [isLoaded, setIsLoaded] = useState(() => Boolean(primaryUrl && loadedImageCache.has(primaryUrl)));
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    setCandidateIndex(0);
    setHasError(false);
    setIsLoaded(Boolean(primaryUrl && loadedImageCache.has(primaryUrl)));
    return () => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, [primaryUrl]);

  // Если фото нет или произошла фатальная ошибка после всех кандидатов — показываем стандартную UI-заглушку ковра с логотипом
  if (!src || !src.trim() || candidates.length === 0 || hasError) {
    return <CarpetPlaceholderIcon className={className} compact={Boolean(width && width <= 80)} />;
  }

  const activeUrl = candidates[candidateIndex] || primaryUrl;
  const isAlreadyCached = loadedImageCache.has(activeUrl);
  const fitClass = fit === 'contain' ? 'object-contain' : 'object-cover';

  return (
    <div className={`relative overflow-hidden ${className.includes('bg-') ? '' : 'bg-slate-100'} ${className}`}>
      {!isLoaded && (
        cachedThumbBackdrop ? (
          <img
            src={cachedThumbBackdrop}
            alt=""
            aria-hidden="true"
            className={`absolute inset-0 w-full h-full ${fitClass} ${imageClassName}`}
          />
        ) : (
          <div className="absolute inset-0 bg-slate-200/70 animate-pulse" />
        )
      )}
      <img
        src={activeUrl}
        alt={alt}
        loading={isAlreadyCached ? 'eager' : loading}
        decoding={decoding}
        {...(fetchPriority ? { fetchPriority } : {})}
        onLoad={() => {
          loadedImageCache.add(activeUrl);
          if (primaryUrl) loadedImageCache.add(primaryUrl);
          setIsLoaded(true);
          onLoad?.();
        }}
        onError={() => {
          if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
          if (candidateIndex + 1 < candidates.length) {
            const nextIdx = candidateIndex + 1;
            const delayMs = 280 * nextIdx;
            retryTimerRef.current = setTimeout(() => {
              setCandidateIndex(nextIdx);
            }, delayMs);
          } else {
            setHasError(true);
            onError?.();
          }
        }}
        className={`w-full h-full ${fitClass} transition-opacity duration-200 ${
          isLoaded ? 'opacity-100' : 'opacity-0'
        } ${imageClassName}`}
      />
    </div>
  );
}
