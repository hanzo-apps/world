import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * DeFi variant e2e — the crypto→DeFi board asserted against the real DOM, with the
 * /v1/world/defi/* backend stubbed (the vite dev server serves only the SPA). It
 * proves the deliverables: the board mounts, the hero populates, the full 190-chain
 * table renders + sorts + filters, honest "—" shows where a metric is absent, and
 * the globe's bridge-flow layer is fetched. Fixtures mirror the Go BFF contract.
 */

const NATIVE = [
  { slug: 'lux', name: 'Lux Network', symbol: 'LUX', txns: 20618, blockHeight: 1096461, addresses: 67, tps: 0, live: true, native: true },
  { slug: 'zoo', name: 'Zoo Network', symbol: 'ZOO', txns: 12323, blockHeight: 13369, addresses: 53, tps: 0, live: true, native: true },
  { slug: 'hanzo', name: 'Hanzo Network', symbol: 'AI', txns: 10, blockHeight: 11, addresses: 10, tps: 0, live: true, native: true },
  { slug: 'pars', name: 'Pars Network', symbol: 'PARS', txns: 58, blockHeight: 63, addresses: 11, tps: 0, live: true, native: true },
  { slug: 'spc', name: 'Sparkle Pony', symbol: 'SPC', txns: 2, blockHeight: 13, addresses: 2, tps: 0, live: true, native: true },
  { slug: 'dex', name: 'Lux DEX', symbol: 'LUX', txns: null, blockHeight: null, addresses: null, tps: null, live: false, native: true },
];

function bridgeRows() {
  // 184 bridge-supported chains (identity only). ethereum/bitcoin explicitly present
  // so the search assertion targets a known slug.
  const seed = ['ethereum', 'bitcoin', 'solana', 'polygon', 'arbitrum', 'base', 'avalanchec', 'binance', 'optimism'];
  const rows = [] as unknown[];
  for (let i = 0; i < 184; i++) {
    const slug = i < seed.length ? seed[i] : `chain${i}`;
    rows.push({
      slug, name: slug.charAt(0).toUpperCase() + slug.slice(1), symbol: slug.slice(0, 4).toUpperCase(),
      logo: `https://assets.lux.network/blockchains/${slug}/info/logo.png`,
      native: false, bridge: true, live: false,
      blockHeight: null, txns: null, addresses: null, tps: null, blockTime: null, tvlUsd: null, status: 'active',
    });
  }
  return rows;
}

function chainsFixture() {
  const chains = [
    ...NATIVE.map((n) => ({
      slug: n.slug, name: n.name, symbol: n.symbol, logo: '', explorer: 'https://explore.lux.network',
      native: true, bridge: true, live: n.live,
      blockHeight: n.blockHeight, txns: n.txns, addresses: n.addresses, tps: n.tps, blockTime: null, tvlUsd: null, status: 'active',
    })),
    ...bridgeRows(),
  ];
  return {
    updatedAt: new Date().toISOString(), chainCount: chains.length, nativeCount: 6, bridgeCount: 184,
    liveCount: 5, metricsSource: 'https://explorer.lux.network', tvlProvenance: 'unavailable', chains,
  };
}

const OVERVIEW = {
  updatedAt: new Date().toISOString(), chainCount: 190, nativeCount: 6, bridgeCount: 184, liveCount: 5,
  totalTxns: 33011, totalBlocks: 1109917, totalAddresses: 143, aggregateTps: 0, totalTvlUsd: null, volume24hUsd: null,
  metricsSource: 'https://explorer.lux.network', tvlProvenance: 'unavailable',
  topChains: NATIVE.filter((n) => n.live).map((n) => ({ slug: n.slug, name: n.name, symbol: n.symbol, txns: n.txns ?? 0, tps: n.tps, tvlUsd: null, live: n.live })),
};

const FLOWS = {
  updatedAt: new Date().toISOString(), modeled: true, hubSlug: 'lux',
  flows: [
    { fromSlug: 'lux', toSlug: 'zoo', fromLat: 37.77, fromLon: -122.42, toLat: 40.71, toLon: -74.01, weight: 1, label: 'LUX ⇄ ZOO', realFlow: true },
    { fromSlug: 'lux', toSlug: 'ethereum', fromLat: 37.77, fromLon: -122.42, toLat: 41, toLon: -74, weight: 0.85, label: 'LUX ⇄ Ethereum', realFlow: false },
  ],
};

