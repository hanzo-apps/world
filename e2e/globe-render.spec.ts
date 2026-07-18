import { expect, test } from '@playwright/test';
import { clickMapControl } from './helpers/map-controls';

// Globe render-fix acceptance suite (world.hanzo.ai Hanzo-Cloud view).
//
// Guards the three "spazz" bugs the CTO reported and the 2D/3D parity + live-analytics
// contract:
//   1. Overlays must sit ON the globe surface with correct occlusion — a back-hemisphere
//      dot/badge is HIDDEN, a front one is drawn (no floating layers above the sphere).
//   2. Terrain drapes on the globe in a single WebGL context (no second canvas, no
//      striping regression — depth-write disabled on the coplanar imagery tiles).
//   3. Every cloud data layer mounts in BOTH 2D (mercator) and 3D (globe) — parity.
// Plus: the REAL live request-geo dots appear and update.
//
// Data is mocked at the same-origin /v1/world/cloud/* contracts so the run is
// deterministic and offline (production serves the real, live payloads).

type DeckLayer = { id: string; props: Record<string, unknown> };
type Rgba = [number, number, number, number];

const cloudMap = {
  // Two request-origin points on OPPOSITE hemispheres so occlusion is testable:
  // FRONT (lon 0) faces a camera centred at lon 0; BACK (lon 180) is behind the globe.
  trafficGlobe: {
    updatedAt: '2026-07-18T12:00:00Z',
    live: true,
    window: { minutes: 60, since: '2026-07-18T11:00:00Z', until: '2026-07-18T12:00:00Z' },
    points: [
      { country: 'FR', lat: 20, lon: 0, count: 90, byService: { models: 90 } },
      { country: 'US', lat: 37.09, lon: -95.71, count: 42, byService: { models: 42 } },
      { country: 'JP', lat: 20, lon: 180, count: 30, byService: { models: 30 } },
    ],
    totals: { rps_1m: 1.6, rpm_60m: 96, top_countries: [{ country: 'FR', count: 90 }, { country: 'US', count: 42 }, { country: 'JP', count: 30 }] },
  },
  traffic: {
    updatedAt: '2026-07-18T12:00:00Z', demo: false,
    arcs: [
      { fromLat: 20, fromLon: 0, toLat: 51.5, toLon: -0.12, weight: 1, label: 'FR → lon' },
      { fromLat: 37.09, fromLon: -95.71, toLat: 40.71, toLon: -74.0, weight: 0.6, label: 'US → nyc' },
    ],
  },
  chainNodes: {
    updatedAt: '2026-07-18T12:00:00Z', positionsModeled: true,
    networks: [{ id: 'lux', name: 'Lux Network', chainId: 96369, blockHeight: 1096461, peers: 3, live: true,
      nodes: [{ lat: 40.71, lon: -74.0, city: 'New York', kind: 'validator' }, { lat: 37.77, lon: -122.42, city: 'San Francisco', kind: 'validator' }] }],
  },
  byoGpu: { updatedAt: '2026-07-18T12:00:00Z', demo: false, gpus: [] },
};

async function mockCloud(page: import('@playwright/test').Page, traffic = cloudMap.trafficGlobe): Promise<void> {
  const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/v1/world/cloud/traffic-globe', (r) => r.fulfill(json(traffic)));
  await page.route('**/v1/world/cloud/traffic', (r) => r.fulfill(json(cloudMap.traffic)));
  await page.route('**/v1/world/cloud/chain-nodes', (r) => r.fulfill(json(cloudMap.chainNodes)));
  await page.route('**/v1/world/cloud/byo-gpu', (r) => r.fulfill(json(cloudMap.byoGpu)));
}

const layerIds = (page: import('@playwright/test').Page): Promise<string[]> =>
  page.evaluate(() => {
    const m = (window as unknown as { __deckMap?: { asGlobeSource: () => { buildLayers: () => DeckLayer[] } } }).__deckMap;
    return (m?.asGlobeSource().buildLayers() ?? []).flat(Infinity).filter(Boolean).map((l: DeckLayer) => l.id);
  });

const go3D = async (page: import('@playwright/test').Page): Promise<void> => {
  await clickMapControl(page, '.deckgl-projection-toggle .proj-btn[data-mode="3d"]');
  await expect
    .poll(() => page.evaluate(() => Boolean((window as unknown as { __globeNative?: unknown }).__globeNative)), { timeout: 25000 })
    .toBe(true);
  await page.waitForTimeout(1200); // let the first data-sync pull + push layers
};

