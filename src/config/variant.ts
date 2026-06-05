const VALID_VARIANTS = ['full', 'tech', 'finance', 'happy', 'commodity', 'energy'] as const;
type ValidVariant = typeof VALID_VARIANTS[number];

function asValidVariant(v: string | null | undefined): ValidVariant | null {
  return v && (VALID_VARIANTS as readonly string[]).includes(v) ? (v as ValidVariant) : null;
}

const buildVariant: ValidVariant = (() => {
  try {
    return asValidVariant(import.meta.env?.VITE_VARIANT) ?? 'full';
  } catch {
    return 'full';
  }
})();

function storedVariant(): ValidVariant | null {
  try {
    return asValidVariant(localStorage.getItem('worldmonitor-variant'));
  } catch {
    return null;
  }
}

function pathVariant(): ValidVariant | null {
  if (typeof location === 'undefined') return null;
  const seg = location.pathname.split('/')[1]?.toLowerCase() ?? '';
  // 'full' from the path is a no-op — the root IS full; only non-default
  // path segments register as a variant.
  return seg && seg !== 'full' ? asValidVariant(seg) : null;
}

function isDesktopRuntime(): boolean {
  return typeof window !== 'undefined'
    && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
}

function isDevHost(): boolean {
  return typeof location !== 'undefined'
    && (location.hostname === 'localhost' || location.hostname === '127.0.0.1');
}

/**
 * SITE_VARIANT — the active variant of the world.hanzo.ai SPA.
 *
 *   Desktop runtime  →  stored preference, else compiled-in build variant.
 *   Web (production) →  first path segment, else 'full'.
 *   Web (localhost)  →  first path segment, else stored preference, else
 *                       compiled-in build variant.
 *
 * Single-domain by design: every variant is served from world.hanzo.ai
 * under a path prefix (`/tech`, `/finance`, ...). Legacy variant
 * subdomains (tech.world.hanzo.ai etc.) should 301 → the canonical
 * path-prefix URL at the edge.
 */
export const SITE_VARIANT: string = (() => {
  if (typeof window === 'undefined') return buildVariant;
  if (isDesktopRuntime()) return storedVariant() ?? buildVariant;

  const fromPath = pathVariant();
  if (fromPath) return fromPath;

  if (isDevHost()) return storedVariant() ?? buildVariant;
  return 'full';
})();