const PROTOCOLS = {
  updatedAt: new Date().toISOString(), metricsSource: 'https://explorer.lux.network', poolCount: 16,
  pools: [
    { chain: 'Lux Network', pair: 'USDC/USDT', token0: 'USDC', token1: 'USDT', tvlUsd: null, volUsd: null },
    { chain: 'Lux Network', pair: 'WLUX/USDT', token0: 'WLUX', token1: 'USDT', tvlUsd: null, volUsd: null },
  ],
};

async function stubDefi(page: Page): Promise<{ flowsRequested: () => boolean }> {
  let flowsRequested = false;
  await page.route('**/v1/world/**', (route: Route) => {
    const url = route.request().url();
    const json = (body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.includes('/v1/world/defi/overview')) return json(OVERVIEW);
    if (url.includes('/v1/world/defi/chains')) return json(chainsFixture());
    if (url.includes('/v1/world/defi/flows')) { flowsRequested = true; return json(FLOWS); }
    if (url.includes('/v1/world/defi/protocols')) return json(PROTOCOLS);
    // Everything else the app polls: harmless empty payloads.
    return json([]);
  });
  return { flowsRequested: () => flowsRequested };
}

async function openDefiVariant(page: Page): Promise<void> {
  await page.addInitScript(() => localStorage.setItem('worldmonitor-variant', 'crypto'));
  await page.goto('/?variant=crypto');
  await page.waitForSelector('.panel', { timeout: 30_000 });
}

test('DeFi board mounts with hero + 190-chain table', async ({ page }) => {
  await stubDefi(page);
  await openDefiVariant(page);

  const board = page.locator('.panel[data-panel="defi-board"]');
  await expect(board).toBeVisible({ timeout: 30_000 });

  // Hero: stat tiles populate and the chain count (190) is shown.
  await expect(board.locator('.defi-hero .cloud-stat')).toHaveCount(6);
  await expect(board.locator('.defi-hero')).toContainText('190');
  await expect(board.locator('.defi-provenance')).toContainText('explorer.lux.network');

  // The full universe renders (190 rows).
  await expect(board.locator('.defi-row')).toHaveCount(190, { timeout: 30_000 });

  // Native chains lead and are txns-sorted (Lux first, then Zoo).
  const first = board.locator('.defi-row').first();
  await expect(first).toContainText('Lux Network');
  await expect(first.locator('.defi-badge-native')).toBeVisible();
});

test('sorting + searching the chain table', async ({ page }) => {
  await stubDefi(page);
  await openDefiVariant(page);
  const board = page.locator('.panel[data-panel="defi-board"]');
  await expect(board.locator('.defi-row')).toHaveCount(190);

  // Sort by Chain name (asc) → first row becomes alphabetical, not Lux.
  await board.locator('.defi-th[data-sort="name"]').click();
  await expect(board.locator('.defi-th[data-sort="name"]')).toHaveClass(/active/);
  await expect(board.locator('.defi-row').first()).not.toContainText('Lux Network');

  // Search narrows to a single known slug.
  await board.locator('.defi-search').fill('ethereum');
  await expect(board.locator('.defi-row')).toHaveCount(1);
  await expect(board.locator('.defi-row').first()).toContainText('Ethereum');

  // Clearing restores the full set.
  await board.locator('.defi-search').fill('');
  await expect(board.locator('.defi-row')).toHaveCount(190);
});

test('honest "—" for absent metrics + Live filter', async ({ page }) => {
  await stubDefi(page);
  await openDefiVariant(page);
  const board = page.locator('.panel[data-panel="defi-board"]');
  await expect(board.locator('.defi-row')).toHaveCount(190);

  // A bridge row (identity only) shows em-dashes for every metric — never a 0.
  const bridgeRow = board.locator('.defi-row', { hasText: 'Bitcoin' }).first();
  await expect(bridgeRow.locator('.defi-badge-bridge')).toBeVisible();
  await expect(bridgeRow).toContainText('—');

  // The "Live" filter collapses to just the reachable chains (5 live natives).
  await board.locator('.defi-chip[data-filter="live"]').click();
  await expect(board.locator('.defi-row')).toHaveCount(5);
});

test('bridge-flow layer is fetched for the globe', async ({ page }) => {
  const { flowsRequested } = await stubDefi(page);
  await openDefiVariant(page);
  await expect(page.locator('.panel[data-panel="defi-board"]')).toBeVisible();
  // The DeckGL map pulls /v1/world/defi/flows to draw the Lux hub↔counterparty arcs.
  await expect.poll(() => flowsRequested(), { timeout: 30_000 }).toBe(true);
});
