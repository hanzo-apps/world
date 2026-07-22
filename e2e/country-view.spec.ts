import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * Country application-view e2e: clicking a country opens a FULLSCREEN view with
 * the intel content on the left and a docked AI analyst chat on the right
 * (desktop), a bottom-sheet on mobile. Escape restores the dashboard; the URL
 * reflects the view (?country=FR) via pushState so browser Back closes it.
 *
 * The open is driven through window.__app.openCountryBriefByCode — the EXACT call
 * the map click handler makes (map.onCountryClicked → openCountryBriefByCode) —
 * so the test exercises the real click code path deterministically, the same
 * window.__app hook the repo's other e2e specs use.
 */

const SCREENS = 'e2e/screens';

async function stubViewApi(page: Page): Promise<void> {
  await page.route('**/v1/world/**', (route: Route) => {
    const url = route.request().url();
    if (url.includes('/v1/world/models')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            { id: 'zen5', label: 'Zen 5', group: 'Zen' },
            { id: 'zen5-flash', label: 'Zen 5 Flash', group: 'Zen' },
          ],
          default: 'zen5',
        }),
      });
    }
    if (url.includes('/v1/world/country-intel')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          brief: 'France remains stable. Monitoring energy policy and labour actions across major cities.',
          country: 'France',
          code: 'FR',
          cached: false,
          generatedAt: new Date().toISOString(),
        }),
      });
    }
    if (url.includes('/v1/world/stock-index')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ available: true, indexName: 'CAC 40', price: '8000', weekChangePercent: '1.2' }),
      });
    }
    if (url.includes('/v1/world/analyst')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ reply: 'Energy policy and labour actions are the current drivers.', actions: [], model: 'zen5', tokens: 12 }),
      });
    }
    // Seed the two risk-required feeds (rss + gdelt) so the deep-link handler's
    // dataFreshness.hasSufficientData() gate flips to 'sufficient' offline.
    if (url.includes('/v1/world/feeds-batch')) {
      const body = route.request().postDataJSON() as { urls?: string[] } | null;
      const urls = body?.urls ?? [];
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          feeds: urls.map((u) => ({
            url: u,
            ok: true,
            items: [{ title: 'Deep-link seed headline', link: 'https://example.com/news', pubDate: new Date().toISOString() }],
          })),
        }),
      });
    }
    if (url.includes('/v1/world/gdelt-geo')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          type: 'FeatureCollection',
          features: [
            { type: 'Feature', properties: { name: 'Paris, France', count: 60 }, geometry: { type: 'Point', coordinates: [2.3522, 48.8566] } },
            { type: 'Feature', properties: { name: 'Lyon, France', count: 40 }, geometry: { type: 'Point', coordinates: [4.8357, 45.764] } },
          ],
        }),
      });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
}

async function signIn(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('hanzo_iam_access_token', 'e2e-fake-token');
    localStorage.setItem('hanzo_iam_expires_at', String(Date.now() + 3_600_000));
    localStorage.setItem('hanzo_iam_owner', 'e2e-org');
  });
}

async function appReady(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForSelector('#panelsGrid', { timeout: 60_000 });
}

async function openCountry(page: Page, code = 'FR', name = 'France'): Promise<void> {
  // __app is exposed before init() finishes, but countryBriefPage is constructed
  // later in init() (after loadAllData) — long after #panelsGrid paints. Wait for
  // the hook so the open isn't raced to a silent early-return; a real map click
  // only ever fires post-boot anyway.
  await page.waitForFunction(
    () => Boolean((window as unknown as { __app?: { countryBriefPage?: unknown } }).__app?.countryBriefPage),
    undefined,
    { timeout: 30_000 },
  );
  await page.evaluate(
    ([c, n]) => (window as unknown as { __app: { openCountryBriefByCode(c: string, n: string): Promise<void> } }).__app.openCountryBriefByCode(c, n),
    [code, name],
  );
  await page.waitForSelector('.country-brief-overlay.active', { timeout: 30_000 });
}

