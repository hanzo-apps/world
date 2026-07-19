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
});
