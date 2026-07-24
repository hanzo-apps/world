import { createContext, useContext, useEffect, useMemo, useRef } from 'react';
import type { MapLayers } from '@/types';
import { SearchController, type SearchControllerDeps } from '@/controllers/SearchController';

/**
 * useSearch — the ⌘K search / command-palette surface for the React shell.
 *
 * This is a THIN React lifecycle wrapper around the EXISTING vanilla
 * `SearchController`. It does NOT re-author any search logic: source
 * registration per site variant, the live search index, result routing
 * (map fly-to / panel scroll / country brief) and the global ⌘K keydown
 * handler all live in `@/controllers/SearchController` and are reused verbatim.
 * React only owns instantiation (`setup()` on mount / `destroy()` on unmount)
 * and hands the controller a DOM host node to mount its modal into.
 *
 * The controller reads its App-state deps through accessors (getMap, getAllNews,
 * …). We keep the SAME accessor contract but route every call through a live
 * ref, so a single controller instance always sees the freshest deps even as
 * the provider re-renders — identical semantics to the vanilla god-object's
 * direct field reads, no controller churn on data updates.
 */

/** The App-state accessors the search surface needs, all optional so the
 *  provider works standalone before the integrate step wires real sources.
 *  `container` is owned by the provider (its modal host div), never a prop. */
export type SearchDeps = Partial<Omit<SearchControllerDeps, 'container'>>;

/** Fallback layer object: handlers mutate `getMapLayers().<layer> = true`;
 *  mutating this shared stand-in is harmless until a real accessor is wired. */
const FALLBACK_LAYERS = {} as MapLayers;

export interface SearchContextValue {
  /** Open the modal, optionally prefilled with a query. */
  open: (query?: string) => void;
  /** Open + run a query (command-bar entrypoint); false if unavailable/empty. */
  runSearch: (query: string) => boolean;
  /** Re-index news / predictions / markets / countries from the latest deps. */
  updateSearchIndex: () => void;
  /** Whether the modal is currently open. */
  isOpen: () => boolean;
  /** Register tech-event rows as a searchable source (tech variant). */
  registerTechEvents: (
    events: { id: string; title: string; location: string; startDate: string }[],
  ) => void;
}

const SearchContext = createContext<SearchContextValue | null>(null);

/**
 * Access the search surface. Must be called within a <SearchProvider>.
 */
export function useSearch(): SearchContextValue {
  const ctx = useContext(SearchContext);
  if (!ctx) {
    throw new Error('useSearch must be used within a <SearchProvider>');
  }
  return ctx;
}

export interface SearchProviderProps {
  /** App-state accessors forwarded verbatim to the vanilla controller. */
  deps?: SearchDeps;
  children?: React.ReactNode;
}

/**
 * SearchProvider — mounts the vanilla SearchController against a hidden DOM
 * host and exposes its lifecycle to descendants via `useSearch()`. Drop it
 * high in the tree (it renders an empty modal-host div + its children).
 */
export function SearchProvider({ deps, children }: SearchProviderProps): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<SearchController | null>(null);

  // Latest deps held in a ref so the controller's accessor closures always read
  // fresh values without re-instantiating the controller on every data update.
  const depsRef = useRef<SearchDeps>(deps ?? {});
  depsRef.current = deps ?? {};

  // Instantiate the controller ONCE against the host node. StrictMode double-
  // invokes effects in dev; the setup()/destroy() pair is idempotent so we never
  // leave a dangling ⌘K listener or a second modal.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || controllerRef.current) return;

    const controller = new SearchController({
      container: host,
      getMap: () => depsRef.current.getMap?.() ?? null,
      getMapLayers: () => depsRef.current.getMapLayers?.() ?? FALLBACK_LAYERS,
      getPanels: () => depsRef.current.getPanels?.() ?? {},
      getAllNews: () => depsRef.current.getAllNews?.() ?? [],
      getLatestPredictions: () => depsRef.current.getLatestPredictions?.() ?? [],
      getLatestMarkets: () => depsRef.current.getLatestMarkets?.() ?? [],
      openCountryBriefByCode: (code, name) =>
        depsRef.current.openCountryBriefByCode?.(code, name),
    });
    controller.setup();
    controllerRef.current = controller;

    return () => {
      controller.destroy();
      controllerRef.current = null;
    };
  }, []);

  const value = useMemo<SearchContextValue>(
    () => ({
      open: (query) => controllerRef.current?.open(query),
      runSearch: (query) => controllerRef.current?.runSearch(query) ?? false,
      updateSearchIndex: () => controllerRef.current?.updateSearchIndex(),
      isOpen: () => controllerRef.current?.isOpen() ?? false,
      registerTechEvents: (events) => controllerRef.current?.registerTechEvents(events),
    }),
    [],
  );

  return (
    <SearchContext.Provider value={value}>
      <div ref={hostRef} data-search-host="" />
      {children}
    </SearchContext.Provider>
  );
}
