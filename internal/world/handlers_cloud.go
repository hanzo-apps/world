package world

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"time"
)

// Platform "cloud pulse": the anonymized, platform-wide aggregate the flagship
// dashboard renders (world.hanzo.ai cloud/SaaS/AI variants). It is deliberately
// non-sensitive — counts and volume buckets only, never per-org spend or names.
//
// HONESTY CONTRACT — NOTHING is fabricated. Every number is REAL (measured by an
// actual backend) or an honest zero/empty. There is no diurnal-sine "demo" curve,
// no hardcoded uptime, no invented model mix or per-region rate. The honest source
// ladder (producePulse), best → last:
//
//   - VOLUME (requests/sec, 24h requests/tokens, series, model mix):
//       1. the super-admin usage ledger (get-cloud-usages ?org=all, ClickHouse) —
//          MEASURED and exact (tokens + spend); clears volumeModeled.
//       2. else the REAL, public endpoints this same binary already serves: the
//          native request-geo globe (traffic-globe, totals.rps_1m) for the
//          headline rate, and the learned-router stats (router-stats) for total
//          routed requests + hourly throughput + per-model mix. Token volume is not
//          measured on this path, so tokens stay blank and volumeModeled stays true.
//       3. else empty (zeros / empty arrays).
//   - FLEET COUNTS + REGION breakdown: the service-token visor (/v1/machines,
//     /v1/gpus) + ai catalog (/v1/models). Absent ⇒ zeros and an empty region list
//     built from the real fleet — never the geo catalog as if it were live.
//   - UPTIME: the public status page (Gatus up/total). Unreachable ⇒ 0 and the
//     overview drops the tile — never a constant.
//
// demo:true means ONLY that nothing real resolved (a warming-up / not-wired state),
// never that a number was invented. Signed-in / token-wired deployments see the
// full measured aggregate; the tokenless public path still shows real request rate,
// throughput, model mix, uptime and chain scale.
//
// Signed-in, org-scoped drill-down (the user's own fleet / models / bill) does NOT
// come through here — those panels call api.hanzo.ai directly with the caller's IAM
// token (no shared key). This route is the platform teaser only.

type cloudOverview struct {
	RequestsPerSec float64 `json:"requestsPerSec"`
	Requests24h    int64   `json:"requests24h"`
	Tokens24h      int64   `json:"tokens24h"`
	ModelsServed   int     `json:"modelsServed"`
	NodesOnline    int     `json:"nodesOnline"`
	NodesTotal     int     `json:"nodesTotal"`
	GpusOnline     int     `json:"gpusOnline"`
	Regions        int     `json:"regions"`
	UptimePct      float64 `json:"uptimePct"`
}

type cloudModel struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	Requests24h int64   `json:"requests24h"`
	Tokens24h   int64   `json:"tokens24h"`
	Share       float64 `json:"share"`
}

type cloudRegion struct {
	ID             string  `json:"id"`
	Name           string  `json:"name"`
	City           string  `json:"city"`
	Country        string  `json:"country"`
	Lat            float64 `json:"lat"`
	Lon            float64 `json:"lon"`
	Nodes          int     `json:"nodes"`
	Gpus           int     `json:"gpus"`
	Status         string  `json:"status"`
	RequestsPerSec float64 `json:"requestsPerSec"`
}

type cloudPulse struct {
	Demo          bool          `json:"demo"`
	VolumeModeled bool          `json:"volumeModeled"`
	Source        string        `json:"source"`
	Note          string        `json:"note"`
	UpdatedAt     string        `json:"updatedAt"`
	Window        string        `json:"window"`
	Overview      cloudOverview `json:"overview"`
	RequestSeries []int64       `json:"requestSeries"`
	TokenSeries   []int64       `json:"tokenSeries"`
	Models        []cloudModel  `json:"models"`
	Regions       []cloudRegion `json:"regions"`
	// Users is populated ONLY on the signed-in admin path (real IAM aggregates:
	// total users, signups, active now, daily-signup series). omitempty ⇒ the public
	// teaser never carries it.
	Users *userMetrics `json:"users,omitempty"`
}

// publicVolumeTimeout bounds each public fallback fetch (traffic-globe, router-stats,
// status page) so a single slow/unreachable host can't stall the pulse produce.
const publicVolumeTimeout = 5 * time.Second

