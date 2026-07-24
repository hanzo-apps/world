import { useSyncExternalStore } from 'react';
import type { MapContainer } from '@/components/MapContainer';
import type { CountryClickPayload } from '@/components/DeckGLMap';
import type { AnalystHost } from '@/services/analyst-actions';
import type { Panel } from '@/components';
import { CountryIntelController } from '@/controllers/CountryIntelController';
import { getGlobeInstance, subscribeGlobeInstance } from './globe-instance';

/**
 * useCountryIntel — the React seam onto the vanilla `CountryIntelController`.
 *
 * It does NOT re-implement the country drill-down. It instantiates the EXISTING
 * controller verbatim (the one that owns the fullscreen `CountryBriefPage`, the
 * globe country-click wiring, brief generation, the 7-day timeline, per-country
 * signals, the shareable story and the ?country= history sync) and drives it off
 * the React globe island through the `globe-instance` registry — the same live
 * `MapContainer` the vanilla App would have handed it via `getMap: () => this.map`.
 *
 * The controller is created ONCE (module singleton, app-global lifetime — exactly
 * like the vanilla App holds it for the app's life) the first time a globe
 * instance is published. `setup()` runs once and binds the globe's country-click
 * handler; the fullscreen brief overlay it manages is vanilla DOM, unchanged.
 *
 * What this hook adds on top of the controller is React *observability*: it wraps
 * the MapContainer in a transparent Proxy that taps the exact three seams the
 * controller uses to change the selection — `onCountryClicked` (globe click),
 * `highlightCountry` (every open, including deep-link / history restore) and
 * `clearCountryHighlight` (close) — and mirrors them into a tiny external store.
 * The controller stays byte-for-byte; the Proxy delegates every other method to
 * the real instance. React components read the store via `useSyncExternalStore`.
 *
 * Coupling honestly bounded (see notes in the port): the controller's data
 * accessors (`getAllNews`, `getLatestClusters`, `getLatestPredictions`,
 * `getIntelligenceCache`, `getPanels`) read App's ingest pipeline, which the React
 * shell has not wired yet — they resolve to empty here, so signals/timeline/news
 * come up empty and the server brief runs on the coordinates+score context alone
 * (graceful, same code path). `getShareUrl` returns null (no URL rewrite yet).
 * `buildAnalystHost` returns a null-object host so the in-brief analyst dock is
 * inert rather than crashing. Each is a single injection point that the owning
 * agent swaps for the real accessor when its surface lands — no rewrite needed.
 */

export interface CountryIntelSelection {
  /** ISO code of the country whose brief is open, or null. */
  code: string | null;
  /** Display name of that country, or null. */
  name: string | null;
  /** Whether the fullscreen brief overlay is currently showing. */
  visible: boolean;
}

export interface CountryIntelApi extends CountryIntelSelection {
  /** Open (or switch to) a country's fullscreen brief — the same funnel the globe
   *  click, deep link and search all pass through. Name is resolved if omitted. */
  openByCode: (code: string, name?: string) => void;
  /** Open the shareable story modal for a country (no-op until data has loaded). */
  openStory: (code: string, name?: string) => void;
  /** Canonical display name for an ISO code (Intl + Tier-1 overrides). */
  resolveName: (code: string) => string;
  /** True once the globe is mounted and the controller is live. */
  ready: boolean;
}

// ── External store (the selection React mirrors) ──────────────────────────────

const EMPTY: CountryIntelSelection = { code: null, name: null, visible: false };

let selection: CountryIntelSelection = EMPTY;
const listeners = new Set<() => void>();

