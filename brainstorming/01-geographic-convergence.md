# Multi-Signal Geographic Convergence

## The Intelligence Problem

The most significant geopolitical events are rarely announced. They emerge from the convergence of multiple independent signals in the same geographic area. A single protest is noise. A protest + unusual military flight activity + shipping diversions + news velocity spike in the same region within 24 hours is a **pattern worth investigating**.

Current intelligence tools show each data layer in isolation. An analyst must mentally correlate:
- "There were protests in Taipei yesterday"
- "I noticed more military flights over the Taiwan Strait"
- "AIS shows unusual vessel clustering"
- "News mentions are spiking"

This cognitive load is unsustainable. The dashboard should do this correlation automatically.

---

## Core Concept

**Geographic Convergence** = Multiple independent data types occurring in the same geographic region within a defined time window.

### Why It Matters

| Single Signal | Convergence Signal |
|--------------|-------------------|
| Protest in city X | Protest + military flights + shipping disruption in region X |
| Military flight detected | Same flight pattern + naval movement + news spike |
| News velocity spike | News spike + prediction market shift + infrastructure incident |

The probability of a significant event scales non-linearly with the number of converging signals:
- 1 signal: Background noise (ignore)
- 2 signals: Possible coincidence (note)
- 3 signals: **Pattern detected** (alert)
- 4+ signals: **High-confidence I&W** (urgent)

---

## Data Sources Available

We already collect these geographically-tagged data types:

| Data Type | Source | Lat/Lon | Update Frequency |
|-----------|--------|---------|------------------|
| Protests | ACLED, GDELT | Direct | 6h (ACLED), 15m (GDELT) |
| Military flights | OpenSky | Direct | Real-time |
| Military vessels | AIS | Direct | Real-time |
| Commercial vessels | AIS | Direct | Real-time |
| Earthquakes | USGS | Direct | 5m |
| Natural events | NASA EONET | Direct | 1h |
| Weather alerts | NWS | Polygon centroid | 5m |
| Internet outages | Cloudflare | Country centroid | 10m |
| News (hotspot-linked) | RSS + GDELT | Inferred from keywords | 5m |
| Chokepoint congestion | AIS density | Predefined points | Real-time |
| AIS gaps (dark ships) | AIS | Last known position | Real-time |

### Data Not Yet Geographically Tagged

| Data Type | Current State | Enhancement Needed |
|-----------|--------------|-------------------|
| Prediction markets | Text only | NLP to extract locations |
| Market movements | Symbol only | Map commodities to regions |
| Pipeline incidents | Inferred | Use pipeline coordinates |
| Cable incidents | Inferred | Use cable landing points |

---

## Geographic Grid Design

### Option A: Fixed Grid (Recommended for v1)

Divide the world into cells of fixed size. Simpler to implement, predictable behavior.

```
Grid cell size options:
- 0.5° × 0.5° = ~55km at equator (too granular, 259,200 cells)
- 1° × 1° = ~111km at equator (good balance, 64,800 cells)
- 2° × 2° = ~222km at equator (coarse, 16,200 cells)

Recommendation: 1° × 1° with clustering for dense areas
```

**Cell ID format**: `lat_lon` e.g., `38_-77` for Washington DC area

### Option B: Hierarchical Grid (H3 or S2)

Use Uber's H3 or Google's S2 for variable-resolution hexagonal cells. Better for clustering but adds dependency.

### Option C: Hotspot-Centric Radii

Use existing hotspots as centers with 200km radii. Misses events in non-hotspot areas.

**Decision**: Start with Option A (1° grid), migrate to H3 if needed.

---

## Time Window Design

### Rolling Window Approach

Maintain a sliding window of recent events per cell:

```typescript
interface CellActivity {
  cellId: string;           // "38_-77"
  lat: number;              // Cell center
  lon: number;
  events: {
    type: SignalType;
    timestamp: Date;
    id: string;             // Original event ID
    severity?: number;      // Optional weighting
  }[];
  firstActivity: Date;      // Oldest event in window
  lastActivity: Date;       // Most recent event
}
```

### Window Duration Options

