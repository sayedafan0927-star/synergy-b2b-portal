import React, { useState } from 'react';
import { Film, Globe, Phone, RotateCcw, Sparkles } from 'lucide-react';
import { useSiteContent } from '@/lib/siteContentStore';
import { useToast } from '@/contexts/ToastContext';
import { HeroAndMediaSubTab } from './content/HeroAndMediaSubTab';
import { TextsAndBannerSubTab } from './content/TextsAndBannerSubTab';
import { ContactsAndLegalSubTab } from './content/ContactsAndLegalSubTab';

type SubTabId = 'media' | 'texts' | 'contacts';

export function AdminContentTab() {
  const [subTab, setSubTab] = useState<SubTabId>('media');
  const { resetSiteContentSection } = useSiteContent();
  const toast = useToast();

  const handleFullReset = async () => {
    await resetSiteContentSection('all');
    toast.success('Весь контент сайта возвращён к заводским настройкам!');
  };

  return (
    <div className="space-y-6">
      {/* Header card */}
      <div className="card p-5 border border-slate-200/90 bg-gradient-to-r from-slate-900 via-slate-800 to-brand-950 text-white">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-1.5 rounded-full bg-amber-400/20 px-2.5 py-0.5 text-[11px] font-bold text-amber-300">
              <Sparkles className="h-3.5 w-3.5" />
              <span>CMS Управление контентом портала</span>
            </div>
            <h3 className="text-lg sm:text-xl font-bold text-white">
              Контент сайта, видео-баннер (1920×1080) и мультиязычные тексты
            </h3>
            <p className="text-xs text-slate-300 max-w-2xl">
              Заменяйте главное видео со снежным барсом, ролики стран, управляйте информационной полосой, текстами (RU / KZ / EN / TR) и контактными реквизитами без участия разработчика.
            </p>
          </div>

          <button
            type="button"
            onClick={handleFullReset}
            className="inline-flex items-center gap-1.5 rounded-xl border border-white/20 bg-white/10 px-3.5 py-2 text-xs font-semibold text-white hover:bg-white/20 transition-colors cursor-pointer shrink-0"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>Сбросить всё к эталону</span>
          </button>
        </div>

        {/* Sub-tabs */}
        <div className="mt-5 flex flex-wrap gap-2 border-t border-white/10 pt-4">
          {[
            { id: 'media' as SubTabId, label: 'Видео (Барс 1920×1080), Страны и Витрина', icon: Film },
            { id: 'texts' as SubTabId, label: 'Инфо-полоса и Тексты (RU / KZ / EN / TR)', icon: Globe },
            { id: 'contacts' as SubTabId, label: 'Контакты, WhatsApp и Юр. реквизиты', icon: Phone },
          ].map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setSubTab(id)}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition-all cursor-pointer ${
                subTab === id
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'bg-white/10 text-slate-200 hover:bg-white/20'
              }`}
            >
              <Icon className="h-4 w-4" />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </div>

      {subTab === 'media' && <HeroAndMediaSubTab />}
      {subTab === 'texts' && <TextsAndBannerSubTab />}
      {subTab === 'contacts' && <ContactsAndLegalSubTab />}
    </div>
  );
}
export default AdminContentTab;
