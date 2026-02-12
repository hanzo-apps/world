import 'maplibre-gl/dist/maplibre-gl.css';
import '../styles/main.css';
import { DeckGLMap } from '../components/DeckGLMap';
import { SITE_VARIANT } from '../config';
import type {
  AisDensityZone,
  AisDisruptionEvent,
  AirportDelayAlert,
  CableAdvisory,
  Earthquake,
  InternetOutage,
  MapLayers,
  MilitaryFlight,
  MilitaryFlightCluster,
  MilitaryVessel,
  MilitaryVesselCluster,
  NaturalEvent,
  RepairShip,
  SocialUnrestEvent,
} from '../types';
import type { WeatherAlert } from '../services/weather';

type Scenario = 'alpha' | 'beta';

type LayerSnapshot = {
  id: string;
  dataCount: number;
};

type OverlaySnapshot = {
  protestMarkers: number;
  datacenterMarkers: number;
  techEventMarkers: number;
  techHQMarkers: number;
};

type MapHarness = {
  ready: boolean;
  variant: string;
  seedAllDynamicData: () => void;
  setProtestsScenario: (scenario: Scenario) => void;
  setZoom: (zoom: number) => void;
  getDeckLayerSnapshot: () => LayerSnapshot[];
  getOverlaySnapshot: () => OverlaySnapshot;
  getClusterStateSize: () => number;
  destroy: () => void;
};

declare global {
  interface Window {
    __mapHarness?: MapHarness;
  }
}

const app = document.getElementById('app');
if (!app) {
  throw new Error('Missing #app container for map harness');
}

app.style.width = '100vw';
app.style.height = '100vh';
app.style.position = 'relative';

const allLayersEnabled: MapLayers = {
  conflicts: true,
  bases: true,
  cables: true,
  pipelines: true,
  hotspots: true,
  ais: true,
  nuclear: true,
  irradiators: true,
  sanctions: true,
  weather: true,
  economic: true,
  waterways: true,
  outages: true,
  datacenters: true,
  protests: true,
  flights: true,
  military: true,
  natural: true,
  spaceports: true,
  minerals: true,
  fires: true,
  startupHubs: true,
  cloudRegions: true,
  accelerators: true,
  techHQs: true,
  techEvents: true,
};

const map = new DeckGLMap(app, {
  zoom: 5,
  pan: { x: 0, y: 0 },
  view: 'global',
  layers: allLayersEnabled,
  timeRange: '24h',
});

const buildProtests = (scenario: Scenario): SocialUnrestEvent[] => {
  const title =
    scenario === 'alpha' ? 'Scenario Alpha Protest' : 'Scenario Beta Protest';
  const baseTime =
    scenario === 'alpha'
      ? new Date('2026-02-01T12:00:00.000Z')
      : new Date('2026-02-01T13:00:00.000Z');

  return [
    {
      id: `e2e-protest-${scenario}`,
      title,
      summary: `${title} summary`,
      eventType: 'riot',
      city: 'Harness City',
      country: 'Harnessland',
      lat: 20.1,
      lon: 0.2,
      time: baseTime,
      severity: 'high',
      fatalities: scenario === 'alpha' ? 1 : 2,
      sources: ['e2e'],
      sourceType: 'rss',
      tags: ['e2e'],
      actors: ['Harness Group'],
      relatedHotspots: [],
      confidence: 'high',
      validated: true,
    },
  ];
};

