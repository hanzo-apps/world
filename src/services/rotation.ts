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
