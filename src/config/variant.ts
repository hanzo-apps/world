const VALID_VARIANTS = ['full', 'tech', 'finance', 'happy', 'commodity', 'energy'] as const;
type ValidVariant = typeof VALID_VARIANTS[number];

function isValidVariant(v: string | null | undefined): v is ValidVariant {
  return Boolean(v) && (VALID_VARIANTS as readonly string[]).includes(v as string);
}

const buildVariant = (() => {
  try {
    const v = import.meta.env?.VITE_VARIANT;
    return isValidVariant(v) ? v : 'full';
  } catch {
    return 'full';
  }
})();

/**
 * Variant resolution order:
 *   1. Tauri desktop:           stored preference (per-install) → build-time variant
 *   2. Path prefix (canonical): /tech | /finance | /commodity | /happy | /energy
 *   3. Subdomain (legacy):      tech.world.hanzo.ai, etc.
 *   4. localhost / dev:         stored preference → build-time variant
 *   5. Else:                    'full' (the world.hanzo.ai root)
 *
 * Path-based detection is the canonical single-domain approach
 * (`world.hanzo.ai/tech` rather than `tech.world.hanzo.ai`). Subdomain
 * detection is kept so existing deployments keep working during the DNS
 * cutover and so direct links to the variant subdomains still resolve.
 */
export const SITE_VARIANT: string = (() => {
  if (typeof window === 'undefined') return buildVariant;

  const isTauri = '__TAURI_INTERNALS__' in window || '__TAURI__' in window;
  if (isTauri) {
    const stored = localStorage.getItem('worldmonitor-variant');
    if (isValidVariant(stored)) return stored;
    return buildVariant;
  }

  // Path-prefix detection: world.hanzo.ai/tech, /finance, etc.
  const firstSeg = location.pathname.split('/')[1]?.toLowerCase() ?? '';
  if (isValidVariant(firstSeg) && firstSeg !== 'full') return firstSeg;

  // Subdomain detection (legacy).
  const h = location.hostname;
  if (h.startsWith('tech.')) return 'tech';
  if (h.startsWith('finance.')) return 'finance';
  if (h.startsWith('happy.')) return 'happy';
  if (h.startsWith('commodity.')) return 'commodity';
  if (h.startsWith('energy.')) return 'energy';

  if (h === 'localhost' || h === '127.0.0.1') {
    const stored = localStorage.getItem('worldmonitor-variant');
    if (isValidVariant(stored)) return stored;
    return buildVariant;
  }

  return 'full';
})();
