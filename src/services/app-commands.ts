/**
 * App command registry — the ONE introspectable control surface for the app.
 *
 * Rich-Hickey decomplected:
 *   - DATA:   COMMANDS is a flat list of typed command specs (name, JSON-schema
 *             params, human description, run()). It is the single source of truth.
 *   - PORT:   AppHost is the narrow capability interface the commands drive. App
 *             implements it; commands never reach into App internals.
 *   - POLICY: dispatch() is the ONE place actions are gated (sign-in), validated
 *             (against each command's schema), executed, and turned into a visible
 *             action log. Verification and enforcement live here, once.
 *   - CONTRACT: commandManifest() serialises {name, description, params} for the
 *             backend, so the analyst tool/prompt contract DERIVES from this file
 *             instead of duplicating it (see internal/world/handlers_analyst.go).
 *
 * Wire shape is a flat action object `{ "type": "<name>", ...params }` — the same
 * shape the backend already emits, extended (never versioned) with new commands.
 */

// ── Capability port ──────────────────────────────────────────────────────────

export interface AppState {
  variant: string;
  timeRange: string;
  mapMode?: '2d' | '3d';
  theme?: 'dark' | 'light';
  region?: string;
  authed?: boolean;
  /** grid | free | immersive — the layout mode the dock select drives. */
  layoutMode?: 'grid' | 'free' | 'immersive';
  /** What fills the immersive background. */
  immersiveBg?: 'map' | 'video';
  language?: string;
  /** The user's keyword monitors, so the analyst can reason about them. */
  monitors?: Array<{ id: string; keywords: string[] }>;
  /** Watch-queue depth + what is playing. */
  queue?: { total: number; unwatched: number; current?: string };
}

/** The dashboard capabilities the analyst is allowed to drive. App implements it. */
export interface AppHost {
  // introspection (grounds the model; also drives the action-log labels)
  getState(): AppState;
  listPanels(): Array<{ key: string; name: string; enabled: boolean }>;
  listLayers(): Array<{ key: string; on: boolean }>;
  listOrgs(): Array<{ id: string; name: string }>;
  isAuthed(): boolean;
  // panels
  showPanel(key: string): boolean;
  hidePanel(key: string): boolean;
  movePanel(key: string, opts: { before?: string; after?: string; position?: 'top' | 'bottom' }): boolean;
  resizePanel(key: string, span: number): boolean;
  // map
  toggleLayer(key: string, on: boolean): boolean;
  setMapMode(mode: '2d' | '3d'): boolean;
  flyTo(lat: number, lon: number, zoom?: number): boolean;
  setRegion(region: string): boolean;
  setTimeRange(range: string): boolean;
  // shell
  setVariant(variant: string): boolean;
  setTheme(theme: 'dark' | 'light'): boolean;
  search(query: string): boolean;
  resetLayout(): void;
  // layout mode + immersive background
  setLayoutMode(mode: 'grid' | 'free' | 'immersive'): boolean;
  setImmersiveBackground(bg: 'map' | 'video'): boolean;
  // language
  setLanguage(code: string): boolean;
  // keyword monitors — "add a topic to scan for"
  addMonitor(keywords: string): { ok: boolean; id?: string };
  removeMonitor(id: string): boolean;
  // watch queue
  queueNext(): { ok: boolean; title?: string };
  queuePrev(): { ok: boolean; title?: string };
  // watch queue — find a video and add it to the persistent watch queue (the
  // queue survives reload, so surfaced content isn't lost on refresh).
  queueVideo(query: string): Promise<{ ok: boolean; note?: string; title?: string }>;
  // custom feeds
  addFeedPanel(name: string, url: string): Promise<{ ok: boolean; note?: string }>;
  removeCustomPanel(name: string): boolean;
  // org (sign-in required)
  switchOrg(org: string): Promise<{ ok: boolean; note?: string }>;
}

// ── Command + schema types ───────────────────────────────────────────────────

export type JsonType = 'string' | 'number' | 'integer' | 'boolean';

export interface JsonProp {
  type: JsonType;
  enum?: Array<string | number>;
  description?: string;
  minimum?: number;
  maximum?: number;
}

export interface JsonSchema {
  type: 'object';
  properties: Record<string, JsonProp>;
  required?: string[];
}

export type Args = Record<string, unknown>;

export interface CommandResult {
  ok: boolean;
  message: string;
}

export interface RunCtx {
  /** Map a panel key to its human name for the action log. */
  label(key: string): string;
}