// handleCloudPulse serves the platform aggregate. Two honest representations:
//
//   - SIGNED-IN ADMIN (z@hanzo.ai / the admin org): the FULL real aggregate, with
//     the token-plane reads (all-org usage ledger + visor fleet) made using the
//     CALLER's OWN bearer, never edge-cached. The upstream independently authorizes
//     the bearer, so a non-super-admin simply degrades to the public sources —
//     never a fabricated number.
//   - EVERYONE ELSE (public teaser): cached; service-token counts + real public
//     volume/uptime.
//
// It never 5xxes: any upstream failure degrades to the honest empty pulse.
func (s *Server) handleCloudPulse(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") || methodNotGet(w, r) {
		return
	}
	// Authed responses must never be served from (or stored in) the shared public
	// cache: vary on Authorization so an anonymous cache entry is never handed to a
	// signed-in caller, and vice-versa.
	w.Header().Set("Vary", "Authorization")

	if bearer, ok := s.adminIdentity(r); ok {
		ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
		defer cancel()
		hdr := map[string]string{"Authorization": bearer}
		p := s.producePulse(ctx, hdr)
		// Real platform user metrics (IAM global-users) — admin path only; aggregates
		// only, never PII. Omitted honestly if the caller isn't a global admin upstream.
		if um, err := s.fetchUserMetrics(ctx, hdr); err == nil {
			p.Users = um
		}
		writeJSON(w, http.StatusOK, "private, no-store", p)
		return
	}

	s.cachedJSON(w, "cloud-pulse", "public, max-age=15, s-maxage=15, stale-while-revalidate=60",
		20*time.Second, 5*time.Minute,
		func(ctx context.Context) (any, error) {
			return s.producePulse(ctx, serviceAuth()), nil
		},
		func(w http.ResponseWriter, _ error) {
			writeJSON(w, http.StatusOK, "", emptyPulse())
		},
	)
}

// emptyPulse is the honest zero baseline: no measured data resolved. Every number
// is zero and the arrays are empty (never null) — flagged demo:true (nothing real
// yet) and volumeModeled:true (no measured volume). We never fabricate.
func emptyPulse() cloudPulse {
	return cloudPulse{
		Demo:          true,
		VolumeModeled: true,
		Source:        "empty",
		Note:          "Platform metrics are warming up — no measured data is reachable yet. Wire the service token (KMS) for the full live aggregate.",
		UpdatedAt:     nowRFC(),
		Window:        "24h",
		RequestSeries: []int64{},
		TokenSeries:   []int64{},
		Models:        []cloudModel{},
		Regions:       []cloudRegion{},
	}
}

// producePulse assembles the pulse from ONLY real sources (see the file header for
// the honesty ladder). auth is the token-plane header (the KMS service bearer on the
// public path, or the signed-in admin's own bearer on the flagship admin path); nil
// leaves the token-plane reads out and the pulse falls back to the public sources.
// demo:true iff nothing real resolved; every field is real or an honest zero/empty.
func (s *Server) producePulse(ctx context.Context, auth map[string]string) cloudPulse {
	p := emptyPulse()
	real := false
	volSrc := ""

	// 1) Fleet COUNTS + REGION breakdown (auth → visor + ai catalog).
	countsReal := s.applyServiceCounts(ctx, &p, auth)
	if countsReal {
		real = true
	}

	// 2) VOLUME — measured ledger first (super-admin ?org=all, exact); else the real
	//    public request rate + throughput + model mix; else empty. Never modeled.
	if ov, err := s.fetchCloudUsage(ctx, "24h", auth); err == nil && ov.Totals.Requests > 0 {
		applyUsageToPulse(&p, ov) // clears volumeModeled, fills tokens/series/models
		real, volSrc = true, "ledger"
	} else if s.applyPublicVolume(ctx, &p) {
		real, volSrc = true, "router" // real rate/throughput/mix; tokens unmeasured ⇒ volumeModeled stays true
	}

	// 3) UPTIME — real share of healthy endpoints (Gatus up/total). 0 ⇒ tile dropped.
	if up, ok := s.fetchUptimePct(ctx); ok {
		p.Overview.UptimePct = up
		real = true
	}

	p.Demo = !real
	switch {
	case countsReal:
		p.Source = "service" // the service-token plane resolved (counts, and usually ledger volume)
	case real:
		p.Source = "public" // tokenless, but real public volume/uptime landed
	default:
		p.Source = "empty"
	}
	if real && volSrc == "" {
		p.Note = "Live fleet and status from Hanzo Cloud. Measured request and token volume appears when the platform usage ledger is reachable."
	}
	return p
}

