import { useAuth } from '@/contexts/AuthContext';
import type { Product } from '@/types';
import { parseSizeDimensions } from '@/types';

export function useUserPricing() {
  const { profile } = useAuth();
  const priceType = profile?.price_type ?? 'retail';

  function getVariantPrice(_collection: string, size: string, baseFallback: number, variantPerSqm?: number): number {
    if (baseFallback && baseFallback > 0) {
      return baseFallback;
    }
    if (variantPerSqm && variantPerSqm > 0) {
      const { w, h } = parseSizeDimensions(size);
      const area = w * h;
      if (area > 0) return Math.round(variantPerSqm * area * 100) / 100;
    }
    return baseFallback || 0;
  }

  function getPricePerSqm(_collection: string, size: string, baseFallback: number, variantPerSqm?: number): number {
    if (variantPerSqm && variantPerSqm > 0) return variantPerSqm;
    const { w, h } = parseSizeDimensions(size);
    const area = w * h;
    if (area > 0 && baseFallback > 0) return Math.round((baseFallback / area) * 100) / 100;
    return baseFallback || 0;
  }

  function getMinPricePerSqm(product: Product): number {
    if (product.price_per_sqm && product.price_per_sqm > 0) return product.price_per_sqm;
    const variantPerSqm = product.variants.find(v => (v.price_per_sqm ?? 0) > 0)?.price_per_sqm;
    if (variantPerSqm && variantPerSqm > 0) return variantPerSqm;
    if (product.variants.length === 0) return 0;
    const first = product.variants[0];
    if (first.price && first.area_sqm && first.area_sqm > 0) {
      return Math.round((first.price / first.area_sqm) * 100) / 100;
    }
    const { w, h } = parseSizeDimensions(first.size);
    const area = w * h;
    return area > 0 ? Math.round((first.base_price / area) * 100) / 100 : first.base_price;
  }

  return { priceType, getVariantPrice, getPricePerSqm, getMinPricePerSqm };
}