| Window | Use Case | Trade-offs |
|--------|----------|------------|
| 6 hours | Tactical I&W | May miss slow-developing situations |
| 24 hours | **Recommended** | Balances freshness with pattern detection |
| 48 hours | Strategic awareness | Risk of coincidental clustering |
| 7 days | Trend analysis | Too much noise for I&W |

**Decision**: 24-hour primary window with 6-hour "hot" sub-window for urgency scoring.

---

## Signal Types & Weights

Not all signals are equal. Military activity is more significant than a minor weather alert.

### Signal Categories

```typescript
type ConvergenceSignalType =
  // High-weight (military/security)
  | 'military_flight'      // Weight: 3.0
  | 'military_vessel'      // Weight: 3.0
  | 'ais_gap'              // Weight: 2.5 (potential clandestine activity)
  | 'protest_violent'      // Weight: 2.5 (riots, fatalities)
  | 'pipeline_incident'    // Weight: 2.5 (explosion, sabotage)
  | 'cable_incident'       // Weight: 2.5 (cut, fault)

  // Medium-weight (disruption)
  | 'protest_peaceful'     // Weight: 1.5
  | 'shipping_congestion'  // Weight: 1.5
  | 'internet_outage'      // Weight: 2.0
  | 'natural_severe'       // Weight: 1.5 (major earthquake, hurricane)
  | 'market_shock'         // Weight: 1.5 (commodity price spike linked to region)

  // Low-weight (context)
  | 'news_velocity'        // Weight: 1.0
  | 'weather_alert'        // Weight: 0.5
  | 'natural_minor'        // Weight: 0.5
  | 'prediction_shift'     // Weight: 1.0 (polymarket change linked to location)
```

### Source Reliability Factors

Different data sources have different reliability. Apply a multiplier based on source quality:

```typescript
const SOURCE_RELIABILITY: Record<string, number> = {
  // High reliability (structured, verified)
  'ACLED': 1.0,           // Verified conflict data
  'USGS': 1.0,            // Official earthquake data
  'OpenSky': 0.95,        // Real-time but some gaps
  'AIS': 0.9,             // Can be spoofed/disabled

  // Medium reliability
  'GDELT': 0.7,           // Automated, may misclassify
  'RSS_news': 0.75,       // Varies by source quality
  'Cloudflare': 0.85,     // Good for outages

  // Lower reliability (inferred/derived)
  'news_keywords': 0.5,   // Location inferred from text
  'social_media': 0.4,    // High noise, low verification
};
```

### Weighting Formula

```
Convergence Score = Σ(signal_weight × recency_factor × severity_factor × source_reliability)

where:
  recency_factor = 1.0 if < 6h, 0.7 if 6-12h, 0.4 if 12-24h
  severity_factor = normalized 0-1 based on signal type
  source_reliability = 0.4-1.0 based on data source
```

---

## Convergence Detection Algorithm

### Phase 1: Event Ingestion

On each data refresh cycle:

```typescript
function ingestEvent(event: GeoEvent): void {
  const cellId = getCellId(event.lat, event.lon);
  const cell = cells.get(cellId) || createCell(cellId);

  cell.events.push({
    type: event.type,
    timestamp: new Date(),
    id: event.id,
    severity: event.severity,
  });

  // Prune events older than window
  cell.events = cell.events.filter(e =>
    Date.now() - e.timestamp.getTime() < WINDOW_MS
  );

  cells.set(cellId, cell);
}
```

### Phase 2: Convergence Scoring

```typescript
function scoreCell(cell: CellActivity): ConvergenceAlert | null {
  // Count unique signal types
  const typeSet = new Set(cell.events.map(e => e.type));
  const typeCount = typeSet.size;

  // Minimum 3 types for convergence
  if (typeCount < 3) return null;

  // Calculate weighted score
  let score = 0;
  for (const event of cell.events) {
    const weight = SIGNAL_WEIGHTS[event.type];
    const recency = getRecencyFactor(event.timestamp);
    const severity = event.severity || 1.0;
    score += weight * recency * severity;
  }

  // Normalize to 0-100
  const normalizedScore = Math.min(100, score * 10);

  // Confidence based on type diversity and score
  const confidence = Math.min(0.95, 0.5 + (typeCount * 0.1) + (normalizedScore / 200));

  return {
    cellId: cell.cellId,
    lat: cell.lat,
    lon: cell.lon,
    score: normalizedScore,
    confidence,
    signalTypes: Array.from(typeSet),
    eventCount: cell.events.length,
    timeSpan: cell.lastActivity.getTime() - cell.firstActivity.getTime(),
  };
}
```

