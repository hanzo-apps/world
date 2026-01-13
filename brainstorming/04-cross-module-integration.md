# Cross-Module Integration

## Overview

The three core features—Geographic Convergence, Country Instability Index (CII), and Infrastructure Cascade—must work together as an integrated intelligence system, not isolated tools.

This document defines how they interact, share data, and avoid duplication.

---

## Module Relationships

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         STRATEGIC RISK DASHBOARD                         │
│                                                                         │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐     │
│  │   Geographic    │    │    Country      │    │  Infrastructure │     │
│  │  Convergence    │◄──►│  Instability    │◄──►│    Cascade      │     │
│  │                 │    │    Index        │    │                 │     │
│  └────────┬────────┘    └────────┬────────┘    └────────┬────────┘     │
│           │                      │                      │               │
│           └──────────────────────┼──────────────────────┘               │
│                                  │                                      │
│                                  ▼                                      │
│                    ┌─────────────────────────┐                         │
│                    │   Unified Alert Panel   │                         │
│                    │   + Shared Data Layer   │                         │
│                    └─────────────────────────┘                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Data Flow Between Modules

### Convergence → CII

When geographic convergence detects a cluster:
- Identify country/countries in the convergence zone
- Boost CII sensitivity for those countries
- Show convergence alert in country detail panel

```typescript
interface ConvergenceToCIILink {
  convergenceAlertId: string;
  affectedCountries: string[];
  signalTypes: string[];
  contribution: number;  // How much to boost CII
}

function onConvergenceDetected(alert: ConvergenceAlert): void {
  const countries = getCountriesInCell(alert.cellId);

  for (const country of countries) {
    // Boost CII information component
    ciiService.addConvergenceBoost(country, {
      alertId: alert.id,
      boost: Math.min(20, alert.score * 0.2),  // Up to +20 points
      expires: new Date(Date.now() + 24 * 60 * 60 * 1000),  // 24h
    });
  }
}
```

### CII → Convergence

When CII spikes rapidly:
- Lower convergence threshold for that country's regions
- Prioritize monitoring cells in that country

```typescript
function onCIISpike(country: string, change: number): void {
  if (change > 15) {  // +15 points in 24h
    const cells = getCellsForCountry(country);

    for (const cellId of cells) {
      // Temporarily lower threshold from 3 types to 2
      convergenceService.setTemporaryThreshold(cellId, 2, '24h');
    }
  }
}
```

### Convergence → Cascade

When convergence includes infrastructure signals:
- Auto-highlight potentially affected infrastructure
- Offer one-click cascade analysis

```typescript
function onConvergenceWithInfrastructure(alert: ConvergenceAlert): void {
  const infraSignals = alert.signalTypes.filter(t =>
    ['pipeline_incident', 'cable_incident', 'ais_gap'].includes(t)
  );

  if (infraSignals.length > 0) {
    const nearbyAssets = findInfrastructureNear(alert.lat, alert.lon, 100);  // 100km

    alert.enrichment = {
      ...alert.enrichment,
      nearbyInfrastructure: nearbyAssets,
      cascadeAvailable: true,
    };
  }
}
```

### Cascade → CII

Infrastructure disruptions affect country scores:

```typescript
function onCascadeCalculated(cascade: CascadeResult): void {
  for (const affected of cascade.countriesAffected) {
    if (affected.impactLevel === 'critical' || affected.impactLevel === 'high') {
      // Add infrastructure component contribution
      ciiService.addInfrastructureImpact(affected.country, {
        assetId: cascade.source.id,
        assetType: cascade.source.type,
        impactLevel: affected.impactLevel,
        capacityLoss: affected.affectedCapacity,
      });
    }
  }
}
```

### CII → Cascade

Unstable countries = higher cascade alert sensitivity:

```typescript
function getCascadeAlertThreshold(countryCode: string): number {
  const cii = ciiService.getCurrentScore(countryCode);

  // Lower threshold for unstable countries
  if (cii.score > 70) return 0.3;  // Alert on 30% impact
  if (cii.score > 50) return 0.5;  // Alert on 50% impact
  return 0.7;  // Normal: alert on 70% impact
}
```

---

## Unified Alert System

Avoid alert fatigue by consolidating related alerts.

### Alert Deduplication

