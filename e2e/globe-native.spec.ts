import { expect, test } from '@playwright/test';

// Native deck.gl GlobeView (GlobeNative) — the pure-deck 3D globe that replaces the
// mapbox globe behind the ?globe=native flag.
//
// This guards the structural perf + correctness contract that a headless GPU CAN
// verify:
//   - the mode activates from the ?globe=native flag,
//   - the whole page holds exactly ONE WebGL context (no mapbox, no overlay) — the
//     single-context perf target,
//   - deck's active viewport is a GlobeViewport (proves it's reprojecting onto the
//     sphere, not a flat map),
//   - a seeded hotspot picks at its globe-projected screen point (layers render AND
//     reproject on the sphere).

type PickResult = { found: boolean; layerId: string | null };

type GlobeHarness = {
  ready: boolean;
  nativeEnabled: boolean;
  getCanvasCount: () => number;
  getViewportType: () => string | null;
  getFirstHotspotLngLat: () => { lon: number; lat: number } | null;
  setCamera: (lon: number, lat: number, zoom: number) => void;
  stopSpin: () => void;
  pickAtLonLat: (lon: number, lat: number, radius?: number) => PickResult;
  destroy: () => void;
};

type HarnessWindow = Window & { __globeHarness?: GlobeHarness };
type Page = import('@playwright/test').Page;

const ready = async (page: Page, query: string): Promise<void> => {
  await page.goto(`/tests/globe-native-harness.html${query}`);
  await expect(page.locator('.globe-native-wrapper')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => Boolean((window as HarnessWindow).__globeHarness?.ready)), {
      timeout: 45000,
    })
    .toBe(true);
};

const pickHotspot = async (page: Page): Promise<PickResult> =>
  page.evaluate(() => {
    const w = (window as HarnessWindow).__globeHarness!;
    const hs = w.getFirstHotspotLngLat();
    if (!hs) return { found: false, layerId: null };
    w.setCamera(hs.lon, hs.lat, 3);
    w.stopSpin();
    return w.pickAtLonLat(hs.lon, hs.lat, 12);
  });

test.describe('native deck.gl GlobeView', () => {
  test.describe.configure({ retries: 1 });
  test.use({ reducedMotion: 'reduce' });

  test('flag activates; single WebGL context; GlobeViewport; hotspot picks on the sphere', async ({
    page,
  }, testInfo) => {
    const pageErrors: string[] = [];
    const ignorable = [/could not compile fragment shader/i, /image.*could not be decoded/i];
    page.on('pageerror', (e) => pageErrors.push(e.message));

    await ready(page, '?globe=native');

    // The flag helper the app routes on reads native from ?globe=native.
    expect(
      await page.evaluate(() => (window as HarnessWindow).__globeHarness!.nativeEnabled),
    ).toBe(true);

    // Single WebGL context: exactly one <canvas> on the whole page (no mapbox basemap
    // canvas, no deck overlay canvas — just GlobeNative's).
    expect(await page.evaluate(() => document.querySelectorAll('canvas').length)).toBe(1);
    expect(
      await page.evaluate(() => (window as HarnessWindow).__globeHarness!.getCanvasCount()),
    ).toBe(1);

    // Active viewport is a GlobeViewport (deck is reprojecting onto the sphere).
    await expect.poll(() =>
      page.evaluate(() => (window as HarnessWindow).__globeHarness!.getViewportType()),
    ).toMatch(/Globe/i);

    // A seeded hotspot picks at its globe-projected screen point.
    await expect.poll(async () => (await pickHotspot(page)).found, { timeout: 20000 }).toBe(true);

    // CTO-facing proof: dots + monochrome basemap on the sphere.
    await page.evaluate(() => {
      const w = (window as HarnessWindow).__globeHarness!;
      const hs = w.getFirstHotspotLngLat();
      if (hs) w.setCamera(hs.lon, hs.lat, 2.2);
      w.stopSpin();
    });
    await page.waitForTimeout(600);
    const shot = await page.locator('.globe-native-wrapper').screenshot();
    await testInfo.attach('globe-native-dots', { body: shot, contentType: 'image/png' });

    expect(pageErrors.filter((e) => !ignorable.some((p) => p.test(e)))).toEqual([]);
  });

  test('native is the default; ?globe=mapbox is the escape hatch', async ({ page }) => {
    // Default (no query param) → native is on.
    await ready(page, '');
    expect(
      await page.evaluate(() => (window as HarnessWindow).__globeHarness!.nativeEnabled),
    ).toBe(true);
    expect(await page.evaluate(() => document.querySelectorAll('canvas').length)).toBe(1);

    // Escape hatch → native off (the app would render the mapbox globe instead).
    await ready(page, '?globe=mapbox');
    expect(
      await page.evaluate(() => (window as HarnessWindow).__globeHarness!.nativeEnabled),
    ).toBe(false);
  });
});
