// The canonical variants. `cloud` is the flagship Hanzo Cloud view (the H + Cloud
// surface: live-traffic globe + platform/flywheel metrics). It folds the former
// `saas` variant and the interim `hanzo` id — both are ALIASES that normalize to
// `cloud`, so existing ?variant=saas / ?variant=hanzo links and stored prefs keep
// working. The BRAND is Hanzo (the H mark); the VIEW is Cloud.
const VALID_VARIANTS = ['full', 'tech', 'finance', 'cloud', 'ai', 'crypto'] as const;

// normVariant maps a raw value to a canonical variant (aliasing saas/hanzo→cloud),
// or null when it is unknown.
function normVariant(v: string | null | undefined): string | null {
  if (v === 'saas' || v === 'hanzo') return 'cloud';
  return v && (VALID_VARIANTS as readonly string[]).includes(v) ? v : null;
}

// isHanzoBrandHost reports whether the Hanzo brand surface (the H-logo toggle + the
// Cloud switcher entry) may appear. White-label rule: ONLY hanzo.ai / hanzo.app
// hosts — never Lux/Zoo/upstream worldmonitor.app deployments. Local dev counts so
// the flagship is what you see with `npm run dev`.
export function isHanzoBrandHost(): boolean {
  if (typeof window === 'undefined') return false;
  const h = window.location.hostname;
  return h === 'world.hanzo.ai' || h.endsWith('.hanzo.ai') || h.endsWith('.hanzo.app') ||
    h === 'localhost' || h === '127.0.0.1';
}

// isCloudDefaultHost is narrower than the brand host: where `cloud` is the DEFAULT
// variant. Only the flagship world.hanzo.ai (+ local dev) — so tech.hanzo.ai etc.
// keep their own build default.
function isCloudDefaultHost(): boolean {
  if (typeof window === 'undefined') return false;
  const h = window.location.hostname;
  return h === 'world.hanzo.ai' || h === 'localhost' || h === '127.0.0.1';
}

export const SITE_VARIANT: string = (() => {
  if (typeof window !== 'undefined') {
    // Shareable, subdomain-free selection: ?variant=full|tech|finance|cloud|ai|crypto
    // (saas/hanzo → cloud) wins and is persisted so it survives navigation. Falls
    // back to the stored choice, then the host default, then the build-time default.
    const fromUrl = normVariant(new URLSearchParams(window.location.search).get('variant'));
    if (fromUrl) {
      localStorage.setItem('worldmonitor-variant', fromUrl);
      return fromUrl;
    }
    const stored = normVariant(localStorage.getItem('worldmonitor-variant'));
    if (stored) return stored;
    // Host default: world.hanzo.ai leads with the Cloud view — but ONLY when the
    // build did not pin a variant (so `VITE_VARIANT=full playwright test` and the
    // OSS per-variant builds are never overridden).
    if (isCloudDefaultHost() && !import.meta.env.VITE_VARIANT) return 'cloud';
  }
  const build = import.meta.env.VITE_VARIANT;
  return build === 'saas' || build === 'hanzo' ? 'cloud' : build || 'full';
})();

// Default basemap style when the user has not picked one. Cloud + AI lead with
// the dotted-land "cybermap" globe (the live Hanzo-traffic surface); every other
// variant keeps the near-black dark basemap. Persisted choice always wins.
export const DEFAULT_BASEMAP_STYLE: 'dark' | 'dot' | 'satellite' | 'terrain' =
  SITE_VARIANT === 'cloud' || SITE_VARIANT === 'ai' ? 'dot' : 'dark';
