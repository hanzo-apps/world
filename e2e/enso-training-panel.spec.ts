import { expect, test } from '@playwright/test';

// Mounts the real EnsoTrainingPanel against a stubbed router-stats payload and
// asserts the rendered DOM: opaque "Enso arm N" labels (NEVER a vendor name),
// the cost-saved headline, the retrain gate verdict, and the honest "—" shadow
// state. Mirrors e2e/investments-panel.spec.ts (runtime-harness).
test.describe('Enso Live Training panel', () => {
  test('renders opaque arms, cost-saved headline and retrain gate — no vendor names', async ({ page }) => {
    await page.goto('/tests/runtime-harness.html');

    const result = await page.evaluate(async () => {
      const CANNED = {
        scope: 'platform',
        window: { since: '2026-07-15T00:00:00Z', until: '2026-07-16T00:00:00Z', events: 48210 },
        cost: { saved_pct: 21.5, cumulative_saved_index: 1372, baseline_model: 'arm-1', priced_events: 41000 },
        quality: { reward_rate: 0.31, rewarded_events: 1200, engine_share: 0.62, avg_confidence: 0.74, shadow_agreement: null },
        by_task: { chat: { events: 30000, models: { 'arm-1': 18000, 'arm-2': 12000 } } },
        by_model: { 'arm-1': 30000, 'arm-2': 14000, 'arm-3': 4210 },
        throughput: { per_hour: Array.from({ length: 24 }, (_, i) => 1500 + i * 40), total_window: 48210 },
        retrain: {
          version: 'router-2026.07.16', trained_time: '2026-07-16T00:00:00Z', events: 48210,
          gate_passed: true, published: true, gate_kind: 'holdout', gate_metric: 'reward',
          gate_value: 0.312, gate_base: 0.298, note: 'shipped',
        },
      };

      // Stub the same-origin proxy the service calls.
      const origFetch = window.fetch;
      window.fetch = (async () =>
        ({ ok: true, status: 200, json: async () => CANNED })) as typeof window.fetch;

      const { EnsoTrainingPanel } = await import('/src/components/EnsoTrainingPanel.ts');
      const panel = new EnsoTrainingPanel();
      const root = panel.getElement();
      document.body.appendChild(root);

      // Wait for the async fetch → render to land.
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline && root.querySelectorAll('.cloud-model-row').length === 0) {
        await new Promise((r) => setTimeout(r, 30));
      }

      const armLabels = Array.from(root.querySelectorAll('.cloud-model-name')).map(
        (n) => (n.textContent ?? '').trim(),
      );
      const text = root.textContent ?? '';

      panel.destroy();
      root.remove();
      window.fetch = origFetch;

      return { armLabels, text };
    });

    // Three opaque arms, labeled by tier — never a vendor name.
    expect(result.armLabels.length).toBe(3);
    expect(result.armLabels[0]).toContain('Enso arm 1');
    expect(result.armLabels[1]).toContain('Enso arm 2');
    expect(result.armLabels[2]).toContain('Enso arm 3');
    for (const vendor of ['claude', 'anthropic', 'gpt', 'openai', 'deepseek', 'qwen', 'gemini', 'llama']) {
      expect(result.text.toLowerCase()).not.toContain(vendor);
    }

    // Headline cost-saved + retrain gate verdict + honest empty shadow state.
    expect(result.text).toContain('21.5%');
    expect(result.text).toContain('passed');
    expect(result.text).toContain('Shadow-vs-served agreement: —');
  });
});
