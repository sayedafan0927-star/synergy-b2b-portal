import { ru } from './ru';
import { kz } from './kz';
import { en } from './en';
import { tr } from './tr';
import type { Language, TranslationDictionary } from './types';

export * from './types';

export const translations: Record<Language, TranslationDictionary> = {
  ru,
  kz,
  en,
  tr,
};
