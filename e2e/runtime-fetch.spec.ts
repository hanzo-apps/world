import { expect, test } from '@playwright/test';

test.describe('desktop runtime routing guardrails', () => {
  test('detectDesktopRuntime covers packaged tauri hosts', async ({ page }) => {
    await page.goto('/tests/runtime-harness.html');

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
    await page.goto('/tests/runtime-harness.html');

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

        // The runtime patch only intercepts /v1/world/* paths. It first hits the
        // local sidecar (127.0.0.1:46123); on failure it retries the same path
        // against the remote API base — same-origin under VITE_VARIANT=full, so the
        // fallback arrives as a relative /v1/world/* URL, distinct from the absolute
        // local attempt.
        if (url.includes('127.0.0.1:46123/v1/world/fred-data')) {
          return responseJson({ error: 'missing local api key' }, 500);
        }
        if (url.startsWith('/v1/world/fred-data')) {
          return responseJson({ observations: [{ value: '321.5' }] }, 200);
        }

        if (url.includes('127.0.0.1:46123/v1/world/stablecoin-markets')) {
          throw new Error('ECONNREFUSED');
        }
        if (url.startsWith('/v1/world/stablecoin-markets')) {
          return responseJson({ stablecoins: [{ symbol: 'USDT' }] }, 200);
        }

        return responseJson({ ok: true }, 200);
      }) as typeof window.fetch;

      const previousTauri = globalWindow.__TAURI__;
      globalWindow.__TAURI__ = { core: { invoke: () => Promise.resolve(null) } };
      delete globalWindow.__wmFetchPatched;

      try {
        runtime.installRuntimeFetchPatch();

        const fredResponse = await window.fetch('/v1/world/fred-data?series_id=CPIAUCSL');
        const fredBody = await fredResponse.json() as { observations?: Array<{ value: string }> };

        const stableResponse = await window.fetch('/v1/world/stablecoin-markets');
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

    expect(result.calls.some((url) => url.includes('127.0.0.1:46123/v1/world/fred-data'))).toBe(true);
    expect(result.calls.some((url) => url.startsWith('/v1/world/fred-data'))).toBe(true);
    expect(result.calls.some((url) => url.includes('127.0.0.1:46123/v1/world/stablecoin-markets'))).toBe(true);
    expect(result.calls.some((url) => url.startsWith('/v1/world/stablecoin-markets'))).toBe(true);
  });

  test('chunk preload reload guard is one-shot until app boot clears it', async ({ page }) => {
    await page.goto('/tests/runtime-harness.html');

    const result = await page.evaluate(async () => {
      const {
        buildChunkReloadStorageKey,
        installChunkReloadGuard,
        clearChunkReloadGuard,
      } = await import('/src/bootstrap/chunk-reload.ts');

      const listeners = new Map<string, Array<() => void>>();
      const eventTarget = {
        addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
          const list = listeners.get(type) ?? [];
          list.push(() => {
            if (typeof listener === 'function') {
              listener(new Event(type));
            } else {
              listener.handleEvent(new Event(type));
            }
          });
          listeners.set(type, list);
        },
      };

      const storageMap = new Map<string, string>();
      const storage = {
        getItem: (key: string) => storageMap.get(key) ?? null,
        setItem: (key: string, value: string) => {
          storageMap.set(key, value);
        },
        removeItem: (key: string) => {
          storageMap.delete(key);
        },
      };

      const emit = (eventName: string) => {
        const handlers = listeners.get(eventName) ?? [];
        handlers.forEach((handler) => handler());
      };

      let reloadCount = 0;
      const storageKey = installChunkReloadGuard('9.9.9', {
        eventTarget,
        storage,
        eventName: 'preload-error',
        reload: () => {
          reloadCount += 1;
        },
      });

      emit('preload-error');
      emit('preload-error');
      const reloadCountBeforeClear = reloadCount;

      clearChunkReloadGuard(storageKey, storage);
      emit('preload-error');

      return {
        storageKey,
        expectedKey: buildChunkReloadStorageKey('9.9.9'),
        reloadCountBeforeClear,
        reloadCountAfterClear: reloadCount,
        storedValue: storageMap.get(storageKey) ?? null,
      };
    });

    expect(result.storageKey).toBe(result.expectedKey);
    expect(result.reloadCountBeforeClear).toBe(1);
    expect(result.reloadCountAfterClear).toBe(2);
    expect(result.storedValue).toBe('1');
  });

  // The upstream worldmonitor.app update-badge + arch-aware desktop-download
  // machinery (App.resolveUpdateDownloadUrl / mapDesktopDownloadPlatform, driven by
  // the get_desktop_runtime_info Tauri command) was removed for Hanzo —
  // App.checkForUpdate is now a deliberate no-op and downloads are served from
  // /v1/world/download?platform=* via DownloadBanner. No behavior remains to assert
  // here, so the obsolete arch-resolution test was removed.

  test('loadMarkets keeps Yahoo-backed data when Finnhub is skipped', async ({ page }) => {
    await page.goto('/tests/runtime-harness.html');

    const result = await page.evaluate(async () => {
      const { App } = await import('/src/App.ts');
      const originalFetch = window.fetch.bind(window);

      const calls: string[] = [];
      const toUrl = (input: RequestInfo | URL): string => {
        if (typeof input === 'string') return new URL(input, window.location.origin).toString();
        if (input instanceof URL) return input.toString();
        return new URL(input.url, window.location.origin).toString();
      };
      const responseJson = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        });

      const yahooChart = (symbol: string) => {
        const base = symbol.length * 100;
        return {
          chart: {
            result: [{
              meta: {
                regularMarketPrice: base + 1,
                previousClose: base,
              },
              indicators: {
                quote: [{ close: [base - 2, base - 1, base, base + 1] }],
              },
            }],
          },
        };
      };

      const marketRenders: number[] = [];
      const marketConfigErrors: string[] = [];
      const heatmapRenders: number[] = [];
      const heatmapConfigErrors: string[] = [];
      const cryptoRenders: number[] = [];
      const apiStatuses: Array<{ name: string; status: string }> = [];

      window.fetch = (async (input: RequestInfo | URL) => {
        const url = toUrl(input);
        calls.push(url);
        const parsed = new URL(url);

        if (parsed.pathname === '/v1/world/finnhub') {
          return responseJson({
            quotes: [],
            skipped: true,
            reason: 'FINNHUB_API_KEY not configured',
          });
        }

        if (parsed.pathname === '/v1/world/yahoo-batch') {
          const symbols = (parsed.searchParams.get('symbols') ?? '').split(',').filter(Boolean);
          return responseJson({
            results: symbols.map((symbol) => ({ symbol, chart: yahooChart(symbol) })),
          });
        }

        if (parsed.pathname === '/v1/world/coingecko') {
          return responseJson([
            { id: 'bitcoin', current_price: 50000, price_change_percentage_24h: 1.2, sparkline_in_7d: { price: [1, 2, 3] } },
            { id: 'ethereum', current_price: 3000, price_change_percentage_24h: -0.5, sparkline_in_7d: { price: [1, 2, 3] } },
            { id: 'solana', current_price: 120, price_change_percentage_24h: 2.1, sparkline_in_7d: { price: [1, 2, 3] } },
          ]);
        }

        return responseJson({});
      }) as typeof window.fetch;

      const fakeApp = {
        latestMarkets: [] as Array<unknown>,
        panels: {
          markets: {
            renderMarkets: (data: Array<unknown>) => marketRenders.push(data.length),
            showConfigError: (message: string) => marketConfigErrors.push(message),
          },
          heatmap: {
            renderHeatmap: (data: Array<unknown>) => heatmapRenders.push(data.length),
            showConfigError: (message: string) => heatmapConfigErrors.push(message),
          },
          crypto: {
            renderCrypto: (data: Array<unknown>) => cryptoRenders.push(data.length),
          },
        },
        statusPanel: {
          updateApi: (name: string, payload: { status?: string }) => {
            apiStatuses.push({ name, status: payload.status ?? '' });
          },
        },
      };

      try {
        await (App.prototype as unknown as { loadMarkets: (thisArg: unknown) => Promise<void> })
          .loadMarkets.call(fakeApp);

        return {
          marketRenders,
          marketConfigErrors,
          heatmapRenders,
          heatmapConfigErrors,
          cryptoRenders,
          apiStatuses,
          latestMarketsCount: fakeApp.latestMarkets.length,
        };
      } finally {
        window.fetch = originalFetch;
      }
    });

    expect(result.marketRenders.some((count) => count > 0)).toBe(true);
    expect(result.latestMarketsCount).toBeGreaterThan(0);
    expect(result.marketConfigErrors.length).toBe(0);

    expect(result.heatmapRenders.length).toBe(0);
    expect(result.heatmapConfigErrors).toEqual(['FINNHUB_API_KEY not configured — add in Settings']);

    expect(result.cryptoRenders.some((count) => count > 0)).toBe(true);
    expect(result.apiStatuses.some((entry) => entry.name === 'Finnhub' && entry.status === 'error')).toBe(true);
    expect(result.apiStatuses.some((entry) => entry.name === 'CoinGecko' && entry.status === 'ok')).toBe(true);
  });
});
