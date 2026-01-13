# Country Instability Index

## The Intelligence Problem

Analysts constantly need to answer: **"How stable is Country X right now?"**

Currently, answering this requires mentally aggregating:
- Recent protest activity
- News sentiment and velocity
- Economic indicators
- Sanctions status
- Conflict proximity
- GDELT tension scores
- Infrastructure incidents
- Election timing
- Historical patterns

This cognitive synthesis is slow, inconsistent, and doesn't scale. Two analysts looking at the same data may reach different conclusions.

**Solution**: A real-time, composite **Country Instability Index (CII)** that aggregates all available signals into a single 0-100 score per country, with transparent component breakdown.

---

## Design Philosophy

### Principles

1. **Transparent, not black-box**: Users can see exactly which components contribute to the score
2. **Relative, not absolute**: A score of 70 means "significantly elevated for this country," not "70% chance of collapse"
3. **Trend-aware**: Direction matters as much as level (rising from 30→50 is more urgent than stable at 60)
4. **Actionable**: High scores should correlate with events worth monitoring

### What CII Is NOT

- Not a predictive model ("Country X will have a coup in 30 days")
- Not a governance quality index (that's Freedom House, V-Dem)
- Not a long-term structural assessment
- Not comparable across countries (Russia 50 ≠ Switzerland 50)

CII measures **current situational instability relative to that country's own baseline**.

---

## Component Architecture

### Component Categories

| Category | Weight | What It Captures |
|----------|--------|------------------|
| **Civil Unrest** | 25% | Protests, riots, strikes |
| **Security** | 20% | Conflicts, military activity, violence |
| **Information** | 15% | News velocity, sentiment, attention |
| **Economic** | 15% | Market moves, sanctions, trade disruption |
| **Geopolitical** | 15% | Tensions with other states, diplomatic incidents |
| **Infrastructure** | 10% | Outages, disruptions, incidents |

### Component Details

#### 1. Civil Unrest Component (25%)

**Data Sources**:
- ACLED: Protests, riots, violence against civilians
- GDELT: Protest mention volume

**Metrics**:
```typescript
interface UnrestMetrics {
  eventCount7d: number;        // Events in past 7 days
  eventCount30d: number;       // Events in past 30 days
  fatalityCount: number;       // Deaths from unrest
  riotRatio: number;           // Riots / total events
  velocityTrend: 'rising' | 'stable' | 'falling';
  geoSpread: number;           // Number of distinct cities affected
}
```

**Scoring**:
```
base_score = min(100, eventCount7d * 5)
fatality_boost = min(30, fatalityCount * 3)
riot_boost = riotRatio * 20
spread_boost = min(20, geoSpread * 2)
velocity_multiplier = rising ? 1.3 : falling ? 0.7 : 1.0

unrest_score = (base_score + fatality_boost + riot_boost + spread_boost) * velocity_multiplier
```

#### 2. Security Component (20%)

**Data Sources**:
- Conflict zones (proximity and intensity)
- Military flights in/near country
- Military vessels in territorial waters
- ACLED battles and explosions

**Metrics**:
```typescript
interface SecurityMetrics {
  activeConflict: boolean;
  conflictIntensity: 'low' | 'medium' | 'high';
  militaryFlights24h: number;
  foreignMilitaryFlights24h: number;
  navalActivity: number;
  violentEvents7d: number;
}
```

**Scoring**:
```
conflict_score = activeConflict ? (intensity === 'high' ? 80 : intensity === 'medium' ? 50 : 30) : 0
military_score = min(40, (militaryFlights24h + foreignMilitaryFlights24h * 2) * 2)
violence_score = min(40, violentEvents7d * 4)

security_score = max(conflict_score, (military_score + violence_score) / 2)
```

#### 3. Information Component (15%)

**Data Sources**:
- RSS news feeds (clustered)
- GDELT news volume
- News sentiment analysis

**Metrics**:
```typescript
interface InformationMetrics {
  newsVelocity: number;          // Articles per hour mentioning country
  velocityBaseline: number;      // 30-day average
  velocityZScore: number;        // Standard deviations from baseline
  sentimentScore: number;        // -1 to +1
  crisisKeywordHits: number;     // Matches for: war, crisis, collapse, coup, etc.
}
```

**Scoring**:
```
velocity_score = min(50, velocityZScore * 15)
sentiment_penalty = sentimentScore < -0.3 ? abs(sentimentScore) * 30 : 0
crisis_boost = min(30, crisisKeywordHits * 5)

information_score = velocity_score + sentiment_penalty + crisis_boost
```

#### 4. Economic Component (15%)

**Data Sources**:
- Stock market (if country has major exchange)
- Currency movements (future: forex APIs)
- Sanctions status
- Commodity prices (for commodity exporters)

**Metrics**:
```typescript
interface EconomicMetrics {
  marketChange24h: number;       // % change in main index
  currencyChange7d: number;      // % change vs USD (future)
  sanctionsLevel: 'none' | 'partial' | 'comprehensive';
  commodityExposure: number;     // Relevance of commodity price swings
}
```

**Scoring**:
```
market_score = abs(marketChange24h) > 3 ? min(40, abs(marketChange24h) * 8) : 0
sanctions_score = comprehensive ? 50 : partial ? 25 : 0
currency_score = abs(currencyChange7d) > 5 ? min(30, abs(currencyChange7d) * 3) : 0

economic_score = market_score + sanctions_score + currency_score
```

#### 5. Geopolitical Component (15%)

**Data Sources**:
- GDELT GPR tension scores
- Diplomatic incident news
- Prediction markets (relevant questions)

**Metrics**:
```typescript
interface GeopoliticalMetrics {
  tensionScores: { partner: string; score: number; trend: string }[];
  maxTension: number;
  tensionTrend: 'rising' | 'stable' | 'falling';
  diplomaticIncidents7d: number;
  predictionShifts: number;      // Big moves in related prediction markets
}
```

**Scoring**:
```
tension_score = min(60, maxTension * 0.6)
trend_multiplier = tensionTrend === 'rising' ? 1.4 : tensionTrend === 'falling' ? 0.6 : 1.0
diplomatic_boost = min(20, diplomaticIncidents7d * 5)
prediction_boost = min(20, predictionShifts * 10)

geopolitical_score = (tension_score * trend_multiplier) + diplomatic_boost + prediction_boost
```

#### 6. Infrastructure Component (10%)

**Data Sources**:
- Internet outages (Cloudflare)
- Pipeline incidents (news-inferred)
- Cable disruptions
- Airport delays/closures

**Metrics**:
```typescript
interface InfrastructureMetrics {
  internetOutage: boolean;
  outageSevenity: 'partial' | 'major' | 'total';
  pipelineIncidents: number;
  cableDisruptions: number;
  airportClosures: number;
}
```

**Scoring**:
```
outage_score = total ? 80 : major ? 50 : partial ? 20 : 0
pipeline_score = min(30, pipelineIncidents * 15)
cable_score = min(20, cableDisruptions * 10)
airport_score = min(20, airportClosures * 10)

infrastructure_score = max(outage_score, pipeline_score + cable_score + airport_score)
```

---

## Composite Score Calculation

### Weighted Sum

```typescript
function calculateCII(country: CountryMetrics): number {
  const components = {
    unrest: { score: calcUnrestScore(country), weight: 0.25 },
    security: { score: calcSecurityScore(country), weight: 0.20 },
    information: { score: calcInformationScore(country), weight: 0.15 },
    economic: { score: calcEconomicScore(country), weight: 0.15 },
    geopolitical: { score: calcGeopoliticalScore(country), weight: 0.15 },
    infrastructure: { score: calcInfrastructureScore(country), weight: 0.10 },
  };

  let rawScore = 0;
  for (const [, comp] of Object.entries(components)) {
    rawScore += comp.score * comp.weight;
  }

  // Apply country-specific baseline adjustment
  const baseline = getCountryBaseline(country.code);
  const adjustedScore = rawScore - baseline.mean;
  const zScore = adjustedScore / baseline.stdDev;

  // Convert Z-score to 0-100 scale
  // Z=0 → 50, Z=2 → 75, Z=-2 → 25
  const normalizedScore = Math.max(0, Math.min(100, 50 + zScore * 12.5));

  return Math.round(normalizedScore);
}
```

### Baseline Normalization

**Critical**: Raw scores are meaningless without baseline comparison.

- Russia always has military activity → raw score would always be high
- Switzerland rarely has protests → a single protest is significant

**Solution**: Maintain rolling 90-day baseline per country, normalize scores as Z-scores.

```typescript
interface CountryBaseline {
  countryCode: string;
  mean: number;           // Average raw score over 90 days
  stdDev: number;         // Standard deviation
  min: number;
  max: number;
  dataPoints: number;     // Number of observations
  lastUpdated: Date;
}
```

---

## Alert Thresholds

| Score Range | Level | Description | Action |
|------------|-------|-------------|--------|
| 0-30 | Low | Below baseline | Monitor |
| 31-50 | Normal | At baseline | Standard |
| 51-65 | Elevated | Above baseline | Increased attention |
| 66-80 | High | Significantly elevated | Alert |
| 81-100 | Critical | Extreme deviation | Urgent |

### Trend-Based Alerts

Score level alone isn't enough. Rapid change is also significant.

```typescript
interface TrendAlert {
  type: 'spike' | 'surge' | 'decline';
  country: string;
  previousScore: number;
  currentScore: number;
  change: number;
  timeframe: string;      // "24h", "7d"
}

// Alert conditions
const SPIKE_THRESHOLD = 15;   // +15 points in 24h
const SURGE_THRESHOLD = 25;   // +25 points in 7d
const DECLINE_THRESHOLD = -20; // -20 points in 7d (potential calm before storm?)
```

---

## Scheduled Events Integration

Elections, transitions, and anniversaries are known risk amplifiers. Integrate them into CII.

### Event Calendar Schema

```typescript
interface ScheduledEvent {
  id: string;
  countryCode: string;
  type: 'election' | 'referendum' | 'transition' | 'anniversary' | 'summit';
  date: Date;
  name: string;
  significance: 'critical' | 'high' | 'medium' | 'low';
  notes?: string;
}

const UPCOMING_EVENTS: ScheduledEvent[] = [
  {
    id: 'ir-election-2025',
    countryCode: 'IR',
    type: 'election',
    date: new Date('2025-06-18'),
    name: 'Iranian Presidential Election',
    significance: 'critical',
  },
  {
    id: 'tw-election-2028',
    countryCode: 'TW',
    type: 'election',
    date: new Date('2028-01-13'),
    name: 'Taiwan Presidential Election',
    significance: 'critical',
  },
  // ... more events
];
```

### Event Impact on CII

Apply score adjustments based on proximity to scheduled events:

```typescript
function getEventModifier(countryCode: string, date: Date): EventModifier {
  const upcomingEvents = UPCOMING_EVENTS.filter(e =>
    e.countryCode === countryCode &&
    e.date > date &&
    differenceInDays(e.date, date) <= 30
  );

  if (upcomingEvents.length === 0) return { modifier: 1.0, events: [] };

  let maxModifier = 1.0;
  for (const event of upcomingEvents) {
    const daysUntil = differenceInDays(event.date, date);

    // Closer to event = higher modifier
    let eventModifier = 1.0;
    if (event.significance === 'critical') {
      if (daysUntil <= 1) eventModifier = 1.5;        // Election day
      else if (daysUntil <= 7) eventModifier = 1.3;  // Week before
      else if (daysUntil <= 14) eventModifier = 1.2; // 2 weeks
      else eventModifier = 1.1;                       // Month before
    } else if (event.significance === 'high') {
      if (daysUntil <= 3) eventModifier = 1.2;
      else if (daysUntil <= 14) eventModifier = 1.1;
    }

    maxModifier = Math.max(maxModifier, eventModifier);
  }

  return {
    modifier: maxModifier,
    events: upcomingEvents,
  };
}
```

### Event Display in UI

```
┌─────────────────────────────────────────────────┐
│ 🇮🇷 IRAN                          CII: 78 ↑12  │
│ ████████████████████░░░░░                       │
│                                                 │
│ ⚠️ UPCOMING EVENT                               │
│ Presidential Election in 12 days               │
│ Sensitivity: +20% boost applied                │
└─────────────────────────────────────────────────┘
```

---

## Data Confidence Indicators

**Critical**: Users must know when data is incomplete.

### Confidence Schema

```typescript
interface DataConfidence {
  countryCode: string;
  tier: 1 | 2 | 3;
  componentCoverage: {
    unrest: { available: boolean; freshness: 'realtime' | 'daily' | 'weekly' | 'stale' };
    security: { available: boolean; freshness: string };
    information: { available: boolean; freshness: string };
    economic: { available: boolean; freshness: string };
    geopolitical: { available: boolean; freshness: string };
    infrastructure: { available: boolean; freshness: string };
  };
  overallConfidence: number;  // 0-1
  lastFullUpdate: Date;
  warnings: string[];
}

function calculateConfidence(coverage: ComponentCoverage): number {
  const weights = { unrest: 0.25, security: 0.2, information: 0.15, economic: 0.15, geopolitical: 0.15, infrastructure: 0.1 };
  let confidence = 0;

  for (const [component, weight] of Object.entries(weights)) {
    const comp = coverage[component];
    if (comp.available) {
      const freshnessScore = comp.freshness === 'realtime' ? 1.0 :
                            comp.freshness === 'daily' ? 0.8 :
                            comp.freshness === 'weekly' ? 0.5 : 0.2;
      confidence += weight * freshnessScore;
    }
  }

  return confidence;
}
```

### Confidence Display

```
┌─────────────────────────────────────────────────┐
│ 🇨🇫 CENTRAL AFRICAN REPUBLIC      CII: 65 ↑3  │
│ ██████████████░░░░░░░░░░                        │
│                                                 │
│ ⚠️ LIMITED DATA (Tier 3)                        │
│ Confidence: 45%                                 │
│ Available: Unrest ✓, Security ✓, News ✓        │
│ Missing: Economic ✗, Infrastructure ✗          │
│                                                 │
│ Score based on partial data. Exercise caution. │
└─────────────────────────────────────────────────┘
```

---

## UI/UX Design

### Map Layer: Choropleth

Color countries by CII score:

```typescript
const CII_COLORS = {
  0: '#22aa88',   // Low - green
  30: '#88aa44', // Normal - yellow-green
  50: '#aaaa44', // Elevated - yellow
  65: '#ffaa00', // High - orange
  80: '#ff4444', // Critical - red
};
```

Map interaction:
- Hover: Show country name + score + trend arrow
- Click: Open detail panel

### Country Panel

```
┌─────────────────────────────────────────────────┐
│ COUNTRY INSTABILITY INDEX                       │
├─────────────────────────────────────────────────┤
│ Sort: [Score ▼] [Change ▼] [Alpha]             │
├─────────────────────────────────────────────────┤
│ 🔴 IRAN                            CII: 78 ↑12 │
│    ████████████████████░░░░░                    │
│    Unrest: 85 | Security: 72 | Info: 68        │
├─────────────────────────────────────────────────┤
│ 🟠 UKRAINE                         CII: 71 →   │
│    ███████████████████░░░░░░                    │
│    Security: 95 | Unrest: 45 | Geo: 80         │
├─────────────────────────────────────────────────┤
│ 🟡 FRANCE                          CII: 58 ↑8  │
│    ███████████████░░░░░░░░░░                    │
│    Unrest: 72 | Info: 55 | Econ: 40            │
├─────────────────────────────────────────────────┤
│ 🟢 GERMANY                         CII: 42 ↓3  │
│    ███████████░░░░░░░░░░░░░░                    │
│    Econ: 45 | Info: 40 | Geo: 38               │
└─────────────────────────────────────────────────┘
```

### Country Detail View

```
┌─────────────────────────────────────────────────┐
│ 🇮🇷 IRAN                                        │
│ Instability Index: 78/100                      │
│ Trend: ↑12 (24h) | ↑23 (7d)                   │
│ Level: HIGH                                    │
├─────────────────────────────────────────────────┤
│ COMPONENT BREAKDOWN                             │
│                                                 │
│ Civil Unrest     ████████████████░░░░  85/100 │
│   • 23 protests in 7 days (+340% vs baseline) │
│   • 3 fatalities reported                      │
│   • 8 cities affected                          │
│                                                 │
│ Security         ███████████████░░░░░  72/100 │
│   • No active conflict                         │
│   • 15 military flights detected               │
│   • IRGC activity elevated                     │
│                                                 │
│ Information      █████████████░░░░░░░  68/100 │
│   • News velocity: +280% vs baseline           │
│   • Sentiment: Negative (-0.6)                 │
│   • Crisis keywords: "protest", "crackdown"   │
│                                                 │
│ Economic         ████████░░░░░░░░░░░░  42/100 │
│   • Sanctions: Comprehensive                   │
│   • No market data available                   │
│                                                 │
│ Geopolitical     ██████████████░░░░░░  70/100 │
│   • USA-Iran tension: 8.2 (rising)            │
│   • Israel-Iran tension: 7.8 (stable)         │
│                                                 │
│ Infrastructure   ██████░░░░░░░░░░░░░░  30/100 │
│   • No major outages                           │
├─────────────────────────────────────────────────┤
│ HISTORICAL CONTEXT                              │
│                                                 │
│ 90-day baseline: 52 ± 12                       │
│ Current score is 2.2σ above mean               │
│ Last similar level: Dec 2024 (Mahsa protests) │
│                                                 │
│ [Score History Chart - 90 days]                │
│     ╭─╮    ╭──╮                               │
│  ───╯ ╰────╯  ╰──────╮                        │
│                       ╰────╭───────           │
│  Jan        Feb        Mar                     │
├─────────────────────────────────────────────────┤
│ NEARBY HOTSPOTS                                 │
│ • Tehran (CII contributor)                     │
│ • Strait of Hormuz (shipping risk)             │
│ • Iraq border (conflict proximity)             │
├─────────────────────────────────────────────────┤
│ RELATED NEWS                                    │
│ • "Protests erupt in Tehran over..." (Reuters) │
│ • "Iran deploys security forces..." (BBC)      │
│ • "US warns of potential..." (State Dept)      │
└─────────────────────────────────────────────────┘
```

---

## Country Coverage

### Tier 1: Full Coverage (Real-time)

Countries with complete data across all components:

```
United States, Russia, China, United Kingdom, France, Germany,
Japan, South Korea, Israel, Iran, Saudi Arabia, UAE, Turkey,
India, Pakistan, Ukraine, Poland, Taiwan, Australia, Brazil
```

### Tier 2: Partial Coverage

Countries with 4+ components available:

```
Most EU members, Canada, Mexico, Egypt, South Africa, Nigeria,
Indonesia, Vietnam, Thailand, Philippines, Argentina, Colombia
```

### Tier 3: Limited Coverage

Countries with 2-3 components (primarily news + protests):

```
Most African nations, Central Asian states, Caribbean, Pacific islands
```

---

## Country Code Mapping

Map events to countries using ISO 3166-1 alpha-2 codes.

### Sources to Country Mapping

| Source | Country Field | Notes |
|--------|--------------|-------|
| ACLED | `country` | Direct |
| GDELT | `ActionGeo_CountryCode` | Needs mapping |
| News | Inferred from keywords | See hotspot mappings |
| OpenSky | `origin_country` | Registration country |
| AIS | Flag state from MMSI | First 3 digits |
| Conflicts | Config | Predefined |
| Sanctions | Config | Predefined |

### Keyword to Country Inference

For news articles without explicit country tags:

```typescript
const COUNTRY_KEYWORDS: Record<string, string[]> = {
  'US': ['united states', 'america', 'washington', 'biden', 'trump', 'pentagon', 'white house'],
  'RU': ['russia', 'moscow', 'kremlin', 'putin'],
  'CN': ['china', 'beijing', 'xi jinping', 'ccp', 'prc'],
  'UA': ['ukraine', 'kyiv', 'zelensky', 'donbas'],
  'IR': ['iran', 'tehran', 'khamenei', 'irgc'],
  'IL': ['israel', 'tel aviv', 'netanyahu', 'idf'],
  'TW': ['taiwan', 'taipei', 'tsai'],
  // ... etc
};
```

---

## Data Storage

### IndexedDB Schema

```typescript
interface CountryInstabilityStore {
  // Current scores
  scores: Map<string, CountryScore>;

  // Historical data for trends
  history: CountryScoreHistory[];

  // Baselines for normalization
  baselines: Map<string, CountryBaseline>;

  // Raw component data
  components: Map<string, CountryComponents>;
}

interface CountryScore {
  countryCode: string;
  countryName: string;
  score: number;
  level: 'low' | 'normal' | 'elevated' | 'high' | 'critical';
  trend: 'rising' | 'stable' | 'falling';
  change24h: number;
  change7d: number;
  components: ComponentScores;
  lastUpdated: Date;
}

interface CountryScoreHistory {
  countryCode: string;
  timestamp: Date;
  score: number;
  components: ComponentScores;
}
```

---

## Implementation Phases

### Phase 1: Core Index (MVP)

1. Implement score calculation for Tier 1 countries
2. Components: Unrest + Security + Information
3. Simple list view sorted by score
4. No baseline normalization (raw scores)

### Phase 2: Full Components

1. Add: Economic, Geopolitical, Infrastructure
2. Implement baseline calculation and Z-score normalization
3. Choropleth map layer
4. Trend detection and alerts

### Phase 3: Analytics

1. Historical score charts
2. Component drill-down
3. Country comparison
4. Export/reporting

### Phase 4: Expansion

1. Tier 2 country coverage
2. Predictive signals (leading indicators)
3. Correlation with prediction markets
4. Custom country watchlists

---

## Challenges & Mitigations

### 1. Data Sparsity for Small Countries

**Problem**: Many countries lack protest data, market data, etc.

**Mitigation**:
- Weight available components higher
- Use regional proxies (e.g., sub-Saharan Africa baseline)
- Show confidence indicator based on data availability

### 2. Event Attribution

**Problem**: News article mentions multiple countries. Which gets the score?

**Mitigation**:
- Primary country (headline focus) gets full weight
- Secondary mentions get 0.3x weight
- Use NLP for subject vs object detection (future)

### 3. Baseline Cold Start

**Problem**: New countries or new data sources lack historical baseline.

**Mitigation**:
- Use regional average as initial baseline
- Require 14 days of data before normalization
- Show "establishing baseline" indicator

### 4. Comparison Temptation

**Problem**: Users will compare scores across countries despite warnings.

**Mitigation**:
- Show percentile rank within country's own history
- De-emphasize absolute scores, emphasize trends
- Add explicit "not comparable" disclaimer

---

## Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Coverage | 50+ countries | Countries with 3+ components |
| Correlation | >0.6 | Score vs subsequent news events |
| User value | >70% | "Useful" rating in feedback |
| False positives | <25% | High scores without subsequent events |

---

## Historical Validation & Calibration

Validate CII against known instability events to ensure accuracy.

### Backtesting Framework

```typescript
interface ValidationCase {
  name: string;
  countryCode: string;
  dateRange: { start: Date; end: Date };
  expectedPeakScore: number;
  expectedComponents: string[];  // Which components should be elevated
  actualOutcome: string;         // What happened
}

const VALIDATION_CASES: ValidationCase[] = [
  {
    name: 'Iran Mahsa Amini Protests',
    countryCode: 'IR',
    dateRange: { start: new Date('2022-09-16'), end: new Date('2022-12-31') },
    expectedPeakScore: 85,
    expectedComponents: ['unrest', 'information', 'security'],
    actualOutcome: 'Nationwide protests, 500+ deaths, major government response',
  },
  {
    name: 'Sudan 2023 Conflict',
    countryCode: 'SD',
    dateRange: { start: new Date('2023-04-15'), end: new Date('2023-06-30') },
    expectedPeakScore: 95,
    expectedComponents: ['security', 'unrest', 'infrastructure'],
    actualOutcome: 'Civil war erupted between SAF and RSF',
  },
  {
    name: 'France Yellow Vests',
    countryCode: 'FR',
    dateRange: { start: new Date('2018-11-17'), end: new Date('2019-03-31') },
    expectedPeakScore: 70,
    expectedComponents: ['unrest', 'information', 'economic'],
    actualOutcome: 'Sustained protests, minor concessions, no regime change',
  },
  {
    name: 'Kazakhstan Jan 2022',
    countryCode: 'KZ',
    dateRange: { start: new Date('2022-01-02'), end: new Date('2022-01-15') },
    expectedPeakScore: 90,
    expectedComponents: ['unrest', 'security', 'information'],
    actualOutcome: 'Major protests, state of emergency, Russian intervention',
  },
];

async function validateCII(): Promise<ValidationReport> {
  const results = [];

  for (const testCase of VALIDATION_CASES) {
    const historicalScores = await getHistoricalScores(
      testCase.countryCode,
      testCase.dateRange.start,
      testCase.dateRange.end
    );

    const peakScore = Math.max(...historicalScores.map(s => s.score));
    const peakComponents = historicalScores
      .find(s => s.score === peakScore)
      ?.topComponents || [];

    results.push({
      case: testCase.name,
      expectedPeak: testCase.expectedPeakScore,
      actualPeak: peakScore,
      scoreDiff: Math.abs(peakScore - testCase.expectedPeakScore),
      expectedComponents: testCase.expectedComponents,
      actualComponents: peakComponents,
      componentMatch: calculateComponentOverlap(
        testCase.expectedComponents,
        peakComponents
      ),
      passed: peakScore >= testCase.expectedPeakScore * 0.8,  // Within 20%
    });
  }

  return {
    results,
    passRate: results.filter(r => r.passed).length / results.length,
    avgScoreDiff: results.reduce((a, r) => a + r.scoreDiff, 0) / results.length,
    recommendations: generateCalibrationRecommendations(results),
  };
}
```

### Calibration Adjustments

Based on validation results, adjust component weights or formulas:

```typescript
interface CalibrationAdjustment {
  component: string;
  issue: string;
  adjustment: string;
  priority: 'critical' | 'high' | 'medium';
}

// Example: If unrest component consistently under-scores
const ADJUSTMENTS: CalibrationAdjustment[] = [
  {
    component: 'unrest',
    issue: 'Under-scoring large protests with few fatalities',
    adjustment: 'Increase weight of geoSpread factor from 2 to 3',
    priority: 'high',
  },
  {
    component: 'security',
    issue: 'Over-scoring routine military exercises',
    adjustment: 'Add baseline comparison for military flights',
    priority: 'medium',
  },
];
```

---

## Additional Indicators (Future)

Expand CII with additional signals for improved accuracy.

### Political Stability Signals

```typescript
interface PoliticalMetrics {
  governmentChange: boolean;        // Recent change of leadership
  stateOfEmergency: boolean;        // Emergency declared
  parliamentDissolved: boolean;     // Legislature suspended
  coupRumorScore: number;           // News mentions of "coup", "overthrow"
  leaderHealthRumors: number;       // Succession concerns
}

// Detect from news keywords
const POLITICAL_KEYWORDS = {
  coup: ['coup', 'overthrow', 'military takeover', 'putsch'],
  emergency: ['state of emergency', 'martial law', 'curfew'],
  transition: ['resign', 'step down', 'succession', 'interim government'],
};
```

### Social Media Sentiment (Tier 1 Countries)

```typescript
interface SocialMediaMetrics {
  trendingHashtags: { tag: string; volume: number; sentiment: number }[];
  protestMentions24h: number;
  viralIncidents: number;          // Rapidly spreading videos/posts
  governmentResponseVolume: number; // Official accounts activity spike
}

// Lower weight due to noise and manipulation risk
const SOCIAL_MEDIA_WEIGHT = 0.05;  // 5% of total, within Information component
```

### Financial Stress Indicators (Tier 1 Countries)

```typescript
interface FinancialStressMetrics {
  cdsSpread: number;               // Credit default swap spread (basis points)
  cdsChange7d: number;             // Change in CDS spread
  bondYieldSpread: number;         // Spread over German bunds or US treasuries
  capitalOutflows: boolean;        // Signs of capital flight
}

// CDS above 500bp or spread widening >100bp in week = elevated stress
function scoreFinancialStress(metrics: FinancialStressMetrics): number {
  let score = 0;
  if (metrics.cdsSpread > 500) score += 30;
  else if (metrics.cdsSpread > 300) score += 15;

  if (metrics.cdsChange7d > 100) score += 25;
  else if (metrics.cdsChange7d > 50) score += 10;

  if (metrics.capitalOutflows) score += 20;

  return Math.min(100, score);
}
```

### Refugee/Displacement Flows

```typescript
interface DisplacementMetrics {
  refugeesOut7d: number;           // People leaving country (UNHCR)
  idpsIn7d: number;                // Internal displacement
  borderCrossings: number;         // Unusual border activity
  refugeeSpike: boolean;           // >50% increase vs baseline
}

// Displacement is a lagging indicator but confirms instability
const DISPLACEMENT_WEIGHT = 0.05;
```

---

## Continuous Learning & Feedback

Allow the system to improve from analyst feedback.

### Feedback Collection

```typescript
interface CIIFeedback {
  countryCode: string;
  date: Date;
  userId: string;
  feedbackType: 'accurate' | 'over_scored' | 'under_scored' | 'missed_event';
  notes?: string;
  actualEventDescription?: string;
  suggestedScore?: number;
}

// Collect feedback on specific scores
async function submitFeedback(feedback: CIIFeedback): Promise<void> {
  await db.feedback.add(feedback);

  // If pattern emerges, flag for review
  const recentFeedback = await db.feedback
    .where('countryCode').equals(feedback.countryCode)
    .filter(f => differenceInDays(new Date(), f.date) <= 30)
    .toArray();

  if (recentFeedback.filter(f => f.feedbackType === 'over_scored').length >= 3) {
    flagForCalibrationReview(feedback.countryCode, 'consistent_over_scoring');
  }
}
```

### Learning Loop

```typescript
interface LearningInsight {
  pattern: string;
  frequency: number;
  suggestedChange: string;
  impact: 'high' | 'medium' | 'low';
}

function analyzeFeedbackPatterns(): LearningInsight[] {
  const insights: LearningInsight[] = [];

  // Example: Sanctions component over-scoring stable sanctioned countries
  const sanctionedCountryFeedback = getFeedbackForSanctionedCountries();
  if (sanctionedCountryFeedback.overScoreRate > 0.4) {
    insights.push({
      pattern: 'Sanctions component over-scores stable sanctioned countries',
      frequency: sanctionedCountryFeedback.count,
      suggestedChange: 'Decay sanctions impact after 90 days of stability',
      impact: 'medium',
    });
  }

  // Example: Information component under-scoring when news is suppressed
  const authoritarianFeedback = getFeedbackForAuthoritarianCountries();
  if (authoritarianFeedback.missedEventRate > 0.3) {
    insights.push({
      pattern: 'Missed events in countries with media suppression',
      frequency: authoritarianFeedback.count,
      suggestedChange: 'Add "media freedom" modifier to information component',
      impact: 'high',
    });
  }

  return insights;
}
```

### Missed Event Analysis

When an analyst reports "significant event happened but score was low":

```typescript
interface MissedEventAnalysis {
  country: string;
  eventDate: Date;
  eventDescription: string;
  scoreAtTime: number;
  componentScores: ComponentScores;
  possibleCauses: string[];
  recommendations: string[];
}

async function analyzeMissedEvent(report: MissedEventReport): Promise<MissedEventAnalysis> {
  const scoreAtTime = await getHistoricalScore(report.countryCode, report.eventDate);

  const analysis: MissedEventAnalysis = {
    country: report.countryCode,
    eventDate: report.eventDate,
    eventDescription: report.description,
    scoreAtTime: scoreAtTime.score,
    componentScores: scoreAtTime.components,
    possibleCauses: [],
    recommendations: [],
  };

  // Analyze why we missed it
  if (scoreAtTime.components.unrest < 30 && report.eventType === 'protest') {
    analysis.possibleCauses.push('ACLED data latency - protest not yet in dataset');
    analysis.recommendations.push('Add GDELT real-time protest detection as supplement');
  }

  if (scoreAtTime.components.information < 30) {
    analysis.possibleCauses.push('News velocity baseline too high - spike normalized away');
    analysis.recommendations.push('Review baseline calculation for this country');
  }

  return analysis;
}
```

---

## Cross-Country Comparison Safeguards

Prevent misuse while allowing meaningful comparison.

### Within-History Percentile

Show where a country stands relative to its own history:

```typescript
function getHistoricalPercentile(countryCode: string, currentScore: number): number {
  const historicalScores = getHistoricalScores(countryCode, 365);  // 1 year
  const sortedScores = historicalScores.map(s => s.score).sort((a, b) => a - b);
  const position = sortedScores.filter(s => s < currentScore).length;
  return Math.round((position / sortedScores.length) * 100);
}

// Display: "Iran is more unstable than 87% of its past 12 months"
```

### Structural Context Overlay

Optionally show external structural indices for context:

```typescript
interface StructuralContext {
  countryCode: string;
  fragileStatesIndex?: number;      // FSI rank (1-179)
  freedomHouseScore?: number;       // 0-100
  vdemLiberalDemocracy?: number;    // 0-1
  worldBankGovernance?: number;     // -2.5 to 2.5
}

// Display alongside CII to prevent false equivalence
// "CII: 60 (Elevated) | FSI Rank: 145/179 (Structurally stable)"
// vs
// "CII: 60 (Elevated) | FSI Rank: 12/179 (Structurally fragile)"
```

### UI Safeguards

```
┌─────────────────────────────────────────────────┐
│ COUNTRY COMPARISON (Use with caution)           │
├─────────────────────────────────────────────────┤
│ ⚠️ CII scores are relative to each country's    │
│    own baseline. Direct comparison is invalid.  │
│                                                 │
│ Instead showing: Deviation from baseline        │
│                                                 │
│ Country          CII    σ from norm   Trend    │
│ Iran             78     +2.2σ         ↑ Rising │
│ France           58     +1.5σ         ↑ Rising │
│ Germany          42     -0.3σ         → Stable │
│                                                 │
│ Interpretation: Iran and France are both       │
│ significantly above their own normal levels.   │
│ This does NOT mean Iran is "more unstable"     │
│ than France in absolute terms.                 │
└─────────────────────────────────────────────────┘
```

---

## Future Enhancements (Updated)

1. ~~**Sector-specific indices**~~ → Implemented via component breakdown
2. **Predictive model**: ML to identify leading indicators
3. ~~**Comparative analysis**~~ → Implemented via historical percentile
4. **API export**: Allow embedding CII in other tools
5. **Custom weights**: Let users adjust component weights
6. **Regional aggregates**: Middle East CII, EU CII, etc.
7. **Correlation with convergence**: Auto-link CII spikes to geographic convergence alerts
8. **Natural language summaries**: "Iran's instability is driven primarily by protests..."

---

*Document version: 2.0 | Author: Claude | Date: 2025-01-13 | Updated based on strategic review*
