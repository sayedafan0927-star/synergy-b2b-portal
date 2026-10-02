import { X, RotateCcw } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

export interface ActiveFilterChipsProps {
  searchQuery: string;
  selectedCategory: string;
  selectedCollections: Set<string>;
  selectedCountries: Set<string>;
  selectedManufacturers: Set<string>;
  selectedWarehouses: Set<string>;
  selectedSizes: Set<string>;
  selectedClusters: Set<string>;
  onClearSearch: () => void;
  onClearCategory: () => void;
  onRemoveCollection: (val: string) => void;
  onRemoveCountry: (val: string) => void;
  onRemoveManufacturer: (val: string) => void;
  onRemoveWarehouse: (val: string) => void;
  onRemoveSize: (val: string) => void;
  onRemoveCluster: (val: string) => void;
  onResetAll: () => void;
}

export function ActiveFilterChips({
  searchQuery,
  selectedCategory,
  selectedCollections,
  selectedCountries,
  selectedManufacturers,
  selectedWarehouses,
  selectedSizes,
  selectedClusters,
  onClearSearch,
  onClearCategory,
  onRemoveCollection,
  onRemoveCountry,
  onRemoveManufacturer,
  onRemoveWarehouse,
  onRemoveSize,
  onRemoveCluster,
  onResetAll,
}: ActiveFilterChipsProps) {
  const { t } = useLanguage();
  const hasActiveFilters =
    Boolean(searchQuery.trim()) ||
    selectedCategory !== 'all' ||
    selectedCollections.size > 0 ||
    selectedCountries.size > 0 ||
    selectedManufacturers.size > 0 ||
    selectedWarehouses.size > 0 ||
    selectedSizes.size > 0 ||
    selectedClusters.size > 0;

  if (!hasActiveFilters) {
    return null;
  }

  return (
    <div className="flex items-center gap-2 overflow-x-auto py-2 no-scrollbar mb-4 animate-fade-in text-xs">
      <span className="text-slate-400 shrink-0 font-medium hidden sm:inline">{t('catalog.filters')}:</span>

      {searchQuery.trim() && (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-slate-100 text-slate-800 font-medium shrink-0">
          <span>{searchQuery}</span>
          <button
            type="button"
            onClick={onClearSearch}
            className="hover:text-rose-600 p-0.5 rounded cursor-pointer"
            aria-label="Сбросить поиск"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      )}

      {selectedCategory !== 'all' && (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-brand-50 text-brand-800 font-medium shrink-0 border border-brand-200">
          <span>{selectedCategory}</span>
          <button
            type="button"
            onClick={onClearCategory}
            className="hover:text-rose-600 p-0.5 rounded cursor-pointer"
            aria-label="Сбросить категорию"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      )}

      {Array.from(selectedCollections).map((col) => (
        <span key={col} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-slate-100 text-slate-800 font-medium shrink-0 border border-slate-200">
          <span>{col}</span>
          <button
            type="button"
            onClick={() => onRemoveCollection(col)}
            className="hover:text-rose-600 p-0.5 rounded cursor-pointer"
            aria-label={`Удалить коллекцию ${col}`}
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}

      {Array.from(selectedSizes).map((sz) => (
        <span key={sz} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-50 text-amber-900 font-medium shrink-0 border border-amber-200">
          <span>{sz}</span>
          <button
            type="button"
            onClick={() => onRemoveSize(sz)}
            className="hover:text-rose-600 p-0.5 rounded cursor-pointer"
            aria-label={`Удалить размер ${sz}`}
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}

      {Array.from(selectedWarehouses).map((wh) => (
        <span key={wh} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-900 font-medium shrink-0 border border-indigo-200">
          <span>{wh}</span>
          <button
            type="button"
            onClick={() => onRemoveWarehouse(wh)}
            className="hover:text-rose-600 p-0.5 rounded cursor-pointer"
            aria-label={`Удалить склад ${wh}`}
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}

      {Array.from(selectedCountries).map((c) => (
        <span key={c} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-slate-100 text-slate-800 font-medium shrink-0 border border-slate-200">
          <span>{c}</span>
          <button
            type="button"
            onClick={() => onRemoveCountry(c)}
            className="hover:text-rose-600 p-0.5 rounded cursor-pointer"
            aria-label={`Удалить страну ${c}`}
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}

      {Array.from(selectedManufacturers).map((m) => (
        <span key={m} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-slate-100 text-slate-800 font-medium shrink-0 border border-slate-200">
          <span>{m}</span>
          <button
            type="button"
            onClick={() => onRemoveManufacturer(m)}
            className="hover:text-rose-600 p-0.5 rounded cursor-pointer"
            aria-label={`Удалить производителя ${m}`}
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}

      {Array.from(selectedClusters).map((cl) => (
        <span key={cl} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-purple-50 text-purple-900 font-medium shrink-0 border border-purple-200">
          <span>{cl}</span>
          <button
            type="button"
            onClick={() => onRemoveCluster(cl)}
            className="hover:text-rose-600 p-0.5 rounded cursor-pointer"
            aria-label={`Удалить кластер ${cl}`}
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}

      <button
        type="button"
        onClick={onResetAll}
        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-rose-600 hover:bg-rose-50 border border-rose-200 font-semibold shrink-0 transition-colors cursor-pointer"
      >
        <RotateCcw className="h-3 w-3" />
        <span>{t('catalog.reset_filters')}</span>
      </button>
    </div>
  );
}

export default ActiveFilterChips;
