# Infrastructure Cascade Visualization

## The Intelligence Problem

Critical infrastructure is interconnected in ways that aren't immediately visible. When an analyst sees a submarine cable fault, the question isn't just "which cable?" but:
- **Which countries lose connectivity?**
- **What financial centers are affected?**
- **Are there redundant routes?**
- **What else depends on this?**

Similarly, a pipeline disruption cascades to:
- Refineries that depend on it
- Ports that handle its output
- Countries that rely on the energy
- Market prices that will spike

Current tools show assets in isolation. The dashboard should answer: **"If X breaks, what happens?"**

---

## Core Concept

**Infrastructure Cascade** = Visualizing the dependency graph of critical infrastructure, showing upstream suppliers, downstream dependents, and geographic/economic impact of disruptions.

### Three Cascade Directions

| Direction | Question | Example |
|-----------|----------|---------|
| **Upstream** | What does this depend on? | Port depends on: pipelines, cables, shipping routes |
| **Downstream** | What depends on this? | Cable serves: 15 countries, 3 financial centers |
| **Lateral** | What shares dependencies? | These 3 ports all depend on Hormuz chokepoint |

### Why It Matters

Single asset view:
> "FLAG Europe-Asia cable has a fault"

Cascade view:
> "FLAG Europe-Asia fault affects: India (23% capacity), UAE (18%), Saudi Arabia (12%). Redundancy available via SEA-ME-WE 5. Mumbai financial center may experience latency. 4 other cables share this landing point."

---

## Infrastructure Assets Available

### Already Implemented

| Asset Type | Count | Data Quality | Dependencies Mapped |
|------------|-------|--------------|---------------------|
| Submarine cables | ~500 | Coordinates, landing points, RFS date | Countries served (partial) |
| Pipelines | ~80 major | Coordinates, capacity, commodity | Origin/destination (partial) |
| Ports | 61 strategic | Coordinates, type, rank | None |
| Chokepoints | 8 major | Coordinates, description | None |
| Conflict zones | 20+ | Polygons | None |

### Dependency Data Needed

| Relationship | Source | Effort |
|--------------|--------|--------|
| Cable → Countries served | TeleGeography (public) | Low - enhance cables.ts |
| Pipeline → Origin/transit/destination | Global Energy Monitor | Low - enhance pipelines.ts |
| Port → Pipelines terminating there | Manual mapping | Medium |
| Port → Cables landing nearby | Proximity calculation | Low |
| Chokepoint → Routes passing through | Route definitions | Medium |
| Country → Critical infrastructure | Aggregation | Low |

---

## Dependency Graph Design

### Node Types

```typescript
type InfrastructureNode = {
  id: string;
  type: 'cable' | 'pipeline' | 'port' | 'chokepoint' | 'country' | 'route';
  name: string;
  coordinates?: [number, number];
  metadata: Record<string, any>;
};
```

### Edge Types

```typescript
type DependencyEdge = {
  from: string;           // Node ID
  to: string;             // Node ID
  type: DependencyType;
  strength: number;       // 0-1 criticality
  redundancy?: number;    // 0-1 how replaceable
  metadata?: {
    capacityShare?: number;   // What % of capacity
    alternativeRoutes?: number;
    estimatedImpact?: string;
  };
};

type DependencyType =
  | 'serves'              // Cable serves country
  | 'terminates_at'       // Pipeline terminates at port
  | 'transits_through'    // Route transits chokepoint
  | 'lands_at'            // Cable lands at country
  | 'depends_on'          // Port depends on pipeline
  | 'shares_risk'         // Assets share vulnerability
  | 'alternative_to';     // Provides redundancy
```

### Graph Structure

```
                    ┌─────────────┐
                    │   COUNTRY   │
                    │   (India)   │
                    └──────┬──────┘
                           │ serves (23%)
                    ┌──────┴──────┐
                    │    CABLE    │
                    │  (FLAG EA)  │
                    └──────┬──────┘
                           │ lands_at
              ┌────────────┴────────────┐
              │                         │
       ┌──────┴──────┐           ┌──────┴──────┐
       │    PORT     │           │    PORT     │
       │  (Mumbai)   │           │ (Fujairah)  │
       └──────┬──────┘           └──────┬──────┘
              │ depends_on               │ depends_on
       ┌──────┴──────┐           ┌──────┴──────┐
       │  PIPELINE   │           │ CHOKEPOINT  │
       │ (India Gas) │           │  (Hormuz)   │
       └─────────────┘           └─────────────┘
```

---

## Data Enrichment Required

### 1. Cable Landing Points → Countries

Current `cables.ts` has coordinates. Need to add:

```typescript
interface SubmarineCable {
  // Existing
  name: string;
  coordinates: [number, number][];
  status: string;
  rfs?: string;
  length?: string;
  owners?: string[];

  // New fields
  landingPoints: {
    country: string;      // ISO code
    countryName: string;
    city?: string;
    lat: number;
    lon: number;
  }[];

  countriesServed: {
    country: string;
    capacityShare: number;  // 0-1, what % of country's capacity
    isRedundant: boolean;   // Has alternative routes
  }[];

  capacityTbps?: number;
}
```

