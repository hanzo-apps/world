import type { MilitaryFlight } from '@/types';
import type { SignalType } from '@/utils/analysis-constants';
import { MILITARY_BASES_EXPANDED } from '@/config/bases-expanded';

export interface MilitaryTheater {
  id: string;
  name: string;
  baseIds: string[];
  centerLat: number;
  centerLon: number;
}

export interface SurgeAlert {
  id: string;
  theater: MilitaryTheater;
  type: 'airlift' | 'fighter' | 'reconnaissance';
  currentCount: number;
  baselineCount: number;
  surgeMultiple: number;
  aircraftTypes: Map<string, number>;
  nearbyBases: string[];
  firstDetected: Date;
  lastUpdated: Date;
}

export interface TheaterActivity {
  theaterId: string;
  timestamp: number;
  transportCount: number;
  fighterCount: number;
  reconCount: number;
  totalMilitary: number;
  flightIds: string[];
}

const THEATERS: MilitaryTheater[] = [
  {
    id: 'middle-east',
    name: 'Middle East / Persian Gulf',
    baseIds: ['al_udeid', 'ali_al_salem_air_base', 'camp_arifjan', 'camp_buehring', 'kuwait_naval_base',
              'naval_support_activity_bahrain', 'isa_air_base', 'masirah_aira_base', 'rafo_thumrait',
              'al_dhafra_air_base', 'port_of_jebel_ali', 'fujairah_naval_base', 'prince_sultan_air_base',
              'ain_assad_air_base', 'camp_victory', 'naval_support_facility_diego_garcia'],
    centerLat: 27.0,
    centerLon: 50.0,
  },
  {
    id: 'europe-east',
    name: 'Eastern Europe',
    baseIds: ['camp_bondsteel', 'aitos_logistics_center', 'bezmer', 'graf_ignatievo'],
    centerLat: 45.0,
    centerLon: 25.0,
  },
  {
    id: 'europe-west',
    name: 'Western Europe',
    baseIds: ['ramstein', 'spangdahlem', 'usag_stuttgart', 'raf_lakenheath', 'raf_mildenhall', 'aviano'],
    centerLat: 50.0,
    centerLon: 8.0,
  },
  {
    id: 'pacific-west',
    name: 'Western Pacific',
    baseIds: ['kadena_air_base', 'camp_fuji', 'fleet_activities_okinawa', 'yokota', 'misawsa',
              'osan_air_base', 'kunsan_ab', 'us_army_garrison_humphreys', 'andersen_air_force_base'],
    centerLat: 30.0,
    centerLon: 130.0,
  },
  {
    id: 'africa-horn',
    name: 'Horn of Africa',
    baseIds: ['camp_lemonnier', 'contingency_location_garoua', 'niger_air_base_201'],
    centerLat: 10.0,
    centerLon: 40.0,
  },
];

const SURGE_THRESHOLD = 2.0;
const BASELINE_WINDOW_HOURS = 48;
const BASELINE_MIN_SAMPLES = 6;
const TRANSPORT_CALLSIGN_PATTERNS = [
  /^RCH/i, /^REACH/i, /^MOOSE/i, /^HERKY/i, /^EVAC/i, /^DUSTOFF/i,
];
const PROXIMITY_RADIUS_KM = 150;

const activityHistory = new Map<string, TheaterActivity[]>();
const activeSurges = new Map<string, SurgeAlert>();
let lastCleanup = Date.now();
const CLEANUP_INTERVAL = 60 * 60 * 1000;
const MAX_HISTORY_HOURS = 72;

function getTheaterForBase(baseId: string): MilitaryTheater | null {
  for (const theater of THEATERS) {
    if (theater.baseIds.includes(baseId)) {
      return theater;
    }
  }
  return null;
}

function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function findNearbyBases(lat: number, lon: number): { baseId: string; baseName: string; distance: number }[] {
  const nearby: { baseId: string; baseName: string; distance: number }[] = [];
  for (const base of MILITARY_BASES_EXPANDED) {
    const dist = distanceKm(lat, lon, base.lat, base.lon);
    if (dist <= PROXIMITY_RADIUS_KM) {
      nearby.push({ baseId: base.id, baseName: base.name, distance: dist });
    }
  }
  return nearby.sort((a, b) => a.distance - b.distance);
}

