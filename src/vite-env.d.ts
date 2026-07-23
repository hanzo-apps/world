/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  // Write-only publishable ingest key for anonymous /v1/event ingest (@hanzo/event).
  readonly VITE_HANZO_INGEST_KEY?: string;
  // Google Tag Manager container id (marketing tags — orthogonal to telemetry).
  readonly VITE_GTM_ID?: string;
}
