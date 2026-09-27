import type { Product, PageId } from '@/types';
import { useAuth } from '@/contexts/AuthContext';
import { useUserPricing } from '@/hooks/usePricing';
import { Lock } from 'lucide-react';

interface ProductCardProps {
  product: Product;
  onNavigate: (page: PageId, productId?: string) => void;
}

export default function ProductCard({ product, onNavigate }: ProductCardProps) {
  const { user } = useAuth();
  const { getMinPricePerSqm } = useUserPricing();
  const pricePerSqm = getMinPricePerSqm(product);

  const totalStock = product.variants.reduce(
    (sum, v) => sum + v.warehouses.reduce((s, w) => s + w.stock, 0),
    0,
  );

  return (
    <button
      onClick={() => onNavigate('product', product.id)}
      className="group card flex flex-col overflow-hidden text-left"
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-slate-100">
        <img
          src={product.images[0]}
          alt={product.name}
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-500 ease-apple group-hover:scale-105"
        />
      </div>

      <div className="flex flex-col p-3 sm:p-4">
        <h3 className="text-sm font-semibold text-slate-900 leading-snug line-clamp-2 group-hover:text-brand-700 transition-colors">
          {product.name}
        </h3>
        <p className="mt-1 text-xs text-slate-400">{product.collection}</p>

        <div className="mt-2 flex items-center gap-2 text-xs">
          <span className="text-slate-400">{product.manufacturer}</span>
          <span className="text-slate-300">·</span>
          <span className={`font-semibold ${totalStock > 0 ? 'text-emerald-600' : 'text-slate-400'}`}>
            {totalStock} шт.
          </span>
        </div>

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
    </button>
  );
}
