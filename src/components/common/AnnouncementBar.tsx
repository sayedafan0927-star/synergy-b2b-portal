import { useState } from 'react';
import { Megaphone, ArrowRight, X } from 'lucide-react';
import { useSiteContent } from '@/lib/siteContentStore';
import { useLanguage } from '@/contexts/LanguageContext';
import type { PageId } from '@/types';

export default function AnnouncementBar({
  onNavigate,
}: {
  onNavigate: (page: PageId, param?: string) => void;
}) {
  const { content } = useSiteContent();
  const { language } = useLanguage();
  const [dismissed, setDismissed] = useState(false);

  const ann = content.announcement;
  if (!ann.enabled || dismissed) return null;

  const text = ann.text[language] || ann.text.ru;
  if (!text) return null;
  const ctaLabel = ann.ctaLabel[language] || ann.ctaLabel.ru;

  const themeClass =
    ann.theme === 'brand'
      ? 'bg-brand-800 text-white border-brand-700'
      : ann.theme === 'emerald'
      ? 'bg-emerald-800 text-white border-emerald-700'
      : ann.theme === 'slate'
      ? 'bg-slate-900 text-white border-slate-800'
      : 'bg-amber-500 text-slate-950 border-amber-400';

  return (
    <div className={`relative z-40 border-b px-4 py-2 text-xs font-medium transition-colors ${themeClass}`}>
      <div className="container-w flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Megaphone className="h-3.5 w-3.5 shrink-0 opacity-90" />
          <span className="truncate sm:whitespace-normal font-semibold">{text}</span>
          {ann.ctaTarget && ctaLabel && (
            <button
              type="button"
              onClick={() => onNavigate(ann.ctaTarget as PageId, ann.ctaParam || undefined)}
              className="inline-flex items-center gap-1 underline font-bold hover:opacity-80 cursor-pointer shrink-0 ml-1"
            >
              <span>{ctaLabel}</span>
              <ArrowRight className="h-3 w-3" />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="p-0.5 rounded hover:bg-black/10 transition-colors cursor-pointer shrink-0"
          aria-label="Закрыть объявление"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