**Source**: TeleGeography's submarine cable map provides landing points publicly.

### 2. Pipeline Origin/Transit/Destination

Current `pipelines.ts` has basic info. Need to add:

```typescript
interface Pipeline {
  // Existing
  name: string;
  coordinates: [number, number][];
  commodity: string;
  capacityNote?: string;

  // New fields
  origin: {
    country: string;
    field?: string;       // Source field/terminal
  };

  transitCountries: string[];  // ISO codes

  destination: {
    country: string;
    terminal?: string;    // Port/refinery name
    portId?: string;      // Link to ports.ts
  };

  capacityMbpd?: number;  // Million barrels per day (oil)
  capacityBcmY?: number;  // Billion cubic meters/year (gas)

  alternatives?: string[]; // Pipeline IDs that could substitute
}
```

**Source**: Global Energy Monitor pipeline tracker (public).

### 3. Port Dependencies

```typescript
interface Port {
  // Existing
  name: string;
  country: string;
  lat: number;
  lon: number;
  type: PortType;
  rank?: number;

  // New fields
  connectedPipelines: string[];   // Pipeline IDs
  nearbyCables: string[];         // Cable IDs (within 50km)
  accessChokepoints: string[];    // Chokepoints required for access

  annualThroughput?: {
    containers?: number;          // TEUs
    oil?: number;                 // Million tonnes
    lng?: number;                 // Million tonnes
  };

  alternatives?: {
    portId: string;
    distance: number;             // km
    capacityMatch: number;        // 0-1
  }[];
}
```

### 4. Route Definitions

Define major trade routes as sequences of chokepoints:

```typescript
interface TradeRoute {
  id: string;
  name: string;
  description: string;
  chokepoints: string[];          // Ordered chokepoint IDs
  majorPorts: string[];           // Port IDs along route
  commodities: string[];
  annualValue?: number;           // USD billions
  annualVolume?: number;          // Million tonnes
}

const TRADE_ROUTES: TradeRoute[] = [
  {
    id: 'asia-europe-suez',
    name: 'Asia → Europe (Suez)',
    description: 'Primary container route from East Asia to Europe',
    chokepoints: ['malacca', 'bab-el-mandeb', 'suez'],
    majorPorts: ['shanghai', 'singapore', 'port-said', 'rotterdam'],
    commodities: ['containers', 'electronics', 'machinery'],
    annualValue: 1400,
  },
  // ... more routes
];
```

---

## Cascade Calculation Algorithm

### Phase 1: Build Dependency Graph

```typescript
interface DependencyGraph {
  nodes: Map<string, InfrastructureNode>;
  edges: DependencyEdge[];

  // Indexes for fast lookup
  outgoing: Map<string, DependencyEdge[]>;  // from → edges
  incoming: Map<string, DependencyEdge[]>;  // to → edges
}

function buildDependencyGraph(): DependencyGraph {
  const graph: DependencyGraph = {
    nodes: new Map(),
    edges: [],
    outgoing: new Map(),
    incoming: new Map(),
  };

  // Add all infrastructure as nodes
  addCablesAsNodes(graph);
  addPipelinesAsNodes(graph);
  addPortsAsNodes(graph);
  addChokepointsAsNodes(graph);
  addCountriesAsNodes(graph);
  addRoutesAsNodes(graph);

  // Build edges from dependency data
  buildCableCountryEdges(graph);
  buildPipelinePortEdges(graph);
  buildPortChokepointEdges(graph);
  buildRouteChokepointEdges(graph);
  buildRedundancyEdges(graph);

  return graph;
}
```

### Phase 2: Calculate Cascade Impact

```typescript
interface CascadeResult {
  source: InfrastructureNode;
  affectedNodes: {
    node: InfrastructureNode;
    impactLevel: 'critical' | 'high' | 'medium' | 'low';
    pathLength: number;           // Hops from source
    dependencyChain: string[];    // How it's connected
    redundancyAvailable: boolean;
    estimatedRecovery?: string;
  }[];

  countriesAffected: {
    country: string;
    impactLevel: 'critical' | 'high' | 'medium' | 'low';
    affectedCapacity: number;     // 0-1
    criticalSectors: string[];
  }[];

  economicImpact?: {
    dailyTradeLoss?: number;
    affectedThroughput?: number;
  };
}

function calculateCascade(
  graph: DependencyGraph,
  sourceId: string,
  disruptionLevel: number = 1.0  // 0-1, partial vs total disruption
): CascadeResult {
  const source = graph.nodes.get(sourceId)!;
  const affected: Map<string, CascadeNode> = new Map();

  // BFS through dependency graph
  const queue: { nodeId: string; depth: number; path: string[] }[] = [
    { nodeId: sourceId, depth: 0, path: [sourceId] }
  ];

  while (queue.length > 0) {
    const { nodeId, depth, path } = queue.shift()!;

    // Get all nodes that depend on this one
    const dependents = graph.incoming.get(nodeId) || [];

    for (const edge of dependents) {
      if (affected.has(edge.from)) continue;

      const impactStrength = edge.strength * disruptionLevel * (1 - (edge.redundancy || 0));

      if (impactStrength > 0.1) {  // Threshold for meaningful impact
        affected.set(edge.from, {
          node: graph.nodes.get(edge.from)!,
          impactLevel: categorizeImpact(impactStrength),
          pathLength: depth + 1,
          dependencyChain: [...path, edge.from],
          redundancyAvailable: (edge.redundancy || 0) > 0.5,
        });

        queue.push({
          nodeId: edge.from,
          depth: depth + 1,
          path: [...path, edge.from],
        });
      }
    }
  }

  return aggregateCascadeResult(source, affected);
}

function categorizeImpact(strength: number): 'critical' | 'high' | 'medium' | 'low' {
  if (strength > 0.8) return 'critical';
  if (strength > 0.5) return 'high';
  if (strength > 0.2) return 'medium';
  return 'low';
}
```

