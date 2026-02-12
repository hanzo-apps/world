import 'maplibre-gl/dist/maplibre-gl.css';
import '../styles/main.css';
import { DeckGLMap } from '../components/DeckGLMap';
import type { MapLayers, SocialUnrestEvent } from '../types';

type Scenario = 'alpha' | 'beta';

type MapHarness = {
  ready: boolean;
  setProtestsScenario: (scenario: Scenario) => void;
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

const baseLayers: MapLayers = {
  conflicts: true,
  bases: true,
  cables: true,
  pipelines: true,
  hotspots: true,
  ais: false,
  nuclear: true,
  irradiators: true,
  sanctions: true,
  weather: false,
  economic: true,
  waterways: true,
  outages: false,
  datacenters: true,
  protests: true,
  flights: false,
  military: false,
  natural: false,
  spaceports: true,
  minerals: true,
  fires: false,
  startupHubs: false,
  cloudRegions: false,
  accelerators: false,
  techHQs: false,
  techEvents: false,
};

const map = new DeckGLMap(app, {
  zoom: 2,
  pan: { x: 0, y: 0 },
  view: 'global',
  layers: baseLayers,
  timeRange: '24h',
});

const buildProtests = (scenario: Scenario): SocialUnrestEvent[] => {
  const title =
    scenario === 'alpha' ? 'Scenario Alpha Protest' : 'Scenario Beta Protest';
  const baseTime = scenario === 'alpha'
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

map.setProtests(buildProtests('alpha'));

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
  lastClusterState?: Map<string, unknown>;
};

window.__mapHarness = {
  get ready() {
    return ready;
  },
  setProtestsScenario: (scenario: Scenario): void => {
    map.setProtests(buildProtests(scenario));
  },
  getClusterStateSize: (): number => {
    return internals.lastClusterState?.size ?? -1;
  },
  destroy: (): void => {
    map.destroy();
  },
};