### Phase 3: Alert Generation

```typescript
function generateAlerts(): ConvergenceAlert[] {
  const alerts: ConvergenceAlert[] = [];

  for (const cell of cells.values()) {
    const alert = scoreCell(cell);
    if (alert && alert.confidence >= 0.6) {
      alerts.push(alert);
    }
  }

  // Sort by score descending
  alerts.sort((a, b) => b.score - a.score);

  // Deduplicate adjacent cells (merge into clusters)
  return mergeAdjacentAlerts(alerts);
}
```

---

## Baseline-Aware Scoring (Critical)

Raw convergence scores are meaningless without context. Washington DC will always have more signals than rural Montana. **Baseline normalization is essential for accuracy.**

### Dynamic Baselines

Maintain rolling baselines for each cell to detect *deviations* not just *counts*:

```typescript
interface CellBaseline {
  cellId: string;
  avgScore7d: number;         // 7-day rolling average score
  avgEventCount7d: number;    // Average events per day
  stdDev: number;             // Standard deviation
  lastCalculated: Date;

  // Per-signal-type baselines for finer detection
  signalBaselines: Map<string, {
    avgCount7d: number;
    stdDev: number;
  }>;
}

function calculateBaselineAdjustedScore(
  cell: CellActivity,
  baseline: CellBaseline
): { score: number; zScore: number; isAnomaly: boolean } {
  const rawScore = calculateRawScore(cell);

  // Z-score: how many standard deviations above baseline
  const zScore = baseline.stdDev > 0
    ? (rawScore - baseline.avgScore7d) / baseline.stdDev
    : rawScore / 10;  // Fallback for new cells

  // Only alert if significantly above baseline (Z > 2.0)
  const isAnomaly = zScore > 2.0;

  // Adjusted score incorporates baseline deviation
  const adjustedScore = Math.min(100,
    rawScore * (1 + Math.max(0, zScore - 1) * 0.3)
  );

  return { score: adjustedScore, zScore, isAnomaly };
}
```

### High-Activity Cell Thresholds

For chronically busy cells (capitals, conflict zones), require stronger signals:

```typescript
const HIGH_ACTIVITY_CELLS = new Set([
  '38_-77',   // Washington DC
  '39_116',   // Beijing
  '51_0',     // London
  '48_2',     // Paris
  '35_139',   // Tokyo
  // ... add known-active areas
]);

function getMinimumTypeCount(cellId: string, baseline: CellBaseline): number {
  if (HIGH_ACTIVITY_CELLS.has(cellId)) return 4;  // Require 4+ types
  if (baseline.avgEventCount7d > 10) return 4;    // High baseline = higher bar
  return 3;  // Default minimum
}
```

### Adaptive Thresholds

Require at least one *unusual* signal (beyond baseline) to trigger alert:

```typescript
function hasUnusualSignal(cell: CellActivity, baseline: CellBaseline): boolean {
  for (const [signalType, events] of groupByType(cell.events)) {
    const signalBaseline = baseline.signalBaselines.get(signalType);
    if (!signalBaseline) return true;  // New signal type = unusual

    const count = events.length;
    const zScore = (count - signalBaseline.avgCount7d) / signalBaseline.stdDev;

    if (zScore > 1.5) return true;  // This signal type is elevated
  }
  return false;
}
```

---

## Maritime Zone Handling

Open ocean events (naval maneuvers, shipping route deviations, AIS gaps) are strategically important even without land-based signals.

### Maritime Region Definitions

