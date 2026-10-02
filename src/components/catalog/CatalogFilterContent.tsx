import { useMemo } from 'react';
import { Search } from 'lucide-react';
import { parseSizeDimensions } from '@/types';
import { useLanguage } from '@/contexts/LanguageContext';
import type { FilterDrawerProps } from './types';
import { FilterSection, CheckItem } from './FilterDrawer';

export interface CatalogFilterContentProps extends Omit<FilterDrawerProps, 'open'> {
  onApply?: () => void;
}

export function CatalogFilterContent({
  onClose,
  onApply,
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
}: CatalogFilterContentProps) {
  const { t } = useLanguage();
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

  const handleApply = () => {
    if (onApply) onApply();
    else if (onClose) onClose();
  };

  return (
    <div className="flex flex-col h-full">
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 no-scrollbar">
        <div className="py-4 border-b border-slate-100">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder={t('catalog.search_ph')}
              className="input-field pl-9 text-sm"
            />
          </div>
        </div>

        {/* КЛАСТЕРЫ РАЗМЕРОВ */}
        <FilterSection title={t('catalog.filter_clusters') || 'КЛАСТЕРЫ РАЗМЕРОВ'} defaultOpen={true}>
          <CheckItem label={t('catalog.cluster_small')} checked={selectedClusters.has('small')} onToggle={() => toggleCluster('small')} />
          <CheckItem label={t('catalog.cluster_medium')} checked={selectedClusters.has('medium')} onToggle={() => toggleCluster('medium')} />
          <CheckItem label={t('catalog.cluster_large')} checked={selectedClusters.has('large')} onToggle={() => toggleCluster('large')} />
          <CheckItem label={t('catalog.cluster_oversize')} checked={selectedClusters.has('oversize')} onToggle={() => toggleCluster('oversize')} />
        </FilterSection>

        <FilterSection title={t('catalog.filter_collection')}>
          {allCollections.map(c => (
            <CheckItem key={c} label={c} checked={selectedCollections.has(c)} onToggle={() => toggleCollection(c)} />
          ))}
        </FilterSection>

        <FilterSection title={t('catalog.filter_size')} defaultOpen={false}>
          {rugSizes.length > 0 && (
            <div className="mb-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1.5">{t('catalog.category_rugs')}</p>
              {rugSizes.map(s => (
                <CheckItem key={s} label={s} checked={selectedSizes.has(s)} onToggle={() => toggleSize(s)} />
              ))}
            </div>
          )}
          {runnerSizes.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1.5">{t('catalog.category_runners')}</p>
              {runnerSizes.map(s => (
                <CheckItem key={s} label={s} checked={selectedSizes.has(s)} onToggle={() => toggleSize(s)} />
              ))}
            </div>
          )}
        </FilterSection>

        <FilterSection title={t('catalog.filter_manufacturer')}>
          {allManufacturers.map(m => (
            <CheckItem key={m} label={m} checked={selectedManufacturers.has(m)} onToggle={() => toggleManufacturer(m)} />
          ))}
        </FilterSection>

        <FilterSection title={t('catalog.filter_country')}>
          {allCountries.map(c => (
            <CheckItem key={c} label={c} checked={selectedCountries.has(c)} onToggle={() => toggleCountry(c)} />
          ))}
        </FilterSection>

        <FilterSection title={t('catalog.filter_warehouse')}>
          {allWarehouses.map(w => (
            <CheckItem key={w} label={w} checked={selectedWarehouses.has(w)} onToggle={() => toggleWarehouse(w)} />
          ))}
        </FilterSection>
      </div>

      <div className="border-t border-slate-100 px-5 py-4 space-y-2 shrink-0 bg-white">
        <button type="button" onClick={handleApply} className="btn-primary w-full cursor-pointer">
          {t('catalog.show_results')}
        </button>
        {activeFilterCount > 0 && (
          <button type="button" onClick={resetFilters} className="btn-secondary w-full text-sm cursor-pointer">
            {t('catalog.reset_filters')}
          </button>
        )}
      </div>
    </div>
  );
}