### Phase 3: Find Redundancies

```typescript
function findRedundancies(
  graph: DependencyGraph,
  sourceId: string
): RedundancyAnalysis {
  const source = graph.nodes.get(sourceId)!;
  const alternatives: Alternative[] = [];

  // For cables: find other cables serving same countries
  if (source.type === 'cable') {
    const countriesServed = getCountriesServed(graph, sourceId);
    for (const country of countriesServed) {
      const otherCables = findCablesServing(graph, country, sourceId);
      alternatives.push({
        type: 'cable',
        affectedEntity: country,
        alternatives: otherCables.map(c => ({
          id: c.id,
          name: c.name,
          capacityShare: c.capacityForCountry,
          currentLoad: c.currentUtilization,
        })),
      });
    }
  }

  // For chokepoints: find alternative routes
  if (source.type === 'chokepoint') {
    const affectedRoutes = findRoutesThrough(graph, sourceId);
    for (const route of affectedRoutes) {
      const altRoutes = findAlternativeRoutes(graph, route);
      alternatives.push({
        type: 'route',
        affectedEntity: route.name,
        alternatives: altRoutes,
        additionalDistance: calculateDetour(route, altRoutes[0]),
        additionalTime: estimateTimeDelay(route, altRoutes[0]),
      });
    }
  }

  return { source, alternatives };
}
```

---

## UI/UX Design

### Trigger: Click Infrastructure Asset

When user clicks any infrastructure asset (cable, pipeline, port, chokepoint), show cascade button:

```
┌─────────────────────────────────────────────┐
│ FLAG Europe-Asia Cable                      │
│ Status: Active | Length: 28,000 km          │
├─────────────────────────────────────────────┤
│ Landing Points: 14 countries                │
│ Capacity: 10 Tbps                           │
│                                             │
│ [📊 Show Cascade Impact]  [🗺️ Highlight]    │
└─────────────────────────────────────────────┘
```

### Cascade Impact Panel

```
┌─────────────────────────────────────────────────────────────┐
│ 💥 CASCADE IMPACT: FLAG Europe-Asia Cable Disruption        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ DIRECTLY AFFECTED (14 countries)                            │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ 🔴 CRITICAL                                             │ │
│ │    India (23% capacity) - Mumbai financial center       │ │
│ │    UAE (18% capacity) - Dubai connectivity              │ │
│ │                                                         │ │
│ │ 🟠 HIGH                                                 │ │
│ │    Saudi Arabia (12%) - Jeddah data centers            │ │
│ │    Egypt (9%) - Suez region connectivity               │ │
│ │                                                         │ │
│ │ 🟡 MEDIUM                                               │ │
│ │    Pakistan (7%), Thailand (6%), Malaysia (5%)         │ │
│ │                                                         │ │
│ │ 🟢 LOW (with redundancy)                                │ │
│ │    UK (3%), Spain (2%), Italy (2%)                     │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ INFRASTRUCTURE AT RISK                                      │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ • Port of Mumbai - depends on cable for operations     │ │
│ │ • Dubai Internet City - 18% capacity at risk           │ │
│ │ • 3 data centers in affected path                      │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ REDUNDANCY ANALYSIS                                         │ │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ ✅ SEA-ME-WE 5 can absorb 40% of traffic               │ │
│ │ ✅ AAE-1 provides backup to UAE/Saudi                  │ │
│ │ ⚠️ No backup for India east coast route                │ │
│ │ Estimated recovery: 2-4 weeks (typical repair)         │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ [Highlight on Map]  [Export Report]  [Close]                │
└─────────────────────────────────────────────────────────────┘
```

### Map Visualization

When cascade panel opens, update map to show:

1. **Source asset**: Pulsing red highlight
2. **Critical dependents**: Red markers/lines
3. **High impact**: Orange markers/lines
4. **Medium impact**: Yellow markers/lines
5. **Redundant routes**: Green dashed lines
6. **Unaffected**: Dimmed

