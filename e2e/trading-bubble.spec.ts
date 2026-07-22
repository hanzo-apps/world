import { expect, test, type Page } from '@playwright/test';

// Markets Bubble — the whole market universe as one D3 circle-pack.
//
// The panel is fed by the shared market-universe service (Yahoo passthrough +
// CoinGecko), joined to the universe metadata. We mock both endpoints with small
// deterministic fixtures, un-hide the opt-in panel and scroll it into view to trip
// its IntersectionObserver → lazy build (same path stations-wall uses; the full
// variant has no finance TradingView terminal to occlude the hover). Then we assert:
// bubbles render across the classes (a class ring/label per class, many leaf
// circles), hovering a leaf shows the tooltip with a signed %, and the panel survives
// a live re-poll (under VITE_E2E the poll runs on a short cadence and the service
// cache TTL is tiny, so a real second round-trip happens within the test).

// Deterministic percent moves — a mix of up/down plus a big mover, so leaves span the
// green→red diverging scale.
const PCTS = [3.4, -2.6, 0.3, -4.8, 1.9, -0.7, 2.2, -1.4];

function yahooBatchBody(url: string): unknown {
  const symbols = (new URL(url).searchParams.get('symbols') ?? '').split(',').filter(Boolean);
  const results = symbols.map((symbol, i) => {
    const pct = PCTS[i % PCTS.length];
    const price = 100 + i;
    const previousClose = price / (1 + pct / 100);
    return {
      symbol,
      chart: {
        chart: {
          result: [
            {
              meta: { regularMarketPrice: price, previousClose },
              indicators: { quote: [{ close: [previousClose, price] }] },
            },
          ],
        },
      },
    };
  });
  return { results };
}

const COINGECKO = [
  { id: 'bitcoin', current_price: 62000, price_change_percentage_24h: 2.8, sparkline_in_7d: { price: [61000, 62000] } },
  { id: 'ethereum', current_price: 3400, price_change_percentage_24h: -1.9, sparkline_in_7d: { price: [3450, 3400] } },
  { id: 'solana', current_price: 145, price_change_percentage_24h: 5.1, sparkline_in_7d: { price: [138, 145] } },
];

test.describe('Markets Bubble — every asset class as one circle-pack', () => {
  test('renders bubbles across classes, tooltips on hover, and survives a re-poll', async ({ page }) => {
    let batchHits = 0;
    const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    await page.route('**/v1/world/yahoo-batch**', (r) => {
      batchHits += 1;
      return r.fulfill(json(yahooBatchBody(r.request().url())));
    });
    await page.route('**/v1/world/coingecko**', (r) => r.fulfill(json(COINGECKO)));

    await page.goto('/?variant=full');

    // Un-hide the opt-in panel and scroll it into view → IntersectionObserver fires →
    // the bubble builds lazily.
    const panel = page.locator('.panel[data-panel="trading-bubble"]');
    await panel.waitFor({ state: 'attached', timeout: 30000 });
    await page.evaluate(() => {
      const el = document.querySelector('.panel[data-panel="trading-bubble"]') as HTMLElement | null;
      el?.classList.remove('hidden');
      el?.scrollIntoView();
    });

    // Leaf circles render — the universe has 34 Yahoo symbols + 3 crypto, so plenty.
    const leaves = page.locator('.trading-bubble .tb-leaf-circle');
    await expect(leaves.first()).toBeVisible({ timeout: 30000 });
    expect(await leaves.count()).toBeGreaterThan(20);

    // One cluster per class present — all five classes are mocked, so ≥ 3.
    const classLabels = page.locator('.trading-bubble .tb-class-label');
    expect(await classLabels.count()).toBeGreaterThanOrEqual(3);

    // Hover the largest bubble → tooltip appears with a signed %.
    await leaves.first().hover();
    const tooltip = page.locator('.trading-bubble-tooltip.visible');
    await expect(tooltip).toBeVisible({ timeout: 10000 });
    await expect(tooltip.locator('.tb-tt-chg')).toContainText('%');

    // Survives a live re-poll: the short-cadence e2e poll makes a second upstream
    // round-trip, and the circles are reused by id (count stays stable, no teardown).
    const before = await leaves.count();
    await expect.poll(() => batchHits, { timeout: 12000 }).toBeGreaterThan(1);
    await expect(leaves.first()).toBeVisible();
    expect(await leaves.count()).toBe(before);
  });
});
