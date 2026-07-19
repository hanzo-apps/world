import { expect, test } from '@playwright/test';

// Enso Live Training must reflect REAL models (the served catalog), never the opaque
// upstream "arm-N" routing mix that read as random/meaningless amounts. Both feeds are
// stubbed with real-shaped payloads; the router-stats stub deliberately includes an
// arm-N by_model map to prove it is NOT rendered anymore.

const ENSO = '.panel[data-panel="enso-training"]';

const ROUTER_STATS = {
  scope: 'platform',
  window: { since: '2026-07-17T00:00:00Z', until: '2026-07-18T00:00:00Z', events: 12345 },
  cost: { saved_pct: 0.23, cumulative_saved_index: 98765, baseline_model: 'x', priced_events: 100 },
  quality: { reward_rate: 0.5, rewarded_events: 10, engine_share: 0.62, avg_confidence: 0.8, shadow_agreement: 0.91 },
  by_task: {},
  by_model: { 'arm-1': 100, 'arm-2': 50, 'arm-3': 25 }, // opaque arms — must NOT render
  throughput: { per_hour: [1, 2, 3, 4, 5, 6], total_window: 21 },
  retrain: {
    version: 'v9', trained_time: '2026-07-17T12:00:00Z', events: 100, gate_passed: true,
    published: true, gate_kind: 'reward', gate_metric: 'rate', gate_value: 0.5, gate_base: 0.4, note: '',
  },
};

const CLOUD_MODELS = {
  updatedAt: '2026-07-18T00:00:00Z',
  totalModels: 42,
  zenModels: 8,
  cloudRegions: 5,
  cloudPlans: 3,
  families: ['Zen', 'Fable'],
  models: [
    { id: 'zen5', name: 'Zen 5', provider: 'hanzo', tier: 'flagship', context: 200000, inPrice: 3, outPrice: 15 },
    { id: 'zen5-flash', name: 'Zen 5 Flash', provider: 'hanzo', tier: 'fast', context: 128000, inPrice: 0.5, outPrice: 1.5 },
    { id: 'fable5', name: 'Fable 5', provider: 'hanzo', tier: 'premium', context: 400000, inPrice: 5, outPrice: 20 },
  ],
};

test.describe('Enso Live Training — real models only', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('renders the real served-model catalog, never opaque arm-N amounts', async ({ page }) => {
    await page.route('**/v1/world/cloud/router-stats*', (r) => r.fulfill({ json: ROUTER_STATS }));
    await page.route('**/v1/world/cloud/models', (r) => r.fulfill({ json: CLOUD_MODELS }));

    await page.goto('/');
    await page.waitForSelector(ENSO, { timeout: 45000 });
    const panel = page.locator(ENSO);

    // Real model names from the catalog appear.
    await expect(panel).toContainText('Zen 5 Flash', { timeout: 15000 });
    await expect(panel).toContainText('Fable 5');
    await expect(panel).toContainText('models served');
    // Real aggregates still render (unchanged, real telemetry).
    await expect(panel).toContainText('cost saved');
    // The opaque per-arm amounts are GONE — no meaningless "Enso arm N" rows.
    await expect(panel).not.toContainText('Enso arm');
    await expect(panel).not.toContainText('arm-1');
  });
});
