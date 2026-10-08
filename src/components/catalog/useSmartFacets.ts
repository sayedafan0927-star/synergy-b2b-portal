import { useMemo } from 'react';
import type { Product, Warehouse } from '@/types';
import { sizeArea } from './types';
import { filterWarehousesForClient } from '@/lib/warehouseVisibility';

export interface UseSmartFacetsParams {
  baseProducts: Product[];
  selectedCategory: 'all' | 'Ковры' | 'Дорожки';
  activeClusterQuickFilter: string;
  selectedClusters: Set<string>;
  selectedCollections: Set<string>;
  selectedManufacturers: Set<string>;
  selectedCountries: Set<string>;
  selectedWarehouses: Set<string>;
  selectedSizes: Set<string>;
  isEffectiveAdmin: boolean;
  profile: any;
  myShowroomName: string;
}

function productMatches(
  p: Product,
  opts: {
    category?: 'all' | 'Ковры' | 'Дорожки';
    clusterQuick?: string;
    clusters?: Set<string>;
    collections?: Set<string>;
    manufacturers?: Set<string>;
    countries?: Set<string>;
    warehouses?: Set<string>;
    sizes?: Set<string>;
  }
): boolean {
  if (opts.category && opts.category !== 'all') {
    const isCat =
      (p.category && p.category.toLowerCase() === opts.category.toLowerCase()) ||
      (opts.category === 'Дорожки' ? p.name.toLowerCase().includes('дорожк') : !p.name.toLowerCase().includes('дорожк'));
    if (!isCat) return false;
  }

  if (opts.clusterQuick && opts.clusterQuick !== 'all') {
    if (opts.clusterQuick === 'runner') {
      if (!p.variants.some(v => v.is_runner)) return false;
    } else {
      if (!p.variants.some(v => v.size_cluster === opts.clusterQuick)) return false;
    }
  }

  if (opts.clusters && opts.clusters.size > 0) {
    if (!p.variants.some(v => v.size_cluster && opts.clusters!.has(v.size_cluster))) return false;
  }

  if (opts.collections && opts.collections.size > 0) {
    if (!opts.collections.has(p.collection)) return false;
  }

  if (opts.manufacturers && opts.manufacturers.size > 0) {
    if (!opts.manufacturers.has(p.manufacturer)) return false;
  }

  if (opts.countries && opts.countries.size > 0) {
    if (!opts.countries.has(p.country)) return false;
  }

  if (opts.warehouses && opts.warehouses.size > 0) {
    const hasWh = p.variants.some(v =>
      v.warehouses.some(w => opts.warehouses!.has(w.warehouse_name || w.city) && w.stock > 0)
    );
    if (!hasWh) return false;
  }

  if (opts.sizes && opts.sizes.size > 0) {
    if (!p.variants.some(v => opts.sizes!.has(v.size))) return false;
  }

  return true;
}

