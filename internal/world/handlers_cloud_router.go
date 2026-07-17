package world

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"time"
)

// Enso Live Training — public router-stats proxy.
//
// Real source: the ai gateway's PUBLIC, no-auth /v1/router/stats?scope=platform
// (hanzoai/ai). Platform scope is aggregates only — NO absolute spend, and every
// routing arm is already relabeled to an opaque "arm-N" upstream, so no vendor
// name can ever reach this public surface. We proxy it same-origin (like the
// other /v1/world/cloud/* excitement-layer routes) so the SPA needs no CORS and
// gets edge caching. scope is HARD-PINNED to platform here — a client cannot ask
// for a different (potentially vendor-labeled) scope through this route.
//
// Honesty: there is no fabricated fallback. If the upstream is unreachable we
// answer a well-formed but empty payload flagged unavailable:true (never a made-up
// number) — the flag travels in the body exactly like cloud-pulse's demo:true, and
// the panel renders its muted "connecting…" state. This also keeps the never-5xx
// guarantee the /v1/world route smoke suite enforces.

// routerStatsUnavailable is the honest empty payload served when the upstream
// cannot be reached. Structurally valid so the client parses it cleanly; the
// unavailable flag tells the panel to show "connecting…" rather than zeros.
var routerStatsUnavailable = json.RawMessage(`{"scope":"platform","unavailable":true,"window":{"since":"","until":"","events":0},"cost":{"saved_pct":0,"cumulative_saved_index":0,"baseline_model":"","priced_events":0},"quality":{"reward_rate":0,"rewarded_events":0,"engine_share":0,"avg_confidence":0,"shadow_agreement":null},"by_task":{},"by_model":{},"throughput":{"per_hour":[],"total_window":0},"retrain":null}`)

// clampHours parses ?hours= and clamps it to [1,168] (default 24). The value is
// forwarded to the upstream and keys the cache so each window caches separately.
func clampHours(raw string) int {
	h, err := strconv.Atoi(raw)
	if err != nil || h < 1 {
		return 24
	}
	if h > 168 {
		return 168
	}
	return h
}

func (s *Server) handleCloudRouterStats(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") || methodNotGet(w, r) {
		return
	}
	hours := clampHours(r.URL.Query().Get("hours"))
	hoursStr := strconv.Itoa(hours)
	s.cachedJSON(w, "router-stats:"+hoursStr, "public, max-age=15, s-maxage=15, stale-while-revalidate=60",
		20*time.Second, 5*time.Minute,
		func(ctx context.Context) (any, error) {
			// scope pinned to platform; hours forwarded. Raw pass-through keeps the
			// arm-opaque contract intact (we never re-shape or re-label).
			url := apiHost() + "/v1/router/stats?scope=platform&hours=" + hoursStr
			body, status, err := s.get(ctx, url, nil)
			if err != nil {
				return nil, err
			}
			if status < 200 || status >= 300 {
				return nil, httpErr(status)
			}
			// ai wraps the aggregate in the casibase envelope {status,data:{…}};
			// unwrap `data` so the client (and our unavailable fallback) see the
			// bare RouterStats shape. A missing/null data or a non-ok status is a
			// soft failure → the honest unavailable payload, never a 5xx.
			var env struct {
				Status string          `json:"status"`
				Data   json.RawMessage `json:"data"`
			}
			if err := json.Unmarshal(body, &env); err != nil {
				return nil, httpErr(http.StatusBadGateway)
			}
			if env.Status != "ok" || len(env.Data) == 0 || string(env.Data) == "null" {
				return nil, httpErr(http.StatusBadGateway)
			}
			return env.Data, nil
		},
		func(w http.ResponseWriter, _ error) {
			// Degrade cleanly (never 5xx): an honest empty payload flagged
			// unavailable:true. no-store so the transient outage is never cached at
			// the edge and the panel re-checks on its next poll.
			writeJSON(w, http.StatusOK, "no-store", routerStatsUnavailable)
		},
	)
}

// routerHistoryUnavailable is the honest empty payload for the flywheel history: no
// series, no retrains — flat/empty charts, never a fabricated curve. Structurally
// valid so the panels bind identically whether live or empty.
var routerHistoryUnavailable = json.RawMessage(`{"scope":"platform","unavailable":true,"window":{"since":"","until":"","days":0},"daily":[],"retrains":[],"totals":{"events":0,"cumulative_cost_saved":0,"reward_rate":0,"days_active":0}}`)

// clampDays parses ?days= and clamps to [1,90] (default 30).
func clampDays(raw string) int {
	d, err := strconv.Atoi(raw)
	if err != nil || d < 1 {
		return 30
	}
	if d > 90 {
		return 90
	}
	return d
}

// handleCloudRouterHistory proxies the ai gateway's PUBLIC /v1/router/history?scope=
// platform (daily reward-rate + cumulative cost-saved + adoption curve + the retrain
// timeline). Same discipline as router-stats: scope HARD-PINNED to platform, raw
// pass-through of the arm-opaque `data`, honest empty (unavailable:true) on any soft
// failure, never a 5xx. The flywheel is only barely lit today — the series start
// empty and GROW with real data; we never invent history.
func (s *Server) handleCloudRouterHistory(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") || methodNotGet(w, r) {
		return
	}
	days := clampDays(r.URL.Query().Get("days"))
	daysStr := strconv.Itoa(days)
	s.cachedJSON(w, "router-history:"+daysStr, "public, max-age=60, s-maxage=60, stale-while-revalidate=300",
		90*time.Second, 10*time.Minute,
		func(ctx context.Context) (any, error) {
			url := apiHost() + "/v1/router/history?scope=platform&days=" + daysStr
			body, status, err := s.get(ctx, url, nil)
			if err != nil {
				return nil, err
			}
			if status < 200 || status >= 300 {
				return nil, httpErr(status)
			}
			var env struct {
				Status string          `json:"status"`
				Data   json.RawMessage `json:"data"`
			}
			if err := json.Unmarshal(body, &env); err != nil {
				return nil, httpErr(http.StatusBadGateway)
			}
			if env.Status != "ok" || len(env.Data) == 0 || string(env.Data) == "null" {
				return nil, httpErr(http.StatusBadGateway)
			}
			return env.Data, nil
		},
		func(w http.ResponseWriter, _ error) {
			writeJSON(w, http.StatusOK, "no-store", routerHistoryUnavailable)
		},
	)
}
