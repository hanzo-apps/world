import { isAuthenticated, orgHeaders } from '@/services/iam';
import { isDesktopRuntime, getRemoteApiBaseUrl } from '@/services/runtime';

// Dashboard sync — the ONE path between the composed dashboard and where it lives.
//
// Signed in, the Go backend owns the dashboard: the full composition — panel
// order, visibility, spans, map cols/layers/mode, custom feed panels, disabled
// sources, AND the layout-engine geometry (free {x,y,w,h} / mode / cellSize /
// gridCols) — is persisted per identity, so it follows the user across devices and
// every change the AI analyst or toolbar makes survives a reload anywhere. Signed
// out, everything stays in localStorage exactly as before (no server state).
//
// It is DECOUPLED from the writers: the dashboard is nothing more than a fixed set
// of localStorage keys, so we OBSERVE writes to those keys (one setItem/removeItem
// interceptor) and debounce a single server save. App, grid-config and Panel never
// learn about the server — they just write localStorage as they always did. The
// blob is opaque (each value stored verbatim); this module never interprets it, and
// it holds layout only — NEVER secrets.

// The keys that together ARE the dashboard. Fixed keys + the per-variant layout
// family (worldmonitor-layout:<variant> holds v2.4.19's free geometry + mode).
const FIXED_KEYS = [
  'panel-order',
  'worldmonitor-panels',
  'worldmonitor-layers',
  'worldmonitor-disabled-feeds',
  'worldmonitor-panel-spans',
  'worldmonitor-panel-cols',
  'hanzo-world-custom-panels',
  'hanzo-world-map-mode',
  'hanzo-world-ui-scale', // text-size / UI scale (accessibility)
  'hanzo-world-grid-size', // dock cell-size fallback (when window.worldGrid is absent)
];
const LAYOUT_PREFIX = 'worldmonitor-layout:';
const SAVE_DEBOUNCE_MS = 800;

type DashboardConfig = Record<string, string>;

// Pristine setItem captured before we patch the prototype, so apply()/hydrate write
// to localStorage WITHOUT re-firing a save.
const rawSetItem = localStorage.setItem.bind(localStorage);

function base(): string {
  return isDesktopRuntime() ? getRemoteApiBaseUrl() : '';
}

function isDashboardKey(key: string): boolean {
  return FIXED_KEYS.includes(key) || key.startsWith(LAYOUT_PREFIX);
}

// The dashboard keys currently present in localStorage (fixed set + every layout
// variant), so multi-variant layouts all persist together.
function presentKeys(): string[] {
  const keys = new Set<string>(FIXED_KEYS.filter((k) => localStorage.getItem(k) !== null));
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(LAYOUT_PREFIX)) keys.add(k);
  }
  return [...keys];
}

function snapshot(): DashboardConfig {
  const cfg: DashboardConfig = {};
  for (const k of presentKeys()) {
    const v = localStorage.getItem(k);
    if (v !== null) cfg[k] = v;
  }
  return cfg;
}

// Restore a server config into localStorage verbatim (server precedence). Uses the
// raw writer so hydration never echoes straight back to the server.
function apply(cfg: DashboardConfig): void {
  for (const [k, v] of Object.entries(cfg)) {
    if (!isDashboardKey(k) || typeof v !== 'string') continue;
    try {
      rawSetItem(k, v);
    } catch {
      /* private mode — nothing to persist locally */
    }
  }
}

function isEmpty(cfg: DashboardConfig): boolean {
  return Object.keys(cfg).length === 0;
}

/**
 * Boot hook: when signed in, pull this identity's dashboard from the server and
 * write it into localStorage BEFORE the app reads it (server precedence across
 * devices), then observe further changes so any dashboard mutation auto-syncs.
 * Bounded + best-effort — a slow or failed server never blocks boot. No-op when
 * signed out (the anonymous, localStorage-only experience is unchanged).
 */
export async function initDashboardSync(): Promise<void> {
  if (!isAuthenticated()) return;
  await hydrate();
  install();
}

async function hydrate(): Promise<void> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(`${base()}/v1/world/dashboard`, { headers: await orgHeaders(), signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return;
    const data = (await res.json()) as { config?: DashboardConfig };
    const server = data.config ?? {};
    if (isEmpty(server)) {
      // Nothing on the server yet — adopt whatever this device already has (first
      // sign-in) rather than leaving it stranded in localStorage only.
      const local = snapshot();
      if (!isEmpty(local)) void put(local);
      return;
    }
    apply(server);
  } catch {
    /* offline / slow — boot from local, and the first change re-syncs */
  }
}

let installed = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

// Intercept writes to the dashboard keys (from App, grid-config or Panel — any
// writer) and debounce ONE server save. Installed after hydrate so restoring the
// server blob doesn't bounce straight back.
function install(): void {
  if (installed) return;
  installed = true;
  // Patch the Storage PROTOTYPE (a localStorage instance won't accept a shadowing
  // setItem in every engine), guarding on `this === localStorage` so sessionStorage
  // is untouched. The captured originals do the real write; we only add the save.
  const proto = Storage.prototype;
  const protoSet = proto.setItem;
  const protoRemove = proto.removeItem;
  proto.setItem = function (key: string, value: string): void {
    protoSet.call(this, key, value);
    if (this === localStorage && isDashboardKey(key)) schedule();
  };
  proto.removeItem = function (key: string): void {
    protoRemove.call(this, key);
    if (this === localStorage && isDashboardKey(key)) schedule();
  };
}

function schedule(): void {
  if (!isAuthenticated()) return; // signed out mid-session — stop syncing
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void put(snapshot());
  }, SAVE_DEBOUNCE_MS);
}

async function put(cfg: DashboardConfig): Promise<void> {
  try {
    await fetch(`${base()}/v1/world/dashboard`, {
      method: 'PUT',
      headers: await orgHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(cfg),
    });
  } catch {
    /* offline — localStorage already has it; the next change re-syncs */
  }
}
