import { expect, test } from '@playwright/test';

// Cloud mode: on world.hanzo.ai (and local dev — a hanzo brand host) the H logo is a
// toggle that reveals the [Hanzo | World | AI | Crypto | Finance | Tech] switcher,
// and the flagship `hanzo` view ships the live-traffic globe layer. This spec drives
// the real header + map on the main app, plus the TrafficGlobePanel in isolation.

const TRAFFIC = {
  updatedAt: '2026-07-16T12:00:00Z',
  live: true,
  window: { minutes: 60, since: '2026-07-16T11:00:00Z', until: '2026-07-16T12:00:00Z' },
  points: [
    { country: 'US', region: 'CA', lat: 36.12, lon: -119.68, count: 42, byService: { chat: 40, media: 2 } },
    { country: 'GB', lat: 55.38, lon: -3.44, count: 12, byService: { models: 12 } },
    { country: 'DE', lat: 51.17, lon: 10.45, count: 7, byService: { embeddings: 7 } },
  ],
  totals: { rps_1m: 0.7, rpm_60m: 0.35, top_countries: [{ country: 'US', count: 42 }, { country: 'GB', count: 12 }, { country: 'DE', count: 7 }] },
};

test.describe('Cloud mode', () => {
  test('H logo reveals the switcher; cloud view ships the live-traffic globe layer', async ({ page }) => {
    // Feed the globe layer real points so its poll resolves (avoids a 404 empty state).
    await page.route('**/v1/world/cloud/traffic-globe', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(TRAFFIC) }),
    );

    await page.goto('/?variant=cloud');

    // The H logo renders as the Hanzo-mode toggle on this (hanzo brand) host.
    const hLogo = page.locator('[data-hanzo-toggle]');
    await expect(hLogo).toBeVisible();

    // Flagship default: the switcher starts collapsed (revealed by the H, not shown
    // by default), so the clean globe view leads.
    const switcher = page.locator('.variant-switcher');
    await expect(switcher).toBeHidden();

    // Click the H → Cloud mode reveals the switcher.
    await hLogo.click();
    await expect(page.locator('.header.hanzo-mode')).toHaveCount(1);
    await expect(switcher).toBeVisible();
    await expect(hLogo).toHaveAttribute('aria-expanded', 'true');

    // Exactly the [Cloud | World | AI | Crypto | Finance | Tech] tabs, Cloud first.
    await expect(switcher.locator('.variant-option')).toHaveCount(6);
    await expect(switcher.locator('.variant-option').first()).toHaveAttribute('data-variant', 'cloud');
    await expect(page.locator('.variant-option[data-variant="cloud"].active')).toHaveCount(1);

    // Click the H again → collapses.
    await hLogo.click();
    await expect(switcher).toBeHidden();

    // The globe's native traffic layer is wired into the layer-toggle system and ON
    // by default in the hanzo view — i.e. the globe layer is toggleable.
    await expect(page.locator('.deckgl-map-wrapper')).toBeVisible({ timeout: 45000 });
    const trafficToggle = page.locator('.layer-toggle[data-layer="traffic"]');
    await expect(trafficToggle).toHaveCount(1);
    await expect(trafficToggle.locator('input[type="checkbox"]')).toBeChecked();
  });

  test('TrafficGlobePanel renders live throughput + top origins, and an honest empty state', async ({ page }) => {
    await page.goto('/tests/runtime-harness.html');

    // Live payload → throughput tiles + ranked origin countries.
    const live = await page.evaluate(async (payload) => {
      const orig = window.fetch;
      window.fetch = (async () => ({ ok: true, status: 200, json: async () => payload })) as typeof window.fetch;
      const { TrafficGlobePanel } = await import('/src/components/TrafficGlobePanel.ts');
      const panel = new TrafficGlobePanel();
      const root = panel.getElement();
      document.body.appendChild(root);
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline && root.querySelectorAll('.traffic-row').length === 0) {
        await new Promise((r) => setTimeout(r, 30));
      }
      const text = root.textContent ?? '';
      const rows = root.querySelectorAll('.traffic-row').length;
      panel.destroy(); root.remove(); window.fetch = orig;
      return { text, rows };
    }, TRAFFIC);
    expect(live.rows).toBe(3);
    expect(live.text).toContain('US');
    expect(live.text).toContain('requests / sec');
    expect(live.text.toLowerCase()).toContain('active regions');

    // Empty payload → honest zero state, never fabricated numbers.
    const empty = await page.evaluate(async () => {
      const orig = window.fetch;
      const EMPTY = { updatedAt: '', live: false, window: { minutes: 60, since: '', until: '' }, points: [], totals: { rps_1m: 0, rpm_60m: 0, top_countries: [] } };
      window.fetch = (async () => ({ ok: true, status: 200, json: async () => EMPTY })) as typeof window.fetch;
      const { TrafficGlobePanel } = await import('/src/components/TrafficGlobePanel.ts');
      const panel = new TrafficGlobePanel();
      const root = panel.getElement();
      document.body.appendChild(root);
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline && !(root.textContent ?? '').includes('No live traffic')) {
        await new Promise((r) => setTimeout(r, 30));
      }
      const text = root.textContent ?? '';
      panel.destroy(); root.remove(); window.fetch = orig;
      return text;
    });
    expect(empty).toContain('No live traffic yet');
  });

  test('3D globe settles (no idle-spin flicker) + Cloud-accurate legend, no cables assertion', async ({ page }) => {
    await page.route('**/v1/world/cloud/traffic-globe', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(TRAFFIC) }),
    );
    const errors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

    await page.goto('/?variant=cloud');
    await expect(page.locator('.deckgl-map-wrapper')).toBeVisible({ timeout: 45000 });

    // Legend must MATCH what the globe plots — the Cloud data classes, not the
    // geopolitical default (which would mislabel a traffic dot as "high alert").
    const legend = page.locator('.deckgl-legend');
    await expect(legend).toBeVisible();
    const legendText = (await legend.innerText()).toLowerCase();
    for (const cls of ['request origin', 'validator node', 'gpu fleet', 'cloud region', 'datacenter']) {
      expect(legendText).toContain(cls);
    }
    for (const geo of ['high alert', 'nuclear', 'elevated']) {
      expect(legendText).not.toContain(geo);
    }

    // Switch to the 3D globe (GlobeNative is exposed on window in dev/e2e).
    await page.locator('.deckgl-projection-toggle .proj-btn[data-mode="3d"]').click();
    await expect
      .poll(() => page.evaluate(() => Boolean((window as unknown as { __globeNative?: unknown }).__globeNative)), { timeout: 20000 })
      .toBe(true);

    // Idle auto-rotate is OFF, so the globe SETTLES: the camera longitude does not
    // drift and the deck render loop idles (a few data-sync renders, not ~40/s). A
    // perpetually-spinning globe re-rasterizes thin vector lines every frame — that is
    // the shimmer; a settled globe does not.
    const settled = await page.evaluate(async () => {
      const g = (window as unknown as {
        __globeNative: { getCenter: () => { lon: number }; getDeck: () => { setProps: (p: unknown) => void } };
      }).__globeNative;
      const c0 = g.getCenter();
      let renders = 0;
      g.getDeck().setProps({ onAfterRender: () => { renders++; } });
      await new Promise((r) => setTimeout(r, 1300));
      return { lonDelta: Math.abs(g.getCenter().lon - c0.lon), renders };
    });
    expect(settled.lonDelta).toBeLessThan(0.001); // no idle auto-rotate drift
    expect(settled.renders).toBeLessThan(12);      // render loop idles (vs ~40/s spinning)

    // The broken cables PathLayer must not assert (cables off in Cloud + path guarded).
    expect(errors.filter((e) => /cables-layer|assertion failed/i.test(e))).toEqual([]);
  });
});
