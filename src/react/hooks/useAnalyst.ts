import { useMemo, useRef } from 'react';
import type { AnalystHost } from '@/services/analyst-actions';
import type { TimeRange } from '@/components';
import { setSiteVariantRuntime } from '@/config/variant';
import { setTheme } from '@/utils';
import { AnalystCommandHost, type AnalystHostBridge } from '@/controllers/AnalystCommandHost';

/**
 * useAnalyst — the React port of the agentic analyst control surface.
 *
 * It does NOT reimplement the analyst. It constructs the SAME framework-agnostic
 * `AnalystCommandHost` the vanilla App uses (verbatim — no forked vocabulary) and
 * feeds it a React-wired `AnalystHostBridge`. The one capability that matters for
 * this surface — `setSiteVariant` — is routed through the EXACT one-switch path
 * App already owns (`setSiteVariantRuntime` + the React state/URL reflect passed
 * in as `onVariantChange`), so an agent's `set_variant` action and a human tab
 * click land on the same switch. `setAppTheme` is likewise wired to the real
 * theme manager.
 *
 * The remaining bridge members project host-owned surfaces the React foundation
 * slice does not mount yet (the deck.gl MapContainer instance, the immersive
 * controller, the grid panel registry, keyword monitors). They are HONEST stubs:
 * reads return empty/neutral snapshots and writes return `false`, so the ONE
 * dispatcher (`app-commands.dispatch`) reports "not available" in its action log
 * rather than pretending. As those surfaces are hoisted into the React tree, each
 * stub is replaced by a real accessor — the port shape never changes.
 *
 * The returned `host` identity is STABLE for the hook's lifetime (AnalystChat
 * holds it for its whole session); freshness comes from the closures reading live
 * module state (`getSiteVariant`) and the `onVariantChange` ref, never from
 * rebuilding the host.
 */
export interface UseAnalystArgs {
  /** The ONE React variant switch — App's `handleSelect`. Canonicalises + persists
   *  + reflects React state and the shareable URL. The agent's set_variant routes
   *  here so there is exactly one switch path. */
  onVariantChange: (id: string) => void;
}

export function useAnalyst({ onVariantChange }: UseAnalystArgs): { host: AnalystHost } {
  // Latest callback in a ref so the host can be built once yet always call the
  // current switch (App may re-create handleSelect across renders).
  const onVariant = useRef(onVariantChange);
  onVariant.current = onVariantChange;

  // Org snapshot lives here, mutated in place exactly like App's `this.analystOrgs`
  // — AnalystCommandHost.build() primes it async via listOrgs().
  const orgsRef = useRef<Array<{ id: string; name: string }>>([]);

  const host = useMemo<AnalystHost>(() => {
    const bridge: AnalystHostBridge = {
      // ── introspection reads ──────────────────────────────────────────────────
      getTimeRange: () => '24h' as TimeRange, // no global time-range control on this surface yet
      getMap: () => null, // GlobeIsland owns the MapContainer internally; not hoisted to the host
      getImmersive: () => null,
      getLayoutMode: () => 'grid',
      getMonitors: () => [],
      getPanelSettings: () => ({}),
      getLocalizedPanelName: (_key, fallback) => fallback,
      isDesktopApp: () => false,
      getMapLayers: () => ({}) as ReturnType<AnalystHostBridge['getMapLayers']>,
      getAnalystOrgs: () => orgsRef.current,
      setAnalystOrgs: (orgs) => {
        orgsRef.current = orgs;
      },

      // ── wired capabilities ───────────────────────────────────────────────────
      // set_variant → the ONE React switch. Validate/canonicalise once for the
      // agent's boolean receipt, then drive App's handleSelect so React state +
      // URL reflect it through the single path.
      setSiteVariant: (variant) => {
        const applied = setSiteVariantRuntime(variant);
        if (!applied) return false;
        onVariant.current(applied);
        return true;
      },
      setAppTheme: (theme) => {
        setTheme(theme);
        return true;
      },

      // ── surfaces not mounted in the React foundation slice yet — honest stubs ─
      setPanelEnabled: () => false,
      movePanelInGrid: () => false,
      resizePanelInGrid: () => false,
      setMapLayerEnabled: () => false,
      setMapProjection: () => false,
      flyMapTo: () => false,
      setMapRegion: () => false,
      setGlobalTimeRange: () => false,
      runSearch: () => false,
      resetPanelLayout: () => {},
      queueVideoToWatch: () => Promise.resolve({ ok: false, note: 'Watch queue is not available on this surface yet.' }),
      setLayoutModeFromCommand: () => false,
      setImmersiveBackgroundFromCommand: () => false,
      setLanguageFromCommand: () => false,
      addMonitorFromCommand: () => ({ ok: false }),
      removeMonitorFromCommand: () => false,
      addCustomFeedPanel: () => Promise.resolve({ ok: false, note: 'Custom feed panels are not available on this surface yet.' }),
      removeCustomFeedPanel: () => false,
      switchActiveOrg: () => Promise.resolve({ ok: false, note: 'Org switching is not available on this surface yet.' }),
    };
    return new AnalystCommandHost(bridge).build();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { host };
}
