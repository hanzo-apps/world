/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  readonly VITE_SENTRY_DSN?: string;
  readonly VITE_ANALYTICS_WEBSITE_ID?: string;
  readonly VITE_GTM_ID?: string;
}