export interface AppCommand {
  name: string;
  description: string;
  params: JsonSchema;
  /** Beyond the global sign-in gate, org-scoped commands are flagged authed. */
  authed?: boolean;
  run(host: AppHost, args: Args, ctx: RunCtx): Promise<CommandResult> | CommandResult;
}

/** The flat wire action the model emits: `{ type, ...params }`. */
export interface RawCommand {
  type: string;
  [k: string]: unknown;
}

export interface CommandLogEntry {
  ok: boolean;
  message: string;
}

// ── Canonical enums (kept in lockstep with App.ts validators) ────────────────

export const TIME_RANGES = ['1h', '6h', '24h', '48h', '7d', 'all'] as const;
export const VARIANTS = ['full', 'tech', 'finance', 'saas', 'ai', 'crypto'] as const;
export const REGIONS = ['global', 'america', 'mena', 'eu', 'asia', 'latam', 'africa', 'oceania'] as const;
export const THEMES = ['dark', 'light'] as const;
export const MAP_MODES = ['2d', '3d'] as const;

// ── The registry (single source of truth) ───────────────────────────────────

export const COMMANDS: AppCommand[] = [
  {
    name: 'show_panel',
    description: 'Show a hidden dashboard panel by its key.',
    params: obj({ key: str('panel key exactly as it appears in the snapshot') }, ['key']),
    run: (h, a, c) => bool(h.showPanel(a.key as string), `Showed ${c.label(a.key as string)}.`, `No panel called "${a.key}".`),
  },
  {
    name: 'hide_panel',
    description: 'Hide a visible dashboard panel by its key.',
    params: obj({ key: str('panel key') }, ['key']),
    run: (h, a, c) => bool(h.hidePanel(a.key as string), `Hid ${c.label(a.key as string)}.`, `No panel called "${a.key}".`),
  },
  {
    name: 'hide_all',
    description: 'Hide every visible dashboard panel at once (clears the board).',
    params: obj({}, []),
    run: (h) => {
      let n = 0;
      for (const p of h.listPanels()) if (p.enabled && h.hidePanel(p.key)) n++;
      return { ok: true, message: n ? `Hid ${n} panel${n === 1 ? '' : 's'}.` : 'No panels were showing.' };
    },
  },
  {
    name: 'show_only',
    description: 'Show only the named panels and hide the rest — e.g. keys "news" or "markets,news". Keys are panel keys from the snapshot.',
    params: obj({ keys: str('one or more panel keys, comma- or space-separated') }, ['keys']),
    run: (h, a, c) => {
      const want = new Set(
        String(a.keys)
          .split(/[,\s]+/)
          .map((s) => s.trim())
          .filter(Boolean),
      );
      if (!want.size) return { ok: false, message: 'Which panels should I keep?' };
      const panels = h.listPanels();
      const known = new Set(panels.map((p) => p.key));
      let hidden = 0;
      for (const p of panels) {
        if (want.has(p.key)) h.showPanel(p.key);
        else if (p.enabled && h.hidePanel(p.key)) hidden++;
      }
      const kept = [...want].filter((k) => known.has(k));
      const missing = [...want].filter((k) => !known.has(k));
      const note = missing.length ? ` (couldn't find ${missing.join(', ')})` : '';
      if (!kept.length) return { ok: false, message: `No matching panels${note}.` };
      const label = kept.map((k) => c.label(k)).join(', ');
      return { ok: true, message: `Showing only ${label}; hid ${hidden}.${note}` };
    },
  },
  {
    name: 'move_panel',
    description: 'Reorder a panel: to the top/bottom, or before/after another panel.',
    params: obj(
      {
        key: str('panel to move'),
        position: enumStr(['top', 'bottom'], 'move to the top or bottom'),
        before: str('place above this panel key'),
        after: str('place below this panel key'),
      },
      ['key'],
    ),
    run: (h, a, c) => {
      const opts = {
        before: strOrU(a.before),
        after: strOrU(a.after),
        position: a.position === 'top' || a.position === 'bottom' ? (a.position as 'top' | 'bottom') : undefined,
      };
      if (!opts.before && !opts.after && !opts.position) {
        return { ok: false, message: `Where should I move ${c.label(a.key as string)}?` };
      }
      const where = opts.position
        ? `to the ${opts.position}`
        : opts.before
          ? `above ${c.label(opts.before)}`
          : `below ${c.label(opts.after!)}`;
      return bool(h.movePanel(a.key as string, opts), `Moved ${c.label(a.key as string)} ${where}.`, `Couldn't move ${c.label(a.key as string)}.`);
    },
  },
  {
    name: 'resize_panel',
    description: 'Set a panel height in grid rows (1 = short, 4 = tall).',
    params: obj({ key: str('panel key'), span: int('height in rows, 1-4', 1, 4) }, ['key', 'span']),
    run: (h, a, c) => bool(h.resizePanel(a.key as string, a.span as number), `Resized ${c.label(a.key as string)} to ${a.span} rows.`, `Couldn't resize ${c.label(a.key as string)}.`),
  },
  {
    name: 'toggle_layer',
    description: 'Turn a map data layer on or off by its key.',
    params: obj({ key: str('map layer key'), on: boolProp('true to enable, false to disable') }, ['key', 'on']),
    run: (h, a) => bool(h.toggleLayer(a.key as string, a.on as boolean), `Turned ${a.on ? 'on' : 'off'} the ${a.key} layer.`, `No map layer called "${a.key}".`),
  },
  {
    name: 'set_map_mode',
    description: 'Switch the map between 2D flat and 3D globe.',
    params: obj({ mode: enumStr([...MAP_MODES], '2d flat map or 3d globe') }, ['mode']),
    run: (h, a) => bool(h.setMapMode(a.mode as '2d' | '3d'), `Switched the map to ${a.mode === '3d' ? '3D globe' : '2D'}.`, 'The 3D globe is unavailable on this map.'),
  },
  {
    name: 'fly_to',
    description: 'Move the map camera to a latitude/longitude, optionally at a zoom (1-12).',
    params: obj({ lat: num('latitude', -90, 90), lon: num('longitude', -180, 180), zoom: num('zoom level 1-12', 0, 20) }, ['lat', 'lon']),
    run: (h, a) => bool(h.flyTo(a.lat as number, a.lon as number, a.zoom as number | undefined), `Flew the map to ${fmtCoord(a.lat as number)}, ${fmtCoord(a.lon as number)}.`, 'Could not move the map camera.'),
  },
  {
    name: 'set_region',
    description: 'Jump the map to a named region preset.',
    params: obj({ region: enumStr([...REGIONS], 'region preset') }, ['region']),
    run: (h, a) => bool(h.setRegion(a.region as string), `Focused the map on ${a.region}.`, `"${a.region}" isn't a valid region.`),
  },
  {
    name: 'set_time_range',
    description: 'Set the global time window for the map and feeds.',
    params: obj({ range: enumStr([...TIME_RANGES], 'time window') }, ['range']),
    run: (h, a) => bool(h.setTimeRange(a.range as string), `Set the time range to ${a.range}.`, `"${a.range}" isn't a valid time range.`),
  },
  {
    name: 'set_variant',
    description: 'Switch the dashboard variant (reloads to the chosen view).',
    params: obj({ variant: enumStr([...VARIANTS], 'dashboard variant') }, ['variant']),
    run: (h, a) => bool(h.setVariant(a.variant as string), `Switching to the ${a.variant} view…`, `"${a.variant}" isn't a valid view.`),
  },
  {
    name: 'set_theme',
    description: 'Switch the colour theme between dark and light.',
    params: obj({ theme: enumStr([...THEMES], 'colour theme') }, ['theme']),
    run: (h, a) => bool(h.setTheme(a.theme as 'dark' | 'light'), `Switched to the ${a.theme} theme.`, `"${a.theme}" isn't a valid theme.`),
  },
  {
    name: 'search',
    description: 'Open the global search and run a query (countries, markets, hotspots, …).',
    params: obj({ query: str('search text') }, ['query']),
    run: (h, a) => bool(h.search(a.query as string), `Searching for "${a.query}".`, 'Search is unavailable right now.'),
  },
  {
    name: 'queue_video',
    description: 'Find a video (e.g. "Milken Institute Jensen Huang 2025") and add it to the persistent Watch Queue, then open it. The queue survives reload and tracks what you have watched.',
    params: obj({ query: str('what to search for — a talk, interview or topic') }, ['query']),
    run: async (h, a) => {
      const res = await h.queueVideo(a.query as string);
      return res.ok
        ? { ok: true, message: `Queued "${res.title || (a.query as string)}" in the Watch Queue.` }
        : { ok: false, message: `Couldn't queue that — ${res.note || 'no video found'}.` };
    },
  },
  {
    name: 'set_layout_mode',
    description: 'Set the layout mode: "grid" (snap to grid), "free" (free-form pixel placement), or "immersive" (map/video fills the viewport, panels float over it).',
    params: obj({ mode: enumStr(['grid', 'free', 'immersive'], 'layout mode') }, ['mode']),
    run: (h, a) => bool(
      h.setLayoutMode(a.mode as 'grid' | 'free' | 'immersive'),
      `Switched to the ${a.mode} layout.`,
      `Couldn't switch to the ${a.mode} layout.`,
    ),
  },
  {
    name: 'set_immersive_background',
    description: 'Choose what fills the immersive background: the map, or live video.',
    params: obj({ background: enumStr(['map', 'video'], 'background source') }, ['background']),
    run: (h, a) => bool(
      h.setImmersiveBackground(a.background as 'map' | 'video'),
      `Immersive background is now ${a.background}.`,
      'Immersive mode is off — turn it on first with set_layout_mode.',
    ),
  },
  {
    name: 'set_language',
    description: 'Switch the interface language (ISO code from the snapshot, e.g. "en", "es", "ja").',
    params: obj({ language: str('ISO language code') }, ['language']),
    run: (h, a) => bool(h.setLanguage(a.language as string), `Language set to ${a.language}.`, `Unsupported language "${a.language}".`),
  },
  {
    name: 'add_monitor',
    description: 'Watch for a topic: add a keyword monitor (comma-separate several keywords). Signed-in monitors are matched server-side against everything the backend ingests.',
    params: obj({ keywords: str('keyword, or comma-separated keywords') }, ['keywords']),
    run: (h, a) => {
      const res = h.addMonitor(a.keywords as string);
      return res.ok
        ? { ok: true, message: `Now monitoring "${a.keywords}".` }
        : { ok: false, message: `Couldn't add a monitor for "${a.keywords}".` };
    },
  },
  {
    name: 'remove_monitor',
    description: 'Stop watching a topic — remove a keyword monitor by its id (from the snapshot).',
    params: obj({ id: str('monitor id from the snapshot') }, ['id']),
    run: (h, a) => bool(h.removeMonitor(a.id as string), 'Removed that monitor.', 'No monitor with that id.'),
  },
  {
    name: 'queue_next',
    description: 'Finish the current Watch Queue item and play the next one.',
    params: obj({}, []),
    run: (h) => {
      const res = h.queueNext();
      return res.ok
        ? { ok: true, message: res.title ? `Playing "${res.title}".` : 'Queue finished — nothing left to watch.' }
        : { ok: false, message: 'The Watch Queue is empty.' };
    },
  },
  {
    name: 'queue_prev',
    description: 'Go back to the previous item in the Watch Queue.',
    params: obj({}, []),
    run: (h) => {
      const res = h.queuePrev();
      return res.ok
        ? { ok: true, message: res.title ? `Playing "${res.title}".` : 'Already at the start of the queue.' }
        : { ok: false, message: 'The Watch Queue is empty.' };
    },
  },
  {
    name: 'reset_layout',
    description: 'Reset all panels to the variant default layout (reloads).',
    params: obj({}, []),
    run: (h) => {
      h.resetLayout();
      return { ok: true, message: 'Reset the panel layout to default.' };
    },
  },
  {
    name: 'add_feed_panel',
    description: 'Add a custom RSS/Atom feed panel (server allowlist enforced).',
    params: obj({ name: str('short panel title'), url: str('https RSS/Atom feed URL') }, ['name', 'url']),
    run: async (h, a) => {
      const res = await h.addFeedPanel(a.name as string, a.url as string);
      return res.ok
        ? { ok: true, message: `Added the "${a.name}" feed panel.` }
        : { ok: false, message: `Couldn't add "${a.name}" — ${res.note || 'try another feed'}.` };
    },
  },
  {
    name: 'remove_custom_panel',
    description: 'Remove a custom feed panel by the title it was added with.',
    params: obj({ name: str('title used when adding') }, ['name']),
    run: (h, a) => bool(h.removeCustomPanel(a.name as string), `Removed the "${a.name}" panel.`, `No custom panel called "${a.name}".`),
  },
  {
    name: 'switch_org',
    description: 'Switch the active organization (reloads scoped data). Sign-in required.',
    params: obj({ org: str('organization id from the snapshot') }, ['org']),
    authed: true,
    run: async (h, a) => {
      const res = await h.switchOrg(a.org as string);
      return res.ok
        ? { ok: true, message: `Switching to the ${a.org} org…` }
        : { ok: false, message: `Couldn't switch org — ${res.note || 'unknown org'}.` };
    },
  },
];

