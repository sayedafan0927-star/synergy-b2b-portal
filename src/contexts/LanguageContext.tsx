import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { translations, SUPPORTED_LANGUAGES, type Language, type LanguageOption } from '@/i18n';

export type { Language, LanguageOption };
export { SUPPORTED_LANGUAGES };

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  currentLanguageOption: LanguageOption;
  languages: LanguageOption[];
  t: (key: string, paramsOrFallback?: Record<string, string | number> | string, fallback?: string) => string;
}

const LanguageContext = createContext<LanguageContextType>({
  language: 'ru',
  setLanguage: () => {},
  currentLanguageOption: SUPPORTED_LANGUAGES[0],
  languages: SUPPORTED_LANGUAGES,
  t: (key: string, paramsOrFallback?: Record<string, string | number> | string, fallback?: string) => {
    if (typeof paramsOrFallback === 'string') return paramsOrFallback;
    return fallback || key;
  },
});

function getHtmlLangCode(lang: Language): string {
  switch (lang) {
    case 'kz':
      return 'kk';
    case 'en':
      return 'en';
    case 'tr':
      return 'tr';
    case 'ru':
    default:
      return 'ru';
  }
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('synergy_lang') as Language;
      if (saved && ['ru', 'kz', 'en', 'tr'].includes(saved)) {
        return saved;
      }
    }
    return 'ru';
  });

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang);
    if (typeof window !== 'undefined') {
      localStorage.setItem('synergy_lang', lang);
      document.documentElement.lang = getHtmlLangCode(lang);
    }
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      document.documentElement.lang = getHtmlLangCode(language);
    }
  }, [language]);

  const currentLanguageOption = SUPPORTED_LANGUAGES.find(l => l.code === language) || SUPPORTED_LANGUAGES[0];

  const t = useCallback(
    (key: string, paramsOrFallback?: Record<string, string | number> | string, fallback?: string): string => {
      let params: Record<string, string | number> | undefined;
      let defaultText: string | undefined;

      if (typeof paramsOrFallback === 'string') {
        defaultText = paramsOrFallback;
      } else if (paramsOrFallback && typeof paramsOrFallback === 'object') {
        params = paramsOrFallback;
        defaultText = fallback;
      } else {
        defaultText = fallback;
      }

      let rawText = translations[language]?.[key] ?? translations.ru?.[key] ?? defaultText ?? key;

      if (params) {
        Object.entries(params).forEach(([paramKey, val]) => {
          rawText = rawText.replace(new RegExp(`\\{${paramKey}\\}`, 'g'), String(val));
        });
      }

      return rawText;
    },
    [language]
  );

  return (
    <LanguageContext.Provider
      value={{
        language,
        setLanguage,
        currentLanguageOption,
        languages: SUPPORTED_LANGUAGES,
        t,
      }}
    >
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  return useContext(LanguageContext);
}
