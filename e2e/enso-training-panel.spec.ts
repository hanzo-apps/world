import { expect, test } from '@playwright/test';

// Mounts the real EnsoTrainingPanel against stubbed router-stats + served-model
// catalog payloads and asserts the rendered DOM. The redesign REPLACED the opaque
// "Enso arm N" routing mix with the REAL served-model catalog (real names, tiers,
// pricing) — this asserts that new surface: real model rows (never opaque arms,
// never a third-party vendor name), the cost-saved headline, the retrain gate
// verdict, and the honest "—" shadow state. Mirrors the app-level assertions in
// e2e/enso-real-models.spec.ts at the runtime-harness (unit) level.
test.describe('Enso Live Training panel', () => {
  test('renders the real served-model catalog, cost-saved headline and retrain gate — no opaque arms, no vendor names', async ({ page }) => {
    await page.goto('/tests/runtime-harness.html');

    const result = await page.evaluate(async () => {
      const ROUTER_STATS = {
        scope: 'platform',
        window: { since: '2026-07-15T00:00:00Z', until: '2026-07-16T00:00:00Z', events: 48210 },
        cost: { saved_pct: 21.5, cumulative_saved_index: 1372, baseline_model: 'arm-1', priced_events: 41000 },
        quality: { reward_rate: 0.31, rewarded_events: 1200, engine_share: 0.62, avg_confidence: 0.74, shadow_agreement: null },
        by_task: { chat: { events: 30000, models: { 'arm-1': 18000, 'arm-2': 12000 } } },
        by_model: { 'arm-1': 30000, 'arm-2': 14000, 'arm-3': 4210 }, // opaque arms — must NOT render
        throughput: { per_hour: Array.from({ length: 24 }, (_, i) => 1500 + i * 40), total_window: 48210 },
        retrain: {
          version: 'router-2026.07.16', trained_time: '2026-07-16T00:00:00Z', events: 48210,
          gate_passed: true, published: true, gate_kind: 'holdout', gate_metric: 'reward',
          gate_value: 0.312, gate_base: 0.298, note: 'shipped',
        },
      };
      // The REAL served catalog the router trains across — Hanzo's own models only.
      const CLOUD_MODELS = {
        updatedAt: '2026-07-16T00:00:00Z',
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

      // Stub the same-origin proxies the panel calls, by endpoint.
      const origFetch = window.fetch;
      window.fetch = (async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        const body = url.includes('/cloud/models') ? CLOUD_MODELS : ROUTER_STATS;
        return { ok: true, status: 200, json: async () => body } as Response;
      }) as typeof window.fetch;

      const { EnsoTrainingPanel } = await import('/src/components/EnsoTrainingPanel.ts');
      const panel = new EnsoTrainingPanel();
      const root = panel.getElement();
      document.body.appendChild(root);

      // Wait for the async fetch → render to land (real model rows appear).
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline && root.querySelectorAll('.cloud-model-row').length === 0) {
        await new Promise((r) => setTimeout(r, 30));
      }

      const modelNames = Array.from(root.querySelectorAll('.cloud-model-name')).map(
        (n) => (n.textContent ?? '').trim(),
      );
      const text = root.textContent ?? '';

      panel.destroy();
      root.remove();
      window.fetch = origFetch;

      return { modelNames, text };
    });

    // The three REAL served models render by name — never opaque "arm-N".
    expect(result.modelNames.length).toBe(3);
    expect(result.modelNames[0]).toContain('Zen 5');
    expect(result.modelNames[1]).toContain('Zen 5 Flash');
    expect(result.modelNames[2]).toContain('Fable 5');
    expect(result.text).toContain('models served');
    // The opaque per-arm mix is GONE.
    expect(result.text).not.toContain('Enso arm');
    expect(result.text).not.toContain('arm-1');
    // No third-party vendor identity leaks through the served catalog.
    for (const vendor of ['claude', 'anthropic', 'gpt', 'openai', 'deepseek', 'qwen', 'gemini', 'llama']) {
      expect(result.text.toLowerCase()).not.toContain(vendor);
    }

    // Headline cost-saved + retrain gate verdict + honest empty shadow state.
    expect(result.text).toContain('21.5%');
    expect(result.text).toContain('passed');
    expect(result.text).toContain('Shadow-vs-served agreement: —');
  });
});