const BY_NAME: Map<string, AppCommand> = new Map(COMMANDS.map((c) => [c.name, c]));

// ── The ONE dispatcher (gate → validate → execute → log) ─────────────────────

/**
 * Validate and apply each action in order, returning a per-action log to render
 * in the chat. Full control is gated on sign-in HERE (one place): anonymous
 * callers get a single sign-in note and nothing executes. Unknown command types,
 * bad params, and failed executions each degrade to an honest ✗ log entry —
 * never a throw, never a silent drop.
 */
export async function dispatch(actions: RawCommand[], host: AppHost): Promise<CommandLogEntry[]> {
  if (!actions.length) return [];
  if (!host.isAuthed()) {
    return [{ ok: false, message: 'Sign in to let the analyst change the dashboard.' }];
  }
  const names = new Map(host.listPanels().map((p) => [p.key, p.name]));
  const ctx: RunCtx = { label: (key: string) => names.get(key) || key };
  const log: CommandLogEntry[] = [];
  for (const a of actions) {
    log.push(await runOne(a, host, ctx));
  }
  return log;
}

async function runOne(a: RawCommand, host: AppHost, ctx: RunCtx): Promise<CommandLogEntry> {
  const type = typeof a?.type === 'string' ? a.type.trim() : '';
  const cmd = BY_NAME.get(type);
  if (!cmd) return { ok: false, message: `Unknown command "${type || '?'}".` };
  const v = validateArgs(cmd.params, a);
  if (!v.ok) return { ok: false, message: `${cmd.name}: ${v.error}` };
  try {
    return await cmd.run(host, v.args, ctx);
  } catch {
    return { ok: false, message: `Could not run ${cmd.name}.` };
  }
}

