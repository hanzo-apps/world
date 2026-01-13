import type {
  InfrastructureNode,
  DependencyEdge,
  CascadeResult,
  CascadeAffectedNode,
  CascadeCountryImpact,
  CascadeImpactLevel,
  UnderseaCable,
  Pipeline,
} from '@/types';
import type { Port } from '@/config/ports';
import { UNDERSEA_CABLES, STRATEGIC_WATERWAYS } from '@/config/geo';
import { PIPELINES } from '@/config/pipelines';
import { PORTS } from '@/config/ports';

// Country name lookup
const COUNTRY_NAMES: Record<string, string> = {
  US: 'United States', GB: 'United Kingdom', ES: 'Spain', FR: 'France',
  DE: 'Germany', IT: 'Italy', PT: 'Portugal', NO: 'Norway', DK: 'Denmark',
  NL: 'Netherlands', BE: 'Belgium', SE: 'Sweden', FI: 'Finland', IE: 'Ireland',
  AT: 'Austria', CH: 'Switzerland', GR: 'Greece', CZ: 'Czech Republic',
  JP: 'Japan', CN: 'China', TW: 'Taiwan', HK: 'Hong Kong', SG: 'Singapore',
  KR: 'South Korea', AU: 'Australia', NZ: 'New Zealand', IN: 'India', PK: 'Pakistan',
  AE: 'UAE', SA: 'Saudi Arabia', EG: 'Egypt', KW: 'Kuwait', BH: 'Bahrain',
  OM: 'Oman', QA: 'Qatar', IR: 'Iran', IQ: 'Iraq', TR: 'Turkey', IL: 'Israel',
  JO: 'Jordan', LB: 'Lebanon', SY: 'Syria', YE: 'Yemen',
  NG: 'Nigeria', ZA: 'South Africa', KE: 'Kenya', TZ: 'Tanzania',
  MZ: 'Mozambique', MG: 'Madagascar', SN: 'Senegal', GH: 'Ghana',
  CI: 'Ivory Coast', AO: 'Angola', ET: 'Ethiopia', UG: 'Uganda',
  BR: 'Brazil', AR: 'Argentina', CL: 'Chile',
  PE: 'Peru', CO: 'Colombia', MX: 'Mexico', PA: 'Panama', VE: 'Venezuela',
  IS: 'Iceland', FO: 'Faroe Islands', FJ: 'Fiji', ID: 'Indonesia',
  VN: 'Vietnam', TH: 'Thailand', MY: 'Malaysia', PH: 'Philippines',
  RU: 'Russia', UA: 'Ukraine', PL: 'Poland', RO: 'Romania', HU: 'Hungary',
  CA: 'Canada', DJ: 'Djibouti', BD: 'Bangladesh', LK: 'Sri Lanka', MM: 'Myanmar',
};

export interface DependencyGraph {
  nodes: Map<string, InfrastructureNode>;
  edges: DependencyEdge[];
  outgoing: Map<string, DependencyEdge[]>;
  incoming: Map<string, DependencyEdge[]>;
}

let cachedGraph: DependencyGraph | null = null;

export function clearGraphCache(): void {
  cachedGraph = null;
}

function addCablesAsNodes(graph: DependencyGraph): void {
  for (const cable of UNDERSEA_CABLES) {
    const firstPoint = cable.points?.[0];
    graph.nodes.set(`cable:${cable.id}`, {
      id: `cable:${cable.id}`,
      type: 'cable',
      name: cable.name,
      coordinates: firstPoint ? [firstPoint[0], firstPoint[1]] : undefined,
      metadata: {
        capacityTbps: cable.capacityTbps,
        rfsYear: cable.rfsYear,
        owners: cable.owners,
        landingPoints: cable.landingPoints,
      },
    });
  }
}

function addPipelinesAsNodes(graph: DependencyGraph): void {
  for (const pipeline of PIPELINES) {
    const firstPoint = pipeline.points?.[0];
    graph.nodes.set(`pipeline:${pipeline.id}`, {
      id: `pipeline:${pipeline.id}`,
      type: 'pipeline',
      name: pipeline.name,
      coordinates: firstPoint ? [firstPoint[0], firstPoint[1]] : undefined,
      metadata: {
        type: pipeline.type,
        status: pipeline.status,
        capacity: pipeline.capacity,
        operator: pipeline.operator,
        countries: pipeline.countries,
      },
    });
  }
}

