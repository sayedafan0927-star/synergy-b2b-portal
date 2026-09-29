import type { Product } from '@/types';
import { parseSizeDimensions } from '@/types';

export type SortOption = 'popular' | 'price-asc' | 'price-desc' | 'name';
export type ViewMode = 'grid' | 'stock';

export function getTotalStock(p: Product): number {
  return p.variants.reduce((s, v) => s + v.warehouses.reduce((a, w) => a + w.stock, 0), 0);
}

export function pluralProducts(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return `${n} товар`;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return `${n} товара`;
  return `${n} товаров`;
}

export function sizeArea(size: string): number {
  const { w, h } = parseSizeDimensions(size);
  return w * h;
}

export interface FilterDrawerProps {
  open: boolean;
  onClose: () => void;
  searchQuery: string;
  setSearchQuery: (v: string) => void;
  selectedCollections: Set<string>;
  toggleCollection: (v: string) => void;
  selectedManufacturers: Set<string>;
  toggleManufacturer: (v: string) => void;
  selectedCountries: Set<string>;
  toggleCountry: (v: string) => void;
  selectedWarehouses: Set<string>;
  toggleWarehouse: (v: string) => void;
  selectedSizes: Set<string>;
  toggleSize: (v: string) => void;
  selectedClusters: Set<string>;
  toggleCluster: (v: string) => void;
  activeFilterCount: number;
  resetFilters: () => void;
  allCollections: string[];
  allManufacturers: string[];
  allCountries: string[];
  allWarehouses: string[];
  allSizes: string[];
}