```typescript
interface MaritimeZone {
  id: string;
  name: string;
  polygon: [number, number][];  // Bounding coordinates
  criticalityLevel: 'high' | 'medium' | 'low';
  relevantSignals: ConvergenceSignalType[];
}

const MARITIME_ZONES: MaritimeZone[] = [
  {
    id: 'taiwan_strait',
    name: 'Taiwan Strait',
    polygon: [[24, 117], [26, 117], [26, 122], [24, 122]],
    criticalityLevel: 'high',
    relevantSignals: ['military_vessel', 'military_flight', 'ais_gap', 'shipping_congestion'],
  },
  {
    id: 'hormuz',
    name: 'Strait of Hormuz',
    polygon: [[25, 55], [27, 55], [27, 58], [25, 58]],
    criticalityLevel: 'high',
    relevantSignals: ['military_vessel', 'ais_gap', 'shipping_congestion'],
  },
  {
    id: 'south_china_sea',
    name: 'South China Sea',
    polygon: [[5, 105], [22, 105], [22, 120], [5, 120]],
    criticalityLevel: 'high',
    relevantSignals: ['military_vessel', 'military_flight', 'ais_gap'],
  },
  // ... more maritime zones
];
```

### Maritime-Specific Detection

For maritime zones, use different rules:

```typescript
function scoreMaritimeCell(
  cell: CellActivity,
  zone: MaritimeZone
): ConvergenceAlert | null {
  // Filter to relevant maritime signals only
  const maritimeEvents = cell.events.filter(e =>
    zone.relevantSignals.includes(e.type)
  );

  if (maritimeEvents.length === 0) return null;

  const typeCount = new Set(maritimeEvents.map(e => e.type)).size;

  // Lower threshold for critical maritime zones: 2 signal types
  const minTypes = zone.criticalityLevel === 'high' ? 2 : 3;

  if (typeCount < minTypes) return null;

  // Higher base weight for maritime signals in critical zones
  const zoneMultiplier = zone.criticalityLevel === 'high' ? 1.5 : 1.0;

  // Calculate score with zone multiplier
  const score = calculateRawScore({ ...cell, events: maritimeEvents }) * zoneMultiplier;

  return {
    // ... standard alert fields
    zoneId: zone.id,
    zoneName: zone.name,
    isMaritimeOnly: true,
  };
}
```

---

## Adjacent Cell Clustering

A significant event often spans multiple grid cells. We need to merge adjacent high-scoring cells into a single alert.

### Clustering Algorithm

```typescript
function mergeAdjacentAlerts(alerts: ConvergenceAlert[]): ConvergenceCluster[] {
  const clusters: ConvergenceCluster[] = [];
  const assigned = new Set<string>();

  for (const alert of alerts) {
    if (assigned.has(alert.cellId)) continue;

    // BFS to find all adjacent high-scoring cells
    const cluster: ConvergenceAlert[] = [alert];
    const queue = [alert.cellId];
    assigned.add(alert.cellId);

    while (queue.length > 0) {
      const current = queue.shift()!;
      const neighbors = getAdjacentCells(current);

      for (const neighbor of neighbors) {
        if (assigned.has(neighbor)) continue;
        const neighborAlert = alerts.find(a => a.cellId === neighbor);
        if (neighborAlert && neighborAlert.score >= alert.score * 0.5) {
          cluster.push(neighborAlert);
          queue.push(neighbor);
          assigned.add(neighbor);
        }
      }
    }

    clusters.push(createCluster(cluster));
  }

  return clusters;
}
```

---

## UI/UX Design

### Map Visualization

**Convergence Zones**: Render as pulsing circles on the map, sized by score, colored by confidence.

```css
.convergence-zone {
  position: absolute;
  border-radius: 50%;
  pointer-events: auto;
  cursor: pointer;
  animation: convergence-pulse 2s ease-in-out infinite;
}

.convergence-zone.high {
  background: rgba(255, 68, 68, 0.3);
  border: 2px solid #ff4444;
}

.convergence-zone.medium {
  background: rgba(255, 170, 0, 0.3);
  border: 2px solid #ffaa00;
}

@keyframes convergence-pulse {
  0%, 100% { transform: scale(1); opacity: 0.8; }
  50% { transform: scale(1.1); opacity: 1; }
}
```

### Alert Panel

New panel or modal showing active convergence alerts:

