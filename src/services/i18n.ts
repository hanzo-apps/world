import i18next from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import en from '../locales/en.json';
import fr from '../locales/fr.json';
import de from '../locales/de.json';
import es from '../locales/es.json';
import it from '../locales/it.json';
import pl from '../locales/pl.json';
import pt from '../locales/pt.json';
import nl from '../locales/nl.json';
import sv from '../locales/sv.json';
import ru from '../locales/ru.json';

const resources = {
  en: { translation: en },
  fr: { translation: fr },
  de: { translation: de },
  es: { translation: es },
  it: { translation: it },
  pl: { translation: pl },
  pt: { translation: pt },
  nl: { translation: nl },
  sv: { translation: sv },
  ru: { translation: ru },
};

// Initialize i18n
export async function initI18n(): Promise<void> {
  await i18next
    .use(LanguageDetector)
    .init({
      resources,
      fallbackLng: 'en',
      debug: import.meta.env.DEV,
      interpolation: {
        escapeValue: false, // not needed for these simple strings
      },
      detection: {
        order: ['localStorage', 'navigator'],
        caches: ['localStorage'],
      },
    });
}

// Helper to translate
export function t(key: string, options?: Record<string, unknown>): string {
  return i18next.t(key, options);
}

// Helper to change language
export async function changeLanguage(lng: string): Promise<void> {
  await i18next.changeLanguage(lng);
  window.location.reload(); // Simple reload to update all components for now
}

// Helper to get current language
export function getCurrentLanguage(): string {
  return i18next.language || 'en';
}

export const LANGUAGES = [
  { code: 'en', label: 'English', flag: '🇬🇧' },
  { code: 'fr', label: 'Français', flag: '🇫🇷' },
  { code: 'de', label: 'Deutsch', flag: '🇩🇪' },
  { code: 'es', label: 'Español', flag: '🇪🇸' },
  { code: 'it', label: 'Italiano', flag: '🇮🇹' },
  { code: 'pl', label: 'Polski', flag: '🇵🇱' },
  { code: 'pt', label: 'Português', flag: '🇵🇹' },
  { code: 'nl', label: 'Nederlands', flag: '🇳🇱' },
  { code: 'sv', label: 'Svenska', flag: '🇸🇪' },
  { code: 'ru', label: 'Русский', flag: '🇷🇺' },
];
