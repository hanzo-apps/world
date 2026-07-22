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
//
// SCOPES: the dashboard has an optional ORG-SHARED default (sharedEndpoint) an org
// admin publishes for the whole org. On boot the org default is hydrated FIRST (the
// base), then the user's own doc is overlaid on top (the user always wins) — so a
// fresh member sees the org's published layout and their own tweaks override it.
// publishOrgDashboard() PUTs the current layout to the shared endpoint (admin-only,
// enforced server-side).

interface SyncGroup {
  endpoint: string;
  // Optional org-wide default, hydrated BEFORE (under) the per-user endpoint. Writes
  // never go here automatically — only the explicit publishOrgDashboard() verb does.
  sharedEndpoint?: string;
  fixed: string[];
  prefix?: string;
  timer: ReturnType<typeof setTimeout> | null;
}

// One group per namespace; keys are disjoint across groups.
const GROUPS: SyncGroup[] = [
  {
    endpoint: '/v1/world/dashboard',
    sharedEndpoint: '/v1/world/dashboard/shared',
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

// GET a scope's blob. Returns the config object (possibly empty) on success, or null
// when the server can't be reached / refuses (offline, 401/403 on the shared scope).
async function fetchDoc(endpoint: string): Promise<SyncDoc | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(`${base()}${endpoint}`, { headers: await orgHeaders(), signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = (await res.json()) as { config?: SyncDoc };
    return data.config ?? {};
  } catch {
    return null;
  }
}

// One hydrate pass, scope-parameterized. The org-shared default (if the group has
// one) is applied FIRST as the base, then the user's own doc is overlaid on top so
// the user always wins. Both scopes are fetched concurrently (boot stays bounded by
// one timeout) but applied in precedence order. Writes only ever target the per-user
// endpoint — the shared default changes solely via publishOrgDashboard().
async function hydrate(g: SyncGroup): Promise<void> {
  const local = snapshot(g); // this device's pre-hydrate (anonymous) layout
  const [shared, user] = await Promise.all([
    g.sharedEndpoint ? fetchDoc(g.sharedEndpoint) : Promise.resolve<SyncDoc | null>(null),
    fetchDoc(g.endpoint),
  ]);
  // Base layer: the org default (lowest precedence). Absent/empty/forbidden → skipped.
  if (shared && !isEmpty(shared)) apply(g, shared);
  if (user === null) return; // couldn't reach the user scope — boot local, first change re-syncs
  if (isEmpty(user)) {
    // No per-user doc yet. Keep the org default applied, but migrate any pre-existing
    // anonymous layout (first sign-in) so it isn't stranded — and let it win.
    if (!isEmpty(local)) {
      apply(g, local);
      void put(g, local);
    }
    return;
  }
  apply(g, user); // the user's own doc overrides the org default
}

/**
 * Publish the user's CURRENT dashboard as the ORG default — the "make my layout the
 * team default" verb. Admin-only on the server (a non-admin gets 403 and nothing
 * changes), so callers should only surface the trigger to admins. Snapshots the live
 * dashboard group and PUTs it to the shared endpoint. Returns whether it was accepted.
 */
export async function publishOrgDashboard(): Promise<boolean> {
  const g = GROUPS.find((x) => x.sharedEndpoint);
  if (!g?.sharedEndpoint || !isAuthenticated()) return false;
  try {
    const res = await fetch(`${base()}${g.sharedEndpoint}`, {
      method: 'PUT',
      headers: await orgHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(snapshot(g)),
    });
    return res.ok;
  } catch {
    return false;
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
