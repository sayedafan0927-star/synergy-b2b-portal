import { Filter, ChevronLeft } from 'lucide-react';
import type { FilterDrawerProps } from './types';
import { CatalogFilterContent } from './CatalogFilterContent';

export function CatalogFilterSidebar(props: FilterDrawerProps) {
  const { open, onClose, activeFilterCount } = props;

  if (!open) return null;

  return (
    <aside
      className="hidden lg:flex w-72 shrink-0 flex-col rounded-2xl border border-slate-200/90 bg-white shadow-xs sticky top-24 max-h-[calc(100vh-7rem)] overflow-hidden transition-all duration-300 animate-in fade-in slide-in-from-left-4 z-20"
      aria-label="Фильтры каталога"
    >
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 shrink-0 bg-white">
        <div className="flex items-center gap-2">
          <Filter className="h-4.5 w-4.5 text-brand-700" />
          <h2 className="text-base font-bold text-slate-900">Фильтры</h2>
          {activeFilterCount > 0 && (
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-700 px-1.5 text-[10px] font-bold text-white">
              {activeFilterCount}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-800 px-2 py-1 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
          title="Свернуть фильтры"
          aria-label="Свернуть фильтры"
        >
          <ChevronLeft className="h-4 w-4" />
          <span>Свернуть</span>
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        <CatalogFilterContent {...props} onApply={onClose} />
      </div>
    </aside>
  );
}

export default CatalogFilterSidebar;
