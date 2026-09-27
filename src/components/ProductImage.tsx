import React, { useState } from 'react';

interface ProductImageProps {
  src?: string | null;
  alt?: string;
  className?: string;
  loading?: 'lazy' | 'eager';
  decoding?: 'async' | 'sync' | 'auto';
  width?: number;
  quality?: number;
  onLoad?: () => void;
  onError?: () => void;
}

export function CarpetPlaceholderIcon({ className = "w-full h-full" }: { className?: string }) {
  return (
    <div className={`flex flex-col items-center justify-center bg-gradient-to-b from-slate-50 via-slate-100 to-slate-200 text-slate-400 select-none p-4 ${className}`}>
      <div className="relative flex flex-col items-center justify-center w-20 h-28 sm:w-24 sm:h-32 rounded border-2 border-dashed border-slate-300 bg-white/70 shadow-inner p-2">
        {/* Top fringe */}
        <div className="flex justify-between w-full h-1 border-b border-slate-200 opacity-60 mb-1">
          {[...Array(8)].map((_, i) => (
            <span key={i} className="inline-block w-0.5 h-1.5 bg-slate-300 rounded-full" />
          ))}
        </div>

        {/* Inner geometric pattern */}
        <div className="flex-1 w-full border border-slate-200 rounded flex flex-col items-center justify-center p-1 bg-slate-50/60">
          <svg className="w-7 h-7 text-brand-700/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M12 3v18" strokeDasharray="2 2" />
            <path d="M3 12h18" strokeDasharray="2 2" />
            <circle cx="12" cy="12" r="3" />
            <path d="m8 8 8 8" />
            <path d="m16 8-8 8" />
          </svg>
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

export function getOptimizedImageUrl(
  src?: string | null,
  options: { width?: number; quality?: number; format?: 'auto' | 'webp' } = {}
): string {
  if (!src) return '';
  if (src.startsWith('/')) return src;

  // Cloudflare image resizing
  if (options.width && src.includes('kilem-khan.kz')) {
    const width = options.width;
    const quality = options.quality || 80;
    const format = options.format || 'auto';
    return `https://kilem-khan.kz/cdn-cgi/image/width=${width},quality=${quality},format=${format}/${src}`;
  }

  return src;
}

export default function ProductImage({
  src,
  alt = 'Ковер',
  className = '',
  loading = 'lazy',
  decoding = 'async',
  width,
  quality,
  onLoad,
  onError,
}: ProductImageProps) {
  const [hasError, setHasError] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);

  // Если фото нет или произошла ошибка загрузки — показываем стандартную UI-заглушку ковра
  if (!src || hasError) {
    return <CarpetPlaceholderIcon className={className} />;
  }

  const optimizedSrc = getOptimizedImageUrl(src, { width, quality });

  return (
    <div className={`relative overflow-hidden bg-slate-100 ${className}`}>
      {!isLoaded && (
        <div className="absolute inset-0 bg-slate-200 animate-pulse" />
      )}
      <img
        src={optimizedSrc}
        alt={alt}
        loading={loading}
        decoding={decoding}
        onLoad={() => {
          setIsLoaded(true);
          onLoad?.();
        }}
        onError={() => {
          setHasError(true);
          onError?.();
        }}
        className={`w-full h-full object-cover transition-opacity duration-300 ${
          isLoaded ? 'opacity-100' : 'opacity-0'
        }`}
      />
    </div>
  );
}
