import React, { useState } from 'react';
import { ImageOff } from 'lucide-react';

interface ProductImageProps {
  src?: string | null;
  alt?: string;
  className?: string;
  loading?: 'lazy' | 'eager';
  decoding?: 'async' | 'sync' | 'auto';
  fallbackSrc?: string;
  width?: number;
  quality?: number;
  onLoad?: () => void;
  onError?: () => void;
}

export function getOptimizedImageUrl(
  src?: string | null,
  options: { width?: number; quality?: number; format?: 'auto' | 'webp' } = {}
): string {
  if (!src) return '';
  if (src.startsWith('/')) return src;

  // Cloudflare image resizing fallback
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
  fallbackSrc = 'https://images.unsplash.com/photo-1600121848594-d8644e57abab?auto=format&fit=crop&q=80&w=800',
  width,
  quality,
  onLoad,
  onError,
}: ProductImageProps) {
  const [hasError, setHasError] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);

  const finalSrc = hasError || !src ? fallbackSrc : getOptimizedImageUrl(src, { width, quality });

  return (
    <div className={`relative overflow-hidden bg-slate-100 ${className}`}>
      {!isLoaded && !hasError && (
        <div className="absolute inset-0 bg-slate-200 animate-pulse" />
      )}
      <img
        src={finalSrc}
        alt={alt}
        loading={loading}
        decoding={decoding}
        onLoad={() => {
          setIsLoaded(true);
          onLoad?.();
        }}
        onError={() => {
          if (!hasError) {
            setHasError(true);
            onError?.();
          }
        }}
        className={`w-full h-full object-cover transition-opacity duration-300 ${
          isLoaded ? 'opacity-100' : 'opacity-0'
        }`}
      />
    </div>
  );
}
