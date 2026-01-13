import type { SocialUnrestEvent, MilitaryFlight, MilitaryVessel, ClusteredEvent } from '@/types';

export interface CountryScore {
  code: string;
  name: string;
  score: number;
  level: 'low' | 'normal' | 'elevated' | 'high' | 'critical';
  trend: 'rising' | 'stable' | 'falling';
  change24h: number;
  components: ComponentScores;
  lastUpdated: Date;
}

export interface ComponentScores {
  unrest: number;
  security: number;
  information: number;
}

interface CountryData {
  protests: SocialUnrestEvent[];
  militaryFlights: MilitaryFlight[];
  militaryVessels: MilitaryVessel[];
  newsEvents: ClusteredEvent[];
}

export const TIER1_COUNTRIES: Record<string, string> = {
  US: 'United States',
  RU: 'Russia',
  CN: 'China',
  UA: 'Ukraine',
  IR: 'Iran',
  IL: 'Israel',
  TW: 'Taiwan',
  KP: 'North Korea',
  SA: 'Saudi Arabia',
  TR: 'Turkey',
  PL: 'Poland',
  DE: 'Germany',
  FR: 'France',
  GB: 'United Kingdom',
  IN: 'India',
  PK: 'Pakistan',
  SY: 'Syria',
  YE: 'Yemen',
  MM: 'Myanmar',
  VE: 'Venezuela',
};

const COUNTRY_KEYWORDS: Record<string, string[]> = {
  US: ['united states', 'america', 'washington', 'biden', 'trump', 'pentagon'],
  RU: ['russia', 'moscow', 'kremlin', 'putin'],
  CN: ['china', 'beijing', 'xi jinping', 'prc'],
  UA: ['ukraine', 'kyiv', 'zelensky', 'donbas'],
  IR: ['iran', 'tehran', 'khamenei', 'irgc'],
  IL: ['israel', 'tel aviv', 'netanyahu', 'idf', 'gaza'],
  TW: ['taiwan', 'taipei'],
  KP: ['north korea', 'pyongyang', 'kim jong'],
  SA: ['saudi arabia', 'riyadh', 'mbs'],
  TR: ['turkey', 'ankara', 'erdogan'],
  PL: ['poland', 'warsaw'],
  DE: ['germany', 'berlin'],
  FR: ['france', 'paris', 'macron'],
  GB: ['britain', 'uk', 'london', 'starmer'],
  IN: ['india', 'delhi', 'modi'],
  PK: ['pakistan', 'islamabad'],
  SY: ['syria', 'damascus', 'assad'],
  YE: ['yemen', 'sanaa', 'houthi'],
  MM: ['myanmar', 'burma', 'rangoon'],
  VE: ['venezuela', 'caracas', 'maduro'],
};

// Geopolitical baseline risk scores (0-50)
// Reflects inherent instability regardless of current events
const BASELINE_RISK: Record<string, number> = {
  US: 5,    // Stable democracy, high media coverage inflates event counts
  RU: 35,   // Authoritarian, active in Ukraine conflict
  CN: 25,   // Authoritarian, Taiwan tensions, internal repression
  UA: 50,   // Active war zone
  IR: 40,   // Authoritarian, regional tensions, under-reported
  IL: 45,   // Active conflict with Gaza/Lebanon
  TW: 30,   // China tensions, invasion risk
  KP: 45,   // Rogue state, nuclear threat, near-zero reporting
  SA: 20,   // Regional tensions but relatively stable
  TR: 25,   // Regional involvement, internal tensions
  PL: 10,   // NATO frontline but stable
  DE: 5,    // Stable democracy
  FR: 10,   // Social tensions but stable
  GB: 5,    // Stable democracy
  IN: 20,   // Regional tensions, internal issues
  PK: 35,   // Nuclear state, instability, terrorism
  SY: 50,   // Active civil war
  YE: 50,   // Active civil war
  MM: 45,   // Military coup, civil conflict
  VE: 40,   // Economic collapse, authoritarian
};

// Event significance multipliers
// Higher = each event is more significant (authoritarian states where events are suppressed)
// Lower = events are common/expected (open democracies with high media coverage)
const EVENT_MULTIPLIER: Record<string, number> = {
  US: 0.3,  // Many protests normal, over-reported
  RU: 2.0,  // Protests rare and significant
  CN: 2.5,  // Any protest is major (heavily suppressed)
  UA: 0.8,  // War context, events expected
  IR: 2.0,  // Protests suppressed, significant when occur
  IL: 0.7,  // Frequent conflict, well-documented
  TW: 1.5,  // Events significant
  KP: 3.0,  // Almost no reporting, any event = major
  SA: 2.0,  // Suppressed
  TR: 1.2,  // Some suppression
  PL: 0.8,  // Open democracy
  DE: 0.5,  // Protests normal
  FR: 0.6,  // Protests common
  GB: 0.5,  // Open democracy
  IN: 0.8,  // Large democracy, many events
  PK: 1.5,  // Some suppression
  SY: 0.7,  // War zone, events expected
  YE: 0.7,  // War zone, events expected
  MM: 1.8,  // Military suppression
  VE: 1.8,  // Suppressed
};

const countryDataMap = new Map<string, CountryData>();
const previousScores = new Map<string, number>();

function initCountryData(): CountryData {
  return { protests: [], militaryFlights: [], militaryVessels: [], newsEvents: [] };
}

export function clearCountryData(): void {
  countryDataMap.clear();
}

function normalizeCountryName(name: string): string | null {
  const lower = name.toLowerCase();
  for (const [code, keywords] of Object.entries(COUNTRY_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) return code;
  }
  for (const [code, countryName] of Object.entries(TIER1_COUNTRIES)) {
    if (lower.includes(countryName.toLowerCase())) return code;
  }
  return null;
}