```css
.cascade-source {
  animation: cascade-pulse 1s ease-in-out infinite;
  filter: drop-shadow(0 0 8px #ff4444);
}

.cascade-critical {
  stroke: #ff4444;
  stroke-width: 3px;
  opacity: 1;
}

.cascade-high {
  stroke: #ff8800;
  stroke-width: 2px;
  opacity: 0.9;
}

.cascade-medium {
  stroke: #ffcc00;
  stroke-width: 2px;
  opacity: 0.8;
}

.cascade-redundant {
  stroke: #22cc66;
  stroke-dasharray: 5,5;
  stroke-width: 2px;
  opacity: 0.7;
}

.cascade-unaffected {
  opacity: 0.2;
}

@keyframes cascade-pulse {
  0%, 100% { filter: drop-shadow(0 0 8px #ff4444); }
  50% { filter: drop-shadow(0 0 16px #ff0000); }
}
```

### Cascade Animation

When showing cascade, animate the spread:

```typescript
async function animateCascade(cascade: CascadeResult): Promise<void> {
  // Start with source
  highlightNode(cascade.source.id, 'source');
  await delay(300);

  // Group by path length
  const byDepth = groupBy(cascade.affectedNodes, n => n.pathLength);

  // Animate each depth level
  for (const [depth, nodes] of Object.entries(byDepth).sort()) {
    for (const node of nodes) {
      highlightNode(node.node.id, node.impactLevel);
      // Draw connection line from parent
      drawCascadeLine(node.dependencyChain);
    }
    await delay(200);
  }

  // Finally show redundancies in green
  for (const alt of cascade.redundancies) {
    highlightNode(alt.id, 'redundant');
  }
}
```

---

## Chokepoint-Specific Cascades

Chokepoints have unique cascade effects - they affect routes, not just individual assets.

### Chokepoint Disruption Scenario

```
┌─────────────────────────────────────────────────────────────┐
│ 💥 CASCADE IMPACT: Strait of Hormuz Blockade               │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ TRAFFIC AFFECTED                                            │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ 🛢️ Oil: 21 million bpd (21% of global consumption)      │ │
│ │ ⛽ LNG: 25% of global LNG trade                         │ │
│ │ 🚢 Ships: ~2,500 transits/month                         │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ ROUTES BLOCKED                                              │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ • Middle East → Asia (oil/LNG)                         │ │
│ │ • Middle East → Europe (oil/LNG)                       │ │
│ │ • Middle East → Americas (limited)                     │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ PORTS CUT OFF                                               │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ 🔴 Ras Tanura (SA) - 6.5M bpd capacity                 │ │
│ │ 🔴 Fujairah (UAE) - Major oil storage hub              │ │
│ │ 🔴 Kharg Island (Iran) - 5M bpd capacity               │ │
│ │ 🔴 Mina al-Ahmadi (Kuwait) - 2M bpd                    │ │
│ │ 🟠 Jebel Ali (UAE) - Container hub, partial access     │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ ALTERNATIVE ROUTES                                          │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ ⚠️ East-West Pipeline (SA): 5M bpd to Red Sea         │ │
│ │    → Only handles 24% of Hormuz flow                   │ │
│ │                                                         │ │
│ │ ⚠️ IPSA Pipeline (Iraq): 1.65M bpd to Turkey          │ │
│ │    → Additional 8% capacity                            │ │
│ │                                                         │ │
│ │ ❌ No viable shipping alternative                       │ │
│ │    → Cape of Good Hope adds 15-20 days                 │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ ESTIMATED IMPACT                                            │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ 📈 Oil price impact: +$30-50/barrel (estimated)        │ │
│ │ 📈 LNG price impact: +40-60% spot prices               │ │
│ │ 🕐 Duration to critical shortage: 30-45 days           │ │
│ │    (strategic reserves can buffer)                     │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ [Highlight Affected Ports]  [Show Alternatives]  [Close]    │
└─────────────────────────────────────────────────────────────┘
```

---

## Country Cascade View

Show all infrastructure a country depends on:

### Trigger: Click Country or Flag

```
┌─────────────────────────────────────────────────────────────┐
│ 🇯🇵 JAPAN - Infrastructure Dependencies                     │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ ENERGY DEPENDENCIES (99% imported)                          │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ OIL ROUTES                                              │ │
│ │ • 87% via Strait of Hormuz                             │ │
│ │ • 100% via Strait of Malacca                           │ │
│ │ • Key ports: Yokohama, Kawasaki, Chiba                 │ │
│ │                                                         │ │
│ │ LNG ROUTES                                              │ │
│ │ • 23% from Australia (direct)                          │ │
│ │ • 19% from Malaysia (via South China Sea)              │ │
│ │ • 14% from Qatar (via Hormuz + Malacca)                │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ DATA CONNECTIVITY                                           │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ SUBMARINE CABLES (12 major)                            │ │
│ │ • Pacific routes: 6 cables to US                       │ │
│ │ • Asia routes: 4 cables to regional hubs               │ │
│ │ • Redundancy: HIGH (well-connected)                    │ │
│ │                                                         │ │
│ │ CRITICAL LANDING POINTS                                │ │
│ │ • Chikura (8 cables) - Single point of failure risk    │ │
│ │ • Shima (6 cables)                                     │ │
│ │ • Kitaibaraki (4 cables)                               │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ VULNERABILITY ASSESSMENT                                    │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ 🔴 Hormuz closure: 30-day crisis threshold             │ │
│ │ 🟠 Malacca disruption: All energy/trade affected       │ │
│ │ 🟡 Taiwan Strait tension: 15% trade at risk            │ │
│ │ 🟢 Cable redundancy: Adequate for most scenarios       │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ [Highlight All Dependencies]  [Scenario Analysis]  [Close]  │
└─────────────────────────────────────────────────────────────┘
```

