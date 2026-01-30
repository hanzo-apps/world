// NASA FIRMS Satellite Fire Data Service
// Integrates with NASA Fire Information for Resource Management System
// Detects active fires, thermal anomalies in monitored regions

export interface FireDataPoint {
  lat: number;
  lon: number;
  brightness: number;  // Kelvin
  scan: number;
  track: number;
  acq_date: string;
  acq_time: string;
  satellite: string;  // "N" for VIIRS, "T" for MODIS
  confidence: number;
  version: number;
  bright_t31: number;
  frp: number;  // Fire Radiative Power (MW)
  daynight: string;  // "D" or "N"
}

export interface FireRegionStats {
  region: string;
  fireCount: number;
  totalFrp: number;  // MW
  lastUpdated: Date;
  highIntensityCount: number;
}

// Coordinates for key monitored regions
const MONITORED_REGIONS: Record<string, { lat: number; lon: number; radius: number }> = {
  'Ukraine': { lat: 48.5, lon: 31.2, radius: 8 },
  'Russia': { lat: 60.0, lon: 100.0, radius: 15 },
  'Iran': { lat: 32.0, lon: 53.0, radius: 6 },
  'Israel/Gaza': { lat: 31.5, lon: 34.5, radius: 2 },
  'Syria': { lat: 35.0, lon: 38.0, radius: 5 },
  'Taiwan': { lat: 24.0, lon: 121.0, radius: 3 },
  'China': { lat: 35.0, lon: 105.0, radius: 12 },
  'North Korea': { lat: 40.0, lon: 127.0, radius: 2 },
  'Saudi Arabia': { lat: 24.0, lon: 45.0, radius: 6 },
  'Turkey': { lat: 39.0, lon: 35.0, radius: 4 },
};

// Sample FIRMS API response (for demo - real implementation would call API)
const DEMO_FIRE_DATA: FireDataPoint[] = [
  { lat: 48.8, lon: 31.2, brightness: 320, scan: 0.5, track: 0.3, acq_date: '2026-01-30', acq_time: '0230', satellite: 'N', confidence: 95, version: 4, bright_t31: 290, frp: 15.2, daynight: 'N' },
  { lat: 48.9, lon: 31.1, brightness: 340, scan: 0.4, track: 0.3, acq_date: '2026-01-30', acq_time: '0230', satellite: 'N', confidence: 98, version: 4, bright_t31: 295, frp: 18.5, daynight: 'N' },
  { lat: 32.5, lon: 35.5, brightness: 380, scan: 0.3, track: 0.2, acq_date: '2026-01-30', acq_time: '0230', satellite: 'N', confidence: 99, version: 4, bright_t31: 300, frp: 22.1, daynight: 'N' },
];

// NASA FIRMS API configuration
const FIRMS_API_BASE = 'https://firms.modaps.eosdis.nasa.gov/api';

let apiKey: string | null = null;

export function setFirmsApiKey(key: string): void {
  apiKey = key;
}

export function getApiKey(): string | null {
  return apiKey;
}

// Fetch fires for a specific region using NASA FIRMS API
export async function fetchFiresForRegion(
  region: string,
  daysBack: number = 1
): Promise<FireDataPoint[]> {
  const config = MONITORED_REGIONS[region];
  if (!config) {
    console.warn(`[FIRMS] Unknown region: ${region}`);
    return [];
  }

  // If no API key, return demo data
  if (!apiKey) {
    console.log(`[FIRMS] No API key configured, using demo data for ${region}`);
    return DEMO_FIRE_DATA.filter(f => {
      const dist = Math.sqrt(
        Math.pow(f.lat - config.lat, 2) + 
        Math.pow(f.lon - config.lon, 2)
      );
      return dist < config.radius;
    });
  }

  try {
    // Calculate date range
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);
    
    const startStr = startDate.toISOString().split('T')[0];
    const endStr = endDate.toISOString().split('T')[0];

    // Build API URL
    // Using VIIRS NRT (Near Real Time) data
    const url = `${FIRMS_API_BASE}/area/${apiKey}/${config.lat}/${config.lon}/${config.radius}/${startStr}/${endStr}/VIIRS_NRT`;
    
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`FIRMS API error: ${response.status}`);
    }
    
    const data = await response.json();
    return data as FireDataPoint[];
  } catch (error) {
    console.error(`[FIRMS] Error fetching ${region}:`, error);
    return [];
  }
}

// Get fire statistics for all monitored regions
export async function getAllFireStats(): Promise<FireRegionStats[]> {
  const stats: FireRegionStats[] = [];
  
  for (const region of Object.keys(MONITORED_REGIONS)) {
    const fires = await fetchFiresForRegion(region);
    const highIntensity = fires.filter(f => f.brightness > 360 && f.confidence > 90);
    
    stats.push({
      region,
      fireCount: fires.length,
      totalFrp: fires.reduce((sum, f) => sum + (f.frp || 0), 0),
      lastUpdated: new Date(),
      highIntensityCount: highIntensity.length,
    });
  }
  
  return stats.sort((a, b) => b.fireCount - a.fireCount);
}

// Check for unusual fire activity (spike compared to baseline)
export async function detectFireAnomaly(region: string): Promise<{
  hasAnomaly: boolean;
  currentCount: number;
  baselineCount: number;
  severity: 'normal' | 'elevated' | 'high' | 'critical';
}> {
  const fires = await fetchFiresForRegion(region);
  const currentCount = fires.length;
  
  // Simple baseline (in production, this would use historical data)
  const baselineCount = 3; // Average for a day
  
  const ratio = currentCount / Math.max(1, baselineCount);
  
  let severity: 'normal' | 'elevated' | 'high' | 'critical';
  if (ratio < 1.5) severity = 'normal';
  else if (ratio < 3) severity = 'elevated';
  else if (ratio < 5) severity = 'high';
  else severity = 'critical';
  
  return {
    hasAnomaly: ratio > 2,
    currentCount,
    baselineCount,
    severity,
  };
}

// Convert fire data to threat signal format
export function firesToThreatSignal(fires: FireDataPoint[], region: string): object {
  const highIntensity = fires.filter(f => f.brightness > 360 && f.confidence > 90);
  
  return {
    type: 'satellite_fire',
    title: `Active Fires Detected: ${region}`,
    description: `${fires.length} fire detections, ${highIntensity.length} high-intensity`,
    severity: highIntensity.length > 3 ? 'high' : fires.length > 5 ? 'medium' : 'low',
    data: {
      region,
      fireCount: fires.length,
      highIntensityCount: highIntensity.length,
      totalFrp: fires.reduce((sum, f) => sum + (f.frp || 0), 0),
      satellites: [...new Set(fires.map(f => f.satellite))],
    },
    timestamp: new Date(),
  };
}

// Health check for FIRMS integration
export function checkFirmsHealth(): { configured: boolean; key: string | null } {
  return {
    configured: apiKey !== null,
    key: apiKey ? '***' + apiKey.slice(-4) : null,
  };
}