function isTransportFlight(flight: MilitaryFlight): boolean {
  if (flight.aircraftType === 'transport' || flight.aircraftType === 'tanker') {
    return true;
  }
  const callsign = flight.callsign.toUpperCase();
  return TRANSPORT_CALLSIGN_PATTERNS.some(p => p.test(callsign));
}

function classifyFlight(flight: MilitaryFlight): 'transport' | 'fighter' | 'recon' | 'other' {
  if (isTransportFlight(flight)) return 'transport';
  if (flight.aircraftType === 'fighter') return 'fighter';
  if (flight.aircraftType === 'reconnaissance' || flight.aircraftType === 'awacs') return 'recon';
  return 'other';
}

function getTheaterForFlight(flight: MilitaryFlight): MilitaryTheater | null {
  const nearbyBases = findNearbyBases(flight.lat, flight.lon);
  for (const { baseId } of nearbyBases) {
    const theater = getTheaterForBase(baseId);
    if (theater) return theater;
  }
  for (const theater of THEATERS) {
    const dist = distanceKm(flight.lat, flight.lon, theater.centerLat, theater.centerLon);
    if (dist < 1500) return theater;
  }
  return null;
}

function calculateBaseline(theaterId: string): { transport: number; fighter: number; recon: number } {
  const history = activityHistory.get(theaterId) || [];
  const cutoff = Date.now() - BASELINE_WINDOW_HOURS * 60 * 60 * 1000;
  const relevant = history.filter(h => h.timestamp >= cutoff);

  if (relevant.length < BASELINE_MIN_SAMPLES) {
    return { transport: 3, fighter: 2, recon: 1 };
  }

  const avgTransport = relevant.reduce((sum, h) => sum + h.transportCount, 0) / relevant.length;
  const avgFighter = relevant.reduce((sum, h) => sum + h.fighterCount, 0) / relevant.length;
  const avgRecon = relevant.reduce((sum, h) => sum + h.reconCount, 0) / relevant.length;

  return {
    transport: Math.max(2, avgTransport),
    fighter: Math.max(1, avgFighter),
    recon: Math.max(1, avgRecon),
  };
}

function cleanupOldHistory(): void {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;

  const cutoff = now - MAX_HISTORY_HOURS * 60 * 60 * 1000;
  for (const [theaterId, history] of activityHistory) {
    const filtered = history.filter(h => h.timestamp >= cutoff);
    if (filtered.length === 0) {
      activityHistory.delete(theaterId);
    } else {
      activityHistory.set(theaterId, filtered);
    }
  }

  for (const [surgeId, surge] of activeSurges) {
    const age = now - surge.lastUpdated.getTime();
    if (age > 2 * 60 * 60 * 1000) {
      activeSurges.delete(surgeId);
    }
  }
}

