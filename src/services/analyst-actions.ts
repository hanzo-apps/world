/**
 * AI Analyst — action contract + executor.
 *
 * The analyst backend (/v1/world/analyst) may return typed actions alongside its
 * prose reply. This module is the single place those actions are validated and
 * dispatched onto the running dashboard. It talks to the app ONLY through the
 * narrow `AnalystHost` port below — it never reaches into App internals — so the
 * control surface stays decoupled and testable. The action vocabulary here mirrors
 * the one described in the backend system prompt (one source of truth per side of
 * the wire); unknown/invalid actions are dropped, never dispatched.
 */

export type AnalystActionType =
  | 'show_panel'
  | 'hide_panel'
  | 'move_panel'
  | 'toggle_layer'
  | 'set_time_range'
  | 'set_variant'
  | 'reset_layout'
  | 'add_feed_panel'
  | 'remove_custom_panel';

export interface AnalystAction {
  type: AnalystActionType | string;
  key?: string;
  on?: boolean;
  before?: string;
  after?: string;
  position?: 'top' | 'bottom';
  range?: string;
  variant?: string;
  name?: string;
  url?: string;
}

/** The dashboard capabilities the analyst is allowed to drive. App implements it. */
export interface AnalystHost {
  getState(): { variant: string; timeRange: string };
  listPanels(): Array<{ key: string; name: string; enabled: boolean }>;
  listLayers(): Array<{ key: string; on: boolean }>;
  showPanel(key: string): boolean;
  hidePanel(key: string): boolean;
  movePanel(key: string, opts: { before?: string; after?: string; position?: 'top' | 'bottom' }): boolean;
  toggleLayer(key: string, on: boolean): boolean;
  setTimeRange(range: string): boolean;
  setVariant(variant: string): boolean;
  resetLayout(): void;
  addFeedPanel(name: string, url: string): Promise<{ ok: boolean; note?: string }>;
  removeCustomPanel(name: string): boolean;
}

const TIME_RANGES = ['1h', '6h', '24h', '48h', '7d', 'all'];
const VARIANTS = ['full', 'tech', 'finance'];

/**
 * Validate + apply each action in order, returning short human-readable echoes to
 * show in the chat (e.g. "Moved Live News to the top"). A failed action degrades
 * to a quiet note rather than throwing.
 */
export async function applyActions(actions: AnalystAction[], host: AnalystHost): Promise<string[]> {
  const names = new Map(host.listPanels().map((p) => [p.key, p.name]));
  const echoes: string[] = [];
  for (const a of actions) {
    try {
      const e = await applyOne(a, host, names);
      if (e) echoes.push(e);
    } catch {
      echoes.push('Could not apply an action.');
    }
  }
  return echoes;
}

async function applyOne(
  a: AnalystAction,
  host: AnalystHost,
  names: Map<string, string>,
): Promise<string | null> {
  const label = (key: string): string => names.get(key) || key;
  switch (a.type) {
    case 'show_panel':
      if (!isStr(a.key)) return null;
      return host.showPanel(a.key) ? `Showed ${label(a.key)}.` : `No panel called "${a.key}".`;

    case 'hide_panel':
      if (!isStr(a.key)) return null;
      return host.hidePanel(a.key) ? `Hid ${label(a.key)}.` : `No panel called "${a.key}".`;

    case 'move_panel': {
      if (!isStr(a.key)) return null;
      const opts = {
        before: isStr(a.before) ? a.before : undefined,
        after: isStr(a.after) ? a.after : undefined,
        position: a.position === 'top' || a.position === 'bottom' ? a.position : undefined,
      };
      if (!opts.before && !opts.after && !opts.position) return `Where should I move ${label(a.key)}?`;
      const where = opts.position
        ? `to the ${opts.position}`
        : opts.before
          ? `above ${label(opts.before)}`
          : `below ${label(opts.after!)}`;
      return host.movePanel(a.key, opts) ? `Moved ${label(a.key)} ${where}.` : `Couldn't move ${label(a.key)}.`;
    }

    case 'toggle_layer':
      if (!isStr(a.key) || typeof a.on !== 'boolean') return null;
      return host.toggleLayer(a.key, a.on)
        ? `Turned ${a.on ? 'on' : 'off'} the ${a.key} layer.`
        : `No map layer called "${a.key}".`;

    case 'set_time_range':
      if (!isStr(a.range) || !TIME_RANGES.includes(a.range)) return `"${a.range}" isn't a valid time range.`;
      return host.setTimeRange(a.range) ? `Set the time range to ${a.range}.` : null;

    case 'set_variant':
      if (!isStr(a.variant) || !VARIANTS.includes(a.variant)) return `"${a.variant}" isn't a valid view.`;
      return host.setVariant(a.variant) ? `Switching to the ${a.variant} view…` : null;

    case 'reset_layout':
      host.resetLayout();
      return 'Reset the panel layout to default.';

    case 'add_feed_panel': {
      if (!isStr(a.name) || !isStr(a.url)) return null;
      const res = await host.addFeedPanel(a.name, a.url);
      return res.ok ? `Added the "${a.name}" feed panel.` : `Couldn't add "${a.name}" — ${res.note || 'try another feed'}.`;
    }

    case 'remove_custom_panel':
      if (!isStr(a.name)) return null;
      return host.removeCustomPanel(a.name) ? `Removed the "${a.name}" panel.` : `No custom panel called "${a.name}".`;

    default:
      return null; // unknown action type — drop silently
  }
}

function isStr(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}