```
┌─────────────────────────────────────────────────┐
│ ⚠️ GEOGRAPHIC CONVERGENCE ALERTS                │
├─────────────────────────────────────────────────┤
│ 🔴 TAIWAN STRAIT                    Score: 87  │
│    Military flights (12) + Naval vessels (5)   │
│    + News spike (+340%) + AIS gaps (3)         │
│    Confidence: 91% | Span: 18h                 │
│    [View on Map] [Details]                     │
├─────────────────────────────────────────────────┤
│ 🟠 EASTERN MEDITERRANEAN            Score: 62  │
│    Shipping congestion + Military vessel       │
│    + Protest activity + News elevated          │
│    Confidence: 74% | Span: 22h                 │
│    [View on Map] [Details]                     │
└─────────────────────────────────────────────────┘
```

### Detail View (on click)

```
┌─────────────────────────────────────────────────┐
│ TAIWAN STRAIT CONVERGENCE                       │
│ Score: 87/100 | Confidence: 91%                │
├─────────────────────────────────────────────────┤
│ CONTRIBUTING SIGNALS                            │
│                                                 │
│ ✈️ Military Flights (12)           +3h to -18h │
│    PLAAF J-16 (3), US P-8 (2), ...            │
│                                                 │
│ 🚢 Naval Vessels (5)               +1h to -12h │
│    PLAN Type 052D, USS Benfold, ...           │
│                                                 │
│ 📡 AIS Gaps (3)                    +2h to -8h  │
│    Vessels went dark near Kinmen              │
│                                                 │
│ 📰 News Velocity                   +340%       │
│    "Taiwan", "China", "military" trending     │
│                                                 │
├─────────────────────────────────────────────────┤
│ NEARBY INFRASTRUCTURE AT RISK                   │
│ • Port of Kaohsiung (45km)                     │
│ • APCN-2 Cable landing (78km)                  │
│ • Kinmen airfield (23km)                       │
├─────────────────────────────────────────────────┤
│ HISTORICAL CONTEXT                              │
│ Similar convergence: Aug 2022 (Pelosi visit)  │
│ Baseline for region: Score 23                  │
└─────────────────────────────────────────────────┘
```

---

## Edge Cases & Challenges

### 1. Coincidental Clustering

**Problem**: Major city has constant activity (protests, flights, ships) that isn't significant.

**Solution**:
- Maintain per-cell baselines (7-day rolling average)
- Alert on deviation from baseline, not absolute count
- Higher thresholds for known-active cells (DC, Beijing, etc.)

### 2. Data Latency Mismatch

**Problem**: ACLED updates every 6h, OpenSky updates real-time. Events may not align temporally.

**Solution**:
- Use event timestamp, not ingestion timestamp
- Wider time tolerance for slow-updating sources
- Weight recent data higher

### 3. Geographic Imprecision

**Problem**: News events are inferred from keywords, not coordinates. May be wrong.

**Solution**:
- Lower weight for inferred locations
- Require at least one direct-coordinate signal for high-confidence alert
- Show "location confidence" in UI

### 4. Cell Boundary Effects

**Problem**: Event on cell boundary may split across cells, reducing scores.

**Solution**:
- Check 8 adjacent cells when scoring
- Merge adjacent high-scoring cells (clustering)
- Use overlapping cells (more complex)

### 5. Alert Fatigue

**Problem**: Too many alerts desensitizes users.

**Solution**:
- Minimum confidence threshold (60%)
- Maximum 5 active alerts at once
- Deduplicate similar alerts within 6h
- User-configurable sensitivity

---

## Data Schema

### IndexedDB Storage

```typescript
interface ConvergenceState {
  cells: Map<string, CellActivity>;
  alerts: ConvergenceAlert[];
  baselines: Map<string, CellBaseline>;
  lastUpdate: Date;
}

interface CellBaseline {
  cellId: string;
  avgScore7d: number;
  avgEventCount7d: number;
  stdDev: number;
  lastCalculated: Date;
}

interface ConvergenceAlert {
  id: string;
  cellId: string;
  lat: number;
  lon: number;
  score: number;
  confidence: number;
  signalTypes: string[];
  eventCount: number;
  timeSpan: number;
  firstSeen: Date;
  lastUpdated: Date;
  regionName?: string;        // Reverse geocoded or hotspot name
  nearbyAssets?: string[];    // Infrastructure IDs
  dismissed?: boolean;        // User dismissed
}
```

---

## Implementation Phases

### Phase 1: Core Detection (MVP)

