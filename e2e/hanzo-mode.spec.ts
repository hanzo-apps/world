import { expect, test } from '@playwright/test';

// Hanzo mode: on world.hanzo.ai (and local dev — a hanzo brand host) the H logo is a
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

test.describe('Hanzo mode', () => {
  test('H logo reveals the switcher; hanzo view ships the live-traffic globe layer', async ({ page }) => {
    // Feed the globe layer real points so its poll resolves (avoids a 404 empty state).
    await page.route('**/v1/world/cloud/traffic-globe', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(TRAFFIC) }),
    );

    await page.goto('/?variant=hanzo');

    // The H logo renders as the Hanzo-mode toggle on this (hanzo brand) host.
    const hLogo = page.locator('[data-hanzo-toggle]');
    await expect(hLogo).toBeVisible();

    // Flagship default: the switcher starts collapsed (revealed by the H, not shown
    // by default), so the clean globe view leads.
    const switcher = page.locator('.variant-switcher');
    await expect(switcher).toBeHidden();

    // Click the H → Hanzo mode reveals the switcher.
    await hLogo.click();
    await expect(page.locator('.header.hanzo-mode')).toHaveCount(1);
    await expect(switcher).toBeVisible();
    await expect(hLogo).toHaveAttribute('aria-expanded', 'true');

    // Exactly the [Hanzo | World | AI | Crypto | Finance | Tech] tabs, Hanzo first.
    await expect(switcher.locator('.variant-option')).toHaveCount(6);
    await expect(switcher.locator('.variant-option').first()).toHaveAttribute('data-variant', 'hanzo');
    await expect(page.locator('.variant-option[data-variant="hanzo"].active')).toHaveCount(1);

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
});
