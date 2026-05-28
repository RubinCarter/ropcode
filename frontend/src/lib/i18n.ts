import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import en from '@/locales/en.json';
import zh from '@/locales/zh.json';

export const LANGUAGE_STORAGE_KEY = 'ropcode_language';
export const LANGUAGE_SETTING_KEY = 'language_preference';
export const SUPPORTED_LANGUAGES = ['en', 'zh'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      zh: { translation: zh },
    },
    fallbackLng: 'en',
    supportedLngs: ['en', 'zh'],
    load: 'languageOnly',
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: LANGUAGE_STORAGE_KEY,
      caches: ['localStorage'],
    },
  });

export async function loadPersistedLanguage(): Promise<void> {
  try {
    const { GetSetting } = await import('./rpc-client');
    const saved = await GetSetting(LANGUAGE_SETTING_KEY);
    if (saved && SUPPORTED_LANGUAGES.includes(saved as SupportedLanguage)) {
      if (!i18n.language?.startsWith(saved)) {
        await i18n.changeLanguage(saved);
      }
    }
  } catch {
    // Backend not ready or setting doesn't exist
  }
}

export default i18n;
