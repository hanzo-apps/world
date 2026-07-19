import { isAuthenticated, orgHeaders } from '@/services/iam';
import { isDesktopRuntime, getRemoteApiBaseUrl } from '@/services/runtime';

// Per-identity sync — the ONE path between the signed-in user's browser state and
// where it lives on the server. Two concerns, ONE mechanism:
//   • DASHBOARD  (/v1/world/dashboard) — panels/order/spans, map cols/layers/mode,
//     custom feeds, disabled sources, the free-layout geometry, text/grid size.
//   • HISTORY    (/v1/world/history)   — the user's REAL actions: recent searches,
//     watch queue.
// Each is nothing more than a fixed set of localStorage keys, so we OBSERVE writes to
// those keys (one setItem/removeItem interceptor) and debounce a save to the RIGHT
// endpoint. The writers (App, grid-config, Panel, SearchModal, watch-queue) never
// learn about the server — they just use localStorage. Blobs are opaque (each value
// stored verbatim); this module never interprets them, and they hold layout/usage
// state only — NEVER secrets. Signed out, everything stays local (no server state).

interface SyncGroup {
  endpoint: string;
  fixed: string[];
  prefix?: string;
  timer: ReturnType<typeof setTimeout> | null;
}

// One group per namespace; keys are disjoint across groups.
const GROUPS: SyncGroup[] = [
  {
    endpoint: '/v1/world/dashboard',
    fixed: [
      'panel-order',
      'worldmonitor-panels',
      'worldmonitor-layers',
      'worldmonitor-disabled-feeds',
      'worldmonitor-panel-spans',
      'worldmonitor-panel-cols',
      'hanzo-world-custom-panels',
      'hanzo-world-map-mode',
      'hanzo-world-ui-scale', // text-size / UI scale (accessibility)
      'hanzo-world-grid-size', // dock cell-size fallback
    ],
    prefix: 'worldmonitor-layout:', // per-variant free geometry + mode
    timer: null,
  },
  {
    endpoint: '/v1/world/history',
    fixed: [
      'worldmonitor_recent_searches', // SearchModal recent searches
      'hanzo-world-watch-queue', // watch queue + watched status
    ],
    timer: null,
  },
];

const SAVE_DEBOUNCE_MS = 800;
type SyncDoc = Record<string, string>;

// Pristine setItem captured before we patch the prototype, so apply()/hydrate write
// to localStorage WITHOUT re-firing a save.
const rawSetItem = localStorage.setItem.bind(localStorage);

function base(): string {
  return isDesktopRuntime() ? getRemoteApiBaseUrl() : '';
}

function inGroup(g: SyncGroup, key: string): boolean {
  return g.fixed.includes(key) || (!!g.prefix && key.startsWith(g.prefix));
}
function groupFor(key: string): SyncGroup | null {
  for (const g of GROUPS) if (inGroup(g, key)) return g;
  return null;
}

// The group's keys currently present in localStorage (fixed set + prefix family).
function presentKeys(g: SyncGroup): string[] {
  const keys = new Set<string>(g.fixed.filter((k) => localStorage.getItem(k) !== null));
  if (g.prefix) {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(g.prefix)) keys.add(k);
    }
  }
  return [...keys];
}

function snapshot(g: SyncGroup): SyncDoc {
  const doc: SyncDoc = {};
  for (const k of presentKeys(g)) {
    const v = localStorage.getItem(k);
    if (v !== null) doc[k] = v;
  }
  return doc;
}

// Restore a server blob into localStorage verbatim (server precedence). Only keys
// that belong to the group are applied, via the raw writer (never re-fires a save).
function apply(g: SyncGroup, doc: SyncDoc): void {
  for (const [k, v] of Object.entries(doc)) {
    if (!inGroup(g, k) || typeof v !== 'string') continue;
    try {
      rawSetItem(k, v);
    } catch {
      /* private mode — nothing to persist locally */
    }
  }
}

function isEmpty(doc: SyncDoc): boolean {
  return Object.keys(doc).length === 0;
}

/**
 * Boot hook: when signed in, pull each per-identity blob from the server and write it
 * into localStorage BEFORE the app reads it (server precedence across devices), then
 * observe further changes so any mutation auto-syncs to the right namespace. Bounded +
 * best-effort — a slow or failed server never blocks boot. No-op when signed out (the
 * anonymous, localStorage-only experience is unchanged).
 */
export async function initDashboardSync(): Promise<void> {
  if (!isAuthenticated()) return;
  await Promise.all(GROUPS.map(hydrate));
  install();
}

async function hydrate(g: SyncGroup): Promise<void> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(`${base()}${g.endpoint}`, { headers: await orgHeaders(), signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return;
    const data = (await res.json()) as { config?: SyncDoc };
    const server = data.config ?? {};
    if (isEmpty(server)) {
      // Nothing on the server yet — adopt whatever this device already has (first
      // sign-in) rather than leaving it stranded in localStorage only.
      const local = snapshot(g);
      if (!isEmpty(local)) void put(g, local);
      return;
    }
    apply(g, server);
  } catch {
    /* offline / slow — boot from local, and the first change re-syncs */
  }
}

let installed = false;

// Intercept writes to any synced key and debounce a save to its group's endpoint.
// Installed after hydrate so restoring a server blob doesn't bounce straight back.
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
    if (this === localStorage) scheduleFor(key);
  };
  proto.removeItem = function (key: string): void {
    protoRemove.call(this, key);
    if (this === localStorage) scheduleFor(key);
  };
}

function scheduleFor(key: string): void {
  if (!isAuthenticated()) return; // signed out mid-session — stop syncing
  const g = groupFor(key);
  if (!g) return;
  if (g.timer) clearTimeout(g.timer);
  g.timer = setTimeout(() => {
    g.timer = null;
    void put(g, snapshot(g));
  }, SAVE_DEBOUNCE_MS);
}

async function put(g: SyncGroup, doc: SyncDoc): Promise<void> {
  try {
    await fetch(`${base()}${g.endpoint}`, {
      method: 'PUT',
      headers: await orgHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(doc),
    });
  } catch {
    /* offline — localStorage already has it; the next change re-syncs */
  }
}
