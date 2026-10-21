import { useMemo } from 'react';
import type { Product, Warehouse } from '@/types';
import { sizeArea } from './types';
import { filterWarehousesForClient } from '@/lib/warehouseVisibility';

export interface UseSmartFacetsParams {
  baseProducts: Product[];
  erpWarehouses?: Warehouse[];
  selectedCategory: 'all' | 'Ковры' | 'Дорожки';
  activeClusterQuickFilter: string;
  selectedClusters: Set<string>;
  selectedCollections: Set<string>;
  selectedManufacturers: Set<string>;
  selectedCountries: Set<string>;
  selectedWarehouses: Set<string>;
  selectedSizes: Set<string>;
  priceMin?: number | null;
  priceMax?: number | null;
  getProductPriceSqm?: (p: Product) => number;
  isEffectiveAdmin: boolean;
  profile: any;
  myShowroomName: string;
}

function matchesSet(set: Set<string> | undefined, val: string | undefined): boolean {
  if (!set || set.size === 0) return true;
  if (!val) return false;
  if (set.has(val)) return true;
  const trimmed = val.trim();
  if (set.has(trimmed)) return true;
  const lower = trimmed.toLowerCase();
  for (const item of set) {
    if (item.trim().toLowerCase() === lower) return true;
  }
  return false;
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
    priceMin?: number | null;
    priceMax?: number | null;
    getProductPriceSqm?: (p: Product) => number;
    hasAnyCatalogStock?: boolean;
  }
): boolean {
  if (opts.category && opts.category !== 'all') {
    const isCat =
      (p.category && p.category.toLowerCase() === opts.category.toLowerCase()) ||
      (opts.category === 'Дорожки' ? p.name.toLowerCase().includes('дорожк') : !p.name.toLowerCase().includes('дорожк'));
    if (!isCat) return false;
  }

  if ((opts.priceMin != null || opts.priceMax != null) && opts.getProductPriceSqm) {
    const pPrice = opts.getProductPriceSqm(p);
    if (opts.priceMin != null && pPrice < opts.priceMin) return false;
    if (opts.priceMax != null && pPrice > opts.priceMax) return false;
  }

  if (opts.clusterQuick && opts.clusterQuick !== 'all') {
    if (opts.clusterQuick === 'runner') {
      if (!p.variants.some(v => v.is_runner)) return false;
    } else {
      if (!p.variants.some(v => v.size_cluster === opts.clusterQuick)) return false;
    }
  }

  if (opts.clusters && opts.clusters.size > 0) {
    if (!p.variants.some(v => v.size_cluster && matchesSet(opts.clusters, v.size_cluster))) return false;
  }

  if (opts.collections && opts.collections.size > 0) {
    if (!matchesSet(opts.collections, p.collection)) return false;
  }

  if (opts.manufacturers && opts.manufacturers.size > 0) {
    if (!matchesSet(opts.manufacturers, p.manufacturer)) return false;
  }

  if (opts.countries && opts.countries.size > 0) {
    if (!matchesSet(opts.countries, p.country)) return false;
  }

  if (opts.warehouses && opts.warehouses.size > 0 && opts.hasAnyCatalogStock !== false) {
    const hasWh = p.variants.some(v =>
      v.warehouses.some(w => matchesSet(opts.warehouses, w.warehouse_name || w.city) && ((w.stock || 0) > 0 || (w.free_stock || 0) > 0))
    );
    if (!hasWh) return false;
  }

  if (opts.sizes && opts.sizes.size > 0) {
    if (!p.variants.some(v => v.size && matchesSet(opts.sizes, v.size))) return false;
  }

  return true;
}