function addPortsAsNodes(graph: DependencyGraph): void {
  for (const port of PORTS) {
    graph.nodes.set(`port:${port.id}`, {
      id: `port:${port.id}`,
      type: 'port',
      name: port.name,
      coordinates: [port.lon, port.lat],
      metadata: {
        country: port.country,
        type: port.type,
        rank: port.rank,
      },
    });
  }
}

function addChokepointsAsNodes(graph: DependencyGraph): void {
  for (const waterway of STRATEGIC_WATERWAYS) {
    graph.nodes.set(`chokepoint:${waterway.id}`, {
      id: `chokepoint:${waterway.id}`,
      type: 'chokepoint',
      name: waterway.name,
      coordinates: [waterway.lon, waterway.lat],
      metadata: {
        description: waterway.description,
      },
    });
  }
}

function addCountriesAsNodes(graph: DependencyGraph): void {
  const countries = new Set<string>();

  for (const cable of UNDERSEA_CABLES) {
    cable.countriesServed?.forEach(c => countries.add(c.country));
    cable.landingPoints?.forEach(lp => countries.add(lp.country));
  }

  for (const pipeline of PIPELINES) {
    pipeline.countries?.forEach(c => {
      const code = c === 'USA' ? 'US' : c === 'Canada' ? 'CA' : c;
      countries.add(code);
    });
  }

  for (const code of countries) {
    graph.nodes.set(`country:${code}`, {
      id: `country:${code}`,
      type: 'country',
      name: COUNTRY_NAMES[code] || code,
      metadata: { code },
    });
  }
}

function addEdge(graph: DependencyGraph, edge: DependencyEdge): void {
  graph.edges.push(edge);

  if (!graph.outgoing.has(edge.from)) graph.outgoing.set(edge.from, []);
  graph.outgoing.get(edge.from)!.push(edge);

  if (!graph.incoming.has(edge.to)) graph.incoming.set(edge.to, []);
  graph.incoming.get(edge.to)!.push(edge);
}

function buildCableCountryEdges(graph: DependencyGraph): void {
  for (const cable of UNDERSEA_CABLES) {
    const cableId = `cable:${cable.id}`;

    cable.countriesServed?.forEach(cs => {
      const countryId = `country:${cs.country}`;
      addEdge(graph, {
        from: cableId,
        to: countryId,
        type: 'serves',
        strength: cs.capacityShare,
        redundancy: cs.isRedundant ? 0.5 : 0,
        metadata: {
          capacityShare: cs.capacityShare,
          estimatedImpact: cs.isRedundant ? 'Medium - redundancy available' : 'High - limited redundancy',
        },
      });
    });

    cable.landingPoints?.forEach(lp => {
      const countryId = `country:${lp.country}`;
      addEdge(graph, {
        from: cableId,
        to: countryId,
        type: 'lands_at',
        strength: 0.3,
        redundancy: 0.5,
      });
    });
  }
}

function buildPipelineCountryEdges(graph: DependencyGraph): void {
  for (const pipeline of PIPELINES) {
    const pipelineId = `pipeline:${pipeline.id}`;

    pipeline.countries?.forEach(country => {
      const code = country === 'USA' ? 'US' : country === 'Canada' ? 'CA' : country;
      const countryId = `country:${code}`;

      if (graph.nodes.has(countryId)) {
        addEdge(graph, {
          from: pipelineId,
          to: countryId,
          type: 'serves',
          strength: 0.2,
          redundancy: 0.3,
        });
      }
    });
  }
}

export function buildDependencyGraph(): DependencyGraph {
  if (cachedGraph) return cachedGraph;

  const graph: DependencyGraph = {
    nodes: new Map(),
    edges: [],
    outgoing: new Map(),
    incoming: new Map(),
  };

  addCablesAsNodes(graph);
  addPipelinesAsNodes(graph);
  addPortsAsNodes(graph);
  addChokepointsAsNodes(graph);
  addCountriesAsNodes(graph);

  buildCableCountryEdges(graph);
  buildPipelineCountryEdges(graph);

  cachedGraph = graph;
  return graph;
}

function categorizeImpact(strength: number): CascadeImpactLevel {
  if (strength > 0.8) return 'critical';
  if (strength > 0.5) return 'high';
  if (strength > 0.2) return 'medium';
  return 'low';
}