```typescript
interface UnifiedAlert {
  id: string;
  type: 'convergence' | 'cii_spike' | 'cascade' | 'composite';
  priority: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  summary: string;
  components: {
    convergence?: ConvergenceAlert;
    ciiChange?: CIIChangeAlert;
    cascade?: CascadeAlert;
  };
  location?: { lat: number; lon: number };
  countries: string[];
  timestamp: Date;
}

function shouldMergeAlerts(a: UnifiedAlert, b: UnifiedAlert): boolean {
  // Same country/region within 2 hours
  const sameCountry = a.countries.some(c => b.countries.includes(c));
  const sameTime = Math.abs(a.timestamp.getTime() - b.timestamp.getTime()) < 2 * 60 * 60 * 1000;
  const sameLocation = a.location && b.location &&
    haversineDistance(a.location, b.location) < 200;  // 200km

  return (sameCountry || sameLocation) && sameTime;
}

function mergeAlerts(alerts: UnifiedAlert[]): UnifiedAlert {
  // Combine into composite alert
  const merged: UnifiedAlert = {
    id: generateId(),
    type: 'composite',
    priority: getHighestPriority(alerts),
    title: generateCompositeTitle(alerts),
    summary: generateCompositeSummary(alerts),
    components: {},
    countries: [...new Set(alerts.flatMap(a => a.countries))],
    timestamp: new Date(Math.max(...alerts.map(a => a.timestamp.getTime()))),
  };

  // Combine components
  for (const alert of alerts) {
    if (alert.components.convergence) merged.components.convergence = alert.components.convergence;
    if (alert.components.ciiChange) merged.components.ciiChange = alert.components.ciiChange;
    if (alert.components.cascade) merged.components.cascade = alert.components.cascade;
  }

  return merged;
}
```

### Alert Panel UI

```
┌─────────────────────────────────────────────────────────────────┐
│ UNIFIED INTELLIGENCE ALERTS                                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ 🔴 COMPOSITE: Taiwan Strait Region              2 hours ago    │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ Geographic Convergence: Score 87                            │ │
│ │ • Military flights (12), Naval vessels (5), AIS gaps (3)   │ │
│ │                                                             │ │
│ │ Country Impact: Taiwan CII 62 → 71 (+9)                    │ │
│ │ • Security component spiked due to military activity       │ │
│ │                                                             │ │
│ │ Infrastructure Risk: Malacca route affected                │ │
│ │ • 3 cables, 2 ports in affected zone                       │ │
│ │                                                             │ │
│ │ [View Convergence] [View Taiwan CII] [Cascade Analysis]    │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                 │
│ 🟠 CII SPIKE: Iran                             4 hours ago     │
│ │ Instability Index: 58 → 78 (+20 in 24h)                    │ │
│ │ Driver: Civil Unrest (85/100)                              │ │
│ │ [View Details]                                              │ │
│                                                                 │
│ 🟡 INFRASTRUCTURE: Baltic Cable Fault          6 hours ago     │
│ │ C-Lion1 cable reported degraded                            │ │
│ │ Impact: Finland (8%), Estonia (12%)                        │ │
│ │ [View Cascade]                                              │ │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Shared Data Layer

### Common Data Structures

```typescript
// Shared location type
interface GeoLocation {
  lat: number;
  lon: number;
  cellId?: string;      // For convergence grid
  countryCode?: string; // For CII
  assetId?: string;     // For cascade
}

// Shared time window
interface TimeWindow {
  start: Date;
  end: Date;
  window: '6h' | '24h' | '7d' | '30d';
}

// Shared event type
interface GeoEvent {
  id: string;
  type: string;
  location: GeoLocation;
  timestamp: Date;
  severity: number;
  source: string;
  metadata: Record<string, any>;
}
```

### Shared Services

```typescript
class SharedDataService {
  // Event ingestion (used by all modules)
  async ingestEvent(event: GeoEvent): Promise<void> {
    // Notify convergence module
    convergenceService.processEvent(event);

    // Notify CII module (if country-relevant)
    if (event.location.countryCode) {
      ciiService.processEvent(event);
    }

    // Notify cascade module (if infrastructure-relevant)
    if (isInfrastructureEvent(event)) {
      cascadeService.processEvent(event);
    }
  }

  // Baseline calculation (shared between convergence and CII)
  getBaseline(key: string, windowDays: number): Baseline {
    return this.baselineStore.get(key, windowDays);
  }

  // Country lookup (shared)
  getCountryForLocation(lat: number, lon: number): string | null {
    return this.geoService.reverseGeocode(lat, lon);
  }

