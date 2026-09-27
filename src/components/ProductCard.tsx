import type { Product, PageId } from '@/types';
import { useAuth } from '@/contexts/AuthContext';
import { useUserPricing } from '@/hooks/usePricing';
import { Lock, Layers } from 'lucide-react';
import ProductImage from '@/components/ProductImage';

interface ProductCardProps {
  product: Product;
  onNavigate: (page: PageId, productId?: string) => void;
}

export default function ProductCard({ product, onNavigate }: ProductCardProps) {
  const { user } = useAuth();
  const { getMinPricePerSqm } = useUserPricing();
  const pricePerSqm = getMinPricePerSqm(product);
  const sizeCount = product.variants.length;
  const imageSource = product.image_thumb || product.images[0];

  return (
    <div
      onClick={() => onNavigate('product', product.id)}
      className="group card flex flex-col overflow-hidden text-left cursor-pointer"
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-slate-100">
        <ProductImage
          src={imageSource}
          alt={product.name}
          loading="lazy"
          decoding="async"
          width={400}
          className="h-full w-full object-cover transition-transform duration-500 ease-apple group-hover:scale-105"
        />
        {sizeCount > 1 && (
          <span className="absolute top-2 right-2 flex items-center gap-1 rounded-full bg-white/90 backdrop-blur-sm px-2 py-0.5 text-[10px] font-semibold text-slate-700 shadow-sm">
            <Layers className="h-3 w-3" />
            {sizeCount} разм.
          </span>
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

        <div className="mt-2 pt-2 border-t border-slate-50">
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
        </div>
      </div>
    </div>
  );
}
