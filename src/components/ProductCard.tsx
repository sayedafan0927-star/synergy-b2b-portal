import { useState } from 'react';
import type { Product, PageId, ProductVariant } from '@/types';
import { useAuth } from '@/contexts/AuthContext';
import { useCart } from '@/contexts/CartContext';
import { useUserPricing } from '@/hooks/usePricing';
import { Check, Layers, Lock, ShoppingCart } from 'lucide-react';
import ProductImage from '@/components/ProductImage';

interface ProductCardProps {
  product: Product;
  onNavigate: (page: PageId, productId?: string) => void;
}

function getTotalStock(variant: ProductVariant) {
  return variant.warehouses.reduce((total, warehouse) => total + warehouse.stock, 0);
}

function getAvailableWarehouse(variant: ProductVariant) {
  return (
    variant.warehouses.find(w => w.stock > 0) ||
    variant.warehouses.find(w => (w.warehouse_name && w.warehouse_name.toLowerCase().includes('основной')) || (w.city && w.city.toLowerCase().includes('астана'))) ||
    variant.warehouses[0]
  );
}

function sizeLabel(count: number) {
  if (count === 1) return 'размер';
  if (count > 1 && count < 5) return 'размера';
  return 'размеров';
}

export default function ProductCard({ product, onNavigate }: ProductCardProps) {
  const { user } = useAuth();
  const { addItem } = useCart();
  const { getMinPricePerSqm, getVariantPrice } = useUserPricing();
  const [sizesOpen, setSizesOpen] = useState(false);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [addedSku, setAddedSku] = useState<string | null>(null);

  const imageSource = product.image_thumb || product.images[0];
  const sizeCount = product.variants.length;
  const pricePerSqm = getMinPricePerSqm(product);

  const setQuantity = (sku: string, value: number) => {
    setQuantities(previous => ({ ...previous, [sku]: Math.max(1, value || 1) }));
  };

  const handleAdd = (variant: ProductVariant) => {
    const warehouse = getAvailableWarehouse(variant);
    if (!warehouse) return;

    const quantity = Math.min(quantities[variant.sku] ?? 1, getTotalStock(variant));
    addItem({
      productId: product.id,
      productName: product.name,
      collection: product.collection,
      image: imageSource,
      size: variant.size,
      sku: variant.sku,
      warehouse: warehouse.warehouse_name || warehouse.city,
      price: getVariantPrice(product.collection, variant.size, variant.base_price, variant.price_per_sqm),
    }, quantity);
    setAddedSku(variant.sku);
    window.setTimeout(() => setAddedSku(current => current === variant.sku ? null : current), 1400);
  };

  const hasDealerStock = Boolean(user && product.variants.some(v => v.dealer_stock));
  const totalShowroomQty = product.variants.reduce((sum, v) => sum + (v.dealer_stock?.in_showroom_qty || 0), 0);
  const totalShowroomSqm = Math.round(product.variants.reduce((sum, v) => sum + (v.dealer_stock?.in_showroom_sqm || 0), 0) * 10) / 10;
  const totalInTransitQty = product.variants.reduce((sum, v) => sum + (v.dealer_stock?.in_transit_qty || 0), 0);
  const totalInTransitSqm = Math.round(product.variants.reduce((sum, v) => sum + (v.dealer_stock?.in_transit_sqm || 0), 0) * 10) / 10;
  const totalHubQty = product.variants.reduce((sum, v) => sum + (v.dealer_stock?.available_hub_qty || 0), 0);

  return (
    <div
      onClick={() => onNavigate('product', product.id)}
      className={`group card relative flex flex-col overflow-visible text-left cursor-pointer ${sizesOpen ? 'z-30' : ''}`}
    >
      <div className="relative aspect-[4/3] overflow-hidden rounded-t-xl bg-slate-100">
        <ProductImage
          src={imageSource}
          alt={product.name}
          loading="lazy"
          decoding="async"
          width={400}
          className="h-full w-full object-cover transition-transform duration-500 ease-apple group-hover:scale-105"
        />
        {hasDealerStock && totalShowroomQty > 0 && (
          <div className="absolute top-2.5 left-2.5 z-10">
            <span className="inline-flex items-center gap-1 rounded-md bg-emerald-600/90 backdrop-blur-sm px-2 py-0.5 text-[11px] font-bold text-white shadow-sm">
              🏪 В наличии: {totalShowroomQty} шт
            </span>
          </div>
        )}
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

        {hasDealerStock && (
          <div className="mt-2.5 flex flex-col gap-1 border-t border-slate-100 pt-2">
            <div className="flex items-center justify-between text-xs">
              <span className="inline-flex items-center gap-1 font-semibold text-emerald-700">
                🏪 В наличии:
              </span>
              <span className="font-bold text-emerald-800">
                {totalShowroomQty} шт <span className="font-normal text-emerald-600">({totalShowroomSqm} м²)</span>
              </span>
            </div>
            {totalInTransitQty > 0 && (
              <div className="flex items-center justify-between text-xs">
                <span className="inline-flex items-center gap-1 font-medium text-indigo-700">
                  🚚 В пути:
                </span>
                <span className="font-semibold text-indigo-800">
                  {totalInTransitQty} шт <span className="font-normal text-indigo-500">({totalInTransitSqm} м²)</span>
                </span>
              </div>
            )}
            <div className="flex items-center justify-between text-xs">
              <span className="inline-flex items-center gap-1 text-slate-500">
                🏢 База Алматы:
              </span>
              <span className="font-medium text-slate-700">
                {totalHubQty} шт
              </span>
            </div>
          </div>
        )}

        <div className="mt-2 border-t border-slate-100 pt-2">
          {user ? (
            <p className="text-sm font-bold text-slate-900">
              ${pricePerSqm % 1 === 0 ? pricePerSqm.toFixed(0) : pricePerSqm.toFixed(2)} / м²
            </p>
          ) : (
            <p className="flex items-center gap-1 text-xs text-slate-400">
              <Lock className="h-3 w-3" />
              Войдите для цен
            </p>
          )}

          <button
            onClick={(event) => {
              event.stopPropagation();
              setSizesOpen(open => !open);
            }}
            className="mt-2 flex items-center gap-2 rounded-full bg-slate-100 px-3.5 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-200"
          >
            <Layers className="h-4 w-4 text-slate-500" />
            {sizeCount} {sizeLabel(sizeCount)}
          </button>
        </div>
      </div>

      {sizesOpen && (
        <div
          className="absolute left-3 right-3 top-full z-40 -mt-1 rounded-lg bg-white p-3 shadow-xl ring-1 ring-slate-200"
          onClick={event => event.stopPropagation()}
        >
          <div className="space-y-2">
            {product.variants.map(variant => {
              const stock = getTotalStock(variant);
              const available = stock > 0;
              const quantity = quantities[variant.sku] ?? 1;
              const isAdded = addedSku === variant.sku;
              const ds = variant.dealer_stock;

              return (
                <div key={variant.sku} className="border-b border-slate-100 pb-2 last:border-b-0 last:pb-0">
                  <div className="grid grid-cols-[1fr_auto_44px_38px] items-center gap-2 text-sm">
                    <span className="font-medium text-slate-700 whitespace-nowrap">{variant.size}</span>
                    <span className={`text-right text-xs font-medium ${available ? 'text-slate-600' : 'text-slate-300'}`}>
                      {available ? stock : '—'}
                    </span>
                    <input
                      type="number"
                      min="1"
                      max={stock || undefined}
                      value={quantity}
                      disabled={!available}
                      onChange={event => setQuantity(variant.sku, Number(event.target.value))}
                      onClick={event => event.stopPropagation()}
                      className="h-8 w-11 rounded border border-slate-300 bg-white px-1 text-center text-sm text-slate-800 outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30 disabled:bg-slate-50 disabled:text-slate-300"
                    />
                    <button
                      onClick={() => handleAdd(variant)}
                      disabled={!available}
                      aria-label={`Добавить размер ${variant.size} в корзину`}
                      className={`flex h-8 w-9 items-center justify-center rounded text-white transition-colors ${
                        isAdded ? 'bg-emerald-600' : available ? 'bg-brand-700 hover:bg-brand-800' : 'cursor-not-allowed bg-slate-200'
                      }`}
                    >
                      {isAdded ? <Check className="h-4 w-4" /> : <ShoppingCart className="h-4 w-4" />}
                    </button>
                  </div>
                  {ds && (
                    <div className="mt-1 flex flex-wrap gap-1 text-[10px]">
                      <span className="inline-flex items-center gap-0.5 rounded bg-emerald-50 px-1.5 py-0.5 font-medium text-emerald-700">
                        🏪 В наличии: {ds.in_showroom_qty} шт ({ds.in_showroom_sqm} м²)
                      </span>
                      {ds.in_transit_qty > 0 && (
                        <span className="inline-flex items-center gap-0.5 rounded bg-indigo-50 px-1.5 py-0.5 font-medium text-indigo-700">
                          🚚 В пути: {ds.in_transit_qty} шт
                        </span>
                      )}
                      <span className="inline-flex items-center gap-0.5 rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-600">
                        🏢 База: {ds.available_hub_qty} шт
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
