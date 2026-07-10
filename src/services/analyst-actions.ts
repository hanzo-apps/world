/**
 * AI Analyst — action contract compatibility surface.
 *
 * The control surface moved to `app-commands.ts` — the single source of truth:
 * capability port (AppHost) + typed command registry + the ONE dispatcher +
 * the backend manifest. This module only re-exports the stable TYPE names the
 * rest of the app already imports, so there is exactly one port type and one
 * executor, never a forked vocabulary.
 *
 *   AnalystHost   → AppHost     (the capability port App implements)
 *   AnalystAction → RawCommand  (the flat `{type, ...params}` wire action)
 */

export type { AppHost as AnalystHost, RawCommand as AnalystAction } from './app-commands';