export function analyzeFlightsForSurge(flights: MilitaryFlight[]): SurgeAlert[] {
  cleanupOldHistory();

  const theaterFlights = new Map<string, MilitaryFlight[]>();
  for (const flight of flights) {
    const theater = getTheaterForFlight(flight);
    if (!theater) continue;
    const existing = theaterFlights.get(theater.id) || [];
    existing.push(flight);
    theaterFlights.set(theater.id, existing);
  }

  const now = Date.now();
  const newAlerts: SurgeAlert[] = [];

  for (const [theaterId, theaterFlightList] of theaterFlights) {
    const theater = THEATERS.find(t => t.id === theaterId);
    if (!theater) continue;

    let transportCount = 0;
    let fighterCount = 0;
    let reconCount = 0;
    const aircraftTypes = new Map<string, number>();
    const nearbyBasesSet = new Set<string>();

    for (const flight of theaterFlightList) {
      const classification = classifyFlight(flight);
      if (classification === 'transport') transportCount++;
      else if (classification === 'fighter') fighterCount++;
      else if (classification === 'recon') reconCount++;

      const typeKey = flight.aircraftModel || flight.aircraftType || 'unknown';
      aircraftTypes.set(typeKey, (aircraftTypes.get(typeKey) || 0) + 1);

      const nearby = findNearbyBases(flight.lat, flight.lon);
      for (const { baseName } of nearby.slice(0, 3)) {
        nearbyBasesSet.add(baseName);
      }
    }

    const activity: TheaterActivity = {
      theaterId,
      timestamp: now,
      transportCount,
      fighterCount,
      reconCount,
      totalMilitary: theaterFlightList.length,
      flightIds: theaterFlightList.map(f => f.id),
    };

    const history = activityHistory.get(theaterId) || [];
    history.push(activity);
    if (history.length > 200) history.shift();
    activityHistory.set(theaterId, history);

    const baseline = calculateBaseline(theaterId);

    if (transportCount >= baseline.transport * SURGE_THRESHOLD && transportCount >= 5) {
      const surgeId = `airlift-${theaterId}`;
      const surgeMultiple = transportCount / baseline.transport;

      const existing = activeSurges.get(surgeId);
      if (existing) {
        existing.currentCount = transportCount;
        existing.surgeMultiple = surgeMultiple;
        existing.aircraftTypes = aircraftTypes;
        existing.nearbyBases = Array.from(nearbyBasesSet);
        existing.lastUpdated = new Date();
      } else {
        const alert: SurgeAlert = {
          id: surgeId,
          theater,
          type: 'airlift',
          currentCount: transportCount,
          baselineCount: Math.round(baseline.transport),
          surgeMultiple,
          aircraftTypes,
          nearbyBases: Array.from(nearbyBasesSet),
          firstDetected: new Date(),
          lastUpdated: new Date(),
        };
        activeSurges.set(surgeId, alert);
        newAlerts.push(alert);
      }
    }

    if (fighterCount >= baseline.fighter * SURGE_THRESHOLD && fighterCount >= 4) {
      const surgeId = `fighter-${theaterId}`;
      const surgeMultiple = fighterCount / baseline.fighter;

      if (!activeSurges.has(surgeId)) {
        const alert: SurgeAlert = {
          id: surgeId,
          theater,
          type: 'fighter',
          currentCount: fighterCount,
          baselineCount: Math.round(baseline.fighter),
          surgeMultiple,
          aircraftTypes,
          nearbyBases: Array.from(nearbyBasesSet),
          firstDetected: new Date(),
          lastUpdated: new Date(),
        };
        activeSurges.set(surgeId, alert);
        newAlerts.push(alert);
      }
    }
  }

  return newAlerts;
}

export function getActiveSurges(): SurgeAlert[] {
  return Array.from(activeSurges.values());
}

export function getTheaterActivity(theaterId: string): TheaterActivity[] {
  return activityHistory.get(theaterId) || [];
}

export function surgeAlertToSignal(surge: SurgeAlert): {
  id: string;
  type: SignalType;
  source: string;
  title: string;
  description: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  confidence: number;
  category: string;
  timestamp: Date;
  location?: { lat: number; lon: number; name: string };
  data: Record<string, unknown>;
  metadata: Record<string, unknown>;
} {
  const typeLabels = {
    airlift: '🛫 Military Airlift Surge',
    fighter: '✈️ Fighter Deployment Surge',
    reconnaissance: '🔭 Reconnaissance Surge',
  };

  const aircraftList = Array.from(surge.aircraftTypes.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([type, count]) => `${count}x ${type}`)
    .join(', ');

  const severity = surge.surgeMultiple >= 4 ? 'critical' :
    surge.surgeMultiple >= 3 ? 'high' : 'medium';

  const confidence = Math.min(0.95, 0.6 + (surge.surgeMultiple - 2) * 0.1);

  const metadata = {
    theaterId: surge.theater.id,
    surgeType: surge.type,
    currentCount: surge.currentCount,
    baselineCount: surge.baselineCount,
    surgeMultiple: surge.surgeMultiple,
    aircraftTypes: Object.fromEntries(surge.aircraftTypes),
    nearbyBases: surge.nearbyBases,
  };

  return {
    id: `surge-${surge.id}-${surge.firstDetected.getTime()}`,
    type: 'military_surge',
    source: 'Military Flight Tracking',
    title: `${typeLabels[surge.type]} - ${surge.theater.name}`,
    description: `${surge.currentCount} ${surge.type} aircraft detected (${surge.surgeMultiple.toFixed(1)}x baseline). ` +
      `${aircraftList}. Near: ${surge.nearbyBases.slice(0, 3).join(', ')}`,
    severity,
    confidence,
    category: 'military',
    timestamp: surge.firstDetected,
    location: {
      lat: surge.theater.centerLat,
      lon: surge.theater.centerLon,
      name: surge.theater.name,
    },
    data: metadata,
    metadata,
  };
}