1. Implement 1° grid system
2. Ingest events from: protests, military flights, military vessels, earthquakes
3. Basic scoring with fixed weights
4. Simple alert list in Signal panel

### Phase 2: Enhanced Signals

1. Add: news velocity, AIS gaps, shipping congestion, natural events
2. Implement cell baselines for anomaly detection
3. Adjacent cell clustering
4. Map visualization (convergence zones)

### Phase 3: Intelligence Features

1. Historical pattern matching ("similar to Aug 2022")
2. Nearby infrastructure enrichment
3. Predictive scoring (trend-based)
4. Export/sharing of convergence reports

---

## Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| True positive rate | >80% | Manual review of alerts |
| Alert-to-event time | <2h | Time from first signal to alert |
| User engagement | >50% click-through | Alerts clicked vs shown |
| False positive rate | <20% | Dismissed alerts / total |

---

## Historical Validation & Calibration

Thresholds and weights must be validated against real events. **Test the system on known historical crises.**

### Backtesting Approach

```typescript
interface HistoricalEvent {
  name: string;
  date: Date;
  location: { lat: number; lon: number };
  expectedSignals: ConvergenceSignalType[];
  expectedMinScore: number;
}

const VALIDATION_EVENTS: HistoricalEvent[] = [
  {
    name: 'Taiwan Strait Crisis (Pelosi Visit)',
    date: new Date('2022-08-02'),
    location: { lat: 25.0, lon: 120.0 },
    expectedSignals: ['military_flight', 'military_vessel', 'news_velocity', 'ais_gap'],
    expectedMinScore: 80,
  },
  {
    name: 'Nord Stream Pipeline Sabotage',
    date: new Date('2022-09-26'),
    location: { lat: 55.5, lon: 15.5 },
    expectedSignals: ['pipeline_incident', 'news_velocity', 'military_vessel'],
    expectedMinScore: 75,
  },
  {
    name: 'Red Sea Houthi Attacks (Start)',
    date: new Date('2023-11-19'),
    location: { lat: 14.0, lon: 42.5 },
    expectedSignals: ['military_vessel', 'shipping_congestion', 'news_velocity'],
    expectedMinScore: 70,
  },
];

// Run validation: for each event, replay historical data and verify alert would trigger
async function validateThresholds(): Promise<ValidationReport> {
  const results = [];
  for (const event of VALIDATION_EVENTS) {
    const historicalData = await fetchHistoricalData(event.date, event.location);
    const alert = scoreCell(historicalData);

    results.push({
      event: event.name,
      expectedScore: event.expectedMinScore,
      actualScore: alert?.score || 0,
      passed: (alert?.score || 0) >= event.expectedMinScore,
      signalsDetected: alert?.signalTypes || [],
      missedSignals: event.expectedSignals.filter(s =>
        !alert?.signalTypes.includes(s)
      ),
    });
  }
  return { results, passRate: results.filter(r => r.passed).length / results.length };
}
```

### Statistical Clustering Alternative

For edge cases where 3 signals may not trigger but the combination is still significant:

```typescript
// Scan statistics approach: detect anomalous clusters even with 2 rare signals
function detectStatisticalAnomaly(cell: CellActivity, baseline: CellBaseline): boolean {
  // Two very rare signals together may be as meaningful as 3 common ones
  const rareSignals = cell.events.filter(e => {
    const signalBaseline = baseline.signalBaselines.get(e.type);
    return !signalBaseline || signalBaseline.avgCount7d < 0.5;  // < 1 per 2 days
  });

  if (rareSignals.length >= 2) {
    const rareTypes = new Set(rareSignals.map(e => e.type));
    if (rareTypes.size >= 2) return true;  // Two different rare signal types
  }
  return false;
}
```

---

## User Feedback Loop

Allow analysts to improve the system over time by marking alerts as useful or false.

### Feedback Schema

```typescript
interface AlertFeedback {
  alertId: string;
  userId: string;
  timestamp: Date;
  rating: 'useful' | 'false_alarm' | 'missed_event';
  notes?: string;
  actualEventType?: string;  // What really happened
}

interface FeedbackAggregates {
  cellId: string;
  totalAlerts: number;
  usefulCount: number;
  falseAlarmCount: number;
  falseAlarmRate: number;
  lastFeedback: Date;
}
```

