import { useState, useMemo, useEffect } from 'react';
import { Search, ChevronDown, ChevronUp, X, Filter } from 'lucide-react';
import { parseSizeDimensions } from '@/types';
import type { FilterDrawerProps } from './types';
import { Portal } from '@/components/common/Portal';

export function FilterSection({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-slate-100 py-4">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between text-sm font-semibold text-slate-800 cursor-pointer"
      >
        {title}
        {open ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
      </button>
      {open && <div className="mt-3">{children}</div>}
    </div>
  );
}

export function CheckItem({
  label,
  checked,
  onToggle,
}: {
  label: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={onToggle}
      className="flex w-full items-center gap-2.5 cursor-pointer py-1.5 text-left group"
    >
      <span
        className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded border transition-colors ${
          checked ? 'border-brand-600 bg-brand-600' : 'border-slate-300 bg-white group-hover:border-slate-400'
        }`}
      >
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

export function FilterDrawer(props: FilterDrawerProps) {
  const {
    open,
    onClose,
    searchQuery,
    setSearchQuery,
    selectedCollections,
    toggleCollection,
    selectedManufacturers,
    toggleManufacturer,
    selectedCountries,
    toggleCountry,
    selectedWarehouses,
    toggleWarehouse,
    selectedSizes,
    toggleSize,
    selectedClusters,
    toggleCluster,
    activeFilterCount,
    resetFilters,
    allCollections,
    allManufacturers,
    allCountries,
    allWarehouses,
    allSizes,
  } = props;

  const rugSizes = useMemo(
    () =>
      allSizes.filter(s => {
        const { w, h } = parseSizeDimensions(s);
        return Math.max(w, h) / Math.min(w, h) < 2.5;
      }),
    [allSizes],
  );
  const runnerSizes = useMemo(
    () =>
      allSizes.filter(s => {
        const { w, h } = parseSizeDimensions(s);
        return Math.max(w, h) / Math.min(w, h) >= 2.5;
      }),
    [allSizes],
  );

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  return (
    <Portal>
      <div
        onClick={onClose}
        className={`fixed inset-0 z-40 bg-black/40 backdrop-blur-sm transition-opacity duration-300 cursor-pointer ${
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      />
      <div
        className={`fixed top-0 left-0 z-50 flex h-full w-[320px] max-w-[85vw] flex-col bg-white shadow-2xl transition-transform duration-300 ease-apple ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-2">
            <Filter className="h-5 w-5 text-brand-700" />
            <h2 className="text-lg font-bold text-slate-900">Фильтр</h2>
            {activeFilterCount > 0 && (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-700 px-1.5 text-[10px] font-bold text-white">
                {activeFilterCount}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-600 cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 no-scrollbar">
          <div className="py-4 border-b border-slate-100">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Поиск по каталогу..."
                className="input-field pl-9 text-sm"
              />
            </div>
          </div>
          <FilterSection title="КЛАСТЕРЫ РАЗМЕРОВ" defaultOpen={true}>
            <CheckItem label="Маленькие (< 2.5 м²)" checked={selectedClusters.has('small')} onToggle={() => toggleCluster('small')} />
            <CheckItem label="Средние (2.5 – 5.5 м²)" checked={selectedClusters.has('medium')} onToggle={() => toggleCluster('medium')} />
            <CheckItem label="Большие (5.5 – 10.0 м²)" checked={selectedClusters.has('large')} onToggle={() => toggleCluster('large')} />
            <CheckItem label="Оверзайз (> 10.0 м²)" checked={selectedClusters.has('oversize')} onToggle={() => toggleCluster('oversize')} />
          </FilterSection>
          <FilterSection title="КОЛЛЕКЦИЯ">
            {allCollections.map(c => (
              <CheckItem key={c} label={c} checked={selectedCollections.has(c)} onToggle={() => toggleCollection(c)} />
            ))}
          </FilterSection>
          <FilterSection title="РАЗМЕР" defaultOpen={false}>
            {rugSizes.length > 0 && (
              <div className="mb-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1.5">Ковры</p>
                {rugSizes.map(s => (
                  <CheckItem key={s} label={s} checked={selectedSizes.has(s)} onToggle={() => toggleSize(s)} />
                ))}
              </div>
            )}
            {runnerSizes.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1.5">Дорожки</p>
                {runnerSizes.map(s => (
                  <CheckItem key={s} label={s} checked={selectedSizes.has(s)} onToggle={() => toggleSize(s)} />
                ))}
              </div>
            )}
          </FilterSection>
          <FilterSection title="ПРОИЗВОДИТЕЛЬ">
            {allManufacturers.map(m => (
              <CheckItem key={m} label={m} checked={selectedManufacturers.has(m)} onToggle={() => toggleManufacturer(m)} />
            ))}
          </FilterSection>
          <FilterSection title="СТРАНА">
            {allCountries.map(c => (
              <CheckItem key={c} label={c} checked={selectedCountries.has(c)} onToggle={() => toggleCountry(c)} />
            ))}
          </FilterSection>
          <FilterSection title="СКЛАД">
            {allWarehouses.map(w => (
              <CheckItem key={w} label={w} checked={selectedWarehouses.has(w)} onToggle={() => toggleWarehouse(w)} />
            ))}
          </FilterSection>
        </div>
        <div className="border-t border-slate-100 px-5 py-4 space-y-2">
          <button type="button" onClick={onClose} className="btn-primary w-full cursor-pointer">
            Показать результаты
          </button>
          {activeFilterCount > 0 && (
            <button type="button" onClick={resetFilters} className="btn-secondary w-full text-sm cursor-pointer">
              Сбросить фильтры
            </button>
          )}
        </div>
      </div>
    </Portal>
  );
}
export default FilterDrawer;
