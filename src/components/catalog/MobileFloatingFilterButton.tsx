import { useState, useEffect, type RefObject } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

interface MobileFloatingFilterButtonProps {
  toolbarRef: RefObject<HTMLElement | null>;
  activeFilterCount: number;
  onClick: () => void;
  /** Скрыть кнопку (например, когда боковая панель фильтров на десктопе уже открыта и закреплена) */
  suppressed?: boolean;
}

export function MobileFloatingFilterButton({
  toolbarRef,
  activeFilterCount,
  onClick,
  suppressed = false,
}: MobileFloatingFilterButtonProps) {
  const { t } = useLanguage();
  const [pastToolbar, setVisible] = useState(false);

  useEffect(() => {
    let ticking = false;

    const checkVisibility = () => {
      if (toolbarRef.current) {
        const rect = toolbarRef.current.getBoundingClientRect();
        // Когда нижняя граница тулбара скрывается под фиксированным хедером (56px)
        const isPast = rect.bottom < 58;
        setVisible(prev => (prev !== isPast ? isPast : prev));
      } else {
        const isPast = window.scrollY > 140;
        setVisible(prev => (prev !== isPast ? isPast : prev));
      }
    };

    const onScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          checkVisibility();
          ticking = false;
        });
        ticking = true;
      }
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    checkVisibility();

    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [toolbarRef]);

  const visible = pastToolbar && !suppressed;

  return (
    <div
      className={`fixed top-[60px] lg:top-[68px] left-3 lg:left-6 z-40 transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] will-change-[transform,opacity] ${
        visible
          ? 'opacity-100 translate-x-0 pointer-events-auto scale-100'
          : 'opacity-0 translate-x-[calc(100vw-110px)] lg:translate-x-0 lg:-translate-y-2 pointer-events-none scale-95'
      }`}
      aria-hidden={!visible}
    >
      <button
        type="button"
        onClick={onClick}
        className={`flex items-center gap-1.5 h-9 px-3.5 rounded-full border shadow-md active:scale-95 transition-all duration-200 cursor-pointer ${
          activeFilterCount > 0
            ? 'border-brand-500/40 bg-brand-50/95 text-brand-900 backdrop-blur-md shadow-brand-900/10 font-semibold ring-2 ring-brand-500/20'
            : 'border-slate-200/90 bg-white/95 text-slate-700 hover:text-slate-900 backdrop-blur-md shadow-slate-900/10 font-medium hover:border-slate-300'
        }`}
        title={t('catalog.filters')}
        aria-label={t('catalog.filters')}
      >
        <SlidersHorizontal className="h-3.5 w-3.5 text-brand-700 shrink-0" />
        <span className="text-xs">{t('catalog.filters')}</span>
        {activeFilterCount > 0 && (
          <span className="flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-brand-700 px-1 text-[10px] font-bold text-white shadow-2xs">
            {activeFilterCount}
          </span>
        )}
      </button>
    </div>
  );
}

export default MobileFloatingFilterButton;
