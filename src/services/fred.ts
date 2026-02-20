import { createCircuitBreaker } from '@/utils';
import { isFeatureAvailable } from './runtime-config';

export interface FredSeries {
  id: string;
  name: string;
  value: number | null;
  previousValue: number | null;
  change: number | null;
  changePercent: number | null;
  date: string;
  unit: string;
}

interface FredConfig {
  id: string;
  name: string;
  unit: string;
  precision: number;
}

interface FredObservation {
  date: string;
  value: string;
}

const FRED_SERIES: FredConfig[] = [
  { id: 'WALCL', name: 'Fed Total Assets', unit: '$B', precision: 0 },
  { id: 'FEDFUNDS', name: 'Fed Funds Rate', unit: '%', precision: 2 },
  { id: 'T10Y2Y', name: '10Y-2Y Spread', unit: '%', precision: 2 },
  { id: 'UNRATE', name: 'Unemployment', unit: '%', precision: 1 },
  { id: 'CPIAUCSL', name: 'CPI Index', unit: '', precision: 1 },
  { id: 'DGS10', name: '10Y Treasury', unit: '%', precision: 2 },
  { id: 'VIXCLS', name: 'VIX', unit: '', precision: 2 },
];

const FRED_API_BASE = '/api/fred-data';
const breaker = createCircuitBreaker<FredSeries[]>({ name: 'FRED Economic' });

interface FredBatchResponse {
  batch: Record<string, { observations: FredObservation[] }>;
}

function parseObservations(observations: FredObservation[]): { date: string; value: number }[] {
  return observations
    .map(obs => {
      const value = parseFloat(obs.value);
      if (isNaN(value) || obs.value === '.') return null;
      return { date: obs.date, value };
    })
    .filter((d): d is { date: string; value: number } => d !== null)
    .reverse();
}

function buildFredSeries(config: FredConfig, data: { date: string; value: number }[]): FredSeries | null {
  if (data.length >= 2) {
    const latest = data[data.length - 1]!;
    const previous = data[data.length - 2]!;
    const change = latest.value - previous.value;
    const changePercent = (change / previous.value) * 100;
    let displayValue = latest.value;
    if (config.id === 'WALCL') displayValue = latest.value / 1000;
    return {
      id: config.id, name: config.name,
      value: Number(displayValue.toFixed(config.precision)),
      previousValue: Number(previous.value.toFixed(config.precision)),
      change: Number(change.toFixed(config.precision)),
      changePercent: Number(changePercent.toFixed(2)),
      date: latest.date, unit: config.unit,
    };
  } else if (data.length === 1) {
    const latest = data[0]!;
    let displayValue = latest.value;
    if (config.id === 'WALCL') displayValue = latest.value / 1000;
    return {
      id: config.id, name: config.name,
      value: Number(displayValue.toFixed(config.precision)),
      previousValue: null, change: null, changePercent: null,
      date: latest.date, unit: config.unit,
    };
  }
  return null;
}

export async function fetchFredData(): Promise<FredSeries[]> {
  if (!isFeatureAvailable('economicFred')) return [];

  return breaker.execute(async () => {
    const endDate = new Date().toISOString().split('T')[0] as string;
    const startDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] as string;

    // Single batch request for all series (1 edge function invocation instead of 7)
    const allIds = FRED_SERIES.map(s => s.id).join(',');
    const params = new URLSearchParams({
      series_id: allIds,
      observation_start: startDate,
      observation_end: endDate,
    });

    const response = await fetch(`${FRED_API_BASE}?${params}`, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const json: FredBatchResponse = await response.json();
    const batch = json.batch || {};

    const results: FredSeries[] = [];
    for (const config of FRED_SERIES) {
      const raw = batch[config.id]?.observations || [];
      const data = parseObservations(raw);
      const series = buildFredSeries(config, data);
      if (series) results.push(series);
    }
    return results;
  }, []);
}

export function getFredStatus(): string {
  return breaker.getStatus();
}

export function getChangeClass(change: number | null): string {
  if (change === null) return '';
  if (change > 0) return 'positive';
  if (change < 0) return 'negative';
  return '';
}

export function formatChange(change: number | null, unit: string): string {
  if (change === null) return 'N/A';
  const sign = change >= 0 ? '+' : '';
  return `${sign}${change}${unit}`;
}