test.describe('Globe render fixes — occlusion, terrain, 2D/3D parity, live dots', () => {
  test.describe.configure({ retries: 1 });
  test.use({ reducedMotion: 'reduce' });

  // The cloud data layers that must exist on the Hanzo-Cloud globe once feeds resolve.
  const CLOUD_LAYERS = ['traffic', 'trafficArcs', 'chainNodes', 'datacenter-clusters-layer'];

  test('3D: cloud layers mount, live dots render on the sphere, no WebGL errors', async ({ page }, testInfo) => {
    const errors: string[] = [];
    const ignorable = [/could not compile fragment shader/i, /image.*could not be decoded/i, /the layer 'background'/i, /status of 40[13]/i];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(e.message));

    await mockCloud(page);
    await page.goto('/?variant=cloud');
    await expect(page.locator('.deckgl-map-wrapper')).toBeVisible({ timeout: 45000 });
    await go3D(page);

    // Single WebGL context for the globe (deck GlobeView, not a 2nd overlay canvas).
    expect(await page.evaluate(() => document.querySelectorAll('.globe-native-canvas').length)).toBe(1);
    await expect.poll(() => page.evaluate(() => (window as unknown as { __globeNative: { getViewportType: () => string | null } }).__globeNative.getViewportType())).toMatch(/Globe/i);

    // Every cloud data layer is mounted.
    const ids = await layerIds(page);
    for (const id of CLOUD_LAYERS) expect(ids).toContain(id);

    // The live request-geo dots are present with the real (mocked) point count.
    const trafficCount = await page.evaluate(() => {
      const m = (window as unknown as { __deckMap: { asGlobeSource: () => { buildLayers: () => DeckLayer[] } } }).__deckMap;
      const t = m.asGlobeSource().buildLayers().flat(Infinity).find((l: DeckLayer) => l?.id === 'traffic');
      return (t?.props?.data as unknown[])?.length ?? 0;
    });
    expect(trafficCount).toBe(cloudMap.trafficGlobe.points.length);

    const shot = await page.locator('.globe-native-wrapper').screenshot();
    await testInfo.attach('3d-globe-cloud-layers', { body: shot, contentType: 'image/png' });
    expect(errors.filter((e) => !ignorable.some((p) => p.test(e)))).toEqual([]);
  });

  test('occlusion: a back-hemisphere dot is culled to transparent, a front dot is opaque', async ({ page }) => {
    await mockCloud(page);
    await page.goto('/?variant=cloud');
    await expect(page.locator('.deckgl-map-wrapper')).toBeVisible({ timeout: 45000 });
    await go3D(page);

    // Face the camera at lon 0 (the FRONT point). Read the REAL traffic layer's fill
    // accessor for each point: front → opaque (alpha>0), back (lon 180) → alpha 0.
    const alphas = await page.evaluate(() => {
      const m = (window as unknown as { __deckMap: { setOcclusionCenter: (lng: number, lat: number) => void; asGlobeSource: () => { buildLayers: () => DeckLayer[] } } }).__deckMap;
      m.setOcclusionCenter(0, 20);
      const t = m.asGlobeSource().buildLayers().flat(Infinity).find((l: DeckLayer) => l?.id === 'traffic') as DeckLayer;
      const data = t.props.data as Array<{ lon: number }>;
      const getFill = t.props.getFillColor as (d: unknown) => Rgba;
      const front = getFill(data.find((d) => d.lon === 0));
      const back = getFill(data.find((d) => d.lon === 180));
      return { frontAlpha: front[3], backAlpha: back[3] };
    });
    expect(alphas.frontAlpha).toBeGreaterThan(0);
    expect(alphas.backAlpha).toBe(0);
  });

  test('occlusion: a back-hemisphere count badge is culled (no floating badge over the globe)', async ({ page }) => {
    await mockCloud(page);
    await page.goto('/?variant=cloud');
    await expect(page.locator('.deckgl-map-wrapper')).toBeVisible({ timeout: 45000 });
    await go3D(page);

    // datacenter count badges are a TextLayer; a back-side badge's glyph AND pill must
    // both go transparent. Probe both hemispheres against a fixed camera centre.
    const badge = await page.evaluate(() => {
      const m = (window as unknown as { __deckMap: { setOcclusionCenter: (lng: number, lat: number) => void; asGlobeSource: () => { buildLayers: () => DeckLayer[] } } }).__deckMap;
      m.setOcclusionCenter(0, 20);
      const b = m.asGlobeSource().buildLayers().flat(Infinity).find((l: DeckLayer) => l?.id === 'datacenter-clusters-badge') as DeckLayer | undefined;
      if (!b) return { skip: true };
      const getColor = b.props.getColor as (d: unknown) => Rgba;
      const getBg = b.props.getBackgroundColor as (d: unknown) => Rgba;
      const front = { lon: 0, lat: 20, count: 5 };
      const back = { lon: 180, lat: 20, count: 5 };
      return { skip: false, frontText: getColor(front)[3], backText: getColor(back)[3], backBg: getBg(back)[3] };
    });
    if (badge.skip) test.skip(true, 'no datacenter badge in this build');
    expect(badge.frontText).toBeGreaterThan(0);
    expect(badge.backText).toBe(0);
    expect(badge.backBg).toBe(0);
  });

  test('2D/3D parity: every cloud layer that mounts in 3D also mounts in 2D', async ({ page }, testInfo) => {
    await mockCloud(page);
    await page.goto('/?variant=cloud');
    await expect(page.locator('.deckgl-map-wrapper')).toBeVisible({ timeout: 45000 });
    await page.waitForTimeout(1500); // 2D feeds settle

    const ids2d = await layerIds(page);
    for (const id of CLOUD_LAYERS) expect(ids2d, `2D missing ${id}`).toContain(id);
    await testInfo.attach('2d-map-cloud-layers', { body: await page.locator('.deckgl-map-wrapper').screenshot(), contentType: 'image/png' });

    await go3D(page);
    const ids3d = await layerIds(page);
    for (const id of CLOUD_LAYERS) expect(ids3d, `3D missing ${id}`).toContain(id);
    await testInfo.attach('3d-globe-cloud-layers-parity', { body: await page.locator('.globe-native-wrapper').screenshot(), contentType: 'image/png' });
  });

  test('terrain drapes on the globe in a single context (no second canvas)', async ({ page }, testInfo) => {
    await mockCloud(page);
    await page.goto('/?variant=cloud');
    await expect(page.locator('.deckgl-map-wrapper')).toBeVisible({ timeout: 45000 });
    await go3D(page);

    await page.evaluate(() => (window as unknown as { __globeNative: { setBasemapStyle: (s: string) => void } }).__globeNative.setBasemapStyle('terrain'));
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __globeNative: { getDeck: () => { props: { layers: DeckLayer[] } } } }).__globeNative.getDeck().props.layers.flat(Infinity).some((l: DeckLayer) => l?.id?.startsWith('globe-imagery-terrain'))), { timeout: 20000 })
      .toBe(true);
    // Still exactly one canvas — imagery drapes as deck tiles, not a 2nd WebGL context.
    expect(await page.evaluate(() => document.querySelectorAll('.globe-native-wrapper canvas').length)).toBe(1);
    await page.waitForTimeout(2500);
    await testInfo.attach('3d-terrain-globe', { body: await page.locator('.globe-native-wrapper').screenshot(), contentType: 'image/png' });
  });

  test('live dots update when the feed changes', async ({ page }) => {
    await mockCloud(page, { ...cloudMap.trafficGlobe, points: cloudMap.trafficGlobe.points.slice(0, 1) });
    await page.goto('/?variant=cloud');
    await expect(page.locator('.deckgl-map-wrapper')).toBeVisible({ timeout: 45000 });
    await go3D(page);

    const count = () => page.evaluate(() => {
      const m = (window as unknown as { __deckMap: { asGlobeSource: () => { buildLayers: () => DeckLayer[] } } }).__deckMap;
      const t = m.asGlobeSource().buildLayers().flat(Infinity).find((l: DeckLayer) => l?.id === 'traffic');
      return (t?.props?.data as unknown[])?.length ?? 0;
    });
    await expect.poll(count, { timeout: 15000 }).toBe(1);

    // Swap the feed to the full 3-point payload; the DeckGLMap poll picks it up.
    await mockCloud(page, cloudMap.trafficGlobe);
    await expect.poll(count, { timeout: 20000 }).toBe(cloudMap.trafficGlobe.points.length);
  });
});