const seedAllDynamicData = (): void => {
  const earthquakes: Earthquake[] = [
    {
      id: 'e2e-eq-1',
      place: 'Harness Fault',
      magnitude: 5.8,
      lat: 34.1,
      lon: -118.2,
      depth: 12,
      time: new Date('2026-02-01T10:00:00.000Z'),
      url: 'https://example.com/eq',
    },
  ];

  const weather: WeatherAlert[] = [
    {
      id: 'e2e-weather-1',
      event: 'Storm Warning',
      severity: 'Severe',
      headline: 'Harness Weather Alert',
      description: 'Severe storm conditions expected in harness region.',
      areaDesc: 'Harness Region',
      onset: new Date('2026-02-01T09:00:00.000Z'),
      expires: new Date('2026-02-01T18:00:00.000Z'),
      coordinates: [[-80.1, 25.7], [-80.2, 25.8], [-80.3, 25.6]],
      centroid: [-80.2, 25.7],
    },
  ];

  const outages: InternetOutage[] = [
    {
      id: 'e2e-outage-1',
      title: 'Harness Network Degradation',
      link: 'https://example.com/outage',
      description: 'Network disruption for test coverage.',
      pubDate: new Date('2026-02-01T11:00:00.000Z'),
      country: 'Harnessland',
      lat: 51.5,
      lon: -0.1,
      severity: 'major',
      categories: ['connectivity'],
    },
  ];

  const aisDisruptions: AisDisruptionEvent[] = [
    {
      id: 'e2e-ais-disruption-1',
      name: 'Harness Chokepoint',
      type: 'chokepoint_congestion',
      lat: 25.0,
      lon: 55.0,
      severity: 'high',
      changePct: 34,
      windowHours: 6,
      vesselCount: 61,
      description: 'High congestion detected for coverage.',
    },
  ];

  const aisDensity: AisDensityZone[] = [
    {
      id: 'e2e-ais-density-1',
      name: 'Harness Density Zone',
      lat: 24.8,
      lon: 54.9,
      intensity: 0.8,
      deltaPct: 22,
      shipsPerDay: 230,
    },
  ];

  const cableAdvisories: CableAdvisory[] = [
    {
      id: 'e2e-cable-adv-1',
      cableId: 'sea-me-we-5',
      title: 'Harness Cable Fault',
      severity: 'fault',
      description: 'Fiber disruption under investigation.',
      reported: new Date('2026-02-01T08:00:00.000Z'),
      lat: 12.2,
      lon: 45.2,
      impact: 'Regional latency increase',
      repairEta: '24h',
    },
  ];

  const repairShips: RepairShip[] = [
    {
      id: 'e2e-repair-1',
      name: 'Harness Repair Vessel',
      cableId: 'sea-me-we-5',
      status: 'enroute',
      lat: 12.5,
      lon: 45.1,
      eta: '2026-02-02T00:00:00Z',
      note: 'En route to suspected break location.',
    },
  ];

  const flightDelays: AirportDelayAlert[] = [
    {
      id: 'e2e-flight-1',
      iata: 'HNS',
      icao: 'EHNS',
      name: 'Harness International',
      city: 'Harness City',
      country: 'Harnessland',
      lat: 40.4,
      lon: -73.9,
      region: 'americas',
      delayType: 'ground_delay',
      severity: 'major',
      avgDelayMinutes: 48,
      reason: 'Severe weather',
      source: 'computed',
      updatedAt: new Date('2026-02-01T11:00:00.000Z'),
    },
  ];

  const militaryFlights: MilitaryFlight[] = [
    {
      id: 'e2e-mil-flight-1',
      callsign: 'HARN01',
      hexCode: 'abc123',
      aircraftType: 'fighter',
      operator: 'usaf',
      operatorCountry: 'US',
      lat: 33.9,
      lon: -117.9,
      altitude: 30000,
      heading: 92,
      speed: 430,
      onGround: false,
      lastSeen: new Date('2026-02-01T11:00:00.000Z'),
      confidence: 'high',
    },
  ];

  const militaryFlightClusters: MilitaryFlightCluster[] = [
    {
      id: 'e2e-mil-flight-cluster-1',
      name: 'Harness Air Cluster',
      lat: 34.0,
      lon: -118.0,
      flightCount: 3,
      flights: militaryFlights,
      activityType: 'exercise',
    },
  ];

  const militaryVessels: MilitaryVessel[] = [
    {
      id: 'e2e-mil-vessel-1',
      mmsi: '123456789',
      name: 'Harness Destroyer',
      vesselType: 'destroyer',
      operator: 'usn',
      operatorCountry: 'US',
      lat: 26.2,
      lon: 56.4,
      heading: 145,
      speed: 18,
      lastAisUpdate: new Date('2026-02-01T11:00:00.000Z'),
      confidence: 'high',
    },
  ];

  const militaryVesselClusters: MilitaryVesselCluster[] = [
    {
      id: 'e2e-mil-vessel-cluster-1',
      name: 'Harness Naval Group',
      lat: 26.1,
      lon: 56.3,
      vesselCount: 4,
      vessels: militaryVessels,
      activityType: 'deployment',
    },
  ];

  const naturalEvents: NaturalEvent[] = [
    {
      id: 'e2e-natural-1',
      title: '🔴 Harness Volcano Activity',
      category: 'volcanoes',
      categoryTitle: 'Volcano',
      lat: 14.7,
      lon: -90.9,
      date: new Date('2026-02-01T06:00:00.000Z'),
      closed: false,
    },
  ];

  map.setLayers(allLayersEnabled);
  map.setZoom(5);
  map.setEarthquakes(earthquakes);
  map.setWeatherAlerts(weather);
  map.setOutages(outages);
  map.setAisData(aisDisruptions, aisDensity);
  map.setCableActivity(cableAdvisories, repairShips);
  map.setProtests(buildProtests('alpha'));
  map.setFlightDelays(flightDelays);
  map.setMilitaryFlights(militaryFlights, militaryFlightClusters);
  map.setMilitaryVessels(militaryVessels, militaryVesselClusters);
  map.setNaturalEvents(naturalEvents);
  map.setFires([
    {
      lat: -5.4,
      lon: -60.1,
      brightness: 420,
      frp: 180,
      confidence: 0.95,
      region: 'Harness Fire Region',
      acq_date: '2026-02-01',
      daynight: 'D',
    },
  ]);
  map.setTechEvents([
    {
      id: 'e2e-tech-event-1',
      title: 'Harness Summit Alpha',
      location: 'Harness City',
      lat: 37.77,
      lng: -122.42,
      country: 'US',
      startDate: '2026-03-10',
      endDate: '2026-03-12',
      url: 'https://example.com/alpha',
      daysUntil: 20,
    },
    {
      id: 'e2e-tech-event-2',
      title: 'Harness Summit Beta',
      location: 'Harness City',
      lat: 37.77,
      lng: -122.42,
      country: 'US',
      startDate: '2026-04-01',
      endDate: '2026-04-02',
      url: 'https://example.com/beta',
      daysUntil: 42,
    },
  ]);
  map.setNewsLocations([
    {
      lat: 48.85,
      lon: 2.35,
      title: 'Harness News Item',
      threatLevel: 'high',
    },
  ]);
};

