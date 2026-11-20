import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './en.json';

/**
 * Languages shipping in the bundle. Adding a language means dropping a
 * `<code>.json` next to `en.json` and registering it here — the language
 * selector and the `dir` attribute are driven by this list, so RTL locales
 * such as `ar` or `he` work without further changes.
 */
export const LANGUAGES = [{ code: 'en', label: 'English', dir: 'ltr' as const }];

const RTL_LANGUAGES = new Set(['ar', 'fa', 'he', 'ur']);

export function languageDirection(code: string): 'ltr' | 'rtl' {
  const base = code.split('-')[0] ?? code;
  return RTL_LANGUAGES.has(base) ? 'rtl' : 'ltr';
}

/** Reflect the active language on <html lang/dir> for screen readers and layout. */
function applyDocumentLanguage(code: string): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = code;
  document.documentElement.dir = languageDirection(code);
}

/** English is the default; the structure is ready for more languages (incl. RTL). */
export async function initI18n(language = 'en'): Promise<void> {
  if (!i18next.isInitialized) {
    await i18next.use(initReactI18next).init({
      lng: language,
      fallbackLng: 'en',
      resources: { en: { translation: en } },
      interpolation: { escapeValue: false },
      returnNull: false,
    });
  } else {
    await i18next.changeLanguage(language);
  }
  applyDocumentLanguage(i18next.language || language);
}
