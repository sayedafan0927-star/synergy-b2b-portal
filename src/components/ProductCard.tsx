import { useState } from 'react';
import type { Product, PageId, ProductVariant } from '@/types';
import { useAuth } from '@/contexts/AuthContext';
import { useCart } from '@/contexts/CartContext';
import { useUserPricing } from '@/hooks/usePricing';
import { Check, ChevronDown, ChevronUp, Layers, Lock, ShoppingCart } from 'lucide-react';
import ProductImage from '@/components/ProductImage';

interface ProductCardProps {
  product: Product;
  onNavigate: (page: PageId, productId?: string) => void;
}

function getAvailableWarehouse(variant: ProductVariant) {
  return variant.warehouses.find(warehouse => warehouse.stock > 0);
}

export default function ProductCard({ product, onNavigate }: ProductCardProps) {
  const { user } = useAuth();
  const { addItem } = useCart();
  const { getMinPricePerSqm, getVariantPrice } = useUserPricing();
  const [sizesOpen, setSizesOpen] = useState(false);
  const [selectedSize, setSelectedSize] = useState(product.variants[0]?.size ?? '');
  const [added, setAdded] = useState(false);

  const selectedVariant = product.variants.find(variant => variant.size === selectedSize) ?? product.variants[0];
  const availableWarehouse = selectedVariant ? getAvailableWarehouse(selectedVariant) : undefined;
  const pricePerSqm = getMinPricePerSqm(product);
  const imageSource = product.image_thumb || product.images[0];
  const sizeCount = product.variants.length;

  const handleAdd = () => {
    if (!selectedVariant || !availableWarehouse) return;
    addItem({
      productId: product.id,
      productName: product.name,
      collection: product.collection,
      image: imageSource,
      size: selectedVariant.size,
      sku: selectedVariant.sku,
      warehouse: availableWarehouse.city,
      price: getVariantPrice(product.collection, selectedVariant.size, selectedVariant.base_price, selectedVariant.price_per_sqm),
    });
    setAdded(true);
    window.setTimeout(() => setAdded(false), 1400);
  };

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
      </div>

      <div className="flex flex-col p-3 sm:p-4">
        <h3 className="text-sm font-semibold text-slate-900 leading-snug line-clamp-2 group-hover:text-brand-700 transition-colors">
          {product.name}
        </h3>
        <button
          onClick={(event) => {
            event.stopPropagation();
            onNavigate('catalog', product.collection);
          }}
          className="mt-1 inline-flex items-center gap-1 text-xs text-brand-600 hover:text-brand-800 hover:underline transition-colors w-fit"
        >
          {product.collection}
        </button>

        <p className="mt-2 text-xs text-slate-400">{product.manufacturer}</p>

        <div className="mt-2 border-t border-slate-100 pt-2">
          <button
            onClick={(event) => {
              event.stopPropagation();
              setSizesOpen(open => !open);
            }}
            className="flex w-full items-center justify-between rounded-md px-1 py-1 text-left text-xs text-slate-600 transition-colors hover:bg-slate-50 hover:text-brand-700"
          >
            <span className="flex items-center gap-1.5 font-medium">
              <Layers className="h-3.5 w-3.5 text-brand-600" />
              Размеры: {sizeCount}
            </span>
            {sizesOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>

          {sizesOpen && (
            <div className="mt-1 space-y-1 rounded-lg bg-slate-50 p-1.5" onClick={event => event.stopPropagation()}>
              {product.variants.map(variant => {
                const warehouse = getAvailableWarehouse(variant);
                const selected = variant.size === selectedSize;
                return (
                  <button
                    key={variant.sku}
                    onClick={() => setSelectedSize(variant.size)}
                    className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
                      selected ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-600 hover:bg-white'
                    }`}
                  >
                    <span className="font-medium">{variant.size}</span>
                    <span className={warehouse ? 'text-emerald-600' : 'text-slate-400'}>
                      {warehouse ? `${warehouse.stock} шт.` : 'Нет в наличии'}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="mt-2 flex items-center justify-between gap-2">
          {user ? (
            <p className="text-sm font-bold text-slate-900">${pricePerSqm.toFixed(0)} / м²</p>
          ) : (
            <p className="flex items-center gap-1 text-xs text-slate-400">
              <Lock className="h-3 w-3" />
              Войдите для цен
            </p>
          )}
          <button
            onClick={(event) => {
              event.stopPropagation();
              handleAdd();
            }}
            disabled={!availableWarehouse}
            className={`inline-flex shrink-0 items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors ${
              added
                ? 'bg-emerald-600 text-white'
                : availableWarehouse
                  ? 'bg-brand-700 text-white hover:bg-brand-800'
                  : 'cursor-not-allowed bg-slate-100 text-slate-400'
            }`}
          >
            {added ? <Check className="h-3.5 w-3.5" /> : <ShoppingCart className="h-3.5 w-3.5" />}
            {added ? 'Добавлено' : 'В корзину'}
          </button>
        </div>
      </div>
    </div>
  );
}
