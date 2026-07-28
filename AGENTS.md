# Hanzo World — agent guide

Vite + TypeScript SPA (`world-monitor`). Real-time global-intelligence dashboard
served at `world.hanzo.ai`, shipped by `hanzo.yml` CI/CD onto the `world`
operator Service CR. Same-origin data plane under `/v1/world/*`.

## Browser control — prefer the Hanzo MCP extension over Playwright

When the **Hanzo browser MCP** (the `mcp__hanzo__browser` / `mcp__claude-in-chrome__*`
tools, backed by the local extension in `~/work/hanzo/extension`) is available,
use it by default to drive a real browser for interactive UI work — inspecting
the globe, tweaking layers, checking live feeds, capturing screenshots against a
running dev server. It talks to a real Chrome/Firefox with the real WebGL/deck.gl
context, so what you see is what a user sees.

Fall back to **Playwright only when** the MCP extension is not connected, or for
the deterministic **e2e suite** (`e2e/*.spec.ts`) — those run headless in CI with
mocked `/v1/world/cloud/*` feeds and must stay reproducible offline. E2e is not
interactive editing; keep the two lanes separate.

Order of preference for "look at / poke the UI": Hanzo MCP browser → Playwright.

## The map / globe

- Basemaps: `dark` · `dot` · `satellite` · `terrain`. **`dot` is the default**
  for every variant (`DEFAULT_BASEMAP_STYLE` in `src/config/variant.ts`) — the
  Kaspersky-style cybermap: land drawn only as a glowing dot-lattice over a black
  ocean sphere, no country fills/borders/imagery.
- The lattice is one pure value — `getLandDots()` in `src/services/land-dots.ts` —
  consumed by BOTH the 2D mercator map (`DeckGLMap`) and the 3D globe
  (`GlobeNative`). One source, two projections. Don't fork it.
- Cloud view layers (default-on, `?variant=cloud`): live request-origin dots +
  animated traffic arcs (`AnimatedArcLayer`, a travelling pulse advanced on RAF),
  validator chain-nodes, BYO-GPU rings, datacenter clusters. Feeds are best-effort
  and degrade to honest empty states — never fabricate volume.
- `satellite`/`terrain` need `VITE_MAPBOX_TOKEN` (from KMS `hanzo/deploy/`, never
  in git); `dark`/`dot` are keyless CartoDB.

## Sources & topics

- A source is a `Feed` (`src/types/index.ts`) in `src/config/feeds.ts`, fetched by
  `fetchCategoryFeeds` (`src/services/rss.ts`). There is no second fetcher.
- Publishes real RSS/Atom → add the host to `rssDomainList`
  (`internal/world/rss_domains.go`, the SSRF boundary) and wrap it in `rss()`.
  Doesn't → emit RSS 2.0 on our own origin with `buildRSS`
  (`internal/world/handlers_social.go`) and reference the route as a plain `Feed`.
  A same-origin emitter must call `s.ingestFeedItems` itself — it never passes
  through `handleRSSProxy`, which is what normally folds items into the lake.
- Social: Reddit + YouTube are keyless. X / TikTok / LinkedIn need
  `X_BEARER_TOKEN` (or `TWITTER_BEARER_TOKEN`), `TIKTOK_ACCESS_TOKEN`,
  `LINKEDIN_ACCESS_TOKEN` + `LINKEDIN_ORG_URN` — from KMS `hanzo/world-secrets`,
  never in git. Absent, each serves an empty channel and logs one skip line.
  A credential is only reachable if it is listed in `worldSecretKeys`
  (`internal/world/kms.go`) — that list IS what world asks KMS for.
- NOT PROVISIONED (measured 2026-07-28, logged in as world's own KMS client):
  `hanzo/world-secrets` does not exist and none of the 24 names are anywhere
  under `hanzo/prod` — `world: KMS injected 0 secret(s) of 24 requested`. Every
  credentialed source is therefore serving its keyless degradation, X / TikTok /
  LinkedIn included. Storing the secrets is an operator action; no code change
  will light them up.
- Keyless does NOT mean free. A feed host budgets by IP and the whole fleet is
  one egress IP. Reddit grants ~one anonymous request per window and says so on
  every response (`x-ratelimit-remaining: 0.0`, `x-ratelimit-reset: 57`);
  YouTube's `/feeds/videos.xml` soft-404s a busy IP per channel, with no header
  to pace by, so its feeds fill in opportunistically over several warm cycles.
  `fetchFeedBody` waits out whatever pause a host states (`hostGate`) and
  `warmFeeds` walks host by host — parallel fetches of one host just become
  429s. Adding feeds on a rate-limited host costs the ones already there.
- A user topic is a `Monitor` (per-user SQLite, namespace `monitors`), not a
  separate store. `topicFeeds()` turns it into Feeds so it pulls; the seed list
  in `TOPIC_KEYWORDS` is only a default, unioned with the user's own topics.
  Trending-noise suppression applies to that seed and only there — a term the
  user typed is deliberate and always signals.
- Warming is demand-driven and decays: a request calls `FeedCache.Want`, the
  warmer refreshes what is wanted, and demand nobody renews within `warmTTL`
  is dropped. `Put` writes bodies, never demand — otherwise the warmer would
  renew its own work and every topic anyone ever typed would be fetched forever.

## Release

Bump `package.json` PATCH (x.y.z → x.y.z+1, never a lazy major), tag `v<version>`,
`workflow_dispatch` the `cicd` workflow. The image tag is the version WITHOUT the
`v`. CI's "Deploy" step can false-negative while the operator finishes rolling —
verify the live version, not just the CI square. Test/doc-only changes need no
release (the image is byte-identical).
