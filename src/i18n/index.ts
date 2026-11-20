import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './en.json';

/** English is the default; the structure is ready for more languages (incl. RTL). */
export async function initI18n(language = 'en'): Promise<void> {
  if (i18next.isInitialized) {
    await i18next.changeLanguage(language);
    return;
  }
  await i18next.use(initReactI18next).init({
    lng: language,
    fallbackLng: 'en',
    resources: { en: { translation: en } },
    interpolation: { escapeValue: false },
  });
}
