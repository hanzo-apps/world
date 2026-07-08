import { expect, test } from '@playwright/test';

type LayerSnapshot = { id: string; dataCount: number };

type Harness = {
  ready: boolean;
  seedAllDynamicData: () => void;
  seedClimateAnomalies: () => void;
  setZoom: (zoom: number) => void;
  setProjectionMode: (mode: '2d' | '3d') => void;
  getProjectionType: () => string;
  getCenterLng: () => number | undefined;
  isAutoRotateActive: () => boolean;
  isUserInteracting: () => boolean;
  autoRotateGateOpen: () => boolean;
  rotateOneStep: (dtSec: number) => void;
  stopIdleSpin: () => void;
  getDeckLayerSnapshot: () => LayerSnapshot[];
};

type HarnessWindow = Window & { __mapHarness?: Harness };

// One representative of every deck.gl layer type in use — each must still build
// on the globe: PathLayer, GeoJsonLayer, IconLayer, ScatterplotLayer, Text.
const GLOBE_SAFE_LAYERS = [
  'cables-layer',            // PathLayer
  'pipelines-layer',        // PathLayer
  'conflict-zones-layer',   // GeoJsonLayer
  'bases-layer',            // IconLayer
  'nuclear-layer',          // IconLayer
  'hotspots-layer',         // ScatterplotLayer
  'datacenters-layer',      // IconLayer
  'earthquakes-layer',      // ScatterplotLayer
  'weather-layer',          // ScatterplotLayer
  'military-flights-layer', // ScatterplotLayer
  'ports-layer',            // ScatterplotLayer
  'news-locations-layer',   // Text/Scatterplot
];

const waitForHarnessReady = async (
  page: import('@playwright/test').Page
): Promise<void> => {
  await page.goto('/tests/map-harness.html');
  await expect(page.locator('.deckgl-map-wrapper')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => Boolean((window as HarnessWindow).__mapHarness?.ready)), {
      timeout: 45000,
    })
    .toBe(true);
};

const projectionType = (page: import('@playwright/test').Page): Promise<string> =>
  page.evaluate(() => (window as HarnessWindow).__mapHarness?.getProjectionType() ?? 'mercator');

const layerIds = async (page: import('@playwright/test').Page): Promise<Set<string>> => {
  const snapshot = await page.evaluate(
    () => (window as HarnessWindow).__mapHarness?.getDeckLayerSnapshot() ?? []
  );
  return new Set(snapshot.filter((l) => l.dataCount > 0).map((l) => l.id));
};

