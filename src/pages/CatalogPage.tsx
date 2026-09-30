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
import type { PageId, Warehouse, StockSummary } from '@/types';
import { useProducts } from '@/hooks/useProductData';
import { useUserPricing } from '@/hooks/usePricing';
import ProductCard from '@/components/ProductCard';
import StockSummaryBar from '@/components/StockSummaryBar';
import { useAuth } from '@/contexts/AuthContext';
import { useDisplaySettings } from '@/hooks/useDisplaySettings';
import { filterWarehousesForClient, isProductInStockForUser, getClientWarehouseSettings } from '@/lib/warehouseVisibility';
import {
  FilterDrawer,
  CatalogStockTable,
  StockReservationsModal,
  ActiveFilterChips,
  getTotalStock,
  sizeArea,
  type SortOption,
  type ViewMode,
} from '@/components/catalog';

export default function CatalogPage({
  onNavigate,
  initialCollection,
  initialCountry,
}: {
  onNavigate: (page: PageId, productId?: string) => void;
  initialCollection?: string;
  initialCountry?: string;
}) {
  const { products, summary: serverSummary, loading, error: loadError } = useProducts();
  const pricing = useUserPricing();
  const { profile, isAdmin, isImpersonating } = useAuth();
  const isEffectiveAdmin = isAdmin && !isImpersonating;
  const { settings: displaySettings } = useDisplaySettings();
  const myShowroomName = profile?.showroom_warehouse_name || 'В моем магазине';

  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [reservationsModalOpen, setReservationsModalOpen] = useState(false);
  const canViewStockSummary = useMemo(() => {
    if (isEffectiveAdmin) return true;
    if (displaySettings.show_reserve) return true;
    const key = profile?.partner_id || profile?.id;
    return Boolean(key && getClientWarehouseSettings(key)?.showStockSummary);
  }, [isEffectiveAdmin, displaySettings.show_reserve, profile?.partner_id, profile?.id]);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('popular');
  const [stockWarehouse, setStockWarehouse] = useState('');
  const [visibleCount, setVisibleCount] = useState(12);
  const [selectedCategory, setSelectedCategory] = useState<'all' | 'Ковры' | 'Дорожки'>('all');

  const [selectedCollections, setSelectedCollections] = useState<Set<string>>(() =>
    initialCollection ? new Set([initialCollection]) : new Set(),
  );
  const [selectedManufacturers, setSelectedManufacturers] = useState<Set<string>>(new Set());
  const [selectedCountries, setSelectedCountries] = useState<Set<string>>(() =>
    initialCountry ? new Set([initialCountry]) : new Set(),
  );
  const [selectedClusters, setSelectedClusters] = useState<Set<string>>(new Set());
  const [selectedWarehouses, setSelectedWarehouses] = useState<Set<string>>(new Set());
  const [selectedSizes, setSelectedSizes] = useState<Set<string>>(new Set());
  const [activeClusterQuickFilter] = useState<'all' | 'small' | 'medium' | 'large' | 'oversize' | 'runner'>('all');
  const [adminStockFilter, setAdminStockFilter] = useState<'all' | 'in_stock' | 'out_of_stock'>('all');
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

  const toggle = (set: Set<string>, val: string) => {
    const next = new Set(set);
    if (next.has(val)) next.delete(val);
    else next.add(val);
    return next;
  };

  const activeFilterCount =
    (selectedCategory !== 'all' ? 1 : 0) +
    (activeClusterQuickFilter !== 'all' ? 1 : 0) +
    selectedCollections.size +
    selectedManufacturers.size +
    selectedCountries.size +
    selectedWarehouses.size +
    selectedSizes.size +
    selectedClusters.size;

  const resetFilters = () => {
    setSearchQuery('');
    setSelectedCategory('all');
    setSelectedClusters(new Set());
    setSelectedCollections(new Set());
    setSelectedManufacturers(new Set());
    setSelectedCountries(new Set());
    setSelectedWarehouses(new Set());
    setSelectedSizes(new Set());
  };

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

    // RugsUSA Pattern 4: Sub-50ms Faceted Multi-token Search
    if (searchQuery.trim()) {
      const tokens = searchQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
      result = result.filter(p => {
        const searchable =
          `${p.name} ${p.collection} ${p.manufacturer} ${p.country || ''} ${p.article || ''} ${p.color || ''} ${p.variants
            .map(v => `${v.size} ${v.article || ''} ${v.sku || ''} ${v.barcode || ''} ${v.code || ''}`)
            .join(' ')}`.toLowerCase();
        return tokens.every(tok => searchable.includes(tok));
      });
    }

    switch (sortBy) {
      case 'popular':
        result.sort((a, b) => getTotalStock(b) - getTotalStock(a));
        break;
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

  // Reset visible count when filters/search/sort change
  useEffect(() => {
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

  if (loading) {
    return (
      <section className="min-h-screen bg-slate-50 pt-20 pb-24 lg:pb-8">
        <div className="container-w">
          <div className="mb-8">
            <div className="skeleton h-8 w-64 mb-3" />
            <div className="skeleton h-4 w-96 max-w-full" />
          </div>
          <div className="mb-6 flex gap-3">
            <div className="skeleton h-11 w-28" />
            <div className="skeleton h-11 w-40" />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 lg:gap-6">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="card overflow-hidden">
                <div className="skeleton aspect-[4/3] rounded-none" />
                <div className="p-3 sm:p-4 space-y-2">
                  <div className="skeleton h-3 w-full" />
                  <div className="skeleton h-3 w-2/3" />
                  <div className="skeleton h-4 w-20 mt-2" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }

  if (loadError) {
    return (
      <section className="min-h-screen bg-slate-50 pt-20 pb-24 lg:pb-8 flex items-center justify-center">
        <div className="text-center max-w-md px-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50 mb-5 mx-auto">
            <X className="h-7 w-7 text-red-500" />
          </div>
          <h3 className="text-lg font-semibold text-slate-800 mb-2">Не удалось загрузить каталог</h3>
          <p className="text-sm text-slate-500 mb-5">Проверьте подключение к интернету и попробуйте снова</p>
          <button type="button" onClick={() => window.location.reload()} className="btn-primary cursor-pointer">
            Повторить
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="min-h-screen bg-slate-50 pt-20 pb-24 lg:pb-8">
      <div className="container-w">
        <div className="mb-8">
          <h1 className="section-heading">Каталог продукции</h1>
          <p className="section-subheading">Широкий ассортимент ковров и дорожек оптом от ведущих производителей</p>
          {selectedCollections.size === 1 && (
            <div className="mt-3 inline-flex items-center gap-2 rounded-lg bg-brand-50 px-3 py-1.5">
              <span className="text-sm font-medium text-brand-700">Коллекция: {[...selectedCollections][0]}</span>
              <button
                type="button"
                onClick={() => setSelectedCollections(new Set())}
                className="text-brand-400 hover:text-brand-600 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>

        <div className="mb-5 flex flex-wrap items-center gap-2">
          {(['all', 'Ковры', 'Дорожки'] as const).map((cat) => {
            const count = cat === 'all'
              ? baseProducts.length
              : baseProducts.filter(p => cat === 'Ковры' ? (p.category === 'Ковры' || !p.name.toLowerCase().includes('дорожк')) : (p.category === 'Дорожки' || p.name.toLowerCase().includes('дорожк'))).length;
            const label = cat === 'all' ? 'Все категории' : cat;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedCategory(cat)}
                className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                  selectedCategory === cat
                    ? 'bg-brand-700 text-white shadow-sm ring-2 ring-brand-700/20'
                    : 'bg-white border border-slate-200 text-slate-700 hover:border-brand-500 hover:bg-slate-50'
                }`}
              >
                {label} ({count})
              </button>
            );
          })}
        </div>

        {/* RugsUSA Size Clustering Bar (Pattern 3) activeClusterQuickFilter disabled per user request to prevent mobile layout overflow */}

        {/* Toolbar */}
        <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3 flex-1">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Поиск по названию, артикулу, штрихкоду..."
                className="input-field pl-10 text-sm"
              />
            </div>
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className="relative flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 hover:border-slate-300 shrink-0 cursor-pointer"
            >
              <SlidersHorizontal className="h-4 w-4" />
              <span>Фильтр</span>
              {activeFilterCount > 0 && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-700 px-1 text-[10px] font-bold text-white">
                  {activeFilterCount}
                </span>
              )}
            </button>
          </div>

          <div className="flex items-center gap-3 flex-wrap sm:flex-nowrap">
            {isEffectiveAdmin && (
              <div className="relative">
                <select
                  value={adminStockFilter}
                  onChange={e => setAdminStockFilter(e.target.value as any)}
                  className="appearance-none rounded-lg border border-amber-300 bg-amber-50/90 py-2.5 pl-3 pr-8 text-xs font-semibold text-amber-900 focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 outline-none transition-colors cursor-pointer"
                  title="Режим видимости для администратора"
                >
                  <option value="all">📦 Все остатки (админ: {products.length})</option>
                  <option value="in_stock">✅ Только в наличии ({products.filter(p => isProductInStockForUser(p, profile, false, true)).length})</option>
                  <option value="out_of_stock">⚠️ Только отсутствующие ({products.filter(p => !isProductInStockForUser(p, profile, false, true)).length})</option>
                </select>
                <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-amber-700 pointer-events-none" />
              </div>
            )}

            <div className="flex rounded-lg border border-slate-200 bg-white p-0.5">
              <button
                type="button"
                onClick={() => setViewMode('grid')}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                  viewMode === 'grid' ? 'bg-brand-700 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                <LayoutGrid className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Плитка</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('stock')}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                  viewMode === 'stock' ? 'bg-brand-700 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                <Table2 className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Сетка остатков</span>
              </button>
            </div>

            {viewMode === 'grid' && (
              <div className="relative">
                <select
                  value={sortBy}
                  onChange={e => setSortBy(e.target.value as SortOption)}
                  className="appearance-none rounded-lg border border-slate-200 bg-white py-2.5 pl-3 pr-9 text-sm text-slate-700 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 outline-none transition-colors cursor-pointer"
                >
                  <option value="popular">По популярности</option>
                  <option value="price-asc">Цена: по возрастанию</option>
                  <option value="price-desc">Цена: по убыванию</option>
                  <option value="name">По названию</option>
                </select>
                <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
              </div>
            )}

            {viewMode === 'stock' && (
              <div className="relative">
                <select
                  value={stockWarehouse}
                  onChange={e => setStockWarehouse(e.target.value)}
                  className="appearance-none rounded-lg border border-slate-200 bg-white py-2.5 pl-3 pr-9 text-sm text-slate-700 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 outline-none transition-colors cursor-pointer"
                >
                  {allWarehouses.map(w => (
                    <option key={w} value={w}>
                      {w}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
              </div>
            )}
          </div>
        </div>

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

        {filteredProducts.length > 0 ? (
          viewMode === 'grid' ? (
            <>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4 2xl:grid-cols-5 min-[1800px]:grid-cols-6 gap-4 lg:gap-6">
                {visibleProducts.map(p => (
                  <ProductCard key={p.id} product={p} onNavigate={onNavigate} />
                ))}
              </div>
              {hasMore && (
                <div className="mt-8 flex flex-col items-center gap-3">
                  <div ref={sentinelRef} className="h-1" />
                  <button
                    type="button"
                    onClick={() => setVisibleCount(c => c + 12)}
                    className="btn-secondary cursor-pointer"
                  >
                    Показать ещё ({filteredProducts.length - visibleCount})
                  </button>
                </div>
              )}
            </>
          ) : (
            <CatalogStockTable
              filteredProducts={filteredProducts}
              selectedWarehouse={stockWarehouse}
              onNavigate={onNavigate}
            />
          )
        ) : (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100 mb-5">
              <SlidersHorizontal className="h-7 w-7 text-slate-400" />
            </div>
            <h3 className="text-lg font-semibold text-slate-800 mb-2">Товары не найдены</h3>
            <p className="text-sm text-slate-500 max-w-sm">Попробуйте изменить параметры поиска или сбросить фильтры</p>
            <button type="button" onClick={resetFilters} className="btn-secondary mt-5 cursor-pointer">
              Сбросить фильтры
            </button>
          </div>
        )}
      </div>

      <FilterDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        selectedCollections={selectedCollections}
        toggleCollection={v => setSelectedCollections(s => toggle(s, v))}
        selectedManufacturers={selectedManufacturers}
        toggleManufacturer={v => setSelectedManufacturers(s => toggle(s, v))}
        selectedCountries={selectedCountries}
        toggleCountry={v => setSelectedCountries(s => toggle(s, v))}
        selectedWarehouses={selectedWarehouses}
        toggleWarehouse={v => setSelectedWarehouses(s => toggle(s, v))}
        selectedSizes={selectedSizes}
        toggleSize={v => setSelectedSizes(s => toggle(s, v))}
        selectedClusters={selectedClusters}
        toggleCluster={v => setSelectedClusters(s => toggle(s, v))}
        activeFilterCount={activeFilterCount}
        resetFilters={resetFilters}
        allCollections={allCollections}
        allManufacturers={allManufacturers}
        allCountries={allCountries}
        allWarehouses={allWarehouses}
        allSizes={allSizes}
      />

      {canViewStockSummary && (
        <StockReservationsModal
          isOpen={reservationsModalOpen}
          onClose={() => setReservationsModalOpen(false)}
        />
      )}
    </section>
  );
}
