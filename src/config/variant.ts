// The header tabs, in order: HOME (the signed-in account/metrics landing — Hanzo
// Cloud usage + bill scoped to the caller's org/project), then AI, CRYPTO,
// FINANCE, TECH, and WORLD (the full geopolitical map).
export const VARIANTS = ['home', 'ai', 'crypto', 'finance', 'tech', 'full'] as const;
export type Variant = (typeof VARIANTS)[number];
const isVariant = (v: string | null): v is Variant => !!v && (VARIANTS as readonly string[]).includes(v);

export const SITE_VARIANT: string = (() => {
  if (typeof window !== 'undefined') {
    // Shareable, subdomain-free selection: ?variant=home|ai|crypto|finance|tech|full
    // wins and is persisted so it survives navigation. Falls back to the stored
    // choice, then the build-time default.
    const fromUrl = new URLSearchParams(window.location.search).get('variant');
    if (isVariant(fromUrl)) {
      localStorage.setItem('worldmonitor-variant', fromUrl);
      return fromUrl;
    }
    const stored = localStorage.getItem('worldmonitor-variant');
    if (isVariant(stored)) return stored;
  }
  return import.meta.env.VITE_VARIANT || 'full';
})();
