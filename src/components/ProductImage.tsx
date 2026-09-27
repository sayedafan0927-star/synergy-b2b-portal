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
      <div className="relative flex flex-col items-center justify-center w-20 h-28 sm:w-24 sm:h-32 rounded border-2 border-dashed border-slate-300 bg-white/80 shadow-inner p-2">
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

export function getOptimizedImageUrl(
  src?: string | null,
  _options: { width?: number; quality?: number; format?: 'auto' | 'webp' } = {}
): string {
  if (!src) return '';
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

  // Если фото нет или произошла ошибка загрузки — показываем стандартную UI-заглушку ковра с логотипом
  if (!src || !src.trim() || hasError) {
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
