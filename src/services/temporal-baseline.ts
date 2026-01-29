// Temporal Anomaly Detection Service
// Detects when current activity levels deviate from historical baselines

export type TemporalEventType = 
  | 'military_flights' 
  | 'vessels' 
  | 'protests' 
  | 'news' 
  | 'ais_gaps';

export interface TemporalBaseline {
  type: TemporalEventType;
  region: string;
  weekday: number; // 0-6, Sunday = 0
  month: number; // 1-12
  hourlyAvg: number[];
  dailyAvg: number;
  stdDev: number;
  sampleCount: number;
  lastUpdated: Date;
}

export interface TemporalAnomaly {
  type: TemporalEventType;
  region: string;
  currentCount: number;
  expectedCount: number;
  zScore: number;
  message: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

interface EventRecord {
  timestamp: Date;
  count: number;
}

// In-memory storage for baselines (would use IndexedDB in production)
const baselines = new Map<string, TemporalBaseline>();
const recentEvents = new Map<string, EventRecord[]>();

const WINDOW_HOURS = 24;
const Z_THRESHOLD_LOW = 1.5;
const Z_THRESHOLD_MEDIUM = 2.0;
const Z_THRESHOLD_HIGH = 3.0;

function getBaselineKey(type: TemporalEventType, region: string, weekday: number, month: number): string {
  return `${type}:${region}:${weekday}:${month}`;
}

function getRecentKey(type: TemporalEventType, region: string): string {
  return `${type}:${region}`;
}

export function updateBaseline(
  type: TemporalEventType,
  region: string,
  count: number,
  timestamp: Date = new Date()
): void {
  const weekday = timestamp.getDay();
  const month = timestamp.getMonth() + 1;
  const key = getBaselineKey(type, region, weekday, month);
  
  let baseline = baselines.get(key);
  const hour = timestamp.getHours();
  
  if (!baseline) {
    baseline = {
      type,
      region,
      weekday,
      month,
      hourlyAvg: new Array(24).fill(0),
      dailyAvg: 0,
      stdDev: 0,
      sampleCount: 0,
      lastUpdated: timestamp,
    };
    baselines.set(key, baseline);
  }
  
  // Update hourly average (exponential moving average)
  baseline.hourlyAvg[hour] = (baseline.hourlyAvg[hour] * 0.7) + (count * 0.3);
  baseline.sampleCount++;
  baseline.lastUpdated = timestamp;
  
  // Recalculate daily average
  const hourlySum = baseline.hourlyAvg.reduce((a, b) => a + b, 0);
  baseline.dailyAvg = hourlySum / 24;
}

export function getZScore(
  type: TemporalEventType,
  region: string,
  currentCount: number,
  timestamp: Date = new Date()
): number {
  const weekday = timestamp.getDay();
  const month = timestamp.getMonth() + 1;
  const key = getBaselineKey(type, region, weekday, month);
  
  const baseline = baselines.get(key);
  if (!baseline || baseline.sampleCount < 10 || baseline.stdDev === 0) {
    return 0; // Not enough data
  }
  
  const zScore = (currentCount - baseline.dailyAvg) / baseline.stdDev;
  return Math.abs(zScore);
}

export function detectAnomaly(
  type: TemporalEventType,
  region: string,
  currentCount: number,
  timestamp: Date = new Date()
): TemporalAnomaly | null {
  const weekday = timestamp.getDay();
  const month = timestamp.getMonth() + 1;
  const key = getBaselineKey(type, region, weekday, month);
  
  const baseline = baselines.get(key);
  if (!baseline || baseline.sampleCount < 10) {
    return null; // Not enough data
  }
  
  const zScore = getZScore(type, region, currentCount, timestamp);
  
  if (zScore < Z_THRESHOLD_LOW) {
    return null; // Within normal range
  }
  
  const weekdayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const monthNames = ['', 'January', 'February', 'March', 'April', 'May', 'June', 
                      'July', 'August', 'September', 'October', 'November', 'December'];
  
  const typeLabels: Record<TemporalEventType, string> = {
    military_flights: 'Military flights',
    vessels: 'Naval vessels',
    protests: 'Protests',
    news: 'News velocity',
    ais_gaps: 'Dark ship activity',
  };
  
  const multiplier = currentCount / (baseline.dailyAvg || 1);
  const formattedMult = multiplier < 10 
    ? `${multiplier.toFixed(1)}x` 
    : `${multiplier.toFixed(0)}x`;
  
  let severity: 'low' | 'medium' | 'high' | 'critical';
  if (zScore >= Z_THRESHOLD_HIGH) severity = 'critical';
  else if (zScore >= Z_THRESHOLD_MEDIUM) severity = 'high';
  else severity = 'medium';
  
  const message = `${typeLabels[type]} in ${region} ${formattedMult} normal for ${weekdayNames[weekday]} (${monthNames[month]})`;
  
  return {
    type,
    region,
    currentCount,
    expectedCount: Math.round(baseline.dailyAvg),
    zScore: Math.round(zScore * 10) / 10,
    message,
    severity,
  };
}

export function getAllAnomalies(
  events: Array<{ type: TemporalEventType; region: string; count: number }>,
  timestamp: Date = new Date()
): TemporalAnomaly[] {
  const anomalies: TemporalAnomaly[] = [];
  
  for (const event of events) {
    const anomaly = detectAnomaly(event.type, event.region, event.count, timestamp);
    if (anomaly) {
      anomalies.push(anomaly);
    }
  }
  
  return anomalies.sort((a, b) => b.zScore - a.zScore);
}

export function getBaselineStats(type: TemporalEventType, region: string): {
  sampleCount: number;
  lastUpdated: Date | null;
  avgDaily: number;
} {
  let totalSamples = 0;
  let lastUpdated: Date | null = null;
  let totalAvg = 0;
  let count = 0;
  
  for (let w = 0; w < 7; w++) {
    for (let m = 1; m <= 12; m++) {
      const key = getBaselineKey(type, region, w, m);
      const baseline = baselines.get(key);
      if (baseline) {
        totalSamples += baseline.sampleCount;
        if (!lastUpdated || baseline.lastUpdated > lastUpdated) {
          lastUpdated = baseline.lastUpdated;
        }
        totalAvg += baseline.dailyAvg;
        count++;
      }
    }
  }
  
  return {
    sampleCount: totalSamples,
    lastUpdated,
    avgDaily: count > 0 ? totalAvg / count : 0,
  };
}

export function clearBaselines(): void {
  baselines.clear();
  recentEvents.clear();
}

export function getBaselineCount(): number {
  return baselines.size;
}

// Debug/test function
export function debugInjectTestBaseline(): void {
  const now = new Date();
  const weekday = now.getDay();
  
  // Inject artificially high baseline for testing
  const testKey = getBaselineKey('military_flights', 'Baltic', weekday, now.getMonth() + 1);
  baselines.set(testKey, {
    type: 'military_flights',
    region: 'Baltic',
    weekday,
    month: now.getMonth() + 1,
    hourlyAvg: new Array(24).fill(5),
    dailyAvg: 120,
    stdDev: 20,
    sampleCount: 100,
    lastUpdated: now,
  });
  
  console.log('[TemporalBaseline] Injected test baseline for Baltic military flights');
}
