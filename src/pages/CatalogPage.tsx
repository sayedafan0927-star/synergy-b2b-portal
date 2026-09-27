import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import {
  Search,
  SlidersHorizontal,
  ChevronDown,
  ChevronUp,
  X,
  Filter,
  LayoutGrid,
  Table2,
  ShoppingCart,
  Check,
  Minus,
  Plus,
  Download,
  Loader2,
  Globe,
} from 'lucide-react';
import type { PageId, Product, ProductVariant, Warehouse } from '@/types';
import { parseSizeDimensions } from '@/types';
import { useProducts } from '@/hooks/useProductData';
import { useUserPricing } from '@/hooks/usePricing';
import ProductCard from '@/components/ProductCard';
import { useCart } from '@/contexts/CartContext';
import { useAuth } from '@/contexts/AuthContext';
import { useDisplaySettings } from '@/hooks/useDisplaySettings';

type SortOption = 'popular' | 'price-asc' | 'price-desc' | 'name';
type ViewMode = 'grid' | 'stock';

function getTotalStock(p: Product) {
  return p.variants.reduce((s, v) => s + v.warehouses.reduce((a, w) => a + w.stock, 0), 0);
}
function pluralProducts(n: number) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return `${n} товар`;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return `${n} товара`;
  return `${n} товаров`;
}
function sizeArea(size: string) {
  const { w, h } = parseSizeDimensions(size);
  return w * h;
}

/* ── Filter sub-components ── */

