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

## Release

Bump `package.json` PATCH (x.y.z → x.y.z+1, never a lazy major), tag `v<version>`,
`workflow_dispatch` the `cicd` workflow. The image tag is the version WITHOUT the
`v`. CI's "Deploy" step can false-negative while the operator finishes rolling —
verify the live version, not just the CI square. Test/doc-only changes need no
release (the image is byte-identical).