---

## Data Schema

### IndexedDB Storage

```typescript
interface CascadeState {
  dependencyGraph: SerializedGraph;
  lastCalculated: Date;
  cachedCascades: Map<string, CascadeResult>;  // Memoized results
}

interface SerializedGraph {
  nodes: InfrastructureNode[];
  edges: DependencyEdge[];
  version: number;
  buildDate: Date;
}

interface CachedCascade {
  sourceId: string;
  result: CascadeResult;
  calculatedAt: Date;
  expiresAt: Date;  // Invalidate after data refresh
}
```

### Configuration Files

```typescript
// src/config/dependencies.ts
export const INFRASTRUCTURE_DEPENDENCIES: DependencyConfig = {

  // Cable → Country relationships
  cableCountries: {
    'flag-europe-asia': {
      countries: [
        { code: 'IN', capacityShare: 0.23, redundant: false },
        { code: 'AE', capacityShare: 0.18, redundant: true },
        { code: 'SA', capacityShare: 0.12, redundant: true },
        // ...
      ],
    },
    // ... more cables
  },

  // Pipeline → Port relationships
  pipelinePorts: {
    'east-west-pipeline': {
      origin: { country: 'SA', terminal: 'Abqaiq' },
      destination: { country: 'SA', port: 'yanbu', portId: 'yanbu' },
      capacityMbpd: 5.0,
    },
    // ... more pipelines
  },

  // Chokepoint → Route relationships
  chokepointRoutes: {
    'hormuz': {
      routes: ['middle-east-asia-oil', 'middle-east-europe-oil'],
      dailyOilMbpd: 21,
      dailyLngBcf: 6.5,
    },
    // ... more chokepoints
  },

  // Port access requirements
  portAccess: {
    'ras-tanura': {
      requiredChokepoints: ['hormuz'],
      connectedPipelines: ['abqaiq-ras-tanura'],
    },
    // ... more ports
  },
};
```

---

## Implementation Phases

### Phase 1: Static Dependencies (MVP)

1. Enhance cables.ts with landing points and countries served
2. Enhance pipelines.ts with origin/destination
3. Create dependencies.ts configuration
4. Build basic dependency graph
5. Simple cascade calculation (1 hop)
6. Basic cascade panel UI

### Phase 2: Full Graph

1. Add port → pipeline connections
2. Add port → chokepoint requirements
3. Define trade routes
4. Multi-hop cascade calculation
5. Map visualization (highlight affected)
6. Redundancy analysis

### Phase 3: Advanced Features

1. Country dependency view
2. Cascade animation
3. Scenario comparison ("what if X AND Y fail?")
4. Economic impact estimation
5. Historical incident correlation
6. Export/sharing

---

## Edge Cases & Challenges

### 1. Circular Dependencies

**Problem**: A depends on B, B depends on C, C depends on A.

**Solution**: Track visited nodes in BFS, limit depth, detect cycles.

### 2. Partial Disruptions

**Problem**: Cable is degraded (50% capacity) not fully broken.

**Solution**: `disruptionLevel` parameter (0-1), scale impact accordingly.

### 3. Data Staleness

**Problem**: Dependency data is static, real infrastructure changes.

**Solution**:
- Version config files
- Periodic manual review
- Flag "last verified" dates
- Allow user overrides

### 4. Over-Complexity

**Problem**: Too many connections make visualization unusable.

**Solution**:
- Filter by impact threshold (show only > 10% impact)
- Collapse low-impact into "and N others"
- Progressive disclosure (click to expand)
- Limit cascade depth (3 hops default)

### 5. Missing Data

**Problem**: We don't know all dependencies.

**Solution**:
- Show confidence levels
- "Partial data available" warnings
- Allow user contributions
- Conservative impact estimates

---

## Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Graph accuracy | >80% of known dependencies mapped | Manual audit |
| Response time | <500ms for cascade calculation | Performance logs |
| User comprehension | >70% find cascade useful | Survey/click-through |
| Data coverage | >90% of critical infrastructure | Config audit |

---

## Expanded Infrastructure Types (Future)

Current focus is on cables, pipelines, ports, and chokepoints. Future expansion:

### Power Grid Infrastructure