function FilterSection({ title, defaultOpen = true, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-slate-100 py-4">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between text-sm font-semibold text-slate-800">
        {title}
        {open ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
      </button>
      {open && <div className="mt-3">{children}</div>}
    </div>
  );
}

function CheckItem({ label, checked, onToggle }: { label: string; checked: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={onToggle}
      className="flex w-full items-center gap-2.5 cursor-pointer py-1.5 text-left group"
    >
      <span className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded border transition-colors ${checked ? 'border-brand-600 bg-brand-600' : 'border-slate-300 bg-white group-hover:border-slate-400'}`}>
        {checked && (
          <svg className="h-3 w-3 text-white" viewBox="0 0 12 12" fill="none">
            <path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      <span className="text-sm text-slate-600">{label}</span>
    </button>
  );
}

/* ── Filter Drawer ── */

interface FilterDrawerProps {
  open: boolean; onClose: () => void;
  searchQuery: string; setSearchQuery: (v: string) => void;
  selectedCollections: Set<string>; toggleCollection: (v: string) => void;
  selectedManufacturers: Set<string>; toggleManufacturer: (v: string) => void;
  selectedCountries: Set<string>; toggleCountry: (v: string) => void;
  selectedWarehouses: Set<string>; toggleWarehouse: (v: string) => void;
  selectedSizes: Set<string>; toggleSize: (v: string) => void;
  activeFilterCount: number; resetFilters: () => void;
  allCollections: string[]; allManufacturers: string[]; allCountries: string[];
  allWarehouses: string[]; allSizes: string[];
}

function FilterDrawer(props: FilterDrawerProps) {
  const {
    open, onClose, searchQuery, setSearchQuery,
    selectedCollections, toggleCollection, selectedManufacturers, toggleManufacturer,
    selectedCountries, toggleCountry, selectedWarehouses, toggleWarehouse,
    selectedSizes, toggleSize, activeFilterCount, resetFilters,
    allCollections, allManufacturers, allCountries, allWarehouses, allSizes,
  } = props;

  const rugSizes = useMemo(() => allSizes.filter(s => {
    const { w, h } = parseSizeDimensions(s);
    return Math.max(w, h) / Math.min(w, h) < 2.5;
  }), [allSizes]);
  const runnerSizes = useMemo(() => allSizes.filter(s => {
    const { w, h } = parseSizeDimensions(s);
    return Math.max(w, h) / Math.min(w, h) >= 2.5;
  }), [allSizes]);

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  return (
    <>
      <div onClick={onClose} className={`fixed inset-0 z-40 bg-black/40 backdrop-blur-sm transition-opacity duration-300 ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} />
      <div className={`fixed top-0 left-0 z-50 flex h-full w-[320px] max-w-[85vw] flex-col bg-white shadow-2xl transition-transform duration-300 ease-apple ${open ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-2">
            <Filter className="h-5 w-5 text-brand-700" />
            <h2 className="text-lg font-bold text-slate-900">Фильтр</h2>
            {activeFilterCount > 0 && <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-700 px-1.5 text-[10px] font-bold text-white">{activeFilterCount}</span>}
          </div>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-600">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 no-scrollbar">
          <div className="py-4 border-b border-slate-100">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
              <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Поиск по каталогу..." className="input-field pl-9 text-sm" />
            </div>
          </div>
          <FilterSection title="КОЛЛЕКЦИЯ">{allCollections.map(c => <CheckItem key={c} label={c} checked={selectedCollections.has(c)} onToggle={() => toggleCollection(c)} />)}</FilterSection>
          <FilterSection title="РАЗМЕР" defaultOpen={false}>
            {rugSizes.length > 0 && (
              <div className="mb-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1.5">Ковры</p>
                {rugSizes.map(s => <CheckItem key={s} label={s} checked={selectedSizes.has(s)} onToggle={() => toggleSize(s)} />)}
              </div>
            )}
            {runnerSizes.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1.5">Дорожки</p>
                {runnerSizes.map(s => <CheckItem key={s} label={s} checked={selectedSizes.has(s)} onToggle={() => toggleSize(s)} />)}
              </div>
            )}
          </FilterSection>
          <FilterSection title="ПРОИЗВОДИТЕЛЬ">{allManufacturers.map(m => <CheckItem key={m} label={m} checked={selectedManufacturers.has(m)} onToggle={() => toggleManufacturer(m)} />)}</FilterSection>
          <FilterSection title="СТРАНА">{allCountries.map(c => <CheckItem key={c} label={c} checked={selectedCountries.has(c)} onToggle={() => toggleCountry(c)} />)}</FilterSection>
          <FilterSection title="СКЛАД">{allWarehouses.map(w => <CheckItem key={w} label={w} checked={selectedWarehouses.has(w)} onToggle={() => toggleWarehouse(w)} />)}</FilterSection>
        </div>
        <div className="border-t border-slate-100 px-5 py-4 space-y-2">
          <button onClick={onClose} className="btn-primary w-full">Показать результаты</button>
          {activeFilterCount > 0 && <button onClick={resetFilters} className="btn-secondary w-full text-sm">Сбросить фильтры</button>}
        </div>
      </div>
    </>
  );
}

/* ── Stock Grid (ERP-style) ── */

function StockGridView({ filteredProducts, selectedWarehouse, onNavigate }: { filteredProducts: Product[]; selectedWarehouse: string; onNavigate: (page: PageId, productId?: string) => void }) {
  const { addItem, items } = useCart();
  const { user } = useAuth();
  const pricing = useUserPricing();
  const { settings } = useDisplaySettings();
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [addedKeys, setAddedKeys] = useState<Record<string, boolean>>({});

  const allSizes = useMemo(() => {
    const set = new Set<string>();
    filteredProducts.forEach(p => p.variants.forEach(v => set.add(v.size)));
    return [...set].sort((a, b) => sizeArea(a) - sizeArea(b));
  }, [filteredProducts]);

  const grouped = useMemo(() => {
    const map = new Map<string, Product[]>();
    for (const p of filteredProducts) {
      const arr = map.get(p.collection) ?? [];
      arr.push(p);
      map.set(p.collection, arr);
    }
    return map;
  }, [filteredProducts]);

  const cartCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const item of items) {
      const key = `${item.productId}::${item.size}::${item.warehouse}`;
      map[key] = (map[key] ?? 0) + item.quantity;
    }
    return map;
  }, [items]);

  const cellKey = (productId: string, sku: string, city: string) => `${productId}::${sku}::${city}`;

  const setQty = useCallback((key: string, val: number) => {
    setQuantities(prev => ({ ...prev, [key]: Math.max(0, val) }));
  }, []);

  const handleAdd = useCallback((product: Product, variant: ProductVariant, wh: Warehouse) => {
    const key = cellKey(product.id, variant.sku, wh.city);
    const qty = quantities[key] ?? 0;
    if (qty < 1 || wh.stock < 1) return;
    const price = pricing.getVariantPrice(product.collection, variant.size, variant.base_price, variant.price_per_sqm);
    addItem({
      productId: product.id,
      productName: product.name,
      collection: product.collection,
      image: product.images[0],
      size: variant.size,
      sku: variant.sku,
      warehouse: wh.city,
      price,
    }, qty);
    setAddedKeys(prev => ({ ...prev, [key]: true }));
    setTimeout(() => setAddedKeys(prev => ({ ...prev, [key]: false })), 1500);
  }, [addItem, quantities, pricing]);

  function exportCollectionToExcel(collection: string, prods: Product[], sizes: string[], warehouse: string) {
    const BOM = '\uFEFF';
    const sep = '\t';
    const headerParts = ['Товар', 'Производитель'];
    if (settings.show_price) headerParts.push('$/м²');
    headerParts.push(...sizes.flatMap(s => {
      const p = [];
      if (settings.show_total_pcs) p.push(`${s} шт.`);
      if (settings.show_sqm) p.push(`${s} м²`);
      return p;
    }));
    if (settings.show_total_pcs) headerParts.push('Итого шт.');
    if (settings.show_sqm) headerParts.push('Итого м²');
    const header = headerParts.join(sep);
    const rows = prods.map(product => {
      const variantMap = new Map(product.variants.map(v => [v.size, v]));
      const pricePerSqm = pricing.getMinPricePerSqm(product);
      let totalPcs = 0;
      let totalSqm = 0;
      const sizeCells = sizes.flatMap(size => {
        const variant = variantMap.get(size);
        if (!variant) {
          const cells = [];
          if (settings.show_total_pcs) cells.push('');
          if (settings.show_sqm) cells.push('');
          return cells;
        }
        const wh = variant.warehouses.find(w => w.city === warehouse);
        const stock = wh?.stock ?? 0;
        const { w, h } = parseSizeDimensions(size);
        const sqm = stock * w * h;
        totalPcs += stock;
        totalSqm += sqm;
        const cells = [];
        if (settings.show_total_pcs) cells.push(String(stock));
        if (settings.show_sqm) cells.push(sqm.toFixed(2));
        return cells;
      });
      const rowParts = [product.name, product.manufacturer];
      if (settings.show_price) rowParts.push(`${Math.round(pricePerSqm)}`);
      rowParts.push(...sizeCells);
      if (settings.show_total_pcs) rowParts.push(String(totalPcs));
      if (settings.show_sqm) rowParts.push(totalSqm.toFixed(2));
      return rowParts.join(sep);
    });
    const content = BOM + [header, ...rows].join('\n');
    const blob = new Blob([content], { type: 'application/vnd.ms-excel;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${collection}_${warehouse}.xls`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (filteredProducts.length === 0) return null;

  return (
    <div className="space-y-8">
      {Array.from(grouped.entries()).map(([collection, prods]) => {
        const collTotalStock = prods.reduce((s, p) => s + getTotalStock(p), 0);
        return (
          <div key={collection} className="card overflow-hidden">
            <div className="bg-slate-50 border-b border-slate-200 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900">{collection}</h3>
                <p className="text-xs text-slate-500">
                  {prods.length} поз.{settings.show_total_pcs ? ` / ${collTotalStock} шт. на складе` : ''}
                </p>
              </div>
              <button
                onClick={() => exportCollectionToExcel(collection, prods, allSizes, selectedWarehouse)}
                className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 transition-colors"
              >
                <Download className="h-3.5 w-3.5" />
                Excel
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-25">
                    <th className="sticky left-0 z-10 bg-white py-2.5 pl-4 pr-3 text-left font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap min-w-[200px]">
                      Товар
                    </th>
                    {settings.show_price && <th className="py-2.5 px-2 text-center font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">$/м²</th>}
                    {allSizes.map(size => (
                      <th key={size} className="py-2.5 px-2 text-center font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap border-l border-slate-100">
                        {size}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {prods.map(product => {
                    const variantMap = new Map(product.variants.map(v => [v.size, v]));
                    const pricePerSqm = pricing.getMinPricePerSqm(product);

                    return (
                      <tr key={product.id} className="hover:bg-slate-25 group">
                        <td className="sticky left-0 z-10 bg-white group-hover:bg-slate-50 py-2 pl-4 pr-3 transition-colors">
                          <button onClick={() => onNavigate('product', product.id)} className="text-left">
                            <div className="flex items-center gap-2.5">
                              <img src={product.images[0]} alt="" className="h-9 w-9 rounded object-cover shrink-0" />
                              <div className="min-w-0">
                                <p className="text-xs font-semibold text-slate-900 truncate max-w-[150px] hover:text-brand-700 transition-colors">{product.name}</p>
                                <p className="text-[10px] text-slate-400">{product.manufacturer}</p>
                                {(settings.show_total_pcs || settings.show_sqm) && (
                                  <p className="text-[10px] text-slate-400">
                                    {(() => {
                                      let pcs = 0; let sqm = 0;
                                      product.variants.forEach(v => {
                                        const wh = v.warehouses.find(w => w.city === selectedWarehouse);
                                        if (wh) {
                                          pcs += wh.stock;
                                          const { w: vw, h: vh } = parseSizeDimensions(v.size);
                                          sqm += wh.stock * vw * vh;
                                        }
                                      });
                                      const parts = [];
                                      if (settings.show_total_pcs) parts.push(`${pcs} шт.`);
                                      if (settings.show_sqm) parts.push(`${sqm.toFixed(1)} м²`);
                                      return parts.join(' / ');
                                    })()}
                                  </p>
                                )}
                              </div>
                            </div>
                          </button>
                        </td>

                        {settings.show_price && (
                          <td className="py-2 px-2 text-center font-bold text-slate-700 whitespace-nowrap">
                            ${Math.round(pricePerSqm)}
                          </td>
                        )}

                        {allSizes.map(size => {
                          const variant = variantMap.get(size);
                          if (!variant) {
                            return <td key={size} className="py-2 px-2 text-center text-slate-200 border-l border-slate-50">—</td>;
                          }
                          const wh = variant.warehouses.find(w => w.city === selectedWarehouse);
                          if (!wh || wh.stock === 0) {
                            const totalForSize = variant.warehouses.reduce((s, w) => s + w.stock, 0);
                            return (
                              <td key={size} className="py-2 px-2 text-center border-l border-slate-50">
                                {totalForSize > 0 ? (
                                  <span className="text-[10px] text-slate-300" title="Нет на выбранном складе">{totalForSize}</span>
                                ) : (
                                  <span className="text-slate-200">—</span>
                                )}
                              </td>
                            );
                          }

                          const key = cellKey(product.id, variant.sku, wh.city);
                          const qty = quantities[key] ?? 0;
                          const added = addedKeys[key];
                          const cartKey = `${product.id}::${variant.size}::${wh.city}`;
                          const inCart = cartCounts[cartKey] ?? 0;

                          return (
                            <td key={size} className="py-1.5 px-1.5 border-l border-slate-50">
                              <div className="flex flex-col items-center gap-1">
                                {settings.show_stock && (
                                  <span className="text-[10px] text-emerald-600 font-medium">{wh.stock}</span>
                                )}
                                <div className="flex items-center">
                                  <button onClick={() => setQty(key, Math.max(0, qty - 1))} className="flex h-6 w-5 items-center justify-center rounded-l border border-slate-200 bg-slate-50 text-slate-400 hover:bg-slate-100">
                                    <Minus className="h-2.5 w-2.5" />
                                  </button>
                                  <input
                                    type="number"
                                    value={qty}
                                    onChange={e => setQty(key, parseInt(e.target.value, 10) || 0)}
                                    className="h-6 w-8 border-y border-slate-200 bg-white text-center text-[11px] text-slate-900 outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                  />
                                  <button onClick={() => setQty(key, qty + 1)} className="flex h-6 w-5 items-center justify-center rounded-r border border-slate-200 bg-slate-50 text-slate-400 hover:bg-slate-100">
                                    <Plus className="h-2.5 w-2.5" />
                                  </button>
                                </div>
                                <button
                                  onClick={() => handleAdd(product, variant, wh)}
                                  disabled={qty < 1}
                                  className={`flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[9px] font-medium transition-all ${
                                    added ? 'bg-emerald-600 text-white' : qty < 1 ? 'bg-slate-100 text-slate-300 cursor-not-allowed' : 'bg-brand-700 text-white hover:bg-brand-800'
                                  }`}
                                >
                                  {added ? <Check className="h-2.5 w-2.5" /> : <ShoppingCart className="h-2.5 w-2.5" />}
                                  {inCart > 0 && !added && (
                                    <span className="bg-white/30 rounded-full px-1 text-[8px]">{inCart}</span>
                                  )}
                                </button>
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── Main CatalogPage ── */

export default function CatalogPage({ onNavigate, initialCollection }: { onNavigate: (page: PageId, productId?: string) => void; initialCollection?: string }) {
  const { products, loading, error: loadError } = useProducts();
  const pricing = useUserPricing();

  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('popular');
  const [stockWarehouse, setStockWarehouse] = useState('');
  const [visibleCount, setVisibleCount] = useState(12);

  const [selectedCollections, setSelectedCollections] = useState<Set<string>>(() => initialCollection ? new Set([initialCollection]) : new Set());
  const [selectedManufacturers, setSelectedManufacturers] = useState<Set<string>>(new Set());
  const [selectedCountries, setSelectedCountries] = useState<Set<string>>(new Set());
  const [selectedWarehouses, setSelectedWarehouses] = useState<Set<string>>(new Set());
  const [selectedSizes, setSelectedSizes] = useState<Set<string>>(new Set());

  const allCollections = useMemo(() => [...new Set(products.map(p => p.collection))].sort(), [products]);
  const allManufacturers = useMemo(() => [...new Set(products.map(p => p.manufacturer))].sort(), [products]);
  const allCountries = useMemo(() => [...new Set(products.map(p => p.country))].sort(), [products]);
  const allWarehouses = useMemo(() => [...new Set(products.flatMap(p => p.variants.flatMap(v => v.warehouses.map(w => w.city))))].sort(), [products]);
  const allSizes = useMemo(() => [...new Set(products.flatMap(p => p.variants.map(v => v.size)))].sort((a, b) => sizeArea(a) - sizeArea(b)), [products]);

  useEffect(() => {
    if (!stockWarehouse && allWarehouses.length > 0) setStockWarehouse(allWarehouses[0]);
  }, [allWarehouses, stockWarehouse]);

  const toggle = (set: Set<string>, val: string) => {
    const next = new Set(set);
    if (next.has(val)) next.delete(val); else next.add(val);
    return next;
  };

  const activeFilterCount = selectedCollections.size + selectedManufacturers.size + selectedCountries.size + selectedWarehouses.size + selectedSizes.size;

  const resetFilters = () => {
    setSearchQuery('');
    setSelectedCollections(new Set());
    setSelectedManufacturers(new Set());
    setSelectedCountries(new Set());
    setSelectedWarehouses(new Set());
    setSelectedSizes(new Set());
  };

  const filteredProducts = useMemo(() => {
    let result = [...products];
    if (selectedCollections.size > 0) result = result.filter(p => selectedCollections.has(p.collection));
    if (selectedManufacturers.size > 0) result = result.filter(p => selectedManufacturers.has(p.manufacturer));
    if (selectedCountries.size > 0) result = result.filter(p => selectedCountries.has(p.country));
    if (selectedWarehouses.size > 0) result = result.filter(p => p.variants.some(v => v.warehouses.some(w => selectedWarehouses.has(w.city) && w.stock > 0)));
    if (selectedSizes.size > 0) result = result.filter(p => p.variants.some(v => selectedSizes.has(v.size)));
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(p => p.name.toLowerCase().includes(q) || p.collection.toLowerCase().includes(q) || p.manufacturer.toLowerCase().includes(q));
    }
    switch (sortBy) {
      case 'popular': result.sort((a, b) => getTotalStock(b) - getTotalStock(a)); break;
      case 'price-asc': result.sort((a, b) => pricing.getMinPricePerSqm(a) - pricing.getMinPricePerSqm(b)); break;
      case 'price-desc': result.sort((a, b) => pricing.getMinPricePerSqm(b) - pricing.getMinPricePerSqm(a)); break;
      case 'name': result.sort((a, b) => a.name.localeCompare(b.name)); break;
    }
    return result;
  }, [products, selectedCollections, selectedManufacturers, selectedCountries, selectedWarehouses, selectedSizes, searchQuery, sortBy, pricing]);

  // Reset visible count when filters/search/sort change
  useEffect(() => { setVisibleCount(12); }, [selectedCollections, selectedManufacturers, selectedCountries, selectedWarehouses, selectedSizes, searchQuery, sortBy, viewMode]);

  const visibleProducts = useMemo(() => filteredProducts.slice(0, visibleCount), [filteredProducts, visibleCount]);
  const hasMore = filteredProducts.length > visibleCount;

  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!hasMore) return;
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) setVisibleCount(c => c + 12);
    }, { rootMargin: '300px' });
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
          <button onClick={() => window.location.reload()} className="btn-primary">Повторить</button>
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
              <button onClick={() => setSelectedCollections(new Set())} className="text-brand-400 hover:text-brand-600">
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>

        {/* Toolbar */}
        <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3 flex-1">
            <button onClick={() => setDrawerOpen(true)} className="relative flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 hover:border-slate-300 shrink-0">
              <SlidersHorizontal className="h-4 w-4" />
              <span>Фильтр</span>
              {activeFilterCount > 0 && <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-700 px-1 text-[10px] font-bold text-white">{activeFilterCount}</span>}
            </button>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex rounded-lg border border-slate-200 bg-white p-0.5">
              <button onClick={() => setViewMode('grid')} className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${viewMode === 'grid' ? 'bg-brand-700 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                <LayoutGrid className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Плитка</span>
              </button>
              <button onClick={() => setViewMode('stock')} className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${viewMode === 'stock' ? 'bg-brand-700 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                <Table2 className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Сетка остатков</span>
              </button>
            </div>

            {activeFilterCount > 0 && (
              <button onClick={resetFilters} className="hidden sm:flex items-center gap-1 text-xs text-slate-400 hover:text-red-500 transition-colors">
                <X className="h-3 w-3" />
                Сбросить ({activeFilterCount})
              </button>
            )}

            {viewMode === 'grid' && (
              <div className="relative">
                <select value={sortBy} onChange={e => setSortBy(e.target.value as SortOption)} className="appearance-none rounded-lg border border-slate-200 bg-white py-2.5 pl-3 pr-9 text-sm text-slate-700 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 outline-none transition-colors cursor-pointer">
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
                <select value={stockWarehouse} onChange={e => setStockWarehouse(e.target.value)} className="appearance-none rounded-lg border border-slate-200 bg-white py-2.5 pl-3 pr-9 text-sm text-slate-700 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 outline-none transition-colors cursor-pointer">
                  {allWarehouses.map(w => <option key={w} value={w}>{w}</option>)}
                </select>
                <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
              </div>
            )}
          </div>
        </div>

        {/* Country filter pills */}
        {allCountries.length > 1 && (
          <div className="mb-4 flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
            <Globe className="h-4 w-4 text-slate-400 shrink-0" />
            {allCountries.map(c => (
              <button
                key={c}
                onClick={() => setSelectedCountries(s => toggle(s, c))}
                className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-all whitespace-nowrap ${
                  selectedCountries.has(c)
                    ? 'bg-brand-700 text-white shadow-sm'
                    : 'bg-white border border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                }`
                }
              >
                {c}
              </button>
            ))}
          </div>
        )}

        <p className="mb-4 text-sm text-slate-500">
          Найдено <span className="font-semibold text-slate-800">{pluralProducts(filteredProducts.length)}</span>
        </p>

        {filteredProducts.length > 0 ? (
          viewMode === 'grid' ? (
            <>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 lg:gap-6">
                {visibleProducts.map(p => <ProductCard key={p.id} product={p} onNavigate={onNavigate} />)}
              </div>
              {hasMore && (
                <div className="mt-8 flex flex-col items-center gap-3">
                  <div ref={sentinelRef} className="h-1" />
                  <button onClick={() => setVisibleCount(c => c + 12)} className="btn-secondary">
                    Показать ещё ({filteredProducts.length - visibleCount})
                  </button>
                </div>
              )}
            </>
          ) : (
            <StockGridView filteredProducts={filteredProducts} selectedWarehouse={stockWarehouse} onNavigate={onNavigate} />
          )
        ) : (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100 mb-5">
              <SlidersHorizontal className="h-7 w-7 text-slate-400" />
            </div>
            <h3 className="text-lg font-semibold text-slate-800 mb-2">Товары не найдены</h3>
            <p className="text-sm text-slate-500 max-w-sm">Попробуйте изменить параметры поиска или сбросить фильтры</p>
            <button onClick={resetFilters} className="btn-secondary mt-5">Сбросить фильтры</button>
          </div>
        )}
      </div>

      <FilterDrawer
        open={drawerOpen} onClose={() => setDrawerOpen(false)}
        searchQuery={searchQuery} setSearchQuery={setSearchQuery}
        selectedCollections={selectedCollections} toggleCollection={v => setSelectedCollections(s => toggle(s, v))}
        selectedManufacturers={selectedManufacturers} toggleManufacturer={v => setSelectedManufacturers(s => toggle(s, v))}
        selectedCountries={selectedCountries} toggleCountry={v => setSelectedCountries(s => toggle(s, v))}
        selectedWarehouses={selectedWarehouses} toggleWarehouse={v => setSelectedWarehouses(s => toggle(s, v))}
        selectedSizes={selectedSizes} toggleSize={v => setSelectedSizes(s => toggle(s, v))}
        activeFilterCount={activeFilterCount} resetFilters={resetFilters}
        allCollections={allCollections} allManufacturers={allManufacturers} allCountries={allCountries}
        allWarehouses={allWarehouses} allSizes={allSizes}
      />
    </section>
  );
}
