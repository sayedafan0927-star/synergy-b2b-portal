import { useAuth } from '@/contexts/AuthContext';
import type { Product } from '@/types';
import { parseSizeDimensions } from '@/types';
import { getPricingTier, calculateContractPrice, type ContractPricingTier, type CalculatedPrice } from '@/lib/pricingEngine';

export function useUserPricing() {
  const { profile } = useAuth();
  const priceType = profile?.price_type ?? 'retail';
  const tier: ContractPricingTier = getPricingTier(priceType);

  function getVariantPrice(_collection: string, size: string, baseFallback: number, variantPerSqm?: number): number {
    let rawBase = baseFallback;
    if ((!rawBase || rawBase <= 0) && variantPerSqm && variantPerSqm > 0) {
      const { w, h } = parseSizeDimensions(size);
      const area = w * h;
      if (area > 0) rawBase = Math.round(variantPerSqm * area * 100) / 100;
    }
    const safeBase = rawBase > 0 ? rawBase : 0;
    return calculateContractPrice(safeBase, priceType).finalPrice;
  }

  function getPricePerSqm(_collection: string, size: string, baseFallback: number, variantPerSqm?: number): number {
    let rawSqm = variantPerSqm;
    if ((!rawSqm || rawSqm <= 0) && baseFallback > 0) {
      const { w, h } = parseSizeDimensions(size);
      const area = w * h;
      if (area > 0) rawSqm = Math.round((baseFallback / area) * 100) / 100;
    }
    const safeSqm = rawSqm && rawSqm > 0 ? rawSqm : (baseFallback || 0);
    return calculateContractPrice(safeSqm, priceType).finalPrice;
  }

  function getMinPricePerSqm(product: Product): number {
    let baseSqm = 0;
    if (product.price_per_sqm && product.price_per_sqm > 0) {
      baseSqm = product.price_per_sqm;
    } else {
      const variantPerSqm = product.variants.find(v => (v.price_per_sqm ?? 0) > 0)?.price_per_sqm;
      if (variantPerSqm && variantPerSqm > 0) {
        baseSqm = variantPerSqm;
      } else if (product.variants.length > 0) {
        const first = product.variants[0];
        if (first.price && first.area_sqm && first.area_sqm > 0) {
          baseSqm = Math.round((first.price / first.area_sqm) * 100) / 100;
        } else {
          const { w, h } = parseSizeDimensions(first.size);
          const area = w * h;
          baseSqm = area > 0 ? Math.round((first.base_price / area) * 100) / 100 : first.base_price;
        }
      }
    }
    return calculateContractPrice(baseSqm, priceType).finalPrice;
  }

  function getContractCalculation(basePrice: number): CalculatedPrice {
    return calculateContractPrice(basePrice, priceType);
  }

  return {
    priceType,
    tier,
    hasContractDiscount: tier.discountPercent > 0,
    discountPercent: tier.discountPercent,
    getVariantPrice,
    getPricePerSqm,
    getMinPricePerSqm,
    getContractCalculation,
  };
}
