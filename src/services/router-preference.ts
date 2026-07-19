// Enso Router — org cost↔quality preference.
//
// Same-origin proxy (/v1/world/cloud/router-preference → ai gateway
// /v1/router/preference, org-scoped by the caller's forwarded bearer). One knob:
// `bias` in [0,1] — 0 = max savings (cheapest model that clears the quality bar),
// 1 = max quality (always the best model), 0.5 = balanced. `default` is the
// platform's neutral bias.
//
// Never throws: the world proxy answers a well-formed {available:false} on any
// upstream failure, and if even that can't be reached (e.g. the route is not yet
// deployed and prod 404s the path) we degrade to a disabled balanced default so
// the slider renders read-only rather than erroring.

export interface RouterPreference {
  bias: number;      // 0..1
  default: number;   // 0..1 — platform neutral
  available: boolean; // false → control is read-only (endpoint not live / not saved)
}

const DISABLED: RouterPreference = { bias: 0.5, default: 0.5, available: false };

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0.5;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function normalize(raw: unknown): RouterPreference {
  const r = (raw ?? {}) as Partial<RouterPreference>;
  const bias = typeof r.bias === 'number' ? clamp01(r.bias) : 0.5;
  const def = typeof r.default === 'number' ? clamp01(r.default) : 0.5;
  return { bias, default: def, available: r.available === true };
}

/** Current org routing bias (same-origin proxy). Degrades to a disabled balanced
 * default rather than throwing, so the panel always has something to render. */
export async function getRouterPreference(): Promise<RouterPreference> {
  try {
    const res = await fetch('/v1/world/cloud/router-preference');
    if (!res.ok) return DISABLED;
    return normalize(await res.json());
  } catch {
    return DISABLED;
  }
}

/** Persist a new routing bias for the caller's org. Returns the saved preference;
 * on any failure returns {available:false} (echoing the attempted bias) so the
 * caller shows a "couldn't save" state without losing the user's slider position. */
export async function setRouterPreference(bias: number): Promise<RouterPreference> {
  const attempted = clamp01(bias);
  try {
    const res = await fetch('/v1/world/cloud/router-preference', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bias: attempted }),
    });
    if (!res.ok) return { bias: attempted, default: 0.5, available: false };
    return normalize(await res.json());
  } catch {
    return { bias: attempted, default: 0.5, available: false };
  }
}