export function calculateCascade(
  sourceId: string,
  disruptionLevel: number = 1.0
): CascadeResult | null {
  const graph = buildDependencyGraph();
  const source = graph.nodes.get(sourceId);

  if (!source) return null;

  const affected: Map<string, CascadeAffectedNode> = new Map();
  const visited = new Set<string>();
  visited.add(sourceId);

  const queue: { nodeId: string; depth: number; path: string[] }[] = [
    { nodeId: sourceId, depth: 0, path: [sourceId] },
  ];

  while (queue.length > 0) {
    const { nodeId, depth, path } = queue.shift()!;
    if (depth >= 3) continue;

    const dependents = graph.outgoing.get(nodeId) || [];

    for (const edge of dependents) {
      if (visited.has(edge.to)) continue;
      visited.add(edge.to);

      const impactStrength = edge.strength * disruptionLevel * (1 - (edge.redundancy || 0));
      const targetNode = graph.nodes.get(edge.to);

      if (!targetNode || impactStrength < 0.05) continue;

      affected.set(edge.to, {
        node: targetNode,
        impactLevel: categorizeImpact(impactStrength),
        pathLength: depth + 1,
        dependencyChain: [...path, edge.to],
        redundancyAvailable: (edge.redundancy || 0) > 0.3,
        estimatedRecovery: edge.metadata?.estimatedImpact,
      });

      queue.push({
        nodeId: edge.to,
        depth: depth + 1,
        path: [...path, edge.to],
      });
    }
  }

  const countriesAffected: CascadeCountryImpact[] = [];
  for (const [nodeId, affectedNode] of affected) {
    if (affectedNode.node.type === 'country') {
      const code = (affectedNode.node.metadata?.code as string) || nodeId.replace('country:', '');
      countriesAffected.push({
        country: code,
        countryName: affectedNode.node.name,
        impactLevel: affectedNode.impactLevel,
        affectedCapacity: getCapacityForCountry(sourceId, code),
      });
    }
  }

  countriesAffected.sort((a, b) => {
    const order = { critical: 0, high: 1, medium: 2, low: 3 };
    return (order[a.impactLevel] - order[b.impactLevel]) || (b.affectedCapacity - a.affectedCapacity);
  });

  const redundancies = findRedundancies(sourceId);

  return {
    source,
    affectedNodes: Array.from(affected.values()),
    countriesAffected,
    redundancies,
  };
}

function getCapacityForCountry(sourceId: string, countryCode: string): number {
  if (sourceId.startsWith('cable:')) {
    const cableId = sourceId.replace('cable:', '');
    const cable = UNDERSEA_CABLES.find(c => c.id === cableId);
    const countryData = cable?.countriesServed?.find(cs => cs.country === countryCode);
    return countryData?.capacityShare || 0;
  }
  return 0.1;
}

function findRedundancies(sourceId: string): CascadeResult['redundancies'] {
  if (!sourceId.startsWith('cable:')) return [];

  const cableId = sourceId.replace('cable:', '');
  const sourceCable = UNDERSEA_CABLES.find(c => c.id === cableId);
  if (!sourceCable) return [];

  const sourceCountries = new Set(sourceCable.countriesServed?.map(c => c.country) || []);
  const alternatives: CascadeResult['redundancies'] = [];

  for (const cable of UNDERSEA_CABLES) {
    if (cable.id === cableId) continue;

    const sharedCountries = cable.countriesServed?.filter(c => sourceCountries.has(c.country)) || [];
    if (sharedCountries.length > 0) {
      const avgCapacity = sharedCountries.reduce((sum, c) => sum + c.capacityShare, 0) / sharedCountries.length;
      alternatives.push({
        id: cable.id,
        name: cable.name,
        capacityShare: avgCapacity,
      });
    }
  }

  return alternatives.slice(0, 5);
}

export function getCableById(id: string): UnderseaCable | undefined {
  return UNDERSEA_CABLES.find(c => c.id === id);
}

export function getPipelineById(id: string): Pipeline | undefined {
  return PIPELINES.find(p => p.id === id);
}

export function getPortById(id: string): Port | undefined {
  return PORTS.find((p: Port) => p.id === id);
}

export function getGraphStats(): { nodes: number; edges: number; cables: number; pipelines: number; countries: number } {
  const graph = buildDependencyGraph();
  let cables = 0, pipelines = 0, countries = 0;

  for (const node of graph.nodes.values()) {
    if (node.type === 'cable') cables++;
    else if (node.type === 'pipeline') pipelines++;
    else if (node.type === 'country') countries++;
  }

  return {
    nodes: graph.nodes.size,
    edges: graph.edges.length,
    cables,
    pipelines,
    countries,
  };
}
