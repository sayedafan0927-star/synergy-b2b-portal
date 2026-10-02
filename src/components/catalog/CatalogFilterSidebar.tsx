import { Filter, ChevronLeft } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import type { FilterDrawerProps } from './types';
import { CatalogFilterContent } from './CatalogFilterContent';

export function CatalogFilterSidebar(props: FilterDrawerProps) {
  const { open, onClose, activeFilterCount } = props;
  const { t } = useLanguage();

  return (
    <aside
      className={`hidden lg:flex shrink-0 flex-col rounded-2xl bg-white shadow-xs sticky top-24 max-h-[calc(100vh-7rem)] overflow-hidden transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] will-change-[width,margin,opacity,transform] z-20 ${
        open
          ? 'w-72 xl:w-80 opacity-100 translate-x-0 border border-slate-200/90 mr-6'
          : 'w-0 opacity-0 -translate-x-6 border-0 pointer-events-none mr-0'
      }`}
      aria-label={t('catalog.filters')}
      aria-hidden={!open ? true : undefined}
      // @ts-expect-error React 18 inert attribute support
      inert={!open ? '' : undefined}
    >
      <div className="w-72 xl:w-80 flex flex-col h-full shrink-0">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 shrink-0 bg-white">
          <div className="flex items-center gap-2">
            <Filter className="h-4.5 w-4.5 text-brand-700" />
            <h2 className="text-base font-bold text-slate-900">{t('catalog.filters')}</h2>
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
            title={t('catalog.collapse_filters')}
            aria-label={t('catalog.collapse_filters')}
          >
            <ChevronLeft className="h-4 w-4" />
            <span>{t('catalog.collapse_filters')}</span>
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
          <CatalogFilterContent {...props} onApply={onClose} />
        </div>
      </div>
    </aside>
  );
}

export default CatalogFilterSidebar;
