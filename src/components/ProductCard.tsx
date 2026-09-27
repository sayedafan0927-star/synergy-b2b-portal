import { useState } from 'react';
import type { Product, PageId } from '@/types';
import { useAuth } from '@/contexts/AuthContext';
import { useUserPricing } from '@/hooks/usePricing';
import { ChevronLeft, ChevronRight, Lock, Layers } from 'lucide-react';

interface ProductCardProps {
  product: Product;
  onNavigate: (page: PageId, productId?: string) => void;
}

export default function ProductCard({ product, onNavigate }: ProductCardProps) {
  const { user } = useAuth();
  const { getMinPricePerSqm } = useUserPricing();
  const [activeImage, setActiveImage] = useState(0);
  const pricePerSqm = getMinPricePerSqm(product);
  const sizeCount = product.variants.length;
  const hasMultipleImages = product.images.length > 1;

  const showPreviousImage = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    setActiveImage(current => current === 0 ? product.images.length - 1 : current - 1);
  };

  const showNextImage = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    setActiveImage(current => (current + 1) % product.images.length);
  };

  return (
    <div
      onClick={() => onNavigate('product', product.id)}
      className="group card flex flex-col overflow-hidden text-left cursor-pointer"
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-slate-50">
        <img
          src={product.images[activeImage]}
          alt={product.name}
          loading="lazy"
          className="h-full w-full object-contain p-3 transition-transform duration-500 ease-apple group-hover:scale-105"
        />
        {hasMultipleImages && (
          <>
            <button
              type="button"
              aria-label="Предыдущее фото"
              onClick={showPreviousImage}
              className="absolute left-3 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-slate-400 bg-white/95 text-slate-700 opacity-100 shadow-md transition-all sm:opacity-0 sm:group-hover:opacity-100 hover:scale-105 hover:bg-white"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              type="button"
              aria-label="Следующее фото"
              onClick={showNextImage}
              className="absolute right-3 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-slate-400 bg-white/95 text-slate-700 opacity-100 shadow-md transition-all sm:opacity-0 sm:group-hover:opacity-100 hover:scale-105 hover:bg-white"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
            <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 gap-1 rounded-full bg-slate-900/45 px-2 py-1">
              {product.images.map((image, index) => (
                <span
                  key={`${image}-${index}`}
                  className={`h-1.5 w-1.5 rounded-full transition-colors ${index === activeImage ? 'bg-white' : 'bg-white/45'}`}
                />
              ))}
            </div>
          </>
        )}
      </div>

      <div className="flex flex-col p-3 sm:p-4">
        <h3 className="text-sm font-semibold text-slate-900 leading-snug line-clamp-2 group-hover:text-brand-700 transition-colors">
          {product.name}
        </h3>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onNavigate('catalog', product.collection);
          }}
          className="mt-1 inline-flex items-center gap-1 text-xs text-brand-600 hover:text-brand-800 hover:underline transition-colors w-fit"
        >
          {product.collection}
        </button>

        <p className="mt-2 text-xs text-slate-400">{product.manufacturer}</p>

        <div className="mt-2 flex items-end justify-between gap-2 border-t border-slate-50 pt-2">
          {user ? (
            <p className="text-sm font-bold text-slate-900">
              ${pricePerSqm.toFixed(0)} / м²
            </p>
          ) : (
            <p className="flex items-center gap-1 text-xs text-slate-400">
              <Lock className="h-3 w-3" />
              Войдите для цен
            </p>
          )}
          {sizeCount > 1 && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600">
              <Layers className="h-3.5 w-3.5" />
              {sizeCount} размеров
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