  // Infrastructure lookup (shared between convergence and cascade)
  getInfrastructureNear(lat: number, lon: number, radiusKm: number): Infrastructure[] {
    return this.infrastructureIndex.queryRadius(lat, lon, radiusKm);
  }
}
```

---

## Strategic Risk Dashboard

The unified view combining all three modules.

### Dashboard Layout

```
┌─────────────────────────────────────────────────────────────────────────┐
│ STRATEGIC RISK OVERVIEW                                  🔴 3 Critical │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│ ┌─────────────────────────┐ ┌─────────────────────────────────────────┐ │
│ │ TOP CONVERGENCE ZONES   │ │ UNSTABLE COUNTRIES                      │ │
│ │                         │ │                                         │ │
│ │ 1. Taiwan Strait (87)  │ │ 1. Iran (78) ↑12                        │ │
│ │ 2. E. Mediterranean(62)│ │ 2. Ukraine (71) →                       │ │
│ │ 3. Red Sea (54)        │ │ 3. Taiwan (65) ↑9                       │ │
│ │                         │ │ 4. France (58) ↑8                       │ │
│ │ [Map View]              │ │ [Full List]                             │ │
│ └─────────────────────────┘ └─────────────────────────────────────────┘ │
│                                                                         │
│ ┌─────────────────────────────────────────────────────────────────────┐ │
│ │ INFRASTRUCTURE STATUS                                               │ │
│ │                                                                     │ │
│ │ ⚠️ DEGRADED: C-Lion1 Cable (Baltic)                                │ │
│ │ ⚠️ CONGESTED: Strait of Hormuz (AIS density +40%)                  │ │
│ │ ✅ All major pipelines operational                                  │ │
│ │ ✅ All major ports accessible                                       │ │
│ │                                                                     │ │
│ │ [View All Infrastructure]  [Scenario Builder]                       │ │
│ └─────────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│ ┌─────────────────────────────────────────────────────────────────────┐ │
│ │ RECENT ALERTS (Last 24h)                                           │ │
│ │                                                                     │ │
│ │ 14:32 🔴 Taiwan Strait convergence + CII spike (composite)        │ │
│ │ 12:45 🟠 Iran CII exceeded 75 threshold                           │ │
│ │ 08:12 🟡 Baltic cable degradation detected                        │ │
│ │ 06:30 🟢 Red Sea congestion returned to normal                    │ │
│ │                                                                     │ │
│ │ [View All Alerts]  [Alert Settings]                                │ │
│ └─────────────────────────────────────────────────────────────────────┘ │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Cumulative Risk Score

Optional: A single number representing overall global risk.

```typescript
interface GlobalRiskMetrics {
  convergenceAlerts: number;    // Active convergence zones
  avgCIIDeviation: number;      // Average country deviation from baseline
  infrastructureIncidents: number;
  compositeScore: number;       // 0-100

  trend: 'escalating' | 'stable' | 'de-escalating';
  topRisks: string[];           // Top 3 risk descriptions
}

function calculateGlobalRisk(): GlobalRiskMetrics {
  const convergence = convergenceService.getActiveAlerts();
  const cii = ciiService.getAllScores();
  const infra = cascadeService.getActiveIncidents();

  // Weight factors
  const convergenceWeight = 0.4;
  const ciiWeight = 0.35;
  const infraWeight = 0.25;

  // Normalize each component to 0-100
  const convergenceScore = Math.min(100, convergence.length * 15);
  const ciiScore = calculateAvgDeviation(cii) * 20;
  const infraScore = Math.min(100, infra.length * 25);

  const composite = (
    convergenceScore * convergenceWeight +
    ciiScore * ciiWeight +
    infraScore * infraWeight
  );

  return {
    convergenceAlerts: convergence.length,
    avgCIIDeviation: calculateAvgDeviation(cii),
    infrastructureIncidents: infra.length,
    compositeScore: Math.round(composite),
    trend: determineTrend(),
    topRisks: identifyTopRisks(convergence, cii, infra),
  };
}
```

---

## Terminology Consistency

Use consistent terminology across all modules:

| Concept | Term to Use | Avoid |
|---------|-------------|-------|
| Risk level categories | critical/high/medium/low | severe/urgent/minor/negligible |
| Score ranges | 0-100 | percentages, letter grades |
| Time windows | 6h, 24h, 7d, 30d | "recent", "short-term" |
| Location precision | lat/lon, cellId | "area", "vicinity" |
| Impact description | qualitative + confidence | precise numbers without context |

---

## Implementation Priority

1. **Phase 1**: Shared data layer (event ingestion, baseline service)
2. **Phase 2**: Cross-module data flow (CII ↔ Convergence)
3. **Phase 3**: Unified alert system (deduplication, composite alerts)
4. **Phase 4**: Strategic Risk Dashboard
5. **Phase 5**: Global risk score (optional)

---

## Open Questions

1. **How often to recalculate cross-module influences?** (Every event? Every minute? On-demand?)
2. **Should global risk score be exposed?** (Risk of misinterpretation)
3. **How to handle conflicting signals?** (CII stable but convergence high)
4. **User customization of module weights?** (Let analysts tune integration)

---

*Document version: 1.0 | Author: Claude | Date: 2025-01-13*
