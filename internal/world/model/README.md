# Hanzo World Model

A planet-scale, continuously-updated **world-state engine** layered on the
`/v1/world/*` data plane. It folds the live public feeds into a typed per-entity
state vector that Hanzo AI — and any customer agent — can embed, query, and be
informed by. Palantir-style situational awareness, built from public sources,
served as a plain JSON + SSE API.

## Design — decomplected, one way to do everything

Two orthogonal halves, connected only by **values**:

- **`internal/world/model/`** (this package) — the state engine. Knows nothing
  about GDELT/OpenSky/ACLED. It folds `Observation` values into `Entity` state,
  derives composite signals in ONE place, tracks what changed, snapshots to
  disk, and serves the query/SSE API.
- **`internal/world/model_sources.go`** (package `world`) — the ONLY bridge to
  the feeds. Each `Source` turns an existing `Server` fetcher into
  `Observation`s. Add a feed to the model by adding a Source there; the engine
  never changes.

```
feeds ──(reuse existing fetchers)──▶ Source ──Observation──▶ Engine.Store
                                                                │
                          snapshot ◀── fold (merge → derive → diff → broadcast)
                                                                │
                     /v1/world/model/{state,country,top,changes,stream}
```

### Entities and metrics

Entity kinds: `country` (full ISO-3166 roster ≈200), `theater` (9 strategic
theaters), `market` (crypto). Each carries a metric vector; unset metrics keep
their last value (**sticky state** — a throttled feed degrades to staleness,
never to zero). Metrics:

| metric | source | meaning |
|---|---|---|
| `baseline` | roster (static) | seed instability per country |
| `newsVolume` | GDELT DOC | article count in a 24h window |
| `newsVelocity` | *derived* | Δ newsVolume vs previous cycle |
| `sentiment` | GDELT DOC | average tone (negative = adverse) |
| `conflictEvents` | ACLED (key-gated) | protest/riot count |
| `militaryActivity` | OpenSky | military aircraft in theater |
| `marketStress` | CoinGecko | 24h price-move magnitude |
| `instability` | *derived, one place* | composite 0–100 → `level` |

`instability` is computed in exactly one function (`compositeInstability`):
baseline modulated by adverse news (amplified by volume), conflict, and military
activity; markets take their stress directly. A partial feed — or none — still
yields a coherent, honestly-degraded score.

### Ingest loop

`Engine.Start(ctx)` loads the last snapshot (warm restart), folds every
`WORLD_MODEL_INTERVAL` (default 10m), and persists after each cycle (atomic
temp+rename) so a restart resumes ≤ one interval stale. Sources are polled
concurrently; a failing source is skipped (its entities keep prior state).

### What "changed" means

A `Change` is recorded (and pushed to SSE) when an **existing** entity moves
materially: `|Δinstability| ≥ 0.5`, OR news volume swings by ≥ 15 articles in a
cycle. The second trigger is the point of the model — it surfaces news surges the
instant they feed in, before they move the composite. Cold-start population is
visible via `/state`, not replayed as thousands of deltas.

## API — `GET /v1/world/model/*`

Every response is the envelope `{ v, asOf, … }`. Reads are public (all data
derives from public sources).

| route | returns |
|---|---|
| `/state[?kind=]` | full compact snapshot — every entity, instability-ranked |
| `/country/{iso}` | one country's full vector + recent deltas |
| `/top?metric=instability\|velocity\|sentiment&n=10&kind=country` | ranked movers |
| `/changes?since=RFC3339` | changes after `since` (default: last hour) — the "inform our AI" hook |
| `/stream` | SSE: an initial `snapshot` event, then `delta` events as folds land |

### AI grounding

`Engine.Context()` and `Engine.CountryContext(iso)` expose a compact model
briefing that the AI handlers merge into their prompts, so answers are grounded
in the model (top movers + deltas) rather than raw feeds. Wired into
`/v1/world/country-intel`.

## Pro-tier gating — one place

Reads are public today. When gating lands, enforce it in **`gate()` (api.go)**
and nowhere else: the gateway (`api.hanzo.ai`) injects the caller's org via
`X-Hanzo-Owner` (from the IAM `owner` claim); check that org's plan/quota there
and return `false` to block. One function, one attach point.

## Roadmap — honest scope

**Shipped (this slice):** state store, ingest loop, snapshot/warm-start, the five
query routes, SSE, AI grounding, ~200-country roster + theaters + markets.

**Next (Palantir-style, not yet built):**

- **Entity-link graph** — `country ↔ event ↔ market` edges, so a query can walk
  from a conflict to the markets and countries it moves. The Observation model
  already carries the entity ids the edges would connect.
- **Timeline queries** — per-entity history (the change log is the seed; today it
  is bounded in memory, next it persists to a time-series store).
- **Watchlists + alerts** — per-org saved queries that fire a webhook/notify when
  a matching `Change` folds in. Attaches at the same `gate()`/org point.

These are deliberately deferred: the state engine + API + SSE are the load-bearing
first slice; the graph and alerting compose on top of the same value flow.
