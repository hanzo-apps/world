// Sector-rotation scanner client. The heavy lifting (fetching the universe,
// computing the Relative Rotation Graph, scoring the thesis signals) runs
// server-side at /v1/world/rotation and is cached there; this is a thin typed
// fetch. See internal/world/handlers_rotation.go for the model.

export type Quadrant = 'leading' | 'weakening' | 'lagging' | 'improving';
export type SignalState = 'active' | 'watch' | 'off';

export interface RotationTail {
  rsRatio: number;
  rsMomentum: number;
}

export interface RotationMember {
  symbol: string;
  name: string;
  rsRatio: number;
  rsMomentum: number;
  quadrant: Quadrant;
  ret21: number;
}

export interface RotationTheme {
  key: string;
  label: string;
  group: string;
  lead: boolean;
  rsRatio: number;
  rsMomentum: number;
  quadrant: Quadrant;
  heading: number; // rotation bearing (deg, 0=east, CCW)
  ret5: number;
  ret21: number;
  ret63: number;
  tail: RotationTail[]; // oldest → newest RRG path
  members: RotationMember[];
}

export interface RotationSignal {
  key: string;
  label: string;
  score: number; // 0..1
  state: SignalState;
  note: string;
}

export interface RotationSnapshot {
  asOf: string;
  benchmark: string;
  window?: string;
  marketSession?: string;
  narrative: string;
  themes: RotationTheme[];
  signals: RotationSignal[];
  unavailable?: boolean;
}

// The four RRG quadrants in reading order, with the plain-language meaning the
// panel labels them by. Distribution watchers care about Weakening; accumulation
// watchers care about Improving.
export const QUADRANT_LABEL: Record<Quadrant, string> = {
  leading: 'Leading',
  weakening: 'Weakening',
  lagging: 'Lagging',
  improving: 'Improving',
};

export async function fetchRotation(signal?: AbortSignal): Promise<RotationSnapshot | null> {
  try {
    const res = await fetch('/v1/world/rotation', { signal });
    if (!res.ok) return null;
    const data = (await res.json()) as RotationSnapshot;
    if (!Array.isArray(data.themes)) return null;
    return data;
  } catch {
    return null;
  }
}

// ── Lux Book: model allocation derived from the rotation read ────────────────

export type Stance = 'accumulate' | 'core' | 'trim' | 'avoid';

export interface BookPosition {
  key: string;
  label: string;
  group: string;
  weight: number;   // % of book, sums to ~100 across the returned positions
  stance: Stance;
  quadrant: Quadrant;
  momentumDelta: number; // rsMomentum − 100
  ret21: number;
  ret63: number;
  anchor: GeoAnchor;
  rationale: string;
}

export interface GeoAnchor {
  label: string;
  lat: number;
  lon: number;
}

// Where each theme physically sits — the point the position anchors to on the
// globe. Sectors fall back to the NYSE anchor.
const NYSE: GeoAnchor = { label: 'NYSE · US', lat: 40.707, lon: -74.011 };
const ANCHORS: Record<string, GeoAnchor> = {
  ai_semis: { label: 'Taiwan · TSMC', lat: 24.774, lon: 120.99 },
  hyperscalers: { label: 'US · Cloud', lat: 45.52, lon: -122.68 },
  energy: { label: 'Permian · TX', lat: 31.9, lon: -102.3 },
  natgas: { label: 'Henry Hub · LA', lat: 30.0, lon: -92.0 },
  uranium: { label: 'Athabasca · CA', lat: 58.0, lon: -104.0 },
  nuclear_power: { label: 'ERCOT · TX', lat: 31.0, lon: -99.0 },
};

const STANCE_OF: Record<Quadrant, Stance> = {
  improving: 'accumulate',
  leading: 'core',
  weakening: 'trim',
  lagging: 'avoid',
};

// Conviction is quadrant base + a momentum tilt: the model overweights themes
// accumulating from a base (Improving) and holds leaders (Leading), while trimming
// rolling-over leaders (Weakening) and avoiding fallers (Lagging). A deep oversold
// base (negative 3-month return) in an accumulating theme adds conviction — that is
// the coiled-spring the rotation is turning up.
const QUAD_BASE: Record<Quadrant, number> = { improving: 1.0, leading: 0.72, weakening: 0.22, lagging: 0.08 };

function conviction(t: RotationTheme): number {
  const mom = Math.max(-1.2, Math.min(1.2, (t.rsMomentum - 100) * 0.16));
  let c = QUAD_BASE[t.quadrant] + mom;
  if (t.quadrant === 'improving' && t.ret63 < 0) c += Math.min(0.3, -t.ret63 / 100); // oversold base bonus
  return Math.max(0, c);
}

function rationale(t: RotationTheme): string {
  switch (t.quadrant) {
    case 'improving':
      return t.ret63 < -8
        ? 'Oversold and turning — momentum up off a deep base.'
        : 'Relative momentum turning up; accumulating early.';
    case 'leading':
      return 'Leading and still accelerating — held as core.';
    case 'weakening':
      return 'Leadership rolling over — trimming into strength.';
    default:
      return 'Underperforming and falling — no allocation pressed.';
  }
}

// computeBook turns a rotation snapshot into the model's top-N allocation: rank by
// conviction, normalise the winners' conviction to a 100% book. Pure — the panel
// and the globe layer share it.
export function computeBook(snap: RotationSnapshot, top = 10): BookPosition[] {
  const scored = snap.themes
    .map((t) => ({ t, c: conviction(t) }))
    .filter((x) => x.c > 0)
    .sort((a, b) => b.c - a.c)
    .slice(0, top);
  const total = scored.reduce((s, x) => s + x.c, 0) || 1;
  return scored.map(({ t, c }) => ({
    key: t.key,
    label: t.label,
    group: t.group,
    weight: (c / total) * 100,
    stance: STANCE_OF[t.quadrant],
    quadrant: t.quadrant,
    momentumDelta: t.rsMomentum - 100,
    ret21: t.ret21,
    ret63: t.ret63,
    anchor: ANCHORS[t.key] || NYSE,
    rationale: rationale(t),
  }));
}
