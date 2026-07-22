// The canonical variants. `cloud` is the flagship Hanzo Cloud view (the H + Cloud
// surface: live-traffic globe + platform/flywheel metrics). It folds the former
// `saas` variant and the interim `hanzo` id — both are ALIASES that normalize to
// `cloud`, so existing ?variant=saas / ?variant=hanzo links and stored prefs keep
// working. The BRAND is Hanzo (the H mark); the VIEW is Cloud.
const VALID_VARIANTS = ['full', 'tech', 'finance', 'cloud', 'ai', 'crypto', 'fund'] as const;

// normVariant maps a raw value to a canonical variant (aliasing saas/hanzo→cloud),
// or null when it is unknown.
function normVariant(v: string | null | undefined): string | null {
  if (v === 'saas' || v === 'hanzo') return 'cloud';
  return v && (VALID_VARIANTS as readonly string[]).includes(v) ? v : null;
}

// isLuxFundHost reports whether we are serving the Lux Fund white-label surface
// (lux.fund). White-label rule: the Lux brand + the `fund` macro terminal appear
// here — never the Hanzo mark. The whole app is the same World engine; only the
// brand and the default view differ by host.
export function isLuxFundHost(): boolean {
  if (typeof window === 'undefined') return false;
  const h = window.location.hostname;
  return h === 'lux.fund' || h.endsWith('.lux.fund');
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
    // lux.fund leads with the `fund` macro terminal (rotation + the Lux book on the
    // globe) — same guard as the Cloud default: only when the build didn't pin a
    // variant, so per-variant builds and tests are never overridden.
    if (isLuxFundHost() && !import.meta.env.VITE_VARIANT) return 'fund';
    // Host default: world.hanzo.ai leads with the Cloud view — but ONLY when the
    // build did not pin a variant (so `VITE_VARIANT=full playwright test` and the
    // OSS per-variant builds are never overridden).
    if (isCloudDefaultHost() && !import.meta.env.VITE_VARIANT) return 'cloud';
  }
  const build = import.meta.env.VITE_VARIANT;
  return build === 'saas' || build === 'hanzo' ? 'cloud' : build || 'full';
})();

// The LIVE variant. SITE_VARIANT is the load-time snapshot (kept for boot-only
// reads); currentVariant is the mutable value that an in-place tab switch
// updates so the app can change view without a page reload. Every read that must
// reflect the current view calls getSiteVariant() — one value, one source.
let currentVariant = SITE_VARIANT;

// getSiteVariant returns the live variant. Prefer this over SITE_VARIANT anywhere
// the value is read at call/render time (it stays correct across an in-place switch).
export function getSiteVariant(): string {
  return currentVariant;
}

// setSiteVariantRuntime switches the live variant in place (no reload). Normalizes
// via the same canonicalizer as boot (saas/hanzo → cloud), persists the choice so
// it survives a later navigation, and returns the applied variant — or null when
// the value is unknown (caller no-ops).
export function setSiteVariantRuntime(v: string): string | null {
  const nv = normVariant(v);
  if (!nv) return null;
  currentVariant = nv;
  try {
    localStorage.setItem('worldmonitor-variant', nv);
  } catch {
    /* private mode — the URL still carries the choice */
  }
  return nv;
}

// Default basemap style when the user has not picked one. Every variant opens on
// the dotted-land "cybermap" globe — the glowing dot lattice is the cinematic hero
// across all modes. Users can still switch to dark / satellite / terrain via the
// style switcher, and a persisted choice always wins.
export const DEFAULT_BASEMAP_STYLE: 'dark' | 'dot' | 'satellite' | 'terrain' = 'dot';