function setSelection(next: CountryIntelSelection): void {
  if (
    next.code === selection.code &&
    next.name === selection.name &&
    next.visible === selection.visible
  ) {
    return;
  }
  selection = next;
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

// The most recent name a code+name globe click carried, so the lat/lon → geocode
// path and history restores (which reach the controller as bare codes) still get
// the human name the click had, falling back to the canonical resolver.
const nameByCode = new Map<string, string>();

// ── Null-object analyst host ──────────────────────────────────────────────────

/**
 * The controller's `setup()` unconditionally wires an analyst dock into the brief
 * via `setAnalystHost(buildAnalystHost())`. The dock is a separate concern (its
 * own port). Until that lands, hand the brief a null-object host: the dock renders
 * inert instead of crashing, and every capability answers honestly-empty. The
 * integrate step replaces this the moment the real host factory exists.
 */
/**
 * The provider the controller's brief pulls its analyst host from. Defaults to the
 * null object; the integrate step calls `setCountryIntelAnalystHost` once (with the
 * host from the analyst port's `useAnalyst()`) to light the in-brief dock up for
 * real. A provider fn (not a value) so it's read fresh at `setup()` time regardless
 * of mount ordering.
 */
let analystHostProvider: () => AnalystHost = () => nullAnalystHost;

/** Inject the real analyst host into the country brief. The one wiring point. */
export function setCountryIntelAnalystHost(provider: () => AnalystHost): void {
  analystHostProvider = provider;
}

const nullAnalystHost: AnalystHost = {
  getState: () => ({ variant: '', timeRange: '7d' }),
  listPanels: () => [],
  listLayers: () => [],
  listOrgs: () => [],
  isAuthed: () => false,
  showPanel: () => false,
  hidePanel: () => false,
  movePanel: () => false,
  resizePanel: () => false,
  toggleLayer: () => false,
  setMapMode: () => false,
  flyTo: () => false,
  setRegion: () => false,
  setTimeRange: () => false,
  setVariant: () => false,
  setTheme: () => false,
  search: () => false,
  resetLayout: () => {},
  setLayoutMode: () => false,
  setImmersiveBackground: () => false,
  setLanguage: () => false,
  addMonitor: () => ({ ok: false }),
  removeMonitor: () => false,
  queueNext: () => ({ ok: false }),
  queuePrev: () => ({ ok: false }),
  queueVideo: () => Promise.resolve({ ok: false }),
  addFeedPanel: () => Promise.resolve({ ok: false }),
  removeCustomPanel: () => false,
  switchOrg: () => Promise.resolve({ ok: false }),
};

// ── Observable MapContainer (transparent selection tap) ───────────────────────

/**
 * Wrap the live MapContainer so the three selection seams the controller drives
 * also update the store, then delegate everything else untouched. A Proxy keeps
 * the full `MapContainer` type without re-declaring its ~40 methods, and never
 * changes the controller's behaviour — it only observes.
 */
function observableMap(map: MapContainer): MapContainer {
  return new Proxy(map, {
    get(target, prop, receiver) {
      if (prop === 'onCountryClicked') {
        return (cb: (country: CountryClickPayload) => void): void => {
          target.onCountryClicked((payload) => {
            if (payload.code && payload.name) nameByCode.set(payload.code, payload.name);
            cb(payload);
          });
        };
      }
      if (prop === 'highlightCountry') {
        return (code: string): void => {
          const name = nameByCode.get(code) ?? CountryIntelController.resolveCountryName(code);
          setSelection({ code, name, visible: true });
          target.highlightCountry(code);
        };
      }
      if (prop === 'clearCountryHighlight') {
        return (): void => {
          setSelection(EMPTY);
          target.clearCountryHighlight();
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

// ── Controller lifecycle (created once, on first globe) ───────────────────────

let controller: CountryIntelController | null = null;
let started = false;

function ensureController(): void {
  if (started) return;
  started = true;
  subscribeGlobeInstance((map) => {
    if (!map || controller) return;
    controller = new CountryIntelController({
      // Live accessor over the registry — the React analogue of `() => this.map`.
      getMap: () => {
        const live = getGlobeInstance();
        return live ? observableMap(live) : null;
      },
      // The React shell has not wired App's ingest pipeline / vanilla Panel
      // instances yet; these resolve empty so the brief degrades gracefully.
      getPanels: () => ({} as Record<string, Panel>),
      getAllNews: () => [],
      getLatestClusters: () => [],
      getLatestPredictions: () => [],
      getIntelligenceCache: () => ({}),
      getShareUrl: () => null,
      buildAnalystHost: () => analystHostProvider(),
    });
    controller.setup();
  });
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Subscribe to the country-intel selection and get the imperative API. Safe to
 * call from any number of components — they share the ONE controller + store.
 */
export function useCountryIntel(): CountryIntelApi {
  ensureController();
  const snap = useSyncExternalStore(subscribe, () => selection, () => selection);

  return {
    ...snap,
    ready: controller != null,
    openByCode: (code, name) => {
      const resolved = name ?? nameByCode.get(code) ?? CountryIntelController.resolveCountryName(code);
      nameByCode.set(code, resolved);
      void controller?.openCountryBriefByCode(code, resolved);
    },
    openStory: (code, name) => {
      controller?.openCountryStory(code, name ?? nameByCode.get(code) ?? CountryIntelController.resolveCountryName(code));
    },
    resolveName: (code) => CountryIntelController.resolveCountryName(code),
  };
}
