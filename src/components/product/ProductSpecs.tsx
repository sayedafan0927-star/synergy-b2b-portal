import { ListChecks } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import type { SpecItem } from './types';

interface ProductSpecsProps {
  specs: SpecItem[];
  isMobile?: boolean;
}

export function ProductSpecs({ specs, isMobile = false }: ProductSpecsProps) {
  const { t } = useLanguage();
  if (isMobile) {
    return (
      <div className="mb-6">
        <div className="flex gap-1 border-b border-slate-200 mb-4">
          <span className="inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px border-brand-600 text-brand-700">
            <ListChecks className="h-4 w-4" />
            {t('product.characteristics')}
          </span>
        </div>
        <div className="grid grid-cols-1 gap-y-3">
          {specs.map(spec => (
            <div key={spec.label} className="flex items-baseline justify-between gap-4 border-b border-dashed border-slate-100 pb-2">
              <span className="text-xs uppercase tracking-wide text-slate-400">{spec.label}</span>
              <span className="text-sm font-medium text-slate-700 text-right">{spec.value}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="hidden lg:block mb-10 border-t border-slate-200 pt-8">
      <h2 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
        <ListChecks className="h-5 w-5 text-slate-400" />
        {t('product.characteristics')}
      </h2>
      <div className="grid grid-cols-2 gap-x-10 gap-y-3 rounded-xl border border-slate-200 bg-slate-50/50 p-5">
        {specs.map(spec => (
          <div key={spec.label} className="flex items-baseline justify-between gap-3 border-b border-dashed border-slate-200 pb-2">
            <span className="text-xs text-slate-400">{spec.label}</span>
            <span className="text-sm font-medium text-slate-700 text-right">{spec.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
export default ProductSpecs;
