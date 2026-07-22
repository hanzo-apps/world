import { expect, test, type Page } from '@playwright/test';

// The signed-in dashboard-sync contract, verified end-to-end against the REAL app:
//   1. on boot, this identity's server dashboard is written into localStorage
//      BEFORE the app reads it (server precedence, cross-device),
//   2. a change to a dashboard key is synced to the server (debounced PUT of the
//      full snapshot),
//   3. signed out, nothing ever touches the server (localStorage only).
// IAM is faked (a non-expired token + a stubbed userinfo) and /v1/world/dashboard
// is stubbed, so no real backend or identity is needed.

const DASH = '**/v1/world/dashboard';
const HIST = '**/v1/world/history';
const LN = '[data-panel="live-news"]';

async function fakeAuth(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('hanzo_iam_access_token', 'faketoken');
    localStorage.setItem('hanzo_iam_expires_at', String(Date.now() + 3_600_000));
    localStorage.setItem('hanzo_iam_owner', 'acme');
  });
  // Keep the fake session valid: a userinfo 401 would let the app drop the token,
  // and the sync (correctly) stops when signed out.
  await page.route('**/v1/iam/oauth/userinfo', (r) =>
    r.fulfill({ json: { sub: 'u1', owner: 'acme', email: 'u@acme.test' } }),
  );
  // Default empty history so boot's history hydrate never hits the real backend;
  // tests that assert on history override this with a later page.route (last wins).
  await page.route(HIST, (r) => r.fulfill({ json: { config: {} } }));
}

test.describe('dashboard sync (real app)', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('boot hydrates localStorage from the server (server precedence)', async ({ page }) => {
    await fakeAuth(page);
    await page.route(DASH, async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ json: { config: { 'hanzo-world-map-mode': '3d' } } });
      } else {
        await route.fulfill({ json: { ok: true } });
      }
    });
    await page.goto('/');
    await page.waitForSelector(LN, { timeout: 45000 });
    // The server value was applied to localStorage at boot, before the app read it.
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('hanzo-world-map-mode')), { timeout: 8000 })
      .toBe('3d');
  });

  test('a dashboard change is synced to the server (debounced PUT of the snapshot)', async ({ page }) => {
    await fakeAuth(page);
    const puts: Array<Record<string, string>> = [];
    await page.route(DASH, async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ json: { config: {} } }); // empty server → first run
      } else {
        puts.push(route.request().postDataJSON() as Record<string, string>);
        await route.fulfill({ json: { ok: true } });
      }
    });
    await page.goto('/');
    await page.waitForSelector(LN, { timeout: 45000 });
    await page.waitForTimeout(2000); // let the boot writes flush their debounced PUT first
    // Change an observed dashboard key; a debounced PUT carries a snapshot of ALL
    // dashboard keys, including our change.
    await page.evaluate(() => localStorage.setItem('worldmonitor-layers', '{"quakes":true}'));
    await expect
      .poll(() => puts.some((p) => p && p['worldmonitor-layers'] === '{"quakes":true}'), { timeout: 8000 })
      .toBe(true);
  });

  test('signed out: never touches the server (localStorage only)', async ({ page }) => {
    let hit = false;
    await page.route(DASH, async (route) => {
      hit = true;
      await route.fulfill({ json: { config: {} } });
    });
    await page.goto('/'); // no fakeAuth → anonymous
    await page.waitForSelector(LN, { timeout: 45000 });
    await page.evaluate(() => localStorage.setItem('worldmonitor-layers', '{"a":1}'));
    await page.waitForTimeout(1200);
    expect(hit).toBe(false);
  });

  test('history keys sync to /v1/world/history, not /dashboard', async ({ page }) => {
    await fakeAuth(page);
    const dashPuts: string[] = [];
    const histPuts: Array<Record<string, string>> = [];
    await page.route(DASH, async (route) => {
      if (route.request().method() === 'GET') await route.fulfill({ json: { config: {} } });
      else {
        dashPuts.push(route.request().postData() || '');
        await route.fulfill({ json: { ok: true } });
      }
    });
    await page.route(HIST, async (route) => {
      if (route.request().method() === 'GET') await route.fulfill({ json: { config: {} } });
      else {
        histPuts.push(route.request().postDataJSON() as Record<string, string>);
        await route.fulfill({ json: { ok: true } });
      }
    });
    await page.goto('/');
    await page.waitForSelector(LN, { timeout: 45000 });
    await page.waitForTimeout(2000); // flush boot writes first

    // A real user action (a recent search) is a HISTORY key → PUT to /history.
    await page.evaluate(() => localStorage.setItem('worldmonitor_recent_searches', '["nvidia"]'));
    await expect
      .poll(() => histPuts.some((p) => p && p['worldmonitor_recent_searches'] === '["nvidia"]'), { timeout: 8000 })
      .toBe(true);
    // …and it was NOT mixed into a dashboard PUT (clean namespace separation).
    expect(dashPuts.some((b) => b.includes('worldmonitor_recent_searches'))).toBe(false);
  });

  // Org-shared default precedence: the org default is hydrated as the BASE, then the
  // user's own doc overlays it. One broad route serves both scopes, branching on URL
  // (the `/shared` GET is the org default; the bare GET is the per-user doc).
  async function routeDashboardScopes(
    page: Page,
    shared: Record<string, string>,
    user: Record<string, string>,
  ): Promise<void> {
    await page.route('**/v1/world/dashboard**', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.fulfill({ json: { ok: true } });
        return;
      }
      const isShared = route.request().url().includes('/dashboard/shared');
      await route.fulfill({ json: { config: isShared ? shared : user } });
    });
  }

  test('org default hydrates as the base when the user has no doc yet', async ({ page }) => {
    await fakeAuth(page);
    // Org published a default; this member has never saved their own → they get it.
    await routeDashboardScopes(page, { 'hanzo-world-map-mode': '3d' }, {});
    await page.goto('/');
    await page.waitForSelector(LN, { timeout: 45000 });
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('hanzo-world-map-mode')), { timeout: 8000 })
      .toBe('3d');
  });

  test('the per-user doc overrides the org default (user wins)', async ({ page }) => {
    await fakeAuth(page);
    // Org default says 3d, the user's own doc says 2d → the user's choice wins.
    await routeDashboardScopes(page, { 'hanzo-world-map-mode': '3d' }, { 'hanzo-world-map-mode': '2d' });
    await page.goto('/');
    await page.waitForSelector(LN, { timeout: 45000 });
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('hanzo-world-map-mode')), { timeout: 8000 })
      .toBe('2d');
  });

  test('boot hydrates history from /v1/world/history (server precedence)', async ({ page }) => {
    await fakeAuth(page);
    await page.route(DASH, (r) => r.fulfill({ json: { config: {} } }));
    await page.route(HIST, (r) => r.fulfill({ json: { config: { 'hanzo-world-watch-queue': '{"items":[7]}' } } }));
    await page.goto('/');
    await page.waitForSelector(LN, { timeout: 45000 });
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('hanzo-world-watch-queue')), { timeout: 8000 })
      .toBe('{"items":[7]}');
  });
});
