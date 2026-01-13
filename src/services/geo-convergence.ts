import type { SocialUnrestEvent, MilitaryFlight, MilitaryVessel, Earthquake } from '@/types';
import { generateSignalId } from '@/utils/analysis-constants';
import type { CorrelationSignalCore } from './analysis-core';

export type GeoEventType = 'protest' | 'military_flight' | 'military_vessel' | 'earthquake';

interface GeoCell {
  id: string;
  lat: number;
  lon: number;
  events: Map<GeoEventType, { count: number; lastSeen: Date }>;
  firstSeen: Date;
}

const cells = new Map<string, GeoCell>();
const WINDOW_MS = 24 * 60 * 60 * 1000;
const CONVERGENCE_THRESHOLD = 3;

export function getCellId(lat: number, lon: number): string {
  return `${Math.floor(lat)},${Math.floor(lon)}`;
}

export function ingestGeoEvent(
  lat: number,
  lon: number,
  type: GeoEventType,
  timestamp: Date = new Date()
): void {
  const cellId = getCellId(lat, lon);

  let cell = cells.get(cellId);
  if (!cell) {
    cell = {
      id: cellId,
      lat: Math.floor(lat) + 0.5,
      lon: Math.floor(lon) + 0.5,
      events: new Map(),
      firstSeen: timestamp,
    };
    cells.set(cellId, cell);
  }

  const existing = cell.events.get(type);
  cell.events.set(type, {
    count: (existing?.count ?? 0) + 1,
    lastSeen: timestamp,
  });
}

function pruneOldEvents(): void {
  const cutoff = Date.now() - WINDOW_MS;

  for (const [cellId, cell] of cells) {
    for (const [type, data] of cell.events) {
      if (data.lastSeen.getTime() < cutoff) {
        cell.events.delete(type);
      }
    }
    if (cell.events.size === 0) {
      cells.delete(cellId);
    }
  }
}

export function ingestProtests(events: SocialUnrestEvent[]): void {
  for (const e of events) {
    ingestGeoEvent(e.lat, e.lon, 'protest', e.time);
  }
}

export function ingestFlights(flights: MilitaryFlight[]): void {
  for (const f of flights) {
    ingestGeoEvent(f.lat, f.lon, 'military_flight', f.lastSeen);
  }
}

export function ingestVessels(vessels: MilitaryVessel[]): void {
  for (const v of vessels) {
    ingestGeoEvent(v.lat, v.lon, 'military_vessel', v.lastAisUpdate);
  }
}

export function ingestEarthquakes(quakes: Earthquake[]): void {
  for (const q of quakes) {
    ingestGeoEvent(q.lat, q.lon, 'earthquake', q.time);
  }
}

export interface GeoConvergenceAlert {
  cellId: string;
  lat: number;
  lon: number;
  types: GeoEventType[];
  totalEvents: number;
  score: number;
}

export function detectGeoConvergence(seenAlerts: Set<string>): GeoConvergenceAlert[] {
  pruneOldEvents();

  const alerts: GeoConvergenceAlert[] = [];

  for (const [cellId, cell] of cells) {
    if (cell.events.size >= CONVERGENCE_THRESHOLD) {
      if (seenAlerts.has(cellId)) continue;

      const types = Array.from(cell.events.keys());
      const totalEvents = Array.from(cell.events.values())
        .reduce((sum, d) => sum + d.count, 0);

      const typeScore = cell.events.size * 25;
      const countBoost = Math.min(25, totalEvents * 2);
      const score = Math.min(100, typeScore + countBoost);

      alerts.push({ cellId, lat: cell.lat, lon: cell.lon, types, totalEvents, score });
      seenAlerts.add(cellId);
    }
  }

  return alerts.sort((a, b) => b.score - a.score);
}

const TYPE_LABELS: Record<GeoEventType, string> = {
  protest: 'protests',
  military_flight: 'military flights',
  military_vessel: 'naval vessels',
  earthquake: 'seismic activity',
};

export function geoConvergenceToSignal(alert: GeoConvergenceAlert): CorrelationSignalCore {
  const typeDescriptions = alert.types.map(t => TYPE_LABELS[t]).join(', ');

  return {
    id: generateSignalId(),
    type: 'geo_convergence',
    title: `Geographic Convergence (${alert.types.length} types)`,
    description: `${typeDescriptions} in region (~${alert.lat.toFixed(1)}°, ${alert.lon.toFixed(1)}°) - ${alert.totalEvents} events/24h`,
    confidence: alert.score / 100,
    timestamp: new Date(),
    data: {
      newsVelocity: alert.totalEvents,
      relatedTopics: alert.types,
    },
  };
}

export function clearCells(): void {
  cells.clear();
}

export function getCellCount(): number {
  return cells.size;
}

export function debugInjectTestEvents(): void {
  const now = new Date();
  const testLat = 25.5;
  const testLon = 121.5;
  ingestGeoEvent(testLat, testLon, 'protest', now);
  ingestGeoEvent(testLat, testLon, 'military_flight', now);
  ingestGeoEvent(testLat, testLon, 'military_vessel', now);
  ingestGeoEvent(testLat + 0.3, testLon + 0.2, 'earthquake', now);
  console.log('[GeoConvergence] Injected 4 test events at Taiwan Strait region');
}

export function debugGetCells(): Map<string, unknown> {
  return new Map(cells);
}