export function useSmartFacets({
  baseProducts,
  erpWarehouses = [],
  selectedCategory,
  activeClusterQuickFilter,
  selectedClusters,
  selectedCollections,
  selectedManufacturers,
  selectedCountries,
  selectedWarehouses,
  selectedSizes,
  priceMin,
  priceMax,
  getProductPriceSqm,
  isEffectiveAdmin,
  profile,
  myShowroomName,
}: UseSmartFacetsParams) {
  const hasAnyCatalogStock = useMemo(
    () =>
      baseProducts.some(p =>
        p.variants.some(v => (v.free_stock || 0) > 0 || (v.stock || 0) > 0 || (v.warehouses || []).some(w => (w.stock || 0) > 0 || (w.free_stock || 0) > 0))
      ),
    [baseProducts]
  );

  // 1. Available Collections (filtered by all other active facets, including priceMin/priceMax!)
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
        priceMin,
        priceMax,
        getProductPriceSqm,
        hasAnyCatalogStock,
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
    priceMin,
    priceMax,
    getProductPriceSqm,
    hasAnyCatalogStock,
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
        priceMin,
        priceMax,
        getProductPriceSqm,
        hasAnyCatalogStock,
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
    priceMin,
    priceMax,
    getProductPriceSqm,
    hasAnyCatalogStock,
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
        priceMin,
        priceMax,
        getProductPriceSqm,
        hasAnyCatalogStock,
      })
    );
    const set = new Set<string>();
    for (const p of matching) {
      for (const v of p.variants) {
        if (v.size) {
          if (!hasAnyCatalogStock) {
            set.add(v.size);
            continue;
          }
          const whs = selectedWarehouses.size > 0
            ? (v.warehouses || []).filter(w => matchesSet(selectedWarehouses, w.warehouse_name || w.city))
            : (v.warehouses || []).filter(w => w.warehouse_id === 81 || w.is_hub || (w.warehouse_name || '').includes('Астана'));
          const hasStock =
            whs.some(w => (w.stock || 0) > 0 || (w.free_stock || 0) > 0) ||
            (selectedWarehouses.size === 0 && (v.in_production_qty ?? 0) > 0);
          if (hasStock) set.add(v.size);
        }
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
    priceMin,
    priceMax,
    getProductPriceSqm,
    hasAnyCatalogStock,
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
        priceMin,
        priceMax,
        getProductPriceSqm,
        hasAnyCatalogStock,
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
    priceMin,
    priceMax,
    getProductPriceSqm,
    hasAnyCatalogStock,
  ]);

  // 5. Available Warehouses (Основной Склад Астана всегда первым)
  const allWarehouses = useMemo(() => {
    const sortHubFirst = (arr: string[]) =>
      arr.sort((a, b) => {
        const aHub = a === 'Основной Склад Астана' || a.includes('Астана');
        const bHub = b === 'Основной Склад Астана' || b.includes('Астана');
        if (aHub && !bHub) return -1;
        if (!aHub && bHub) return 1;
        return a.localeCompare(b, 'ru');
      });

    const matching = baseProducts.filter(p =>
      productMatches(p, {
        category: selectedCategory,
        clusterQuick: activeClusterQuickFilter,
        clusters: selectedClusters,
        collections: selectedCollections,
        manufacturers: selectedManufacturers,
        countries: selectedCountries,
        sizes: selectedSizes,
        priceMin,
        priceMax,
        getProductPriceSqm,
        hasAnyCatalogStock,
      })
    );

    if (isEffectiveAdmin || !hasAnyCatalogStock || !profile || profile.role !== 'client') {
      const set = new Set<string>();
      for (const w of erpWarehouses) {
        const name = w.warehouse_name || w.city;
        if (name) set.add(name);
      }
      for (const p of matching) {
        for (const v of p.variants) {
          for (const w of v.warehouses) {
            const name = w.warehouse_name || w.city;
            if (name) set.add(name);
          }
        }
      }
      for (const w of selectedWarehouses) set.add(w);
      const list = sortHubFirst(Array.from(set));
      return list.length > 0 ? list : ['Основной Склад Астана'];
    }

    const uniqueRawWarehouses: Warehouse[] = [];
    const seenKeys = new Set<string>();
    for (const w of erpWarehouses) {
      const key = `${w.warehouse_id}::${w.warehouse_name || w.city}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        uniqueRawWarehouses.push(w);
      }
    }
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
    const names = sortHubFirst(Array.from(set));
    return names.length > 0 ? names : ['Основной Склад Астана'];
  }, [
    baseProducts,
    erpWarehouses,
    hasAnyCatalogStock,
    selectedCategory,
    activeClusterQuickFilter,
    selectedClusters,
    selectedCollections,
    selectedManufacturers,
    selectedCountries,
    selectedSizes,
    selectedWarehouses,
    priceMin,
    priceMax,
    getProductPriceSqm,
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