// applyServiceCounts fills the real fleet counts (models served, nodes online/total,
// GPUs) and the region breakdown from the service-token visor + ai catalog. Regions
// are derived from the machines' OWN region strings (resolved to the geo catalog for
// name/city/coords) — an empty fleet yields an empty regions list, never the geo
// catalog as if it were live; per-region rate stays 0 (no real per-region source).
// Returns false (leaving zeros) when no auth header is supplied or the core reads
// fail. auth is the KMS service bearer (public path) or the caller's own admin
// bearer (admin path).
func (s *Server) applyServiceCounts(ctx context.Context, p *cloudPulse, hdr map[string]string) bool {
	if hdr == nil {
		return false
	}
	host := apiHost()

	// Models served (ai gateway, OpenAI-compatible list).
	var models struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := s.getJSON(ctx, host+"/v1/models", hdr, &models); err != nil || len(models.Data) == 0 {
		return false
	}

	// Fleet (visor). status is a free string; treat non-terminal states as online.
	var machines struct {
		Machines []struct {
			Region string `json:"region"`
			Status string `json:"status"`
		} `json:"machines"`
	}
	if err := s.getJSON(ctx, host+"/v1/machines", hdr, &machines); err != nil {
		return false
	}
	var gpus struct {
		Gpus []struct {
			Region string `json:"region"`
		} `json:"gpus"`
	}
	// GPUs are a bonus count; a failure here should not sink real machine data.
	_ = s.getJSON(ctx, host+"/v1/gpus", hdr, &gpus)

	// Real region breakdown: place each machine/GPU into its resolved catalog region
	// (name/city/coords), counting nodes + GPUs. rps stays 0 — no invented rate.
	agg := map[string]*cloudRegion{}
	var order []string
	region := func(raw string) *cloudRegion {
		rg, ok := resolveRegion(raw)
		if !ok {
			return nil
		}
		if c := agg[rg.ID]; c != nil {
			return c
		}
		nc := rg
		nc.Nodes, nc.Gpus, nc.RequestsPerSec, nc.Status = 0, 0, 0, "online"
		agg[rg.ID] = &nc
		order = append(order, rg.ID)
		return &nc
	}

	online := 0
	for _, m := range machines.Machines {
		if machineOnline(m.Status) {
			online++
		}
		if c := region(m.Region); c != nil {
			c.Nodes++
		}
	}
	for _, g := range gpus.Gpus {
		if c := region(g.Region); c != nil {
			c.Gpus++
		}
	}

	p.Overview.ModelsServed = len(models.Data)
	p.Overview.NodesTotal = len(machines.Machines)
	p.Overview.NodesOnline = online
	p.Overview.GpusOnline = len(gpus.Gpus)
	regions := make([]cloudRegion, 0, len(order))
	for _, id := range order {
		regions = append(regions, *agg[id])
	}
	p.Regions = regions
	p.Overview.Regions = len(regions)
	return true
}

// applyPublicVolume folds REAL, public request volume into p when the measured
// ledger is unavailable — no fabrication. It reads the SAME endpoints this binary
// already serves to other panels: the native request-geo globe (traffic-globe,
// totals.rps_1m — the Live Traffic rate) for the headline requests/sec, and the
// learned-router stats (router-stats, the Enso Training source) for total routed
// requests, the hourly throughput series and the per-model request mix. Token
// volume is NOT measured on this path, so Tokens24h / TokenSeries stay empty and
// volumeModeled stays true. Returns true when at least one real datum landed.
func (s *Server) applyPublicVolume(ctx context.Context, p *cloudPulse) bool {
	cctx, cancel := context.WithTimeout(ctx, publicVolumeTimeout)
	defer cancel()
	got := false

	// Headline requests/sec — real, from the native LB request-geo aggregate.
	if g, ok := s.fetchNativeGlobe(cctx, 60); ok && g.Totals.RPS1m > 0 {
		p.Overview.RequestsPerSec = round1(g.Totals.RPS1m)
		got = true
	}

	// Routed-request volume + hourly throughput + per-model mix — real, from the
	// public learned-router stats (arms already opaque upstream; no vendor names).
	if rs, ok := s.fetchRouterStats(cctx, 24); ok {
		events := rs.Window.Events
		if events == 0 {
			events = rs.Throughput.TotalWindow
		}
		if events > 0 {
			p.Overview.Requests24h = events
			if p.Overview.RequestsPerSec == 0 { // globe rate unavailable → window average
				p.Overview.RequestsPerSec = round1(float64(events) / routerWindowSecs(rs))
			}
			got = true
		}
		if len(rs.Throughput.PerHour) > 0 {
			p.RequestSeries = append([]int64{}, rs.Throughput.PerHour...)
			got = true
		}
		if m := modelsFromRouterStats(rs.ByModel); len(m) > 0 {
			p.Models = m
			got = true
		}
	}

	if got {
		p.Window = "24h"
		p.Note = "Live platform request rate, throughput and model mix — measured across all orgs (traffic globe + learned router). Token volume needs the usage ledger and appears when a super-admin service token is wired."
	}
	return got
}

