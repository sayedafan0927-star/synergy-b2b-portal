import { useState, useMemo, useEffect, useRef } from 'react';
import {
  Search,
  SlidersHorizontal,
  ChevronDown,
  X,
  LayoutGrid,
  Table2,
  Globe,
} from 'lucide-react';
import type { PageId, Warehouse, StockSummary, Product } from '@/types';
import { useProducts } from '@/hooks/useProductData';
import { useUserPricing } from '@/hooks/usePricing';
import ProductCard from '@/components/ProductCard';
import StockSummaryBar from '@/components/StockSummaryBar';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useDisplaySettings } from '@/hooks/useDisplaySettings';
import { filterWarehousesForClient, isProductInStockForUser, getClientWarehouseSettings } from '@/lib/warehouseVisibility';
import {
  FilterDrawer,
  CatalogFilterSidebar,
  CatalogStockTable,
  CatalogLoadingSkeleton,
  CatalogLoadError,
  StockReservationsModal,
  ActiveFilterChips,
  useCatalogStatePersistence,
  DecklePaperWrapper,
  CatalogPetroglyphHero,
  getTotalStock,
  sizeArea,
  type SortOption,
  type ViewMode,
} from '@/components/catalog';
import { tokenizeSearchQuery, matchesSearchTokens } from '@/lib/searchNormalization';

