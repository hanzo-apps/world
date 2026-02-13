import { expect, test } from '@playwright/test';

test.describe('desktop runtime routing guardrails', () => {
  test('detectDesktopRuntime covers packaged tauri hosts', async ({ page }) => {
    await page.goto('/runtime-harness.html');

    const result = await page.evaluate(async () => {
      const runtime = await import('/src/services/runtime.ts');
      return {
        tauriHost: runtime.detectDesktopRuntime({
          hasTauriGlobals: false,
          userAgent: 'Mozilla/5.0',
          locationProtocol: 'https:',
          locationHost: 'tauri.localhost',
          locationOrigin: 'https://tauri.localhost',
        }),
        tauriScheme: runtime.detectDesktopRuntime({
          hasTauriGlobals: false,
          userAgent: 'Mozilla/5.0',
          locationProtocol: 'tauri:',
          locationHost: '',
          locationOrigin: 'tauri://localhost',
        }),
        tauriUa: runtime.detectDesktopRuntime({
          hasTauriGlobals: false,
          userAgent: 'Mozilla/5.0 Tauri/2.0',
          locationProtocol: 'https:',
          locationHost: 'example.com',
          locationOrigin: 'https://example.com',
        }),
        tauriGlobal: runtime.detectDesktopRuntime({
          hasTauriGlobals: true,
          userAgent: 'Mozilla/5.0',
          locationProtocol: 'https:',
          locationHost: 'example.com',
          locationOrigin: 'https://example.com',
        }),
        secureLocalhost: runtime.detectDesktopRuntime({
          hasTauriGlobals: false,
          userAgent: 'Mozilla/5.0',
          locationProtocol: 'https:',
          locationHost: 'localhost',
          locationOrigin: 'https://localhost',
        }),
        insecureLocalhost: runtime.detectDesktopRuntime({
          hasTauriGlobals: false,
          userAgent: 'Mozilla/5.0',
          locationProtocol: 'http:',
          locationHost: 'localhost:5173',
          locationOrigin: 'http://localhost:5173',
        }),
        webHost: runtime.detectDesktopRuntime({
          hasTauriGlobals: false,
          userAgent: 'Mozilla/5.0',
          locationProtocol: 'https:',
          locationHost: 'worldmonitor.app',
          locationOrigin: 'https://worldmonitor.app',
        }),
      };
    });

    expect(result.tauriHost).toBe(true);
    expect(result.tauriScheme).toBe(true);
    expect(result.tauriUa).toBe(true);
    expect(result.tauriGlobal).toBe(true);
    expect(result.secureLocalhost).toBe(true);
    expect(result.insecureLocalhost).toBe(false);
    expect(result.webHost).toBe(false);
  });

  test('runtime fetch patch falls back to cloud for local failures', async ({ page }) => {
    await page.goto('/runtime-harness.html');

    const result = await page.evaluate(async () => {
      const runtime = await import('/src/services/runtime.ts');
      const globalWindow = window as unknown as Record<string, unknown>;
      const originalFetch = window.fetch.bind(window);

      const calls: string[] = [];
      const responseJson = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        });

      window.fetch = (async (input: RequestInfo | URL) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
            ? input.toString()
            : input.url;

        calls.push(url);

        if (url.includes('127.0.0.1:46123/api/fred-data')) {
          return responseJson({ error: 'missing local api key' }, 500);
        }
        if (url.includes('worldmonitor.app/api/fred-data')) {
          return responseJson({ observations: [{ value: '321.5' }] }, 200);
        }

        if (url.includes('127.0.0.1:46123/api/stablecoin-markets')) {
          throw new Error('ECONNREFUSED');
        }
        if (url.includes('worldmonitor.app/api/stablecoin-markets')) {
          return responseJson({ stablecoins: [{ symbol: 'USDT' }] }, 200);
        }

        return responseJson({ ok: true }, 200);
      }) as typeof window.fetch;

      const previousTauri = globalWindow.__TAURI__;
      globalWindow.__TAURI__ = { core: { invoke: () => Promise.resolve(null) } };
      delete globalWindow.__wmFetchPatched;

      try {
        runtime.installRuntimeFetchPatch();

        const fredResponse = await window.fetch('/api/fred-data?series_id=CPIAUCSL');
        const fredBody = await fredResponse.json() as { observations?: Array<{ value: string }> };

        const stableResponse = await window.fetch('/api/stablecoin-markets');
        const stableBody = await stableResponse.json() as { stablecoins?: Array<{ symbol: string }> };

        return {
          fredStatus: fredResponse.status,
          fredValue: fredBody.observations?.[0]?.value ?? null,
          stableStatus: stableResponse.status,
          stableSymbol: stableBody.stablecoins?.[0]?.symbol ?? null,
          calls,
        };
      } finally {
        window.fetch = originalFetch;
        delete globalWindow.__wmFetchPatched;
        if (previousTauri === undefined) {
          delete globalWindow.__TAURI__;
        } else {
          globalWindow.__TAURI__ = previousTauri;
        }
      }
    });

    expect(result.fredStatus).toBe(200);
    expect(result.fredValue).toBe('321.5');
    expect(result.stableStatus).toBe(200);
    expect(result.stableSymbol).toBe('USDT');

    expect(result.calls.some((url) => url.includes('127.0.0.1:46123/api/fred-data'))).toBe(true);
    expect(result.calls.some((url) => url.includes('worldmonitor.app/api/fred-data'))).toBe(true);
    expect(result.calls.some((url) => url.includes('127.0.0.1:46123/api/stablecoin-markets'))).toBe(true);
    expect(result.calls.some((url) => url.includes('worldmonitor.app/api/stablecoin-markets'))).toBe(true);
  });
});