/** Pick + type-check the schema's properties off the flat action object. */
function validateArgs(schema: JsonSchema, raw: RawCommand): { ok: true; args: Args } | { ok: false; error: string } {
  const args: Args = {};
  for (const [key, prop] of Object.entries(schema.properties)) {
    const val = raw[key];
    if (val === undefined || val === null) continue;
    if (!typeOk(prop.type, val)) return { ok: false, error: `"${key}" must be a ${prop.type}` };
    if (prop.enum && !prop.enum.includes(val as string | number)) {
      return { ok: false, error: `"${key}" must be one of ${prop.enum.join(', ')}` };
    }
    if (typeof val === 'number') {
      if (prop.minimum !== undefined && val < prop.minimum) return { ok: false, error: `"${key}" must be ≥ ${prop.minimum}` };
      if (prop.maximum !== undefined && val > prop.maximum) return { ok: false, error: `"${key}" must be ≤ ${prop.maximum}` };
    }
    args[key] = val;
  }
  for (const req of schema.required || []) {
    if (args[req] === undefined) return { ok: false, error: `missing "${req}"` };
  }
  return { ok: true, args };
}

function typeOk(t: JsonType, v: unknown): boolean {
  switch (t) {
    case 'string':
      return typeof v === 'string' && v.trim().length > 0;
    case 'number':
      return typeof v === 'number' && Number.isFinite(v);
    case 'integer':
      return typeof v === 'number' && Number.isInteger(v);
    case 'boolean':
      return typeof v === 'boolean';
  }
}

