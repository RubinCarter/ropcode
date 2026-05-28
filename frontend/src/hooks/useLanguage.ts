import { useTranslation } from 'react-i18next';
import { useCallback } from 'react';
import { SaveSetting } from '@/lib/rpc-client';
import { LANGUAGE_SETTING_KEY, SUPPORTED_LANGUAGES, type SupportedLanguage } from '@/lib/i18n';

export function useLanguage() {
  const { i18n } = useTranslation();

  const language: SupportedLanguage = i18n.language?.startsWith('zh') ? 'zh' : 'en';

  const changeLanguage = useCallback(async (lang: SupportedLanguage) => {
    await i18n.changeLanguage(lang);
    try {
      await SaveSetting(LANGUAGE_SETTING_KEY, lang);
    } catch {
      // localStorage fallback via i18next detector cache
    }
    // Notify Electron to rebuild menus (setLocale added in Task 10)
    const eAPI = window.electronAPI as (typeof window.electronAPI & { setLocale?: (lang: string) => void }) | undefined;
    if (eAPI?.setLocale) {
      eAPI.setLocale(lang);
    }
  }, [i18n]);

  return { language, changeLanguage, supportedLanguages: SUPPORTED_LANGUAGES };
}
