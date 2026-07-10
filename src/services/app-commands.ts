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