```typescript
interface PowerGrid {
  id: string;
  name: string;
  type: 'transmission' | 'generation' | 'interconnect';
  country: string;
  capacityMw?: number;
  coordinates?: [number, number][];  // For transmission lines

  // Dependencies
  fuelSource?: string[];              // 'gas_pipeline_X', 'lng_terminal_Y'
  interconnects?: string[];           // Cross-border connections
}

// Example: European grid interconnects
const POWER_INTERCONNECTS = [
  {
    id: 'nordlink',
    name: 'NordLink',
    type: 'interconnect',
    countries: ['DE', 'NO'],
    capacityMw: 1400,
    dependencies: ['north_sea_cables'],
  },
];
```

### Fuel Storage & Distribution

```typescript
interface FuelInfrastructure {
  id: string;
  type: 'refinery' | 'storage' | 'terminal' | 'distribution';
  name: string;
  country: string;
  capacityMbbls?: number;            // Million barrels (storage)
  throughputMbpd?: number;           // Million barrels/day (refinery)

  // Dependencies
  inputPipelines?: string[];
  outputPipelines?: string[];
  portAccess?: string;
}
```

### Integration with Cascade

```typescript
// Extend node types
type InfrastructureNode = {
  id: string;
  type: 'cable' | 'pipeline' | 'port' | 'chokepoint' | 'country' | 'route'
       | 'power_grid' | 'refinery' | 'storage' | 'terminal';  // New types
  // ...
};

// Power-specific cascade: "If gas pipeline X fails..."
// → Affects power plant Y
// → Affects grid region Z
// → Affects countries in region
```

---

## Data Update Mechanisms

Dependency data must stay current. Implement multiple update pathways.

### Scheduled Review Cycle

```typescript
interface DataFreshnessConfig {
  category: string;
  reviewIntervalDays: number;
  sources: string[];
  lastReviewed: Date;
  nextReviewDue: Date;
}

const DATA_FRESHNESS: DataFreshnessConfig[] = [
  {
    category: 'submarine_cables',
    reviewIntervalDays: 90,
    sources: ['TeleGeography', 'SubmarineCableMap'],
    lastReviewed: new Date('2025-01-01'),
    nextReviewDue: new Date('2025-04-01'),
  },
  {
    category: 'pipeline_routes',
    reviewIntervalDays: 180,
    sources: ['GlobalEnergyMonitor', 'EIA'],
    lastReviewed: new Date('2024-12-01'),
    nextReviewDue: new Date('2025-06-01'),
  },
  // ...
];

// Show in UI when data is stale
function getDataWarnings(): string[] {
  const warnings: string[] = [];
  for (const config of DATA_FRESHNESS) {
    if (new Date() > config.nextReviewDue) {
      warnings.push(`${config.category} data may be outdated (last reviewed ${formatDate(config.lastReviewed)})`);
    }
  }
  return warnings;
}
```

### News-Triggered Updates

Monitor for infrastructure changes via news:

```typescript
const INFRASTRUCTURE_CHANGE_KEYWORDS = [
  'cable cut', 'cable fault', 'pipeline completed', 'pipeline damaged',
  'port closed', 'terminal opened', 'interconnect operational',
  'refinery explosion', 'grid failure', 'blackout',
];

async function detectInfrastructureNews(news: NewsItem[]): Promise<InfrastructureAlert[]> {
  const alerts: InfrastructureAlert[] = [];

  for (const item of news) {
    const text = `${item.title} ${item.description}`.toLowerCase();

    for (const keyword of INFRASTRUCTURE_CHANGE_KEYWORDS) {
      if (text.includes(keyword)) {
        // Try to match to known infrastructure
        const matchedAsset = findMatchingInfrastructure(text);

        alerts.push({
          type: 'infrastructure_news',
          keyword,
          newsItem: item,
          matchedAsset,
          requiresReview: true,
        });
      }
    }
  }

  return alerts;
}
```

### User Contribution System

Allow analysts to report corrections:

```typescript
interface InfrastructureCorrection {
  id: string;
  assetId: string;
  assetType: string;
  correctionType: 'new_dependency' | 'remove_dependency' | 'update_capacity' | 'status_change';
  currentValue: any;
  proposedValue: any;
  source: string;
  submittedBy: string;
  submittedAt: Date;
  status: 'pending' | 'approved' | 'rejected';
  reviewNotes?: string;
}

// UI: "Report incorrect data" button on every asset popup
// Corrections go to review queue before merging into config
```

---

## Impact Quantification Improvements

Avoid false precision. Use qualitative descriptions backed by real metrics where available.

### Impact Descriptors

```typescript
interface ImpactDescription {
  level: 'critical' | 'high' | 'medium' | 'low';
  qualitative: string;
  quantitative?: {
    metric: string;
    value: number;
    unit: string;
    confidence: 'verified' | 'estimated' | 'unknown';
  };
}

// Example: Cable disruption impact on India
const CABLE_IMPACT_INDIA: ImpactDescription = {
  level: 'critical',
  qualitative: 'Major degradation of international connectivity. Financial centers affected. Business operations impaired.',
  quantitative: {
    metric: 'capacity_loss',
    value: 23,
    unit: 'percent',
    confidence: 'estimated',
  },
};
```

### Confidence Labels

