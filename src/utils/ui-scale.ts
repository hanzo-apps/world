// User-adjustable UI text scale (accessibility — "adaptable to people's needs").
//
// The dashboard is 100% px-sized text, so a root font-size can't scale it. Instead a
// single --ui-scale CSS var drives `zoom` on the readable CONTENT containers
// (.panel-content — see main.css), never the panels-grid, so the free-mode drag/snap
// coordinate space is unaffected. Persisted per-browser in localStorage; the per-user
// SQLite dashboard-sync picks up the key automatically (it observes dashboard keys).

const KEY = 'hanzo-world-ui-scale';
export const UI_SCALE_MIN = 0.8;
export const UI_SCALE_MAX = 1.6;

function clamp(v: number): number {
  return Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, Math.round(v * 10) / 10));
}

/** The saved scale (1 = default), clamped to the supported range. */
export function getUiScale(): number {
  const v = parseFloat(localStorage.getItem(KEY) ?? '');
  return Number.isFinite(v) ? clamp(v) : 1;
}

/** Set + persist + apply the scale. */
export function setUiScale(scale: number): void {
  const v = clamp(scale);
  try {
    localStorage.setItem(KEY, String(v));
  } catch {
    /* private mode — applies for the session, just won't persist */
  }
  apply(v);
}

/** Apply the stored scale to the document (call once at boot, before first paint). */
export function applyStoredUiScale(): void {
  apply(getUiScale());
}

function apply(v: number): void {
  document.documentElement.style.setProperty('--ui-scale', String(v));
}