seedAllDynamicData();

let ready = false;
const pollReady = (): void => {
  if (document.querySelector('#deckgl-basemap canvas')) {
    ready = true;
    return;
  }
  requestAnimationFrame(pollReady);
};
pollReady();

const internals = map as unknown as {
  buildLayers?: () => Array<{ id: string; props?: { data?: unknown } }>;
  lastClusterState?: Map<string, unknown>;
};

const getDataCount = (data: unknown): number => {
  if (Array.isArray(data)) return data.length;
  if (
    data &&
    typeof data === 'object' &&
    'type' in data &&
    (data as { type?: string }).type === 'FeatureCollection' &&
    'features' in data &&
    Array.isArray((data as { features?: unknown[] }).features)
  ) {
    return (data as { features: unknown[] }).features.length;
  }
  if (
    data &&
    typeof data === 'object' &&
    'length' in data &&
    typeof (data as { length?: unknown }).length === 'number'
  ) {
    return Number((data as { length: number }).length);
  }
  return data ? 1 : 0;
};

window.__mapHarness = {
  get ready() {
    return ready;
  },
  variant: SITE_VARIANT,
  seedAllDynamicData,
  setProtestsScenario: (scenario: Scenario): void => {
    map.setProtests(buildProtests(scenario));
  },
  setZoom: (zoom: number): void => {
    map.setZoom(zoom);
    map.render();
  },
  getDeckLayerSnapshot: (): LayerSnapshot[] => {
    const layers = internals.buildLayers?.() ?? [];
    return layers.map((layer) => ({
      id: layer.id,
      dataCount: getDataCount(layer.props?.data),
    }));
  },
  getOverlaySnapshot: (): OverlaySnapshot => ({
    protestMarkers: document.querySelectorAll('.protest-marker').length,
    datacenterMarkers: document.querySelectorAll('.datacenter-marker').length,
    techEventMarkers: document.querySelectorAll('.tech-event-marker').length,
    techHQMarkers: document.querySelectorAll('.tech-hq-marker').length,
  }),
  getClusterStateSize: (): number => {
    return internals.lastClusterState?.size ?? -1;
  },
  destroy: (): void => {
    map.destroy();
  },
};
