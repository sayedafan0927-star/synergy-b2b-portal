import { useState, useEffect } from 'react';
import { ChevronDown, ChevronUp, X, Filter } from 'lucide-react';
import type { FilterDrawerProps } from './types';
import { Portal } from '@/components/common/Portal';
import { CatalogFilterContent } from './CatalogFilterContent';

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
  const { open, onClose, activeFilterCount } = props;

  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <Portal>
      {/* Mobile-only Slide Drawer (lg:hidden) */}
      <div className="lg:hidden">
        <div
          onClick={onClose}
          className="fixed inset-0 z-[70] bg-black/50 backdrop-blur-xs transition-opacity duration-300 cursor-pointer animate-in fade-in"
        />
        <div
          className="fixed top-0 left-0 z-[80] flex h-full w-[320px] max-w-[85vw] flex-col bg-white shadow-2xl transition-transform duration-300 ease-apple animate-in slide-in-from-left"
        >
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 shrink-0 bg-white">
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
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 cursor-pointer"
              title="Закрыть фильтр"
              aria-label="Закрыть фильтр"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
            <CatalogFilterContent {...props} onApply={onClose} />
          </div>
        </div>
      </div>
    </Portal>
  );
}

export default FilterDrawer;