export function ingestProtestsForCII(events: SocialUnrestEvent[]): void {
  for (const e of events) {
    const code = normalizeCountryName(e.country);
    if (!code || !TIER1_COUNTRIES[code]) continue;
    if (!countryDataMap.has(code)) countryDataMap.set(code, initCountryData());
    countryDataMap.get(code)!.protests.push(e);
  }
}

export function ingestMilitaryForCII(flights: MilitaryFlight[], vessels: MilitaryVessel[]): void {
  for (const f of flights) {
    const code = normalizeCountryName(f.operatorCountry);
    if (!code || !TIER1_COUNTRIES[code]) continue;
    if (!countryDataMap.has(code)) countryDataMap.set(code, initCountryData());
    countryDataMap.get(code)!.militaryFlights.push(f);
  }
  for (const v of vessels) {
    const code = normalizeCountryName(v.operatorCountry);
    if (!code || !TIER1_COUNTRIES[code]) continue;
    if (!countryDataMap.has(code)) countryDataMap.set(code, initCountryData());
    countryDataMap.get(code)!.militaryVessels.push(v);
  }
}

export function ingestNewsForCII(events: ClusteredEvent[]): void {
  for (const e of events) {
    const title = e.primaryTitle.toLowerCase();
    for (const [code] of Object.entries(TIER1_COUNTRIES)) {
      const keywords = COUNTRY_KEYWORDS[code] || [];
      if (keywords.some(kw => title.includes(kw))) {
        if (!countryDataMap.has(code)) countryDataMap.set(code, initCountryData());
        countryDataMap.get(code)!.newsEvents.push(e);
      }
    }
  }
}

function calcUnrestScore(data: CountryData, countryCode: string): number {
  const count = data.protests.length;
  if (count === 0) return 0;

  const multiplier = EVENT_MULTIPLIER[countryCode] ?? 1.0;
  const fatalities = data.protests.reduce((sum, p) => sum + (p.fatalities || 0), 0);
  const highSeverity = data.protests.filter(p => p.severity === 'high').length;

  // Apply event multiplier to account for reporting bias
  const adjustedCount = count * multiplier;
  const baseScore = Math.min(50, adjustedCount * 8);
  const fatalityBoost = Math.min(30, fatalities * 5 * multiplier);
  const severityBoost = Math.min(20, highSeverity * 10 * multiplier);

  return Math.min(100, baseScore + fatalityBoost + severityBoost);
}

function calcSecurityScore(data: CountryData): number {
  const flights = data.militaryFlights.length;
  const vessels = data.militaryVessels.length;
  const flightScore = Math.min(50, flights * 3);
  const vesselScore = Math.min(30, vessels * 5);
  return Math.min(100, flightScore + vesselScore);
}

function calcInformationScore(data: CountryData, countryCode: string): number {
  const count = data.newsEvents.length;
  if (count === 0) return 0;

  const multiplier = EVENT_MULTIPLIER[countryCode] ?? 1.0;
  const velocitySum = data.newsEvents.reduce((sum, e) => sum + (e.velocity?.sourcesPerHour || 0), 0);
  const avgVelocity = velocitySum / count;

  // Apply multiplier - news about authoritarian states is more significant
  const adjustedCount = count * multiplier;
  const baseScore = Math.min(40, adjustedCount * 5);
  const velocityBoost = Math.min(40, avgVelocity * 10);
  const alertBoost = data.newsEvents.some(e => e.isAlert) ? 20 : 0;

  return Math.min(100, baseScore + velocityBoost + alertBoost);
}

function getLevel(score: number): CountryScore['level'] {
  if (score >= 81) return 'critical';
  if (score >= 66) return 'high';
  if (score >= 51) return 'elevated';
  if (score >= 31) return 'normal';
  return 'low';
}

function getTrend(code: string, current: number): CountryScore['trend'] {
  const prev = previousScores.get(code);
  if (prev === undefined) return 'stable';
  const diff = current - prev;
  if (diff >= 5) return 'rising';
  if (diff <= -5) return 'falling';
  return 'stable';
}

export function calculateCII(): CountryScore[] {
  const scores: CountryScore[] = [];

  for (const [code, name] of Object.entries(TIER1_COUNTRIES)) {
    const data = countryDataMap.get(code) || initCountryData();
    const baselineRisk = BASELINE_RISK[code] ?? 20;

    // Calculate component scores with country-specific adjustments
    const components: ComponentScores = {
      unrest: calcUnrestScore(data, code),
      security: calcSecurityScore(data),
      information: calcInformationScore(data, code),
    };

    // Calculate event-based score (weighted components)
    const eventScore = components.unrest * 0.4 + components.security * 0.3 + components.information * 0.3;

    // Blend baseline risk with detected events
    // Formula: baseline provides floor, events can push it higher
    // - 40% baseline risk (geopolitical context always matters)
    // - 60% event-based (current detected activity)
    const blendedScore = baselineRisk * 0.4 + eventScore * 0.6;
    const score = Math.round(Math.min(100, blendedScore));

    const prev = previousScores.get(code) ?? score;

    scores.push({
      code,
      name,
      score,
      level: getLevel(score),
      trend: getTrend(code, score),
      change24h: score - prev,
      components,
      lastUpdated: new Date(),
    });

    previousScores.set(code, score);
  }

  return scores.sort((a, b) => b.score - a.score);
}

export function getTopUnstableCountries(limit = 10): CountryScore[] {
  return calculateCII().slice(0, limit);
}