export function useSmartFacets({
  baseProducts,
  selectedCategory,
  activeClusterQuickFilter,
  selectedClusters,
  selectedCollections,
  selectedManufacturers,
  selectedCountries,
  selectedWarehouses,
  selectedSizes,
  isEffectiveAdmin,
  profile,
  myShowroomName,
}: UseSmartFacetsParams) {
  // 1. Available Collections (filtered by all other active facets)
  const allCollections = useMemo(() => {
    const matching = baseProducts.filter(p =>
      productMatches(p, {
        category: selectedCategory,
        clusterQuick: activeClusterQuickFilter,
        clusters: selectedClusters,
        manufacturers: selectedManufacturers,
        countries: selectedCountries,
        warehouses: selectedWarehouses,
        sizes: selectedSizes,
      })
    );
    const set = new Set<string>();
    for (const p of matching) {
      if (p.collection) set.add(p.collection);
    }
    for (const c of selectedCollections) {
      set.add(c);
    }
    return Array.from(set).sort();
  }, [
    baseProducts,
    selectedCategory,
    activeClusterQuickFilter,
    selectedClusters,
    selectedManufacturers,
    selectedCountries,
    selectedWarehouses,
    selectedSizes,
    selectedCollections,
  ]);

  // 2. Available Countries (filtered by all other active facets, e.g. collection or size)
  const allCountries = useMemo(() => {
    const matching = baseProducts.filter(p =>
      productMatches(p, {
        category: selectedCategory,
        clusterQuick: activeClusterQuickFilter,
        clusters: selectedClusters,
        collections: selectedCollections,
        manufacturers: selectedManufacturers,
        warehouses: selectedWarehouses,
        sizes: selectedSizes,
      })
    );
    const set = new Set<string>();
    for (const p of matching) {
      if (p.country) set.add(p.country);
    }
    for (const c of selectedCountries) {
      set.add(c);
    }
    return Array.from(set).sort();
  }, [
    baseProducts,
    selectedCategory,
    activeClusterQuickFilter,
    selectedClusters,
    selectedCollections,
    selectedManufacturers,
    selectedWarehouses,
    selectedSizes,
    selectedCountries,
  ]);

  // 3. Available Sizes (filtered by collection, country, category, etc.)
  const allSizes = useMemo(() => {
    const matching = baseProducts.filter(p =>
      productMatches(p, {
        category: selectedCategory,
        clusterQuick: activeClusterQuickFilter,
        clusters: selectedClusters,
        collections: selectedCollections,
        manufacturers: selectedManufacturers,
        countries: selectedCountries,
        warehouses: selectedWarehouses,
      })
    );
    const set = new Set<string>();
    for (const p of matching) {
      for (const v of p.variants) {
        if (v.size) set.add(v.size);
      }
    }
    for (const s of selectedSizes) {
      set.add(s);
    }
    return Array.from(set).sort((a, b) => sizeArea(a) - sizeArea(b));
  }, [
    baseProducts,
    selectedCategory,
    activeClusterQuickFilter,
    selectedClusters,
    selectedCollections,
    selectedManufacturers,
    selectedCountries,
    selectedWarehouses,
    selectedSizes,
  ]);

  // 4. Available Manufacturers
  const allManufacturers = useMemo(() => {
    const matching = baseProducts.filter(p =>
      productMatches(p, {
        category: selectedCategory,
        clusterQuick: activeClusterQuickFilter,
        clusters: selectedClusters,
        collections: selectedCollections,
        countries: selectedCountries,
        warehouses: selectedWarehouses,
        sizes: selectedSizes,
      })
    );
    const set = new Set<string>();
    for (const p of matching) {
      if (p.manufacturer) set.add(p.manufacturer);
    }
    for (const m of selectedManufacturers) {
      set.add(m);
    }
    return Array.from(set).sort();
  }, [
    baseProducts,
    selectedCategory,
    activeClusterQuickFilter,
    selectedClusters,
    selectedCollections,
    selectedCountries,
    selectedWarehouses,
    selectedSizes,
    selectedManufacturers,
  ]);

  // 5. Available Warehouses
  const allWarehouses = useMemo(() => {
    const matching = baseProducts.filter(p =>
      productMatches(p, {
        category: selectedCategory,
        clusterQuick: activeClusterQuickFilter,
        clusters: selectedClusters,
        collections: selectedCollections,
        manufacturers: selectedManufacturers,
        countries: selectedCountries,
        sizes: selectedSizes,
      })
    );

    if (isEffectiveAdmin) {
      const set = new Set<string>();
      for (const p of matching) {
        for (const v of p.variants) {
          for (const w of v.warehouses) {
            const name = w.warehouse_name || w.city;
            if (name) set.add(name);
          }
        }
      }
      for (const w of selectedWarehouses) set.add(w);
      return Array.from(set).sort();
    }

    const uniqueRawWarehouses: Warehouse[] = [];
    const seenKeys = new Set<string>();
    for (const p of matching) {
      for (const v of p.variants) {
        for (const w of v.warehouses) {
          const key = `${w.warehouse_id}::${w.warehouse_name || w.city}`;
          if (!seenKeys.has(key)) {
            seenKeys.add(key);
            uniqueRawWarehouses.push(w);
          }
        }
      }
    }
    const visible = filterWarehousesForClient(uniqueRawWarehouses, profile, myShowroomName);
    const set = new Set<string>(visible.map(w => w.warehouse_name || w.city).filter(Boolean));
    for (const w of selectedWarehouses) set.add(w);
    const names = Array.from(set).sort();
    return names.length > 0 ? names : ['Основной Склад Астана'];
  }, [
    baseProducts,
    selectedCategory,
    activeClusterQuickFilter,
    selectedClusters,
    selectedCollections,
    selectedManufacturers,
    selectedCountries,
    selectedSizes,
    selectedWarehouses,
    isEffectiveAdmin,
    profile,
    myShowroomName,
  ]);

  return {
    allCollections,
    allCountries,
    allSizes,
    allManufacturers,
    allWarehouses,
  };
}
