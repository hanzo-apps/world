/**
 * Analyst model roster — the chat's model/agent picker source.
 *
 * The backend (/v1/world/models) is the single source of truth: it always returns
 * the curated Zen family first, then augments with whatever the signed-in user can
 * serve from api.hanzo.ai/v1/models (and agents, when the plane exposes them). This
 * module just fetches that roster, remembers the user's choice, and hands the chosen
 * id to the analyst request. It never invents model ids — an empty/failed fetch
 * degrades to the Zen default so the dropdown always works.
 */

import { scopedHeaders } from './org-scope';

export interface AnalystModel {
  id: string;
  label: string;
  group: string; // 'Zen' | 'Models' | 'Agents' | …
}

export interface ModelRoster {
  models: AnalystModel[];
  default: string;
}

const CHOICE_KEY = 'hanzo-world-analyst-model';

// Curated fallback — used only when the backend roster is unreachable, so the
// picker is never empty. Mirrors the server default (ai.go model = "best": the
// gateway's routing alias, the one id that survives upstream catalog shifts).
const ZEN_FALLBACK: AnalystModel[] = [
  { id: 'best', label: 'Best (auto)', group: 'Zen' },
  { id: 'zen5', label: 'Zen 5', group: 'Zen' },
];

const FALLBACK_ROSTER: ModelRoster = { models: ZEN_FALLBACK, default: 'best' };

export async function fetchRoster(): Promise<ModelRoster> {
  try {
    const headers = await scopedHeaders();
    const res = await fetch('/v1/world/models', { headers });
    if (!res.ok) return FALLBACK_ROSTER;
    const data = (await res.json()) as { data?: unknown; default?: unknown };
    const models = Array.isArray(data.data)
      ? data.data
          .map((m) => {
            const rec = m as { id?: unknown; label?: unknown; group?: unknown };
            const id = String(rec?.id ?? '').trim();
            if (!id) return null;
            return { id, label: String(rec?.label ?? id), group: String(rec?.group ?? 'Models') };
          })
          .filter((m): m is AnalystModel => m !== null)
      : [];
    if (!models.length) return FALLBACK_ROSTER;
    const first = models[0]!;
    const def = typeof data.default === 'string' && models.some((m) => m.id === data.default) ? data.default : first.id;
    return { models, default: def };
  } catch {
    return FALLBACK_ROSTER;
  }
}

/** The user's stored choice if it is still in the roster, else the roster default. */
export function selectedModel(roster: ModelRoster): string {
  let stored = '';
  try {
    stored = localStorage.getItem(CHOICE_KEY) || '';
  } catch {
    stored = '';
  }
  if (stored && roster.models.some((m) => m.id === stored)) return stored;
  return roster.default;
}

export function rememberModel(id: string): void {
  try {
    localStorage.setItem(CHOICE_KEY, id);
  } catch {
    /* private mode */
  }
}