// routerStatsVolume is the subset of the public router-stats aggregate we fold into
// the pulse: total routed events (requests), the hourly throughput series, and the
// per-model event mix. Same upstream the Enso Training panel proxies.
type routerStatsVolume struct {
	Window struct {
		Since  string `json:"since"`
		Until  string `json:"until"`
		Events int64  `json:"events"`
	} `json:"window"`
	ByModel    map[string]int64 `json:"by_model"`
	Throughput struct {
		PerHour     []int64 `json:"per_hour"`
		TotalWindow int64   `json:"total_window"`
	} `json:"throughput"`
}

// fetchRouterStats reads the PUBLIC learned-router aggregate (no token) and unwraps
// the {status,data} envelope, exactly as handleCloudRouterStats does. ok=false when
// unreachable or the envelope is not ok.
func (s *Server) fetchRouterStats(ctx context.Context, hours int) (*routerStatsVolume, bool) {
	var env struct {
		Status string          `json:"status"`
		Data   json.RawMessage `json:"data"`
	}
	u := apiHost() + "/v1/router/stats?scope=platform&hours=" + strconv.Itoa(hours)
	if err := s.getJSON(ctx, u, nil, &env); err != nil {
		return nil, false
	}
	if env.Status != "ok" || len(env.Data) == 0 || string(env.Data) == "null" {
		return nil, false
	}
	var rs routerStatsVolume
	if err := json.Unmarshal(env.Data, &rs); err != nil {
		return nil, false
	}
	return &rs, true
}

// routerWindowSecs is the router-stats window length in seconds (since→until),
// defaulting to 24h when the timestamps are missing/unparseable — so a window
// average never divides by a bogus interval.
func routerWindowSecs(rs *routerStatsVolume) float64 {
	if t0, e0 := time.Parse(time.RFC3339, rs.Window.Since); e0 == nil {
		if t1, e1 := time.Parse(time.RFC3339, rs.Window.Until); e1 == nil {
			if d := t1.Sub(t0).Seconds(); d > 0 {
				return d
			}
		}
	}
	return 86400
}

// modelsFromRouterStats maps the router's per-model REQUEST counts into the shared
// cloudModel shape (share = count/total, ranked desc then by id for stability).
// Tokens are not measured on this path, so Tokens24h stays 0 — honestly blank,
// never fabricated. nil when the router listed no models.
func modelsFromRouterStats(byModel map[string]int64) []cloudModel {
	var total int64
	for _, c := range byModel {
		total += c
	}
	if total <= 0 {
		return nil
	}
	out := make([]cloudModel, 0, len(byModel))
	for id, c := range byModel {
		out = append(out, cloudModel{ID: id, Name: id, Requests24h: c, Share: float64(c) / float64(total)})
	}
	sort.SliceStable(out, func(a, b int) bool {
		if out[a].Requests24h != out[b].Requests24h {
			return out[a].Requests24h > out[b].Requests24h
		}
		return out[a].ID < out[b].ID
	})
	return out
}

