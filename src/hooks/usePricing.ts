import { useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useCollectionPrices } from '@/hooks/useProductData';
import type { Product, CollectionPrice } from '@/types';
import { parseSizeDimensions } from '@/types';

export function useUserPricing() {
  const { profile } = useAuth();
  const allPrices = useCollectionPrices();

  const priceType = profile?.price_type ?? 'retail';

  const priceMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const cp of allPrices) {
      if (cp.price_type_id === priceType) {
        map.set(cp.collection, cp.price_per_sqm);
      }
    }
    return map;
  }, [allPrices, priceType]);

  function getVariantPrice(collection: string, size: string, baseFallback: number, variantPerSqm?: number): number {
    if (baseFallback && baseFallback > 0) {
      return baseFallback;
    }
    const perSqm = (variantPerSqm && variantPerSqm > 0 ? variantPerSqm : undefined) ?? priceMap.get(collection);
    if (perSqm !== undefined) {
      const { w, h } = parseSizeDimensions(size);
      const area = w * h;
      if (area > 0) return Math.round(perSqm * area * 100) / 100;
    }
    return baseFallback;
  }

  function getPricePerSqm(collection: string, size: string, baseFallback: number, variantPerSqm?: number): number {
    if (variantPerSqm && variantPerSqm > 0) return variantPerSqm;
    const perSqm = priceMap.get(collection);
    if (perSqm !== undefined) return perSqm;
    const { w, h } = parseSizeDimensions(size);
    const area = w * h;
    if (area > 0 && baseFallback > 0) return Math.round((baseFallback / area) * 100) / 100;
    return baseFallback;
  }

  function getMinPricePerSqm(product: Product): number {
    if (product.price_per_sqm && product.price_per_sqm > 0) return product.price_per_sqm;
    const variantPerSqm = product.variants.find(v => (v.price_per_sqm ?? 0) > 0)?.price_per_sqm;
    if (variantPerSqm && variantPerSqm > 0) return variantPerSqm;
    const perSqm = priceMap.get(product.collection);
    if (perSqm !== undefined && perSqm > 0) return perSqm;
    if (product.variants.length === 0) return 0;
    const first = product.variants[0];
    const { w, h } = parseSizeDimensions(first.size);
    const area = w * h;
    return area > 0 ? Math.round((first.base_price / area) * 100) / 100 : first.base_price;
  }

  return { priceType, getVariantPrice, getPricePerSqm, getMinPricePerSqm };
}