export default function CatalogPage({
  onNavigate,
  initialCollection,
  initialCountry,
  initialSearch,
}: {
  onNavigate: (page: PageId, productId?: string) => void;
  initialCollection?: string;
  initialCountry?: string;
  initialSearch?: string;
}) {
  const { t } = useLanguage();
  const { products, summary: serverSummary, loading, error: loadError } = useProducts();
  const pricing = useUserPricing();
  const { profile, isAdmin, isImpersonating } = useAuth();
  const isEffectiveAdmin = isAdmin && !isImpersonating;
  const { settings: displaySettings } = useDisplaySettings();
  const myShowroomName = profile?.showroom_warehouse_name || 'В моем магазине';

  const {
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
    adminStockFilter,
    setAdminStockFilter,
    toggle,
    activeFilterCount,
    resetFilters,
    saveCatalogSnapshot,
    attemptScrollRestoration,
    hasSavedState,
  } = useCatalogStatePersistence({ initialCollection, initialCountry, initialSearch });

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [reservationsModalOpen, setReservationsModalOpen] = useState(false);
  const [stockWarehouse, setStockWarehouse] = useState('');
  const canViewStockSummary = useMemo(() => {
    if (isEffectiveAdmin) return true;
    if (displaySettings.show_reserve) return true;
    const key = profile?.partner_id || profile?.id;
    return Boolean(key && getClientWarehouseSettings(key)?.showStockSummary);
  }, [isEffectiveAdmin, displaySettings.show_reserve, profile?.partner_id, profile?.id]);
  const hideOutOfStockSetting = displaySettings.hide_out_of_stock_products !== false;

  const baseProducts = useMemo(() => {
    if (isEffectiveAdmin) {
      if (adminStockFilter === 'in_stock') {
        return products.filter(p => isProductInStockForUser(p, profile, false, true));
      }
      if (adminStockFilter === 'out_of_stock') {
        return products.filter(p => !isProductInStockForUser(p, profile, false, true));
      }
      return products;
    }
    // Для клиента: фильтруем товары с нулевым остатком
    return products.filter(p => isProductInStockForUser(p, profile, false, hideOutOfStockSetting));
  }, [products, isEffectiveAdmin, adminStockFilter, profile, hideOutOfStockSetting]);

  const allCollections = useMemo(() => [...new Set(baseProducts.map(p => p.collection))].sort(), [baseProducts]);
  const allManufacturers = useMemo(() => [...new Set(baseProducts.map(p => p.manufacturer))].sort(), [baseProducts]);
  const allCountries = useMemo(() => [...new Set(baseProducts.map(p => p.country))].sort(), [baseProducts]);
  const allWarehouses = useMemo(() => {
    if (isEffectiveAdmin) {
      return [...new Set(baseProducts.flatMap(p => p.variants.flatMap(v => v.warehouses.map(w => w.warehouse_name || w.city))))].sort();
    }
    const uniqueRawWarehouses: Warehouse[] = [];
    const seenKeys = new Set<string>();
    for (const p of baseProducts) {
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
    const names = [...new Set(visible.map(w => w.warehouse_name || w.city))].filter(Boolean);
    return names.length > 0 ? names.sort() : ['Основной Склад Астана'];
  }, [baseProducts, isEffectiveAdmin, profile, myShowroomName]);
  const allSizes = useMemo(
    () => [...new Set(baseProducts.flatMap(p => p.variants.map(v => v.size)))].sort((a, b) => sizeArea(a) - sizeArea(b)),
    [baseProducts],
  );

  useEffect(() => {
    if (!stockWarehouse && allWarehouses.length > 0) setStockWarehouse(allWarehouses[0]);
  }, [allWarehouses, stockWarehouse]);


  const filteredProducts = useMemo(() => {
    let result = [...baseProducts];

    if (selectedCategory !== 'all') {
      result = result.filter(
        p =>
          (p.category && p.category.toLowerCase() === selectedCategory.toLowerCase()) ||
          (selectedCategory === 'Дорожки' ? p.name.toLowerCase().includes('дорожк') : !p.name.toLowerCase().includes('дорожк')),
      );
    }

    // RugsUSA Pattern 3: Size Clustering Engine
    if (activeClusterQuickFilter !== 'all') {
      if (activeClusterQuickFilter === 'runner') {
        result = result.filter(p => p.variants.some(v => v.is_runner));
      } else {
        result = result.filter(p => p.variants.some(v => v.size_cluster === activeClusterQuickFilter));
      }
    }
    if (selectedClusters.size > 0) {
      result = result.filter(p => p.variants.some(v => v.size_cluster && selectedClusters.has(v.size_cluster)));
    }

    if (selectedCollections.size > 0) result = result.filter(p => selectedCollections.has(p.collection));
    if (selectedManufacturers.size > 0) result = result.filter(p => selectedManufacturers.has(p.manufacturer));
    if (selectedCountries.size > 0) result = result.filter(p => selectedCountries.has(p.country));
    if (selectedWarehouses.size > 0)
      result = result.filter(p =>
        p.variants.some(v => v.warehouses.some(w => selectedWarehouses.has(w.warehouse_name || w.city) && w.stock > 0)),
      );
    if (selectedSizes.size > 0) result = result.filter(p => p.variants.some(v => selectedSizes.has(v.size)));

    // Sub-10ms Homoglyph, Dimension & Layout Normalized Search
    if (searchQuery.trim()) {
      const tokens = tokenizeSearchQuery(searchQuery);
      result = result.filter(p => {
        const searchable =
          `${p.name} ${p.collection} ${p.manufacturer} ${p.country || ''} ${p.article || ''} ${p.color || ''} ${p.variants
            .map(v => `${v.size} ${v.article || ''} ${v.sku || ''} ${v.barcode || ''} ${v.code || ''}`)
            .join(' ')}`;
        return matchesSearchTokens(searchable, tokens);
      });
    }

    switch (sortBy) {
      case 'popular': {
        const stockMap = new Map<string, number>();
        const priorityMap = new Map<string, number>();

        for (let i = 0; i < result.length; i++) {
          const p = result[i];
          stockMap.set(p.id, getTotalStock(p));

          const art = (p.article || '').toUpperCase();
          const col = (p.collection || '').toUpperCase();
          const color = (p.color || '').toUpperCase();
          let pr = 0;
          if (col.includes('FLORA') && (art.includes('9568B') || art.includes('9568-B'))) pr = 100;
          else if (col.includes('AFGAN') && (art.includes('123') || color.includes('CREAM'))) pr = 90;
          else if (col.includes('HYPNOSE') && (art.includes('P1010') || art.includes('1010'))) pr = 80;
          else if (col.includes('OCTAVIA') && (art.includes('75488') || color.includes('071'))) pr = 70;
          else if (col.includes('FLORA') && (art.includes('9568G') || (art.includes('9114G') && color.includes('GREY')))) pr = 60;
          priorityMap.set(p.id, pr);
        }

        result.sort((a, b) => {
          const diffPriority = (priorityMap.get(b.id) || 0) - (priorityMap.get(a.id) || 0);
          if (diffPriority !== 0) return diffPriority;
          return (stockMap.get(b.id) || 0) - (stockMap.get(a.id) || 0);
        });
        break;
      }
      case 'price-asc':
        result.sort((a, b) => pricing.getMinPricePerSqm(a) - pricing.getMinPricePerSqm(b));
        break;
      case 'price-desc':
        result.sort((a, b) => pricing.getMinPricePerSqm(b) - pricing.getMinPricePerSqm(a));
        break;
      case 'name':
        result.sort((a, b) => a.name.localeCompare(b.name));
        break;
    }
    return result;
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
    searchQuery,
    sortBy,
    pricing,
  ]);

  const currentSummary: StockSummary = useMemo(() => {
    const isFiltered =
      activeFilterCount > 0 ||
      searchQuery.trim().length > 0 ||
      selectedCategory !== 'all' ||
      selectedCollections.size > 0 ||
      selectedCountries.size > 0;
    if (!isFiltered && serverSummary) {
      return serverSummary;
    }

    let freeQty = 0;
    let freeSqm = 0;
    let reservedQty = 0;
    let reservedSqm = 0;
    let toShipQty = 0;
    let toShipSqm = 0;
    let totalQty = 0;
    let totalSqm = 0;

    for (const p of filteredProducts) {
      for (const v of p.variants) {
        const area = v.area_sqm || sizeArea(v.size) || 1;
        const free = v.free_stock || 0;
        const res = v.reserved_stock || 0;
        const toShip = v.to_ship_stock || 0;
        const total = v.total_stock || free + res + toShip;

        freeQty += free;
        freeSqm += free * area;

        reservedQty += res;
        reservedSqm += res * area;

        toShipQty += toShip;
        toShipSqm += v.to_ship_sqm || toShip * area;

        totalQty += total;
        totalSqm += total * area;
      }
    }

    return {
      total_items: filteredProducts.length,
      free_stock_qty: freeQty,
      free_stock_sqm: Math.round(freeSqm * 100) / 100,
      reserved_stock_qty: reservedQty,
      reserved_stock_sqm: Math.round(reservedSqm * 100) / 100,
      to_ship_qty: toShipQty,
      to_ship_sqm: Math.round(toShipSqm * 100) / 100,
      total_stock_qty: totalQty,
      total_stock_sqm: Math.round(totalSqm * 100) / 100,
    };
  }, [
    filteredProducts,
    serverSummary,
    activeFilterCount,
    searchQuery,
    selectedCategory,
    selectedCollections.size,
    selectedCountries.size,
  ]);

  useEffect(() => {
    if (!hasSavedState) {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
      const raf = requestAnimationFrame(() => {
        window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
      });
      return () => cancelAnimationFrame(raf);
    }
  }, [hasSavedState, initialCountry, initialCollection, initialSearch]);

  useEffect(() => {
    if (!loading && products.length > 0) {
      attemptScrollRestoration(true);
    }
  }, [loading, products.length, attemptScrollRestoration]);

  const handleProductNavigate = (targetPage: PageId, targetProductId?: string) => {
    if (targetPage === 'product') {
      saveCatalogSnapshot(targetProductId);
    }
    onNavigate(targetPage, targetProductId);
  };

  const visibleProducts = useMemo(() => filteredProducts.slice(0, visibleCount), [filteredProducts, visibleCount]);
  const hasMore = filteredProducts.length > visibleCount;

  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!hasMore) return;
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      entries => {
        if (entries[0].isIntersecting) setVisibleCount(c => c + 12);
      },
      { rootMargin: '300px' },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasMore]);

  if (loading) return <CatalogLoadingSkeleton />;
  if (loadError) return <CatalogLoadError />;

  const filterProps = {
    searchQuery,
    setSearchQuery,
    selectedCollections,
    toggleCollection: (v: string) => setSelectedCollections(s => toggle(s, v)),
    selectedManufacturers,
    toggleManufacturer: (v: string) => setSelectedManufacturers(s => toggle(s, v)),
    selectedCountries,
    toggleCountry: (v: string) => setSelectedCountries(s => toggle(s, v)),
    selectedWarehouses,
    toggleWarehouse: (v: string) => setSelectedWarehouses(s => toggle(s, v)),
    selectedSizes,
    toggleSize: (v: string) => setSelectedSizes(s => toggle(s, v)),
    selectedClusters,
    toggleCluster: (v: string) => setSelectedClusters(s => toggle(s, v)),
    activeFilterCount,
    resetFilters,
    allCollections,
    allManufacturers,
    allCountries,
    allWarehouses,
    allSizes,
  };

  return (
    <DecklePaperWrapper>
      <CatalogPetroglyphHero title={t('catalog.title')}>
        {selectedCollections.size === 1 && (
          <div className="mb-3 inline-flex items-center gap-2 rounded-lg bg-[#003365]/10 border border-[#003365]/20 px-3 py-1.5">
            <span className="text-sm font-medium text-[#003365]">{t('product.collection')}: {[...selectedCollections][0]}</span>
            <button
              type="button"
              onClick={() => setSelectedCollections(new Set())}
              className="text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {(['all', 'Ковры', 'Дорожки'] as const).map((cat) => {
            const count = cat === 'all'
              ? baseProducts.length
              : baseProducts.filter(p => cat === 'Ковры' ? (p.category === 'Ковры' || !p.name.toLowerCase().includes('дорожк')) : (p.category === 'Дорожки' || p.name.toLowerCase().includes('дорожк'))).length;
            const label = cat === 'all' ? t('catalog.all') : cat === 'Ковры' ? t('catalog.category_rugs') : t('catalog.category_runners');
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedCategory(cat)}
                className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                  selectedCategory === cat
                    ? 'bg-brand-700 text-white shadow-xs font-bold'
                    : 'bg-white border border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                }`}
              >
                {label} ({count})
              </button>
            );
          })}
        </div>
      </CatalogPetroglyphHero>

        {/* RugsUSA Size Clustering Bar (Pattern 3) activeClusterQuickFilter disabled per user request to prevent mobile layout overflow */}

        {/* Country filter pills */}
        {allCountries.length > 1 && (
          <div className="mb-4 flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
            <Globe className="h-4 w-4 text-slate-400 shrink-0" />
            {allCountries.map(c => (
              <button
                key={c}
                type="button"
                onClick={() => setSelectedCountries(s => toggle(s, c))}
                className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-all whitespace-nowrap cursor-pointer ${
                  selectedCountries.has(c)
                    ? 'bg-brand-700 text-white shadow-sm'
                    : 'bg-white border border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        )}

        {/* Stock Summary Bar (Сводка: свободно, в брони, к отгрузке, всего) */}
        {canViewStockSummary && (
          <div className="mb-4">
            <StockSummaryBar
              summary={currentSummary}
              onReserveClick={() => setReservationsModalOpen(true)}
            />
          </div>
        )}

        {/* Active Filter Chips */}
        <ActiveFilterChips
          searchQuery={searchQuery}
          selectedCategory={selectedCategory}
          selectedCollections={selectedCollections}
          selectedCountries={selectedCountries}
          selectedManufacturers={selectedManufacturers}
          selectedWarehouses={selectedWarehouses}
          selectedSizes={selectedSizes}
          selectedClusters={selectedClusters}
          onClearSearch={() => setSearchQuery('')}
          onClearCategory={() => setSelectedCategory('all')}
          onRemoveCollection={val => setSelectedCollections(s => toggle(s, val))}
          onRemoveCountry={val => setSelectedCountries(s => toggle(s, val))}
          onRemoveManufacturer={val => setSelectedManufacturers(s => toggle(s, val))}
          onRemoveWarehouse={val => setSelectedWarehouses(s => toggle(s, val))}
          onRemoveSize={val => setSelectedSizes(s => toggle(s, val))}
          onRemoveCluster={val => setSelectedClusters(s => toggle(s, val))}
          onResetAll={resetFilters}
        />

        {/* Toolbar: Search & Filter moved lower, directly adjacent to cards, with Sort neatly placed */}
        <div className="mb-5 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-1">
          <div className="flex items-center gap-2.5 flex-1 max-w-md">
            <div className="relative flex-1">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder={t('catalog.search_ph')}
                className="input-field pl-10 text-sm bg-white"
              />
            </div>
            <button
              type="button"
              onClick={() => setDrawerOpen(!drawerOpen)}
              className={`relative flex items-center gap-2 rounded-lg border px-3.5 py-2.5 text-sm font-medium transition-colors shrink-0 cursor-pointer shadow-2xs ${
                drawerOpen
                  ? 'border-brand-600 bg-brand-50 text-brand-700 font-semibold'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:border-slate-300'
              }`}
            >
              <SlidersHorizontal className="h-4 w-4 text-slate-600" />
              <span>{drawerOpen ? t('catalog.collapse_filters') : t('catalog.filters')}</span>
              {activeFilterCount > 0 && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-700 px-1 text-[10px] font-bold text-white">
                  {activeFilterCount}
                </span>
              )}
            </button>
          </div>

          <div className="flex items-center justify-between sm:justify-end gap-2.5">
            {viewMode === 'grid' && (
              <div className="relative">
                <select
                  value={sortBy}
                  onChange={e => setSortBy(e.target.value as SortOption)}
                  className="appearance-none rounded-lg border border-slate-200 bg-white py-2 pl-3 pr-8 text-xs font-semibold text-slate-700 hover:border-slate-300 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 outline-none transition-colors cursor-pointer shadow-2xs"
                >
                  <option value="popular">{t('catalog.sort_popular')}</option>
                  <option value="price-asc">{t('catalog.sort_price_asc')}</option>
                  <option value="price-desc">{t('catalog.sort_price_desc')}</option>
                  <option value="name">{t('catalog.sort_newest')}</option>
                </select>
                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
              </div>
            )}

            {viewMode === 'stock' && (
              <div className="relative">
                <select
                  value={stockWarehouse}
                  onChange={e => setStockWarehouse(e.target.value)}
                  className="appearance-none rounded-lg border border-slate-200 bg-white py-2 pl-3 pr-8 text-xs font-semibold text-slate-700 hover:border-slate-300 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 outline-none transition-colors cursor-pointer shadow-2xs"
                >
                  {allWarehouses.map(w => (
                    <option key={w} value={w}>
                      {w}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
              </div>
            )}

            <div className="flex rounded-lg border border-slate-200 bg-white p-0.5 shadow-2xs">
              <button
                type="button"
                onClick={() => setViewMode('grid')}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                  viewMode === 'grid' ? 'bg-[#003365] text-white shadow-xs' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                <LayoutGrid className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{t('catalog.view_grid')}</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('stock')}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                  viewMode === 'stock' ? 'bg-[#003365] text-white shadow-xs' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                <Table2 className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{t('catalog.view_table')}</span>
              </button>
            </div>
          </div>
        </div>

        <div className="flex items-start">
          <CatalogFilterSidebar
            open={drawerOpen}
            onClose={() => setDrawerOpen(false)}
            {...filterProps}
          />

          <div className="flex-1 min-w-0 w-full transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]">
            {filteredProducts.length > 0 ? (
              viewMode === 'grid' ? (
                <>
                  <div className="relative">
                    <div className={`grid grid-cols-2 md:grid-cols-3 ${
                      drawerOpen ? 'lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-4' : 'lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-5'
                    } gap-4 lg:gap-6`}>
                      {visibleProducts.map(p => (
                        <ProductCard key={p.id} product={p} onNavigate={handleProductNavigate} />
                      ))}
                    </div>
                  </div>
                  {hasMore && (
                    <div className="mt-8 flex flex-col items-center gap-3">
                      <div ref={sentinelRef} className="h-1" />
                      <button
                        type="button"
                        onClick={() => setVisibleCount(c => c + 12)}
                        className="btn-secondary cursor-pointer"
                      >
                        {t('common.show_more')} ({filteredProducts.length - visibleCount})
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <CatalogStockTable
                  filteredProducts={filteredProducts}
                  selectedWarehouse={stockWarehouse}
                  onNavigate={handleProductNavigate}
                />
              )
            ) : (
              <div className="flex flex-col items-center justify-center py-24 text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100 mb-5">
                  <SlidersHorizontal className="h-7 w-7 text-slate-400" />
                </div>
                <h3 className="text-lg font-semibold text-slate-800 mb-2">{t('catalog.not_found')}</h3>
                <p className="text-sm text-slate-500 max-w-sm">{t('catalog.not_found_desc')}</p>
                <button type="button" onClick={resetFilters} className="btn-secondary mt-5 cursor-pointer">
                  {t('catalog.reset_filters')}
                </button>
              </div>
            )}
          </div>
        </div>

        <FilterDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          {...filterProps}
        />

      {canViewStockSummary && (
        <StockReservationsModal
          isOpen={reservationsModalOpen}
          onClose={() => setReservationsModalOpen(false)}
        />
      )}
    </DecklePaperWrapper>
  );
}
