export type Language = 'ru' | 'kz' | 'en' | 'tr';

export interface LanguageOption {
  code: Language;
  label: string;
  shortLabel: string;
  flag: string;
}

export const SUPPORTED_LANGUAGES: LanguageOption[] = [
  { code: 'ru', label: 'Русский', shortLabel: 'RU', flag: '🇷🇺' },
  { code: 'kz', label: 'Қазақша', shortLabel: 'KZ', flag: '🇰🇿' },
  { code: 'en', label: 'English', shortLabel: 'EN', flag: '🇬🇧' },
  { code: 'tr', label: 'Türkçe', shortLabel: 'TR', flag: '🇹🇷' },
];

export type TranslationDictionary = Record<string, string>;
