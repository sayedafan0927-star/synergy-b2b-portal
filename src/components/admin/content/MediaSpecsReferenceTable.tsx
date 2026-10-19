import React from 'react';
import { Info } from 'lucide-react';
import { SITE_MEDIA_SPECS } from '@/lib/siteContentStore';

export function MediaSpecsReferenceTable() {
  return (
    <div className="rounded-xl border border-brand-200 bg-gradient-to-br from-brand-50/70 via-white to-amber-50/40 p-4 sm:p-5 shadow-2xs">
      <div className="flex items-start gap-3 mb-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-700 text-white">
          <Info className="h-5 w-5" />
        </div>
        <div>
          <h4 className="text-sm sm:text-base font-bold text-slate-900">
            Эталонные технические требования к видео и изображениям (Шпаргалка для дизайнера)
          </h4>
          <p className="text-xs text-slate-600 mt-0.5">
            Точные размеры и пропорции текущего боевого контента, чтобы при замене не возникало обрезаний или чёрных полос.
          </p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200/90 bg-white">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
            <tr>
              <th className="py-2.5 px-3 font-bold">Блок / Слот</th>
              <th className="py-2.5 px-3 font-bold">Точный размер (px)</th>
              <th className="py-2.5 px-3 font-bold">Пропорции</th>
              <th className="py-2.5 px-3 font-bold">Формат и вес</th>
              <th className="py-2.5 px-3 font-bold">Важные особенности верстки</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {Object.values(SITE_MEDIA_SPECS).map(spec => (
              <tr key={spec.slot} className="hover:bg-slate-50/80">
                <td className="py-2 px-3 font-semibold text-slate-900">{spec.title}</td>
                <td className="py-2 px-3 font-mono font-bold text-brand-700 whitespace-nowrap">
                  {spec.recommendedResolution}
                </td>
                <td className="py-2 px-3 font-mono whitespace-nowrap">
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 font-bold text-slate-800">{spec.aspectRatio}</span>
                </td>
                <td className="py-2 px-3 text-slate-600">
                  <div>{spec.format}</div>
                  <div className="text-[11px] text-slate-400">
                    до {spec.maxSizeMb} МБ {spec.durationHint ? `• ${spec.durationHint}` : ''}
                  </div>
                </td>
                <td className="py-2 px-3 text-slate-600 max-w-xs">{spec.safeZoneNote}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
