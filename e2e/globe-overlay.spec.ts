import { expect, test } from '@playwright/test';

// P0-1: deck.gl overlays must actually RENDER on the mapbox-gl v3 globe.
//
// The regression this guards: with interleaved:true, MapboxOverlay drew deck
// layers inside mapbox's projection pass, which does NOT reproject onto the
// globe — every overlay silently vanished in 3D (2D was fine). The fix flips the
// overlay to interleaved:false (overlaid), giving deck its own canvas + its own
// _GlobeView derived from the live map projection each frame.
//
// getDeckLayerSnapshot() (used by globe.spec) reads buildLayers() output and so
// passed EVEN WITH THE BUG. This spec instead asserts the renderer mechanism and
// a real on-globe pick — signals that are only true when layers reproject:
//   - the overlay is overlaid (interleaved === false) and owns its own canvas,
//   - deck's active viewport is a GlobeViewport in 3D (mercator in 2D),
//   - picking a seeded feature at its globe-projected screen point hits it.
// It exercises 2D→3D→2D round-trips and a live setStyle (theme swap).

type PickResult = { found: boolean; layerId: string | null };

type Harness = {
  ready: boolean;
  seedAllDynamicData: () => void;
  setZoom: (zoom: number) => void;
  setCamera: (camera: { lon: number; lat: number; zoom: number }) => void;
  setLayersForSnapshot: (layers: string[]) => void;
  setProjectionMode: (mode: '2d' | '3d') => void;
  getProjectionType: () => string;
  stopIdleSpin: () => void;
  getDeckInterleaved: () => boolean | null;
  getDeckCanvasCount: () => number;
  getDeckViewportType: () => string | null;
  getFirstHotspotLngLat: () => { lon: number; lat: number } | null;
  pickAtLonLat: (lon: number, lat: number, radius?: number) => PickResult;
};

type HarnessWindow = Window & {
  __mapHarness?: Harness;
  __mapboxMap?: unknown;
};

type Page = import('@playwright/test').Page;

const H = 'window.__mapHarness';

const ready = async (page: Page): Promise<void> => {
  await page.goto('/tests/map-harness.html');
  await expect(page.locator('.deckgl-map-wrapper')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => Boolean((window as HarnessWindow).__mapHarness?.ready)), {
      timeout: 45000,
    })
    .toBe(true);
  // Only the hotspots layer needs to be on; it is fed by the static INTEL_HOTSPOTS
  // config, so it is present regardless of any live data.
  await page.evaluate(() => {
    const w = (window as HarnessWindow).__mapHarness!;
    w.seedAllDynamicData();
    w.setLayersForSnapshot(['hotspots']);
    w.stopIdleSpin();
  });
};

const projection = (page: Page): Promise<string> =>
  page.evaluate(() => (window as HarnessWindow).__mapHarness?.getProjectionType() ?? 'mercator');

const viewportType = (page: Page): Promise<string | null> =>
  page.evaluate(() => (window as HarnessWindow).__mapHarness?.getDeckViewportType() ?? null);

// Centre on the seeded hotspot, freeze the spin, then pick it. Picking succeeds
// only if the layer is actually rendered AND projected at that screen location.
const pickHotspot = async (page: Page): Promise<PickResult> => {
  return page.evaluate(() => {
    const w = (window as HarnessWindow).__mapHarness!;
    const hs = w.getFirstHotspotLngLat();
    if (!hs) return { found: false, layerId: null };
    w.setCamera({ lon: hs.lon, lat: hs.lat, zoom: 3 });
    w.stopIdleSpin();
    return w.pickAtLonLat(hs.lon, hs.lat, 12);
  });
};

const pollPickFound = async (page: Page): Promise<void> => {
  await expect
    .poll(async () => (await pickHotspot(page)).found, { timeout: 20000 })
    .toBe(true);
};

test.describe('P0-1 deck overlay renders on the globe', () => {
  test.describe.configure({ retries: 1 });
  test.use({ reducedMotion: 'reduce' });

  test('overlaid mode; GlobeViewport in 3D; feature picks on the sphere; survives round-trips + setStyle', async ({
    page,
  }, testInfo) => {
    const pageErrors: string[] = [];
    const ignorable = [/could not compile fragment shader/i, /image.*could not be decoded/i];
    page.on('pageerror', (e) => pageErrors.push(e.message));

    await ready(page);

    // The overlay is OVERLAID (the fix), not interleaved, and owns its own canvas.
    expect(await page.evaluate(() => (window as HarnessWindow).__mapHarness!.getDeckInterleaved())).toBe(false);
    expect(await page.evaluate(() => (window as HarnessWindow).__mapHarness!.getDeckCanvasCount())).toBeGreaterThanOrEqual(2);

    // 2D baseline: mercator viewport + pickable dot.
    expect(await projection(page)).toBe('mercator');
    await expect.poll(() => viewportType(page)).toMatch(/Mercator|Web/i);
    await pollPickFound(page);

    // → 3D globe. Deck's active viewport must be a GlobeViewport (proves deck is
    // reprojecting onto the sphere) and the dot must still pick on the globe.
    await page.locator('.deckgl-projection-toggle .proj-btn[data-mode="3d"]').click();
    await expect.poll(() => projection(page), { timeout: 30000 }).toBe('globe');
    await page.evaluate(() => (window as HarnessWindow).__mapHarness!.stopIdleSpin());
    await expect.poll(() => viewportType(page), { timeout: 20000 }).toMatch(/Globe/i);
    await pollPickFound(page);

    // Screenshot the dots on the sphere (the CTO-facing proof).
    await page.evaluate(() => {
      const w = (window as HarnessWindow).__mapHarness!;
      const hs = w.getFirstHotspotLngLat();
      if (hs) w.setCamera({ lon: hs.lon, lat: hs.lat, zoom: 2.2 });
      w.stopIdleSpin();
    });
    await page.waitForTimeout(600);
    const shot = await page.locator('.deckgl-map-wrapper').screenshot();
    await testInfo.attach('globe-3d-dots', { body: shot, contentType: 'image/png' });

    // Round-trip 2D → 3D again; picks must survive each transition.
    await page.locator('.deckgl-projection-toggle .proj-btn[data-mode="2d"]').click();
    await expect.poll(() => projection(page), { timeout: 20000 }).toBe('mercator');
    await pollPickFound(page);
    await page.locator('.deckgl-projection-toggle .proj-btn[data-mode="3d"]').click();
    await expect.poll(() => projection(page), { timeout: 20000 }).toBe('globe');
    await page.evaluate(() => (window as HarnessWindow).__mapHarness!.stopIdleSpin());
    await pollPickFound(page);

    // setStyle: a full basemap swap (theme change) clears mapbox sources but the
    // overlaid deck lives outside the style, so its layers must survive.
    await page.evaluate(() =>
      window.dispatchEvent(new CustomEvent('theme-changed', { detail: { theme: 'light' } })),
    );
    await page.waitForTimeout(1500); // style.load + re-applied projection/atmosphere
    await page.evaluate(() => (window as HarnessWindow).__mapHarness!.stopIdleSpin());
    expect(await page.evaluate(() => (window as HarnessWindow).__mapHarness!.getDeckInterleaved())).toBe(false);
    await pollPickFound(page);

    expect(pageErrors.filter((e) => !ignorable.some((p) => p.test(e)))).toEqual([]);
  });
});