Always show confidence in impact estimates:

```
┌─────────────────────────────────────────────────┐
│ IMPACT ON INDIA                                 │
│                                                 │
│ 🔴 CRITICAL - Capacity loss: ~23% (estimated)  │
│                                                 │
│ Confidence: MEDIUM                              │
│ • Capacity share from TeleGeography (2024)     │
│ • Redundancy analysis based on cable count     │
│ • Actual traffic distribution unknown          │
│                                                 │
│ [View methodology]                              │
└─────────────────────────────────────────────────┘
```

### Avoid False Precision

```typescript
// BAD: "Economic impact: $1,247,892,341"
// GOOD: "Economic impact: ~$1.2B daily trade affected"

function formatEconomicImpact(value: number): string {
  if (value >= 1e12) return `~$${(value / 1e12).toFixed(1)}T`;
  if (value >= 1e9) return `~$${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `~$${(value / 1e6).toFixed(0)}M`;
  return `~$${value.toLocaleString()}`;
}

// Always prefix with "~" or "estimated" for derived values
```

---

## Real-Time Monitoring Integration

Auto-trigger cascade analysis when incidents are detected.

### Incident Detection Triggers

```typescript
interface IncidentTrigger {
  sourceType: string;
  condition: (data: any) => boolean;
  assetLookup: (data: any) => string | null;  // Returns asset ID
  cascadeAutoTrigger: boolean;
}

const INCIDENT_TRIGGERS: IncidentTrigger[] = [
  {
    sourceType: 'cloudflare_outage',
    condition: (outage) => outage.severity === 'major' || outage.severity === 'total',
    assetLookup: (outage) => findCablesForCountry(outage.countryCode),
    cascadeAutoTrigger: true,
  },
  {
    sourceType: 'news_pipeline_incident',
    condition: (news) => news.keywords.includes('explosion') || news.keywords.includes('sabotage'),
    assetLookup: (news) => matchPipelineFromText(news.text),
    cascadeAutoTrigger: true,
  },
  {
    sourceType: 'ais_chokepoint_blockage',
    condition: (ais) => ais.congestionLevel > 0.9,
    assetLookup: (ais) => ais.chokepointId,
    cascadeAutoTrigger: false,  // Manual confirmation needed
  },
];

// When incident detected, auto-open cascade panel
async function onIncidentDetected(incident: Incident): Promise<void> {
  for (const trigger of INCIDENT_TRIGGERS) {
    if (incident.type === trigger.sourceType && trigger.condition(incident.data)) {
      const assetId = trigger.assetLookup(incident.data);

      if (assetId && trigger.cascadeAutoTrigger) {
        // Calculate cascade
        const cascade = calculateCascade(graph, assetId);

        // Show notification
        showNotification({
          type: 'cascade_alert',
          title: `Infrastructure Incident Detected`,
          message: `${assetId} may be affected. Cascade impact calculated.`,
          action: () => openCascadePanel(assetId, cascade),
        });
      }
    }
  }
}
```

### Live Status Overlay

Show real-time status on infrastructure:

```
┌─────────────────────────────────────────────────┐
│ 🚨 LIVE STATUS: FLAG Europe-Asia Cable          │
├─────────────────────────────────────────────────┤
│                                                 │
│ Status: DEGRADED (50% capacity)                 │
│ Since: 2 hours ago                              │
│ Source: Cloudflare Radar + News Reports         │
│                                                 │
│ [View Live Cascade Impact]                      │
│ [Compare to Normal State]                       │
└─────────────────────────────────────────────────┘
```

---

## Multi-Event Scenario Analysis

Handle compound disruptions (e.g., "What if Hormuz AND Malacca both blocked?").

### Scenario Builder

```typescript
interface Scenario {
  id: string;
  name: string;
  description: string;
  disruptions: {
    assetId: string;
    disruptionLevel: number;  // 0-1
  }[];
  createdAt: Date;
  savedBy?: string;
}

