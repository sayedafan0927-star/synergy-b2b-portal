import React, { useState, useMemo, useEffect } from 'react';
import { Megaphone, Globe, Search, RotateCcw, Save, Check } from 'lucide-react';
import { translations, SUPPORTED_LANGUAGES, type Language } from '@/i18n';
import { useSiteContent } from '@/lib/siteContentStore';
import { useToast } from '@/contexts/ToastContext';

const TEXT_SECTIONS = [
  { id: 'home.', label: 'Главная страница (Hero, Преимущества, B2B)' },
  { id: 'catalog.', label: 'Каталог и фильтры' },
  { id: 'contacts.', label: 'Страница «Контакты»' },
  { id: 'footer.', label: 'Подвал сайта (Footer)' },
  { id: 'legal.', label: 'Юридические разделы (Доставка, Возврат, Оферта)' },
  { id: 'nav.', label: 'Меню навигации' },
  { id: 'whatsapp.', label: 'Виджет WhatsApp' },
  { id: 'all', label: 'Все ключи локализации' },
] as const;

export function TextsAndBannerSubTab() {
  const { content, saveSiteContent, resetSiteContentSection } = useSiteContent();
  const toast = useToast();

  const [announcement, setAnnouncement] = useState(content.announcement);
  const [overrides, setOverrides] = useState<Partial<Record<Language, Record<string, string>>>>(
    content.translationsOverride || {}
  );
  const [editLang, setEditLang] = useState<Language>('ru');
  const [sectionPrefix, setSectionPrefix] = useState<string>('home.');
  const [searchQuery, setSearchQuery] = useState('');
  const [onlyModified, setOnlyModified] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setAnnouncement(content.announcement);
    setOverrides(content.translationsOverride || {});
  }, [content]);

  const baseDict = translations[editLang] || translations.ru;
  const langOverrides = overrides[editLang] || {};

  const filteredKeys = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return Object.keys(baseDict).filter(key => {
      if (sectionPrefix !== 'all' && !key.startsWith(sectionPrefix)) return false;
      const isMod = Boolean(langOverrides[key] !== undefined && langOverrides[key] !== baseDict[key]);
      if (onlyModified && !isMod) return false;
      if (!q) return true;
      const baseVal = String(baseDict[key] || '').toLowerCase();
      const overVal = String(langOverrides[key] || '').toLowerCase();
      return key.toLowerCase().includes(q) || baseVal.includes(q) || overVal.includes(q);
    });
  }, [baseDict, langOverrides, sectionPrefix, searchQuery, onlyModified]);

  const handleTextChange = (key: string, value: string) => {
    setOverrides(prev => {
      const currentLangMap = { ...(prev[editLang] || {}) };
      if (value === baseDict[key] || value.trim() === '') {
        delete currentLangMap[key];
      } else {
        currentLangMap[key] = value;
      }
      return { ...prev, [editLang]: currentLangMap };
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveSiteContent({
        announcement,
        translationsOverride: overrides,
      });
      toast.success('Информационная полоса и тексты сайта сохранены!');
    } finally {
      setSaving(false);
    }
  };

  const modifiedCount = useMemo(() => {
    let count = 0;
    for (const lang of ['ru', 'kz', 'en', 'tr'] as Language[]) {
      count += Object.keys(overrides[lang] || {}).length;
    }
    return count;
  }, [overrides]);

  return (
    <div className="space-y-6">
      {/* 1. Верхняя информационная полоса (Announcement Bar) */}
      <div className="card p-5 space-y-4 border border-slate-200/90">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2.5">
            <Megaphone className="h-5 w-5 text-amber-600" />
            <div>
              <h4 className="text-base font-bold text-slate-900">
                Информационная полоса (Announcement Bar в шапке сайта)
              </h4>
              <p className="text-xs text-slate-500">
                Позволяет вывести важное объявление для всех дилеров (новые поступления, график работы в праздники, акции).
              </p>
            </div>
          </div>

          <label className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3.5 py-1.5 text-xs font-bold text-slate-800 cursor-pointer">
            <input
              type="checkbox"
              checked={announcement.enabled}
              onChange={e => setAnnouncement(p => ({ ...p, enabled: e.target.checked }))}
              className="h-4 w-4 accent-brand-700"
            />
            <span>{announcement.enabled ? 'Полоса включена на сайте' : 'Выключена'}</span>
          </label>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Цветовая тема</label>
            <select
              value={announcement.theme}
              onChange={e => setAnnouncement(p => ({ ...p, theme: e.target.value as any }))}
              className="input-field text-xs"
            >
              <option value="amber">Золотисто-янтарная (Акцент)</option>
              <option value="brand">Фирменная синяя (Synergy)</option>
              <option value="emerald">Изумрудная (Новое поступление)</option>
              <option value="slate">Строгая графитовая</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Переход по кнопке</label>
            <select
              value={announcement.ctaTarget}
              onChange={e => setAnnouncement(p => ({ ...p, ctaTarget: e.target.value as any }))}
              className="input-field text-xs"
            >
              <option value="catalog">В каталог ковров</option>
              <option value="contacts">На страницу контактов</option>
              <option value="profile">В личный кабинет</option>
              <option value="">Без кнопки перехода</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Фильтр каталога (опционально)</label>
            <input
              type="text"
              value={announcement.ctaParam}
              onChange={e => setAnnouncement(p => ({ ...p, ctaParam: e.target.value }))}
              placeholder="Напр.: country:Турция или search:Иран"
              className="input-field text-xs font-mono"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
          {SUPPORTED_LANGUAGES.map(l => (
            <div key={l.code} className="rounded-lg border border-slate-200 bg-slate-50/60 p-3 space-y-2">
              <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                <span>{l.flag} {l.label} ({l.shortLabel})</span>
              </div>
              <input
                type="text"
                value={announcement.text[l.code] || ''}
                onChange={e =>
                  setAnnouncement(p => ({
                    ...p,
                    text: { ...p.text, [l.code]: e.target.value },
                  }))
                }
                placeholder={`Текст объявления (${l.shortLabel})`}
                className="input-field text-xs"
              />
              <input
                type="text"
                value={announcement.ctaLabel[l.code] || ''}
                onChange={e =>
                  setAnnouncement(p => ({
                    ...p,
                    ctaLabel: { ...p.ctaLabel, [l.code]: e.target.value },
                  }))
                }
                placeholder={`Текст кнопки (${l.shortLabel})`}
                className="input-field text-xs"
              />
            </div>
          ))}
        </div>
      </div>

      {/* 2. Редактор текстов сайта (RU / KZ / EN / TR) */}
      <div className="card p-5 space-y-4 border border-slate-200/90">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2.5">
            <Globe className="h-5 w-5 text-brand-700" />
            <div>
              <h4 className="text-base font-bold text-slate-900">
                Редактор текстов и заголовков сайта (RU / KZ / EN / TR)
              </h4>
              <p className="text-xs text-slate-500">
                Любой заголовок, подзаголовок или описание на сайте можно изменить мгновенно без пересборки кода. Активных замен: <strong>{modifiedCount}</strong>
              </p>
            </div>
          </div>

          {modifiedCount > 0 && (
            <button
              type="button"
              onClick={() =>
                resetSiteContentSection('translationsOverride').then(() =>
                  toast.success('Все текстовые замены сброшены к заводским')
                )
              }
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Сбросить все замены ({modifiedCount})
            </button>
          )}
        </div>

        {/* Панель фильтров: Язык + Раздел + Поиск */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
            {SUPPORTED_LANGUAGES.map(l => (
              <button
                key={l.code}
                type="button"
                onClick={() => setEditLang(l.code)}
                className={`rounded-md px-3 py-1.5 text-xs font-bold transition-all cursor-pointer ${
                  editLang === l.code ? 'bg-brand-700 text-white shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {l.flag} {l.shortLabel}
              </button>
            ))}
          </div>

          <select
            value={sectionPrefix}
            onChange={e => setSectionPrefix(e.target.value)}
            className="input-field text-xs w-auto min-w-[230px]"
          >
            {TEXT_SECTIONS.map(sec => (
              <option key={sec.id} value={sec.id}>{sec.label}</option>
            ))}
          </select>

          <div className="relative flex-1 min-w-[200px]">
            <Search className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Поиск по тексту или ключу..."
              className="input-field pl-9 text-xs"
            />
          </div>

          <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={onlyModified}
              onChange={e => setOnlyModified(e.target.checked)}
              className="h-4 w-4 accent-brand-700"
            />
            <span>Только изменённые</span>
          </label>
        </div>

        {/* Список текстовых ключей */}
        <div className="max-h-[460px] overflow-y-auto divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
          {filteredKeys.slice(0, 80).map(key => {
            const defaultVal = baseDict[key] || '';
            const currentVal = langOverrides[key] !== undefined ? langOverrides[key] : defaultVal;
            const isModified = langOverrides[key] !== undefined && langOverrides[key] !== defaultVal;
            return (
              <div key={key} className={`p-3 transition-colors ${isModified ? 'bg-amber-50/40' : 'hover:bg-slate-50/60'}`}>
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[11px] font-bold text-slate-500">{key}</span>
                    {isModified && (
                      <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">
                        <Check className="h-2.5 w-2.5" /> Изменено
                      </span>
                    )}
                  </div>
                  {isModified && (
                    <button
                      type="button"
                      onClick={() => handleTextChange(key, defaultVal)}
                      className="text-[11px] font-semibold text-slate-500 hover:text-red-600 cursor-pointer"
                    >
                      Вернуть по умолчанию
                    </button>
                  )}
                </div>
                <textarea
                  rows={defaultVal.length > 90 ? 2 : 1}
                  value={currentVal}
                  onChange={e => handleTextChange(key, e.target.value)}
                  className="input-field text-xs resize-y"
                />
              </div>
            );
          })}
          {filteredKeys.length === 0 && (
            <div className="p-8 text-center text-xs text-slate-400">
              По вашему запросу текстовых ключей не найдено.
            </div>
          )}
        </div>
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="btn-primary inline-flex items-center gap-2 px-6 py-2.5 text-sm font-bold cursor-pointer"
        >
          <Save className="h-4 w-4" />
          <span>{saving ? 'Сохранение...' : 'Сохранить полосу и тексты'}</span>
        </button>
      </div>
    </div>
  );
}