// fetchUptimePct derives a real platform uptime from the PUBLIC status page (Gatus):
// the share of monitored endpoints currently healthy (up/total, 0..100). ok=false
// when the page is unreachable or has no evaluated endpoints — the overview then
// drops the uptime tile rather than showing a constant.
func (s *Server) fetchUptimePct(ctx context.Context) (float64, bool) {
	cctx, cancel := context.WithTimeout(ctx, publicVolumeTimeout)
	defer cancel()
	base := statusBase()
	host := ""
	if u, err := url.Parse(base); err == nil {
		host = u.Hostname()
	}
	raw, ok := s.fetchGatusBoard(cctx, base, host)
	if !ok {
		return 0, false
	}
	sp := summarizeStatusPage(host, raw)
	if sp.Total == 0 {
		return 0, false
	}
	return round2s(float64(sp.Up) / float64(sp.Total) * 100), true
}

// applyUsageToPulse folds the real platform-wide usage overview into p: the headline
// rate (recent series bucket, else 24h average), 24h totals, the real hourly
// request/token series, and the top models by real spend. It clears volumeModeled —
// these are measured, not modeled.
func applyUsageToPulse(p *cloudPulse, ov *cloudUsageOverview) {
	p.VolumeModeled = false
	p.Window = ov.Range
	if p.Window == "" {
		p.Window = "24h"
	}
	p.Overview.Requests24h = ov.Totals.Requests
	p.Overview.Tokens24h = ov.Totals.Tokens

	// Headline rate: the most recent complete bucket is the freshest honest rate;
	// fall back to the 24h average when there is no usable interval.
	p.Overview.RequestsPerSec = round1(usageRate(ov.Totals.Requests, ov.Series, ov.Interval, seriesRequests))

	// Real hourly buckets (chronological) drive both sparklines.
	if n := len(ov.Series); n > 0 {
		reqs := make([]int64, n)
		toks := make([]int64, n)
		for i, pt := range ov.Series {
			reqs[i] = pt.Requests
			toks[i] = pt.Tokens
		}
		p.RequestSeries = reqs
		p.TokenSeries = toks
	}

	// Top models by real spend/volume (ledger byModel items, already ranked).
	if m := topModelsFromUsage(ov); m != nil {
		p.Models = m
	}
	p.Note = "Live platform aggregate from Hanzo Cloud — models, fleet, and measured 24h request/token volume across all orgs."
}

func machineOnline(status string) bool {
	switch status {
	case "active", "running", "online", "ready", "healthy", "":
		return true
	default:
		return false
	}
}

// regionCatalog is Hanzo's DOKS geo catalog — the reference coordinates (id / name /
// city / country / lat / lon) the map layers place points against, plus per-region
// capacity weights (Nodes / Gpus) the modeled-globe layer spreads real peer counts
// across (flagged positionsModeled:true there). It is NOT live fleet data: the
// cloud-pulse never presents it as such — the pulse's region breakdown is built from
// the real visor fleet (applyServiceCounts).
func regionCatalog() []cloudRegion {
	return []cloudRegion{
		{ID: "nyc", Name: "New York", City: "New York", Country: "USA", Lat: 40.7128, Lon: -74.0060, Nodes: 42, Gpus: 168, Status: "online"},
		{ID: "sfo", Name: "San Francisco", City: "San Francisco", Country: "USA", Lat: 37.7749, Lon: -122.4194, Nodes: 38, Gpus: 152, Status: "online"},
		{ID: "ams", Name: "Amsterdam", City: "Amsterdam", Country: "Netherlands", Lat: 52.3676, Lon: 4.9041, Nodes: 26, Gpus: 96, Status: "online"},
		{ID: "fra", Name: "Frankfurt", City: "Frankfurt", Country: "Germany", Lat: 50.1109, Lon: 8.6821, Nodes: 22, Gpus: 88, Status: "online"},
		{ID: "lon", Name: "London", City: "London", Country: "UK", Lat: 51.5074, Lon: -0.1278, Nodes: 18, Gpus: 64, Status: "online"},
		{ID: "sgp", Name: "Singapore", City: "Singapore", Country: "Singapore", Lat: 1.3521, Lon: 103.8198, Nodes: 16, Gpus: 60, Status: "online"},
		{ID: "blr", Name: "Bangalore", City: "Bangalore", Country: "India", Lat: 12.9716, Lon: 77.5946, Nodes: 12, Gpus: 40, Status: "degraded"},
		{ID: "syd", Name: "Sydney", City: "Sydney", Country: "Australia", Lat: -33.8688, Lon: 151.2093, Nodes: 8, Gpus: 24, Status: "online"},
	}
}

func trimSlash(s string) string {
	for len(s) > 0 && s[len(s)-1] == '/' {
		s = s[:len(s)-1]
	}
	return s
}
