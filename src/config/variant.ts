// The canonical variants. `hanzo` is the flagship Hanzo view (folds the former
// `saas` cloud variant + adds the live-traffic globe); `saas` is kept as an ALIAS
// that normalizes to `hanzo` so existing ?variant=saas links keep working.
const VALID_VARIANTS = ['full', 'tech', 'finance', 'hanzo', 'ai', 'crypto'] as const;

// normVariant maps a raw value to a canonical variant (aliasing saas→hanzo), or
// null when it is unknown.
function normVariant(v: string | null | undefined): string | null {
  if (v === 'saas') return 'hanzo';
  return v && (VALID_VARIANTS as readonly string[]).includes(v) ? v : null;
}

// isHanzoBrandHost reports whether the Hanzo brand surface (the H-logo toggle + the
// Hanzo switcher entry) may appear. White-label rule: ONLY hanzo.ai / hanzo.app
// hosts — never Lux/Zoo/upstream worldmonitor.app deployments. Local dev counts so
// the flagship is what you see with `npm run dev`.
export function isHanzoBrandHost(): boolean {
  if (typeof window === 'undefined') return false;
  const h = window.location.hostname;
  return h === 'world.hanzo.ai' || h.endsWith('.hanzo.ai') || h.endsWith('.hanzo.app') ||
    h === 'localhost' || h === '127.0.0.1';
}

// isHanzoDefaultHost is narrower than the brand host: where `hanzo` is the DEFAULT
// variant. Only the flagship world.hanzo.ai (+ local dev) — so tech.hanzo.ai etc.
// keep their own build default.
function isHanzoDefaultHost(): boolean {
  if (typeof window === 'undefined') return false;
  const h = window.location.hostname;
  return h === 'world.hanzo.ai' || h === 'localhost' || h === '127.0.0.1';
}

export const SITE_VARIANT: string = (() => {
  if (typeof window !== 'undefined') {
    // Shareable, subdomain-free selection: ?variant=full|tech|finance|hanzo|ai|crypto
    // (saas → hanzo) wins and is persisted so it survives navigation. Falls back to
    // the stored choice, then the host default, then the build-time default.
    const fromUrl = normVariant(new URLSearchParams(window.location.search).get('variant'));
    if (fromUrl) {
      localStorage.setItem('worldmonitor-variant', fromUrl);
      return fromUrl;
    }
    const stored = normVariant(localStorage.getItem('worldmonitor-variant'));
    if (stored) return stored;
    // Host default: world.hanzo.ai leads with the Hanzo view — but ONLY when the
    // build did not pin a variant (so `VITE_VARIANT=full playwright test` and the
    // OSS per-variant builds are never overridden).
    if (isHanzoDefaultHost() && !import.meta.env.VITE_VARIANT) return 'hanzo';
  }
  const build = import.meta.env.VITE_VARIANT;
  return build === 'saas' ? 'hanzo' : build || 'full';
})();