test.describe('3D globe', () => {
  test.describe.configure({ retries: 1 });

  // Runs FIRST and is deliberately light: the idle-spin rAF loop is engaged then
  // cancelled in the same tick, so no sustained globe repaint occurs (a
  // continuously repainting software-GL globe starves page.evaluate in CI). The
  // rotation math and idle/interaction gate are exercised via discrete calls —
  // setCenter mutates map state synchronously, independent of GL throughput.
  test.describe('idle auto-rotate', () => {
    test.use({ reducedMotion: 'no-preference' });

    test('engages in 3D, rotates the globe, and its gate closes on interaction / in 2D', async ({
      page,
    }) => {
      await waitForHarnessReady(page);

      const engaged = await page.evaluate(() => {
        const w = (window as HarnessWindow).__mapHarness!;
        w.setZoom(1.6);
        w.setProjectionMode('3d');
        const active = w.isAutoRotateActive(); // rafId set synchronously
        w.stopIdleSpin();                       // cancel before any sustained repaint
        return { active, gate: w.autoRotateGateOpen() };
      });
      expect(engaged.active).toBe(true); // loop engaged in 3D
      expect(engaged.gate).toBe(true);   // idle gate open

      // One step (1s worth) rotates the globe eastward ~4 degrees.
      const moved = await page.evaluate(() => {
        const w = (window as HarnessWindow).__mapHarness!;
        const before = w.getCenterLng() ?? 0;
        w.rotateOneStep(1);
        return Math.abs((w.getCenterLng() ?? 0) - before);
      });
      expect(moved).toBeGreaterThan(3);
      expect(moved).toBeLessThan(6);

      // A real pointer interaction closes the gate (spin pauses).
      await page.evaluate(() =>
        document.querySelector('.maplibregl-canvas')?.dispatchEvent(
          new MouseEvent('mousedown', { bubbles: true })
        )
      );
      const afterInteract = await page.evaluate(() => {
        const w = (window as HarnessWindow).__mapHarness!;
        return { interacting: w.isUserInteracting(), gate: w.autoRotateGateOpen() };
      });
      expect(afterInteract.interacting).toBe(true);
      expect(afterInteract.gate).toBe(false);

      // Flat map never auto-rotates.
      const flat = await page.evaluate(() => {
        const w = (window as HarnessWindow).__mapHarness!;
        w.setProjectionMode('2d');
        return { active: w.isAutoRotateActive(), gate: w.autoRotateGateOpen() };
      });
      expect(flat.active).toBe(false);
      expect(flat.gate).toBe(false);
    });
  });

  // Runs LAST because rendering a full-layer globe under CI's software GL is the
  // heaviest step. reducedMotion keeps auto-rotate off so there is no sustained
  // repaint; every assertion is a pure buildLayers/getProjection state read plus
  // real pill clicks. All static checks live in ONE page load to avoid repeated
  // heavy globe initialisations.
  test.describe('projection + layers (static)', () => {
    test.use({ reducedMotion: 'reduce' });

    test('2D<->3D toggle switches projection; every layer renders on the globe; heatmap is substituted; no deck errors', async ({
      page,
    }) => {
      const pageErrors: string[] = [];
      const deckAssertionErrors: string[] = [];
      const ignorable = [/could not compile fragment shader/i];
      page.on('pageerror', (e) => pageErrors.push(e.message));
      page.on('console', (msg) => {
        if (msg.type() === 'error' && msg.text().includes('deck.gl: assertion failed')) {
          deckAssertionErrors.push(msg.text());
        }
      });

      await waitForHarnessReady(page);
      await page.evaluate(() => {
        const w = (window as HarnessWindow).__mapHarness!;
        w.seedAllDynamicData();
        w.seedClimateAnomalies();
        w.setZoom(5); // clears per-layer minZoom gates (bases/nuclear/datacenters)
      });

      // Flat map by default; climate uses the screen-space HeatmapLayer.
      expect(await projectionType(page)).toBe('mercator');
      await expect(page.locator('.deckgl-projection-toggle .proj-btn[data-mode="2d"]')).toHaveClass(/active/);
      {
        const ids = await layerIds(page);
        expect(ids.has('climate-heatmap-layer')).toBe(true);
        expect(ids.has('climate-anomaly-points-layer')).toBe(false);
      }

      // Click the real 3D pill in the map header.
      await page.locator('.deckgl-projection-toggle .proj-btn[data-mode="3d"]').click();
      await expect.poll(() => projectionType(page), { timeout: 30000 }).toBe('globe');
      await expect(page.locator('.deckgl-projection-toggle .proj-btn[data-mode="3d"]')).toHaveClass(/active/);

      // Freeze the idle spin so the static layer checks don't run against a
      // continuously repainting globe (a repainting software-GL globe starves
      // page.evaluate in CI). reducedMotion disables it where the emulation is
      // honored; this makes it deterministic everywhere.
      await page.evaluate(() => (window as HarnessWindow).__mapHarness?.stopIdleSpin());

      // Every representative deck.gl layer type still builds on the globe...
      await expect
        .poll(async () => {
          const ids = await layerIds(page);
          return GLOBE_SAFE_LAYERS.filter((id) => !ids.has(id)).length;
        }, { timeout: 20000 })
        .toBe(0);

      // ...and the screen-space climate heatmap is swapped for a globe-safe scatter.
      {
        const ids = await layerIds(page);
        expect(ids.has('climate-anomaly-points-layer')).toBe(true);
        expect(ids.has('climate-heatmap-layer')).toBe(false);
      }

      // Flip back to the flat map.
      await page.locator('.deckgl-projection-toggle .proj-btn[data-mode="2d"]').click();
      await expect.poll(() => projectionType(page), { timeout: 20000 }).toBe('mercator');

      expect(pageErrors.filter((e) => !ignorable.some((p) => p.test(e)))).toEqual([]);
      expect(deckAssertionErrors).toEqual([]);
    });
  });
});
