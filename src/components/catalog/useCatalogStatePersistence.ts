import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { SortOption, ViewMode } from './types';

export const CATALOG_STATE_STORAGE_KEY = 'synergy:catalog_state_v1';
const TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

export interface CatalogPersistedState {
  searchQuery: string;
  sortBy: SortOption;
  viewMode: ViewMode;
  selectedCategory: 'all' | 'Ковры' | 'Дорожки';
  selectedCollections: string[];
  selectedManufacturers: string[];
  selectedCountries: string[];
  selectedClusters: string[];
  selectedWarehouses: string[];
  selectedSizes: string[];
  visibleCount: number;
  scrollY: number;
  lastViewedProductId?: string | null;
  timestamp: number;
}

export function readCatalogState(): CatalogPersistedState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(CATALOG_STATE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CatalogPersistedState;
    if (!parsed || !parsed.timestamp || Date.now() - parsed.timestamp > TTL_MS) {
      sessionStorage.removeItem(CATALOG_STATE_STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeCatalogState(state: Omit<CatalogPersistedState, 'timestamp'>): void {
  if (typeof window === 'undefined') return;
  try {
    const payload: CatalogPersistedState = {
      ...state,
      timestamp: Date.now(),
    };
    sessionStorage.setItem(CATALOG_STATE_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore storage quota or disabled sessionStorage
  }
}

export function clearCatalogState(): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(CATALOG_STATE_STORAGE_KEY);
  } catch {
    // Ignore
  }
}

export function restoreCatalogScroll(productId?: string | null, scrollY?: number): void {
  if (typeof window === 'undefined') return;

  const attemptScroll = () => {
    let handled = false;
    if (productId) {
      const card = document.querySelector(`[data-product-id="${productId}"]`);
      if (card) {
        card.scrollIntoView({ block: 'center', behavior: 'instant' });
        // Pulse ring highlight for 1.2s to visually orient the returning user
        card.classList.add('ring-2', 'ring-amber-500/80', 'transition-all');
        setTimeout(() => {
          card.classList.remove('ring-2', 'ring-amber-500/80');
        }, 1200);
        handled = true;
      }
    }
    if (!handled && typeof scrollY === 'number' && scrollY > 0) {
      window.scrollTo({ top: scrollY, behavior: 'instant' });
    }
  };

  requestAnimationFrame(() => {
    attemptScroll();
    // Subsequent frame check in case card images/grid took an extra frame to calculate dimensions
    setTimeout(attemptScroll, 60);
  });
}

export interface UseCatalogStatePersistenceOptions {
  initialCollection?: string;
  initialCountry?: string;
  initialSearch?: string;
}

export function useCatalogStatePersistence(options: UseCatalogStatePersistenceOptions = {}) {
  const { initialCollection, initialCountry, initialSearch } = options;

  // Retrieve saved snapshot if not an explicit navigation link (such as banner click or search redirect)
  const savedState = useMemo(() => {
    if (initialCollection || initialCountry || initialSearch) {
      return null;
    }
    return readCatalogState();
  }, [initialCollection, initialCountry, initialSearch]);

  const [viewMode, setViewMode] = useState<ViewMode>(() => savedState?.viewMode || 'grid');
  const [searchQuery, setSearchQuery] = useState<string>(() => initialSearch || savedState?.searchQuery || '');
  const [sortBy, setSortBy] = useState<SortOption>(() => savedState?.sortBy || 'popular');
  const [visibleCount, setVisibleCount] = useState<number>(() => savedState?.visibleCount || 12);
  const [selectedCategory, setSelectedCategory] = useState<'all' | 'Ковры' | 'Дорожки'>(
    () => savedState?.selectedCategory || 'all',
  );

  const [selectedCollections, setSelectedCollections] = useState<Set<string>>(() => {
    if (initialCollection) return new Set([initialCollection]);
    if (savedState?.selectedCollections?.length) return new Set(savedState.selectedCollections);
    return new Set();
  });

  const [selectedManufacturers, setSelectedManufacturers] = useState<Set<string>>(
    () => new Set(savedState?.selectedManufacturers || []),
  );

  const [selectedCountries, setSelectedCountries] = useState<Set<string>>(() => {
    if (initialCountry) return new Set([initialCountry]);
    if (savedState?.selectedCountries?.length) return new Set(savedState.selectedCountries);
    return new Set();
  });

  const [selectedClusters, setSelectedClusters] = useState<Set<string>>(
    () => new Set(savedState?.selectedClusters || []),
  );

  const [selectedWarehouses, setSelectedWarehouses] = useState<Set<string>>(
    () => new Set(savedState?.selectedWarehouses || []),
  );

  const [selectedSizes, setSelectedSizes] = useState<Set<string>>(
    () => new Set(savedState?.selectedSizes || []),
  );

  const [activeClusterQuickFilter, setActiveClusterQuickFilter] = useState<
    'all' | 'small' | 'medium' | 'large' | 'oversize' | 'runner'
  >('all');

  const [adminStockFilter, setAdminStockFilter] = useState<'all' | 'in_stock' | 'out_of_stock'>('all');

  // Track initial mount so visibleCount is not reset to 12 upon restoring previous scroll position
  const isInitialMount = useRef(true);
  const hasRestoredScrollRef = useRef(false);

  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    // Reset to 12 only on subsequent user-initiated filter changes
    setVisibleCount(12);
  }, [
    selectedCategory,
    activeClusterQuickFilter,
    selectedClusters,
    selectedCollections,
    selectedManufacturers,
    selectedCountries,
    selectedWarehouses,
    selectedSizes,
    searchQuery,
    sortBy,
    viewMode,
  ]);

  const toggle = useCallback((set: Set<string>, val: string) => {
    const next = new Set(set);
    if (next.has(val)) next.delete(val);
    else next.add(val);
    return next;
  }, []);

  const activeFilterCount =
    (selectedCategory !== 'all' ? 1 : 0) +
    (activeClusterQuickFilter !== 'all' ? 1 : 0) +
    selectedCollections.size +
    selectedManufacturers.size +
    selectedCountries.size +
    selectedWarehouses.size +
    selectedSizes.size +
    selectedClusters.size;

  const resetFilters = useCallback(() => {
    setSearchQuery('');
    setSelectedCategory('all');
    setSelectedClusters(new Set());
    setSelectedCollections(new Set());
    setSelectedManufacturers(new Set());
    setSelectedCountries(new Set());
    setSelectedWarehouses(new Set());
    setSelectedSizes(new Set());
    setVisibleCount(12);
    clearCatalogState();
  }, []);

  const saveCatalogSnapshot = useCallback((productId?: string | null) => {
    writeCatalogState({
      searchQuery,
      sortBy,
      viewMode,
      selectedCategory,
      selectedCollections: Array.from(selectedCollections),
      selectedManufacturers: Array.from(selectedManufacturers),
      selectedCountries: Array.from(selectedCountries),
      selectedClusters: Array.from(selectedClusters),
      selectedWarehouses: Array.from(selectedWarehouses),
      selectedSizes: Array.from(selectedSizes),
      visibleCount,
      scrollY: typeof window !== 'undefined' ? window.scrollY : 0,
      lastViewedProductId: productId || null,
    });
  }, [
    searchQuery,
    sortBy,
    viewMode,
    selectedCategory,
    selectedCollections,
    selectedManufacturers,
    selectedCountries,
    selectedClusters,
    selectedWarehouses,
    selectedSizes,
    visibleCount,
  ]);

  const attemptScrollRestoration = useCallback((isReady: boolean) => {
    if (!isReady || hasRestoredScrollRef.current) return;
    if (savedState?.lastViewedProductId || (savedState?.scrollY && savedState.scrollY > 0)) {
      hasRestoredScrollRef.current = true;
      restoreCatalogScroll(savedState.lastViewedProductId, savedState.scrollY);
    }
  }, [savedState]);

  return {
    viewMode,
    setViewMode,
    searchQuery,
    setSearchQuery,
    sortBy,
    setSortBy,
    visibleCount,
    setVisibleCount,
    selectedCategory,
    setSelectedCategory,
    selectedCollections,
    setSelectedCollections,
    selectedManufacturers,
    setSelectedManufacturers,
    selectedCountries,
    setSelectedCountries,
    selectedClusters,
    setSelectedClusters,
    selectedWarehouses,
    setSelectedWarehouses,
    selectedSizes,
    setSelectedSizes,
    activeClusterQuickFilter,
    setActiveClusterQuickFilter,
    adminStockFilter,
    setAdminStockFilter,
    toggle,
    activeFilterCount,
    resetFilters,
    saveCatalogSnapshot,
    attemptScrollRestoration,
    hasSavedState: Boolean(savedState),
  };
}
