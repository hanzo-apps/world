import { expect, test } from '@playwright/test';

// In-place variant switch (the tab-switch freeze fix).
//
// The header variant tabs [Cloud | AI | Crypto | Finance | Tech | World] used to
// switch by setting window.location.href — a full page reload that re-created the
// deck.gl WebGL context, respawned the ML workers, re-mounted the video iframes and
// cold-refetched every feed. That churn WAS the freeze. The switch is now in place:
// recompute the target variant's config and re-apply it live, like the intra-variant
// panel toggle — no reload, heavy singletons kept warm.
//
// The airtight proof of "no reload": inject a sentinel into the JS context AFTER the
// app boots. A full navigation destroys the context and wipes the sentinel; an
// in-place switch preserves it. We also assert the SAME <canvas> survives (deck.gl
// not torn down), the panel set swaps, the active tab + URL re-point, and the switch
// is fast.

const TRAFFIC = {
  updatedAt: '2026-07-18T12:00:00Z',
  live: true,
  window: { minutes: 60, since: '2026-07-18T11:00:00Z', until: '2026-07-18T12:00:00Z' },
  points: [
    { country: 'US', lat: 37.09, lon: -95.71, count: 42, byService: { models: 42 } },
    { country: 'GB', lat: 55.38, lon: -3.44, count: 12, byService: { models: 12 } },
  ],
  totals: { rps_1m: 0.9, rpm_60m: 54, top_countries: [{ country: 'US', count: 42 }, { country: 'GB', count: 12 }] },
};

async function mockCloud(page: import('@playwright/test').Page): Promise<void> {
  const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/v1/world/cloud/traffic-globe', (r) => r.fulfill(json(TRAFFIC)));
  await page.route('**/v1/world/cloud/traffic', (r) => r.fulfill(json({ updatedAt: TRAFFIC.updatedAt, demo: false, arcs: [] })));
  await page.route('**/v1/world/cloud/chain-nodes', (r) => r.fulfill(json({ updatedAt: TRAFFIC.updatedAt, positionsModeled: true, networks: [] })));
  await page.route('**/v1/world/cloud/byo-gpu', (r) => r.fulfill(json({ updatedAt: TRAFFIC.updatedAt, demo: false, gpus: [] })));
}

test.describe('Variant switch — in place, no reload', () => {
  test('switching tabs keeps the JS context, the globe canvas, and swaps the panel set', async ({ page }) => {
    await mockCloud(page);
    await page.goto('/?variant=cloud');

    // Reveal the switcher (flagship cloud starts collapsed behind the H toggle).
    await page.locator('[data-hanzo-toggle]').click();
    const switcher = page.locator('.variant-switcher');
    await expect(switcher).toBeVisible();
    await expect(page.locator('.variant-option[data-variant="cloud"].active')).toHaveCount(1);

    // The globe mounts ONE deck.gl <canvas>. Marking it lets us later prove it is the
    // SAME element after a switch (WebGL context never torn down). This is a bonus
    // proof layered on top of the airtight sentinel below: it only fires where a GL
    // context actually renders. Under headless swiftshader (CI) deck.gl may not create
    // a canvas at all, and in the immersive cloud view the globe is a fixed background
    // rather than a panel child — so we mark the canvas IF one is present and gate the
    // identity assertions on that, instead of blocking the whole test on GL rendering.
    const globe = page.locator('canvas').first();
    const canvasMarked = await globe
      .waitFor({ state: 'attached', timeout: 15000 })
      .then(() => globe.evaluate((c) => { (c as HTMLCanvasElement & { __globeMark?: string }).__globeMark = 'orig'; }))
      .then(() => true)
      .catch(() => false);
    const globeSurvived = async (): Promise<boolean> =>
      !canvasMarked ||
      (await globe.evaluate((c) => (c as HTMLCanvasElement & { __globeMark?: string }).__globeMark === 'orig').catch(() => false));

    // Sentinel in the live JS context. A reload destroys the context → the sentinel
    // is gone. Survival across a tab click == no navigation happened.
    await page.evaluate(() => {
      (window as unknown as { __noReload?: string }).__noReload = 'sentinel';
      window.addEventListener('beforeunload', () => {
        (window as unknown as { __unloaded?: boolean }).__unloaded = true;
      });
    });

    // Switch Cloud → AI.
    await page.locator('.variant-option[data-variant="ai"]').click();
    await page.waitForFunction(() => new URLSearchParams(location.search).get('variant') === 'ai', undefined, { timeout: 20000 });

    // The switch's SYNCHRONOUS cost — the actual "is it a cold-start freeze?" measure —
    // is recorded on window.__switchT by setSiteVariant. This is the honest perf gate:
    // it times the switch code itself, immune to boot/GL thread-contention that inflates
    // wall-clock under headless software rendering (where the click merely queues behind
    // the cold globe render). A reload would cold-start everything; the in-place switch
    // is a few ms.
    const switchCost = await page.evaluate(() => (window as unknown as { __switchT?: { total?: number } }).__switchT?.total ?? -1);
    expect(switchCost, `in-place switch synchronous cost was ${switchCost}ms`).toBeGreaterThanOrEqual(0);
    expect(switchCost, `in-place switch synchronous cost was ${switchCost}ms`).toBeLessThan(500);

    // The active tab + URL re-pointed to AI, with NO reload.
    await expect(page.locator('.variant-option[data-variant="ai"].active')).toHaveCount(1);
    await expect(page.locator('.variant-option[data-variant="cloud"].active')).toHaveCount(0);
    await expect(page).toHaveURL(/variant=ai/);

    // The airtight assertions: the JS context survived (sentinel intact, no unload) —
    // a reload would have wiped both. Plus, where a GL canvas rendered, it is the very
    // same element (globe/WebGL never torn down).
    expect(await page.evaluate(() => (window as unknown as { __noReload?: string }).__noReload)).toBe('sentinel');
    expect(await page.evaluate(() => (window as unknown as { __unloaded?: boolean }).__unloaded)).toBeFalsy();
    expect(await globeSurvived()).toBe(true);

    // The panel set swapped in place: an AI panel is now visible, the cloud-only
    // live-traffic panel is hidden (kept alive, just `.hidden`).
    await expect(page.locator('.panel[data-panel="ai-compute"]:not(.hidden)')).toHaveCount(1);
    await expect(page.locator('.panel[data-panel="traffic-globe"]:not(.hidden)')).toHaveCount(0);

    // Two more switches to prove it holds across the family, still no reload.
    await page.locator('.variant-option[data-variant="finance"]').click();
    await expect(page).toHaveURL(/variant=finance/);
    await expect(page.locator('.variant-option[data-variant="finance"].active')).toHaveCount(1);
    // Finance markets panel shows; the AI compute panel is hidden.
    await expect(page.locator('.panel[data-panel="markets"]:not(.hidden)')).toHaveCount(1);

    await page.locator('.variant-option[data-variant="full"]').click();
    await expect(page.locator('.variant-option[data-variant="full"].active')).toHaveCount(1);
    await expect(page).not.toHaveURL(/variant=/); // full is the canonical default — no param

    // Still the same context + same globe canvas after three switches.
    expect(await page.evaluate(() => (window as unknown as { __noReload?: string }).__noReload)).toBe('sentinel');
    expect(await globeSurvived()).toBe(true);
  });
});
