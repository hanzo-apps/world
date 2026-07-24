import { expect, test, type Page } from '@playwright/test';

/**
 * React-entry CORE cutover gate (world.hanzo.ai React + @hanzo/gui surface).
 *
 * These specs drive the REAL React entry (index.react.html), not a harness, and prove
 * the surface is cutover-ready:
 *   1. shell/auth mounts       — HanzoAppHeader + variant tabs render.
 *   2. globe island renders    — GlobeIsland instantiates the existing MapContainer
 *                                (a WebGL canvas inside #mapContainer).
 *   3. variant filter          — switching a tab swaps the visible panel set (the
 *                                rail's per-variant filter — cloud-only vs world-only).
 *   4. shared panel-order       — a pre-seeded `panel-order` layout is honoured (the
 *                                cross-surface persistence contract with the vanilla app).
 *   5. drag reorder            — a real pointer drag reorders the grid and writes the
 *                                SHARED `panel-order` key.
 *   6. a panel's live fetch    — MarketsPanel issues its live `/v1/world/finnhub` fetch
 *                                (mocked same-origin) and renders the returned rows.
 *
 * The React dev server serves the React entry at /index.react.html (/, is the vanilla
 * app), so every navigation targets that path.
 */

const REACT = '/index.react.html';

// Wait for the lazy PanelRail chunk to stream in and at least one panel to mount.
async function waitForRail(page: Page): Promise<void> {
  await expect(page.locator('.panels-grid [data-panel]').first()).toBeVisible({ timeout: 30000 });
}

test.describe('React entry — shell + globe', () => {
  test('unified shell + variant tabs mount', async ({ page }) => {
    await page.goto(REACT);

    // The header view-switcher is the anchor the shell hangs off — role=tablist with
    // the six canonical variant tabs (Cloud · AI · Crypto · Finance · Tech · World).
    const tablist = page.getByRole('tablist', { name: 'View switcher' });
    await expect(tablist).toBeVisible();
    for (const label of ['Cloud', 'AI', 'Crypto', 'Finance', 'Tech', 'World']) {
      await expect(tablist.getByRole('tab', { name: label, exact: true })).toBeVisible();
    }
  });

  test('globe island renders a WebGL canvas', async ({ page }) => {
    await page.goto(REACT);
    // GlobeIsland mounts <div id="mapContainer"> then instantiates MapContainer, which
    // creates the WebGL canvas inside it. The flagship Cloud variant OPENS on the native
    // 3D globe and parks the mapbox 2D map (its canvas mounts HIDDEN behind the globe),
    // so assert the canvas is ATTACHED with real render dimensions rather than visible —
    // the globe engine having mounted a sized WebGL surface is the contract here.
    const host = page.locator('#mapContainer');
    await expect(host).toBeVisible();
    const canvas = host.locator('canvas').first();
    await expect(canvas).toBeAttached({ timeout: 45000 });
    const size = await canvas.evaluate((c) => ({
      w: (c as HTMLCanvasElement).width,
      h: (c as HTMLCanvasElement).height,
    }));
    expect(size.w).toBeGreaterThan(0);
    expect(size.h).toBeGreaterThan(0);
  });
});

test.describe('React entry — variant filter', () => {
  test('switching tabs swaps the visible panel set', async ({ page }) => {
    // Default host variant is cloud. The live-traffic globe tile is a cloud panel and
    // NOT a world panel; Country Instability (cii) is a world panel and NOT cloud.
    await page.goto(REACT);
    await waitForRail(page);

    await expect(page.locator('[data-panel="traffic-globe"]')).toHaveCount(1);
    await expect(page.locator('[data-panel="cii"]')).toHaveCount(0);

    // One-switch path: click the World tab; the rail re-filters to the full set.
    await page.getByRole('tab', { name: 'World', exact: true }).click();

    await expect(page.locator('[data-panel="cii"]')).toHaveCount(1, { timeout: 15000 });
    await expect(page.locator('[data-panel="traffic-globe"]')).toHaveCount(0);
  });
});

