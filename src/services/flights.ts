import type { AirportDelayAlert, FlightDelaySeverity, FlightDelayType, MonitoredAirport } from '@/types';
import { MONITORED_AIRPORTS, FAA_AIRPORTS, DELAY_SEVERITY_THRESHOLDS } from '@/config/airports';

interface FAAStatusResponse {
  Name: string;
  City: string;
  State: string;
  ICAO: string;
  IATA: string;
  SupportedAirport: boolean;
  Delay: boolean;
  DelayCount: number;
  Status: Array<{
    Reason: string;
    ClosureBegin?: string;
    EndTime?: string;
    MinDelay?: string;
    MaxDelay?: string;
    AvgDelay?: string;
    Trend?: string;
    Type?: string;
  }>;
  Weather?: {
    Weather: string;
    Visibility: number;
    Temp: string;
    Wind: string;
  };
}

const cache = new Map<string, { data: AirportDelayAlert; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function determineSeverity(avgDelayMinutes: number, delayedPct?: number): FlightDelaySeverity {
  const t = DELAY_SEVERITY_THRESHOLDS;
  if (avgDelayMinutes >= t.severe.avgDelayMinutes || (delayedPct && delayedPct >= t.severe.delayedPct)) {
    return 'severe';
  }
  if (avgDelayMinutes >= t.major.avgDelayMinutes || (delayedPct && delayedPct >= t.major.delayedPct)) {
    return 'major';
  }
  if (avgDelayMinutes >= t.moderate.avgDelayMinutes || (delayedPct && delayedPct >= t.moderate.delayedPct)) {
    return 'moderate';
  }
  if (avgDelayMinutes >= t.minor.avgDelayMinutes || (delayedPct && delayedPct >= t.minor.delayedPct)) {
    return 'minor';
  }
  return 'normal';
}

function parseDelayType(status: FAAStatusResponse['Status'][0]): FlightDelayType {
  const type = status.Type?.toLowerCase() || '';
  const reason = status.Reason?.toLowerCase() || '';

  if (type.includes('ground stop') || reason.includes('ground stop')) {
    return 'ground_stop';
  }
  if (type.includes('ground delay') || reason.includes('ground delay') || reason.includes('gdp')) {
    return 'ground_delay';
  }
  if (type.includes('departure') || reason.includes('departure')) {
    return 'departure_delay';
  }
  if (type.includes('arrival') || reason.includes('arrival')) {
    return 'arrival_delay';
  }
  return 'general';
}

function parseAvgDelay(status: FAAStatusResponse['Status'][0]): number {
  if (status.AvgDelay) {
    const match = status.AvgDelay.match(/(\d+)/);
    if (match?.[1]) return parseInt(match[1], 10);
  }
  if (status.MinDelay && status.MaxDelay) {
    const minMatch = status.MinDelay.match(/(\d+)/);
    const maxMatch = status.MaxDelay.match(/(\d+)/);
    if (minMatch?.[1] && maxMatch?.[1]) {
      return Math.round((parseInt(minMatch[1], 10) + parseInt(maxMatch[1], 10)) / 2);
    }
  }
  return 0;
}

async function fetchFAAStatus(iata: string): Promise<AirportDelayAlert | null> {
  const airport = MONITORED_AIRPORTS.find((a) => a.iata === iata);
  if (!airport) return null;

  const cacheKey = `faa-${iata}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  try {
    const url = import.meta.env.DEV
      ? `/api/faa/asws/api/airport/status/${iata}`
      : `https://soa.smext.faa.gov/asws/api/airport/status/${iata}`;

    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      console.warn(`[Flights] FAA API error for ${iata}: ${response.status}`);
      return null;
    }

    const data: FAAStatusResponse = await response.json();

    const primaryStatus = data.Status?.[0];
    const avgDelayMinutes = primaryStatus ? parseAvgDelay(primaryStatus) : 0;
    const delayType = primaryStatus ? parseDelayType(primaryStatus) : 'general';

    const alert: AirportDelayAlert = {
      id: `faa-${iata}`,
      iata: data.IATA || iata,
      icao: data.ICAO || airport.icao,
      name: data.Name || airport.name,
      city: data.City || airport.city,
      country: airport.country,
      lat: airport.lat,
      lon: airport.lon,
      region: airport.region,
      delayType: data.Delay ? delayType : 'general',
      severity: data.Delay ? determineSeverity(avgDelayMinutes) : 'normal',
      avgDelayMinutes,
      reason: primaryStatus?.Reason || (data.Delay ? 'Delays reported' : undefined),
      source: 'faa',
      updatedAt: new Date(),
    };

    cache.set(cacheKey, { data: alert, timestamp: Date.now() });
    return alert;
  } catch (error) {
    console.error(`[Flights] Failed to fetch FAA status for ${iata}:`, error);
    return null;
  }
}