test.describe('Country application view', () => {
  test('desktop: fullscreen intel + docked analyst sidebar, URL + Escape', async ({ page }) => {
    await signIn(page);
    await stubViewApi(page);
    await appReady(page);

    await openCountry(page);

    // Fullscreen, not the old centered card: page fills the viewport width.
    const page_ = page.locator('.country-brief-page');
    await expect(page_).toBeVisible();
    const box = await page_.boundingBox();
    const vp = page.viewportSize()!;
    expect(box!.width).toBeGreaterThan(vp.width - 4); // no horizontal straitjacket

    // Intel content on the left…
    await expect(page.locator('.cb-main .cb-body')).toBeVisible();
    // …docked analyst chat on the right (signed-in → composer, model picker present).
    const sidebar = page.locator('.cb-analyst-sidebar');
    await expect(sidebar).toBeVisible();
    await expect(sidebar.locator('.hzc-input')).toBeVisible();
    // Model picker is a pill opening a popover listbox (portaled to <body>); wait
    // for the roster to paint, then open it to confirm the two stubbed models.
    const modelBtn = sidebar.locator('.hzc-model');
    await expect(modelBtn.locator('.hzc-model-name')).toHaveText('Zen 5');
    await modelBtn.click();
    await expect(page.locator('.hzc-model-menu .hzc-model-opt')).toHaveCount(2);
    await modelBtn.click(); // close the popover
    // Sidebar is on the right of the intel content.
    const mainBox = await page.locator('.cb-main').boundingBox();
    const sideBox = await sidebar.boundingBox();
    expect(sideBox!.x).toBeGreaterThan(mainBox!.x);

    // URL reflects the view (pushState).
    expect(page.url()).toContain('country=FR');

    await page.screenshot({ path: `${SCREENS}/country-view-desktop.png` });

    // Escape restores the dashboard and drops ?country=.
    await page.keyboard.press('Escape');
    await expect(page.locator('.country-brief-overlay.active')).toHaveCount(0);
    expect(page.url()).not.toContain('country=');
  });

  test('desktop: analyst sidebar collapses and reopens via the pill', async ({ page }) => {
    await signIn(page);
    await stubViewApi(page);
    await appReady(page);
    await openCountry(page);

    const brief = page.locator('.country-brief-page');
    await expect(brief).not.toHaveClass(/cb-analyst-collapsed/);
    await page.click('.cb-analyst-collapse');
    await expect(brief).toHaveClass(/cb-analyst-collapsed/);
    await expect(page.locator('.cb-analyst-fab')).toBeVisible();
    await page.click('.cb-analyst-fab');
    await expect(brief).not.toHaveClass(/cb-analyst-collapsed/);
  });

  test('mobile 390px: analyst is a bottom sheet, no horizontal scroll', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page);
    await stubViewApi(page);
    await appReady(page);
    await openCountry(page);

    const brief = page.locator('.country-brief-page');
    // On mobile the intel leads; the analyst starts collapsed with a reopen pill.
    await expect(brief).toHaveClass(/cb-analyst-collapsed/);
    await expect(page.locator('.cb-analyst-fab')).toBeVisible();
    // No horizontal overflow.
    const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollW).toBeLessThanOrEqual(390 + 1);

    await page.screenshot({ path: `${SCREENS}/country-view-mobile-closed.png` });

    // Open the bottom sheet.
    await page.click('.cb-analyst-fab');
    await expect(brief).not.toHaveClass(/cb-analyst-collapsed/);
    await expect(page.locator('.cb-analyst-sidebar .hzc-input')).toBeVisible();
    await page.screenshot({ path: `${SCREENS}/country-view-mobile-open.png` });
  });

  test('deep link: ?country=FR opens the view directly', async ({ page }) => {
    await signIn(page);
    await stubViewApi(page);
    // The deep-link handler waits for sufficient live data before opening; let the
    // real proxied feeds load (news + gdelt), then assert the view appears.
    await page.goto('/?country=FR');
    await page.waitForSelector('#panelsGrid', { timeout: 60_000 });
    await expect(page.locator('.country-brief-overlay.active')).toBeVisible({ timeout: 80_000 });
    await expect(page.locator('.cb-analyst-sidebar')).toBeVisible();
    expect(page.url()).toContain('country=FR');
  });
});