test.describe('React entry — shared panel-order', () => {
  test('a pre-seeded panel-order layout is honoured', async ({ page }) => {
    // The React grid reads the SAME `panel-order` localStorage key the vanilla app
    // writes. Seed a specific first panel BEFORE load, then assert the grid renders it
    // first — the cross-surface persistence contract.
    await page.addInitScript(() => {
      // World variant so the seeded ids are all in the visible set.
      window.localStorage.setItem('worldmonitor-variant', 'full');
      window.localStorage.setItem(
        'panel-order',
        JSON.stringify(['strategic-risk', 'markets', 'cii', 'economic']),
      );
    });
    await page.goto(REACT);
    await waitForRail(page);

    const firstPanel = page.locator('.panels-grid > [data-panel]').first();
    await expect(firstPanel).toHaveAttribute('data-panel', 'strategic-risk', { timeout: 15000 });
  });
});

test.describe('React entry — drag reorder', () => {
  test('a pointer drag reorders the grid and writes the shared key', async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('worldmonitor-variant', 'full');
      window.localStorage.removeItem('panel-order');
    });
    await page.goto(REACT);
    await waitForRail(page);

    const grid = page.locator('.panels-grid');
    const order = async (): Promise<string[]> =>
      grid.evaluate((g) =>
        Array.from(g.children).map((c) => (c as HTMLElement).dataset.panel ?? ''),
      );

    const before = await order();
    expect(before.length).toBeGreaterThan(2);

    // Drag panel[0] down past panel[2]'s midpoint so it commits a reorder. Drive the
    // real pointer plumbing (mouse → pointer events in Chromium): press on the panel
    // body, cross the 6px threshold, then step down.
    const p0 = page.locator(`[data-panel="${before[0]}"]`);
    const p2 = page.locator(`[data-panel="${before[2]}"]`);
    const b0 = await p0.boundingBox();
    const b2 = await p2.boundingBox();
    expect(b0 && b2).toBeTruthy();

    const startX = b0!.x + b0!.width / 2;
    const startY = b0!.y + 14; // near the top (header), off any interactive control
    const endY = b2!.y + b2!.height * 0.7;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    // Cross the drag threshold, then walk down in steps so the reflow tracks the ghost.
    await page.mouse.move(startX, startY + 10);
    for (let y = startY + 10; y <= endY; y += 24) {
      await page.mouse.move(startX, y);
      await page.waitForTimeout(30);
    }
    await page.mouse.move(startX, endY);
    await page.mouse.up();

    // The engine reordered the DOM on commit and PanelGrid persisted it to the shared
    // key. Assert both: the first id moved AND `panel-order` was written.
    await expect
      .poll(async () => (await order())[0], { timeout: 10000 })
      .not.toBe(before[0]);

    const saved = await page.evaluate(() =>
      JSON.parse(window.localStorage.getItem('panel-order') || '[]'),
    );
    expect(Array.isArray(saved)).toBe(true);
    expect(saved.length).toBeGreaterThan(0);
  });
});

test.describe('React entry — a panel live fetch renders', () => {
  test('MarketsPanel fetches /v1/world/finnhub and renders rows', async ({ page }) => {
    // MarketsPanel is a World-variant panel. Mock its same-origin proxy endpoints so
    // the live fetch is deterministic + offline: finnhub echoes every requested symbol
    // as a priced quote; the yahoo passthroughs return empty so nothing hits the wire.
    await page.route('**/v1/world/finnhub**', async (route) => {
      const symbols = (new URL(route.request().url()).searchParams.get('symbols') || '')
        .split(',')
        .filter(Boolean);
      const quotes = symbols.map((symbol, i) => ({
        symbol,
        price: 100 + i,
        changePercent: 1.23,
      }));
      await route.fulfill({ json: { quotes } });
    });
    await page.route('**/v1/world/yahoo-batch**', (route) => route.fulfill({ json: {} }));
    await page.route('**/v1/world/yahoo-finance**', (route) => route.fulfill({ json: {} }));

    await page.addInitScript(() => window.localStorage.setItem('worldmonitor-variant', 'full'));
    await page.goto(REACT);
    await waitForRail(page);

    const markets = page.locator('[data-panel="markets"]');
    await expect(markets).toHaveCount(1);
    // The chassis renders the title uppercased; the live fetch leaves the loading state
    // and paints priced rows ($NNN.NN) from the mocked quotes.
    await expect(markets.getByText(/\$\d/).first()).toBeVisible({ timeout: 20000 });
  });
});
