import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * Context-menu + analyst-data-tool e2e.
 *
 *   1. Right-click a news-shaped item (the exact data-ctx-* convention NewsPanel
 *      emits) → the custom menu shows Open link / Copy link / Copy headline plus
 *      the panel baseline; Copy actually writes to the clipboard.
 *   2. Right-click the live map → the map menu shows Copy coordinates / Fly here /
 *      the 2D-3D toggle (via the MapContainer capability port).
 *   3. A stubbed analyst response carrying a data-tool trace renders the collapsed
 *      "🔧 world_brief(...)" line before the grounded reply.
 *
 * No real inference or feeds: the analyst/models routes are stubbed and the news
 * item is injected into a live panel so the menu code runs against production DOM.
 */

const SCREENS = 'e2e/screens';

async function stubWorldApi(page: Page, analystBody?: unknown): Promise<void> {
  await page.route('**/v1/world/**', (route: Route) => {
    const url = route.request().url();
    if (url.includes('/v1/world/analyst')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          analystBody ?? { reply: '', actions: [], model: 'zen5', tokens: 0, traces: [] },
        ),
      });
    }
    if (url.includes('/v1/world/models')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [{ id: 'zen5', label: 'Zen 5', group: 'Zen' }],
          default: 'zen5',
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

// Read the current custom menu's item labels (buttons only, not separators/labels).
async function menuItems(page: Page): Promise<string[]> {
  return page.$$eval('#panelContextMenu .panel-context-menu-item', (els) =>
    els.map((e) => (e.textContent || '').trim()),
  );
}

test.describe('right-click context menus', () => {
  test('news item → Open link / Copy link / Copy headline (+ clipboard)', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await stubWorldApi(page);
    await appReady(page);

    // Add a faithful news item (exactly the data-ctx-* attributes NewsPanel
    // emits) inside its own panel appended to the grid. A synthetic panel is used
    // so a live panel's periodic re-render can't wipe the item mid-test, and so it
    // is not under the map canvas — the menu code path is identical either way.
    // The app defaults to FREE layout, where a raw injected panel (no coordinates)
    // stacks at 0,0 under the full-width map and the map eats the right-click; pin
    // grid mode so the injected panel flows to the grid end as a hit-testable child.
    await page.evaluate(() =>
      (window as unknown as { worldGrid?: { setLayoutMode(m: string): void } }).worldGrid?.setLayoutMode('grid'),
    );
    await page.waitForTimeout(80);
    await page.evaluate(() => {
      const grid = document.querySelector('#panelsGrid')!;
      const panel = document.createElement('div');
      panel.className = 'panel';
      panel.dataset.panel = 'e2e-test-panel';
      panel.innerHTML =
        '<div class="panel-content"><div class="item" id="e2e-news-item" ' +
        'data-ctx-url="https://example.com/story" data-ctx-headline="Breaking test headline" ' +
        'style="padding:12px;min-height:24px;">Breaking test headline</div></div>';
      grid.appendChild(panel);
    });

    await page.locator('#e2e-news-item').scrollIntoViewIfNeeded();
    await page.locator('#e2e-news-item').click({ button: 'right' });
    await expect(page.locator('#panelContextMenu')).toBeVisible();

    const items = await menuItems(page);
    expect(items).toEqual(expect.arrayContaining(['Open link', 'Copy link', 'Copy headline']));
    // Baseline panel actions still ride below the component items.
    expect(items).toEqual(expect.arrayContaining(['Hide panel', 'Reset layout', 'Full']));

    await page.screenshot({ path: `${SCREENS}/ctxmenu-news.png` });

    // Copy headline actually writes to the clipboard.
    await page.locator('#panelContextMenu .panel-context-menu-item', { hasText: 'Copy headline' }).click();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe('Breaking test headline');
    // Menu dismisses after an action.
    await expect(page.locator('#panelContextMenu')).toHaveCount(0);
  });

  test('map → Copy coordinates / Fly here / 2D-3D toggle', async ({ page }) => {
    await stubWorldApi(page);
    await appReady(page);

    // The map is a first-class grid citizen in the full app; wait for its canvas.
    await page.waitForSelector('.map-container canvas', { timeout: 60_000 });

    // A stationary right-click on the map surface opens the map menu (a rotate
    // drag would instead keep the maplibre gesture — not exercised here).
    await expect
      .poll(
        async () => {
          await page.locator('.map-container canvas').first().click({ button: 'right', position: { x: 300, y: 180 } });
          if (!(await page.locator('#panelContextMenu').count())) return [];
          return menuItems(page);
        },
        { timeout: 30_000 },
      )
      .toEqual(expect.arrayContaining(['Copy coordinates', 'Fly here']));

    const items = await menuItems(page);
    // The 2D-3D toggle is present (label depends on current projection).
    expect(items.some((l) => /Switch to (2D map|3D globe)/.test(l))).toBe(true);

    await page.screenshot({ path: `${SCREENS}/ctxmenu-map.png` });
  });
});

test.describe('analyst data-tool traces', () => {
  test('a stubbed tool round-trip renders the 🔧 trace + grounded reply', async ({ page }) => {
    await signIn(page);
    await stubWorldApi(page, {
      reply: 'Composite instability is steady; Sudan and Ukraine lead the movers.',
      actions: [],
      model: 'zen5',
      tokens: 128,
      traces: [
        {
          label: 'world_brief({"n":5})',
          ok: true,
          result: '{"asOf":"2026-07-09T00:00:00Z","kind":"country","top":[{"iso":"SD","instability":0.82}]}',
        },
      ],
    });
    await appReady(page);

    await page.click('.hzc-fab');
    const composer = page.locator('.hzc-body .hzc-input');
    await expect(composer).toBeVisible();
    await composer.fill('What is the state of global instability?');
    await page.click('.hzc-body .hzc-send');

    // The tool trace renders before the reply that cites it; its summary carries
    // the tool call (the redesign shows a database glyph, not the 🔧 emoji).
    const trace = page.locator('.hzc-body .hzc-tool .hzc-tool-summary');
    await expect(trace).toBeVisible();
    await expect(trace).toContainText('world_brief(');

    // The detail renders open, so the raw result body — a compact table of the
    // tool's JSON — is visible inline and carries the returned instability field.
    await expect(page.locator('.hzc-body .hzc-tool .hzc-table')).toContainText('instability');

    // …and the grounded prose reply is shown.
    await expect(page.locator('.hzc-body .hzc-row.assistant')).toContainText('instability is steady');

    await page.screenshot({ path: `${SCREENS}/analyst-tool-trace.png` });
  });
});