function generateSimulatedDelay(airport: MonitoredAirport): AirportDelayAlert {
  // Simulated delays based on typical patterns
  // In production, this would be replaced with real API data
  const hour = new Date().getUTCHours();
  const isRushHour = (hour >= 6 && hour <= 10) || (hour >= 16 && hour <= 20);

  // Higher chance of delays during rush hours and at busier airports
  const busyAirports = ['LHR', 'CDG', 'FRA', 'JFK', 'LAX', 'ORD', 'PEK', 'HND', 'DXB', 'SIN'];
  const isBusy = busyAirports.includes(airport.iata);

  // Random factor with weighted probability
  const random = Math.random();
  const delayChance = isRushHour ? 0.35 : 0.15;
  const hasDelay = random < (isBusy ? delayChance * 1.5 : delayChance);

  let avgDelayMinutes = 0;
  let delayType: FlightDelayType = 'general';
  let reason: string | undefined;

  if (hasDelay) {
    // Generate realistic delay values
    const severityRoll = Math.random();
    if (severityRoll < 0.05) {
      // Severe (5% of delays)
      avgDelayMinutes = 60 + Math.floor(Math.random() * 60);
      delayType = Math.random() < 0.3 ? 'ground_stop' : 'ground_delay';
      reason = Math.random() < 0.5 ? 'Weather conditions' : 'Air traffic volume';
    } else if (severityRoll < 0.2) {
      // Major (15% of delays)
      avgDelayMinutes = 45 + Math.floor(Math.random() * 20);
      delayType = 'ground_delay';
      reason = Math.random() < 0.5 ? 'Weather' : 'High traffic volume';
    } else if (severityRoll < 0.5) {
      // Moderate (30% of delays)
      avgDelayMinutes = 25 + Math.floor(Math.random() * 20);
      delayType = Math.random() < 0.5 ? 'departure_delay' : 'arrival_delay';
      reason = 'Congestion';
    } else {
      // Minor (50% of delays)
      avgDelayMinutes = 15 + Math.floor(Math.random() * 15);
      delayType = 'general';
      reason = 'Minor delays';
    }
  }

  return {
    id: `sim-${airport.iata}`,
    iata: airport.iata,
    icao: airport.icao,
    name: airport.name,
    city: airport.city,
    country: airport.country,
    lat: airport.lat,
    lon: airport.lon,
    region: airport.region,
    delayType,
    severity: determineSeverity(avgDelayMinutes),
    avgDelayMinutes,
    reason,
    source: 'computed',
    updatedAt: new Date(),
  };
}

export async function fetchFlightDelays(): Promise<AirportDelayAlert[]> {
  console.log('[Flights] Fetching flight delay data...');
  const alerts: AirportDelayAlert[] = [];

  // Fetch FAA data for US airports (in parallel batches)
  const faaPromises = FAA_AIRPORTS.map((iata) => fetchFAAStatus(iata));
  const faaResults = await Promise.allSettled(faaPromises);

  for (const result of faaResults) {
    if (result.status === 'fulfilled' && result.value) {
      alerts.push(result.value);
    }
  }

  // For non-US airports, generate simulated data
  // TODO: Replace with real APIs (Eurocontrol, AeroDataBox) when available
  const nonUsAirports = MONITORED_AIRPORTS.filter((a) => a.country !== 'USA');
  for (const airport of nonUsAirports) {
    const simulated = generateSimulatedDelay(airport);
    alerts.push(simulated);
  }

  // Only return airports with delays (severity > normal)
  const activeAlerts = alerts.filter((a) => a.severity !== 'normal');

  console.log(`[Flights] Found ${activeAlerts.length} airports with delays out of ${alerts.length} monitored`);
  return activeAlerts;
}

export function getAirportByCode(code: string): MonitoredAirport | undefined {
  return MONITORED_AIRPORTS.find(
    (a) => a.iata === code.toUpperCase() || a.icao === code.toUpperCase()
  );
}

export function getAllMonitoredAirports(): MonitoredAirport[] {
  return MONITORED_AIRPORTS;
}