### Adaptive Adjustment

Use feedback to tune parameters:

```typescript
function adjustThresholdsFromFeedback(aggregates: FeedbackAggregates[]): void {
  for (const agg of aggregates) {
    // If >30% false alarm rate for a cell, raise its threshold
    if (agg.falseAlarmRate > 0.3 && agg.totalAlerts >= 10) {
      const baseline = baselines.get(agg.cellId);
      if (baseline) {
        baseline.adjustedThreshold = Math.min(4, baseline.adjustedThreshold + 1);
        // Now requires 4+ signal types instead of 3
      }
    }

    // If many missed events reported, lower threshold
    const missedReports = getMissedEventReports(agg.cellId);
    if (missedReports.length > 3) {
      // Consider lowering threshold or adding new signal types
      flagForReview(agg.cellId, 'high_miss_rate');
    }
  }
}
```

### Learning from Missed Events

When analysts report "something happened here but no alert":

```typescript
interface MissedEventReport {
  location: { lat: number; lon: number };
  timestamp: Date;
  description: string;
  signalsPresent: string[];  // What data was available
  signalsMissing: string[];  // What should have been detected
}

// Analyze missed events to identify gaps
function analyzeMissedEvents(reports: MissedEventReport[]): GapAnalysis {
  // Group by what signals were missing
  const missingSignalCounts = new Map<string, number>();
  for (const report of reports) {
    for (const signal of report.signalsMissing) {
      missingSignalCounts.set(signal, (missingSignalCounts.get(signal) || 0) + 1);
    }
  }

  return {
    topMissingSignals: [...missingSignalCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5),
    recommendations: generateRecommendations(missingSignalCounts),
  };
}
```

---

## Enhanced Visualization

Show context that helps analysts understand *why* an alert fired.

### Baseline Deviation Display

```
┌─────────────────────────────────────────────────┐
│ TAIWAN STRAIT CONVERGENCE                       │
│ Score: 87/100 | Confidence: 91%                │
│                                                 │
│ 📊 BASELINE COMPARISON                          │
│ ┌─────────────────────────────────────────────┐ │
│ │ Current activity: 340% of weekly average    │ │
│ │ Z-score: 3.2 (highly unusual)               │ │
│ │ Normal range: 15-35 | Current: 87           │ │
│ │ ████████████████████████░░░░░░ ← You are here │
│ └─────────────────────────────────────────────┘ │
│                                                 │
│ CONTRIBUTING SIGNALS (vs baseline)              │
│ ✈️ Military Flights: 12 (avg: 3)    +300% ↑↑   │
│ 🚢 Naval Vessels: 5 (avg: 2)        +150% ↑    │
│ 📡 AIS Gaps: 3 (avg: 0.5)           +500% ↑↑↑  │
│ 📰 News Velocity: +340% vs baseline             │
└─────────────────────────────────────────────────┘
```

### Multi-Window Trend View

Show both 24h alert window and 7-day trend:

```
┌─────────────────────────────────────────────────┐
│ 7-DAY ACTIVITY TREND                            │
│                                                 │
│     ▁▂▂▁▂▂▃▅███ ← Current spike                │
│     M T W T F S S                               │
│                                                 │
│ Pattern: Activity building over 3 days          │
│ Similar to: Aug 2022 (Pelosi visit)            │
│                                                 │
│ [View 30-day history]                           │
└─────────────────────────────────────────────────┘
```

---

## Geotagging Enhancement Roadmap

Close gaps in data sources that lack geographic coordinates.

### Pipeline/Cable Incidents