function calculateCompoundCascade(
  graph: DependencyGraph,
  disruptions: { assetId: string; level: number }[]
): CompoundCascadeResult {
  // Calculate individual cascades
  const individualCascades = disruptions.map(d =>
    calculateCascade(graph, d.assetId, d.level)
  );

  // Merge impacts (some may overlap, some compound)
  const mergedImpacts = mergeImpacts(individualCascades);

  // Identify compounding effects
  const compoundingEffects = findCompoundingEffects(individualCascades);

  return {
    scenario: disruptions,
    individualCascades,
    mergedImpact: mergedImpacts,
    compoundingEffects,
    totalEconomicImpact: sumEconomicImpacts(mergedImpacts),
  };
}
```

### Scenario UI

```
┌─────────────────────────────────────────────────────────────┐
│ SCENARIO BUILDER                                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ Active Disruptions:                                         │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ ▪ Strait of Hormuz - 100% blocked         [Remove]     │ │
│ │ ▪ Strait of Malacca - 50% congested       [Remove]     │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ [+ Add Disruption]                                          │
│                                                             │
│ ─────────────────────────────────────────────────────────── │
│                                                             │
│ COMPOUND IMPACT ANALYSIS                                    │
│                                                             │
│ ⚠️ COMPOUNDING EFFECTS DETECTED                             │
│ • Japan oil supply: 87% Hormuz + 13% Malacca = TOTAL CUTOFF │
│ • South Korea: Both routes blocked = No alternatives        │
│ • India: Partial via overland but 60% at risk              │
│                                                             │
│ Countries at Critical Risk: 🇯🇵 🇰🇷 🇮🇳 🇹🇭 🇻🇳               │
│                                                             │
│ [Calculate Full Impact]  [Save Scenario]  [Export]          │
└─────────────────────────────────────────────────────────────┘
```

### Pre-Built Scenarios

```typescript
const PREBUILT_SCENARIOS: Scenario[] = [
  {
    id: 'taiwan-strait-crisis',
    name: 'Taiwan Strait Crisis',
    description: 'Full blockade of Taiwan Strait shipping',
    disruptions: [
      { assetId: 'taiwan_strait', disruptionLevel: 1.0 },
    ],
  },
  {
    id: 'hormuz-malacca-compound',
    name: 'Persian Gulf + Malacca Dual Blockade',
    description: 'Worst-case for Asian energy security',
    disruptions: [
      { assetId: 'hormuz', disruptionLevel: 1.0 },
      { assetId: 'malacca', disruptionLevel: 1.0 },
    ],
  },
  {
    id: 'mediterranean-cables',
    name: 'Mediterranean Cable Severing',
    description: 'Multiple cables cut in Eastern Mediterranean',
    disruptions: [
      { assetId: 'seamewe4', disruptionLevel: 1.0 },
      { assetId: 'seamewe5', disruptionLevel: 1.0 },
      { assetId: 'aae1', disruptionLevel: 1.0 },
    ],
  },
];
```

---

## User Comprehension Improvements

Make cascade visualization accessible to non-experts.

### Interactive Graph View

```typescript
interface GraphViewOptions {
  layout: 'hierarchical' | 'force' | 'geographic';
  showLabels: boolean;
  showImpactLevels: boolean;
  filterByImpact: 'all' | 'critical' | 'high' | 'medium';
  animateFlow: boolean;
}

// Allow users to switch between views
// - Geographic: Assets on map with lines
// - Hierarchical: Tree showing dependencies
// - Force: Network graph with clustering
```

### Legend & Glossary

```
┌─────────────────────────────────────────────────┐
│ CASCADE LEGEND                                  │
├─────────────────────────────────────────────────┤
│ IMPACT LEVELS                                   │
│ 🔴 Critical (>80%): Severe, immediate impact   │
│ 🟠 High (50-80%): Significant disruption       │
│ 🟡 Medium (20-50%): Notable but manageable     │
│ 🟢 Low (<20%): Minor or redundancy available   │
│                                                 │
│ LINE STYLES                                     │
│ ─── Solid: Active dependency                   │
│ - - Dashed: Redundancy/backup available        │
│ ═══ Double: Multiple dependencies              │
│                                                 │
│ ICONS                                           │
│ ⚡ Power infrastructure                         │
│ 🔌 Submarine cable                             │
│ 🛢️ Pipeline                                     │
│ ⚓ Port                                         │
│ 🌊 Chokepoint                                   │
└─────────────────────────────────────────────────┘
```

### Guided Tour Mode

For new users, provide interactive walkthrough:

```typescript
const CASCADE_TOUR_STEPS = [
  {
    target: '.cascade-source',
    content: 'This is the disrupted asset. The cascade shows what would be affected.',
    position: 'bottom',
  },
  {
    target: '.cascade-critical',
    content: 'Red items are critically dependent - they would be severely impacted.',
    position: 'right',
  },
  {
    target: '.cascade-redundant',
    content: 'Green dashed lines show backup routes that could absorb some impact.',
    position: 'left',
  },
  {
    target: '.cascade-depth-slider',
    content: 'Adjust this to show more or fewer levels of downstream effects.',
    position: 'top',
  },
];
```

---

## Open Questions (Updated)

1. ~~**How deep should cascades go?**~~ → Default 3, user configurable
2. ~~**Should we include financial centers as nodes?**~~ → Yes, as downstream dependents
3. **How to handle classified/sensitive dependency data?** (Some relationships are national security)
4. **Should cascade calculations be server-side?** (Complex graphs may need more compute)
5. ~~**How to visualize multiple simultaneous disruptions?**~~ → Scenario Builder implemented
6. **API for external consumers?** Allow embedding cascade analysis in other tools
7. **Collaboration features?** Allow teams to share/comment on scenarios

---

## References

- TeleGeography Submarine Cable Map (public data)
- Global Energy Monitor Pipeline Tracker
- EIA (US Energy Information Administration) - chokepoint data
- Lloyd's List Intelligence - port rankings
- NATO Infrastructure Protection Studies
- World Bank Infrastructure Database

---

*Document version: 2.0 | Author: Claude | Date: 2025-01-13 | Updated based on strategic review*