// ── Manifest (the backend contract derives from this) ────────────────────────

export interface CommandManifestEntry {
  name: string;
  description: string;
  params: JsonSchema;
  authed: boolean;
}

/** Serialisable description of every command — sent to the backend so the
 *  analyst prompt/tool contract is generated from this registry, not duplicated. */
export function commandManifest(): CommandManifestEntry[] {
  return COMMANDS.map((c) => ({ name: c.name, description: c.description, params: c.params, authed: !!c.authed }));
}

// ── Schema helpers (keep the registry above terse + declarative) ─────────────

function obj(properties: Record<string, JsonProp>, required: string[]): JsonSchema {
  return { type: 'object', properties, required };
}
function str(description: string): JsonProp {
  return { type: 'string', description };
}
function num(description: string, minimum?: number, maximum?: number): JsonProp {
  return { type: 'number', description, minimum, maximum };
}
function int(description: string, minimum?: number, maximum?: number): JsonProp {
  return { type: 'integer', description, minimum, maximum };
}
function boolProp(description: string): JsonProp {
  return { type: 'boolean', description };
}
function enumStr(values: string[], description: string): JsonProp {
  return { type: 'string', enum: values, description };
}

function bool(ok: boolean, okMsg: string, failMsg: string): CommandResult {
  return ok ? { ok: true, message: okMsg } : { ok: false, message: failMsg };
}
function strOrU(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim().length > 0 ? v : undefined;
}
function fmtCoord(n: number): string {
  return (Math.round(n * 100) / 100).toString();
}