```typescript
// Map news keywords to infrastructure coordinates
async function geotagInfrastructureIncident(
  newsItem: NewsItem
): Promise<GeotaggedEvent | null> {
  // Search for pipeline/cable names in text
  const pipelineMatch = PIPELINE_NAMES.find(p =>
    newsItem.text.toLowerCase().includes(p.name.toLowerCase())
  );

  if (pipelineMatch) {
    return {
      type: 'pipeline_incident',
      lat: pipelineMatch.coordinates[0][0],  // Use start point
      lon: pipelineMatch.coordinates[0][1],
      source: 'inferred',
      confidence: 0.7,
      linkedAssetId: pipelineMatch.id,
    };
  }

  // Similar for cables
  const cableMatch = CABLE_NAMES.find(c =>
    newsItem.text.toLowerCase().includes(c.name.toLowerCase())
  );

  if (cableMatch) {
    // Use nearest landing point mentioned or midpoint
    const landingPoint = findMentionedLandingPoint(newsItem.text, cableMatch);
    return {
      type: 'cable_incident',
      lat: landingPoint.lat,
      lon: landingPoint.lon,
      source: 'inferred',
      confidence: 0.6,
      linkedAssetId: cableMatch.id,
    };
  }

  return null;
}
```

### Market Shock Geotagging

```typescript
// Map commodity price movements to producer regions
const COMMODITY_REGIONS: Record<string, { lat: number; lon: number; name: string }[]> = {
  'crude_oil': [
    { lat: 26.0, lon: 50.0, name: 'Persian Gulf' },
    { lat: 5.0, lon: -4.0, name: 'Gulf of Guinea' },
    { lat: 60.0, lon: 70.0, name: 'Western Siberia' },
  ],
  'natural_gas': [
    { lat: 60.0, lon: 75.0, name: 'Russia' },
    { lat: 25.0, lon: 51.0, name: 'Qatar' },
  ],
  'wheat': [
    { lat: 48.0, lon: 35.0, name: 'Ukraine' },
    { lat: 55.0, lon: 50.0, name: 'Russia' },
  ],
  // ... more commodities
};

function geotagMarketShock(commodity: string, priceChange: number): GeotaggedEvent[] {
  if (Math.abs(priceChange) < 5) return [];  // Only significant moves

  const regions = COMMODITY_REGIONS[commodity] || [];
  return regions.map(region => ({
    type: 'market_shock',
    lat: region.lat,
    lon: region.lon,
    source: 'derived',
    confidence: 0.5,  // Lower confidence for derived locations
    metadata: {
      commodity,
      priceChange,
      regionName: region.name,
    },
  }));
}
```

### Prediction Market Geotagging

```typescript
// Extract locations from prediction market questions
const LOCATION_PATTERNS = [
  { pattern: /(?:north\s*korea|dprk|pyongyang)/i, lat: 39.0, lon: 125.7 },
  { pattern: /(?:taiwan|taipei)/i, lat: 25.0, lon: 121.5 },
  { pattern: /(?:ukraine|kyiv|kiev)/i, lat: 50.4, lon: 30.5 },
  { pattern: /(?:iran|tehran)/i, lat: 35.7, lon: 51.4 },
  { pattern: /(?:china|beijing)/i, lat: 39.9, lon: 116.4 },
  // ... more patterns
];

function geotagPredictionMarket(question: string, probabilityChange: number): GeotaggedEvent | null {
  if (Math.abs(probabilityChange) < 5) return null;

  for (const { pattern, lat, lon } of LOCATION_PATTERNS) {
    if (pattern.test(question)) {
      return {
        type: 'prediction_shift',
        lat,
        lon,
        source: 'inferred',
        confidence: 0.6,
        metadata: {
          question,
          probabilityChange,
        },
      };
    }
  }
  return null;
}
```

---

## Open Questions (Updated)

1. ~~**Should we weight by source reliability?**~~ ✅ Implemented above
2. ~~**How to handle maritime-only convergence?**~~ ✅ Addressed with Maritime Zone Handling
3. **Should convergence alerts appear in the main Signal panel or separate?**
4. ~~**How to handle multi-day events?**~~ ✅ Use 7-day trend view + baseline comparison
5. **Should we allow user-defined regions of interest?** (Higher sensitivity for specific areas)
6. **H3 grid migration timing** - When does cell boundary overhead justify the dependency?
7. **Cross-module alert deduplication** - How to avoid redundant alerts when CII also spikes?

---

## References

- US Intelligence Community's "Indications and Warning" doctrine
- RAND Corporation: "Warning Analysis for the Information Age"
- Existing implementations: Palantir Gotham, Babel Street, Recorded Future

---

*Document version: 2.0 | Author: Claude | Date: 2025-01-13 | Updated based on strategic review*
