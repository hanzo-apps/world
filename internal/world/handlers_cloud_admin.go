package world

import (
	"context"
	"encoding/json"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Admin-only Cloud aggregates. Every handler here is gated by requireAdmin
// (fail-closed 403) and then forwards the caller's own IAM bearer to the cloud
// subsystems on api.hanzo.ai — no shared key, and cloud independently re-verifies
// the admin claim. Each degrades honestly: on any upstream failure it returns a
// 200 with {available:false, note:"…"} rather than 5xx or invented numbers.

// ── fleet: machines + GPUs grouped by provider/region ────────────────────────
//
// Real source: visor /v1/machines + /v1/gpus + /v1/fleet/workers. These carry
// provider, region, status and (for BYO GPUs) VRAM total. Live GPU utilization /
// memory-used / temperature are NOT instrumented anywhere in the data plane
// today, so we surface what exists and label the gap honestly rather than faking
// a utilization gauge.

type fleetMachineRow struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Type     string `json:"type"`
	Status   string `json:"status"`
	GPUModel string `json:"gpuModel"`
	GPUs     int    `json:"gpus"`
	VRAM     string `json:"vram"` // BYO GPUs report VRAM total; "" when unknown
	VCPU     int    `json:"vcpu"` // vCPU count (visor MachineView.vcpu); 0 when unknown
	Mem      string `json:"mem"`  // system RAM, e.g. "8 GB"; "" when unknown
	OS       string `json:"os"`
}

type fleetRegionGroup struct {
	Region   string            `json:"region"`
	GPUs     int               `json:"gpus"`
	Machines []fleetMachineRow `json:"machines"`
}

type fleetProviderGroup struct {
	Provider string             `json:"provider"`
	Machines int                `json:"machines"`
	Online   int                `json:"online"`
	GPUs     int                `json:"gpus"`
	Regions  []fleetRegionGroup `json:"regions"`
}

type fleetWorker struct {
	ID           string   `json:"id"`
	Hostname     string   `json:"hostname"`
	Provider     string   `json:"provider"`
	Location     string   `json:"location"`
	Status       string   `json:"status"`
	GPU          string   `json:"gpu"`
	VRAM         string   `json:"vram"`
	Capabilities []string `json:"capabilities"`
	Version      string   `json:"version"`
	// Serving is the model ids this worker's hanzo-engine advertises (engine.serve),
	// EngineStatus its reachability, JobQueue the gpu-jobs queue it claims from —
	// the "what this GPU is serving" the fleet view surfaces. Empty when the worker
	// runs only the studio.render job loop and no model server.
	Serving      []string `json:"serving"`
	EngineStatus string   `json:"engineStatus"`
	JobQueue     string   `json:"jobQueue"`
}

type cloudFleet struct {
	Available bool                 `json:"available"`
	UpdatedAt string               `json:"updatedAt"`
	Note      string               `json:"note"`
	UtilNote  string               `json:"utilNote"`
	Totals    fleetTotals          `json:"totals"`
	Providers []fleetProviderGroup `json:"providers"`
	Workers   []fleetWorker        `json:"workers"`
}

type fleetTotals struct {
	Machines  int `json:"machines"`
	Online    int `json:"online"`
	GPUs      int `json:"gpus"`
	Providers int `json:"providers"`
	Regions   int `json:"regions"`
}

func (s *Server) handleCloudFleet(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") || methodNotGet(w, r) {
		return
	}
	bearer, ok := s.requireAdmin(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	hdr := map[string]string{"Authorization": bearer}
	base := apiHost()

	var machines struct {
		Machines []struct {
			ID, Name, Region, Type, Status, Provider, GPU, OS, Mem string
			Vcpu                                                   int `json:"vcpu"`
		} `json:"machines"`
	}
	if err := s.getJSON(ctx, base+"/v1/machines", hdr, &machines); err != nil {
		writeJSON(w, http.StatusOK, "private, no-store", cloudFleet{Available: false, UpdatedAt: nowRFC(), Note: "Fleet inventory (visor) is unavailable right now."})
		return
	}
	var gpus struct {
		Gpus []struct {
			ID, Model, Region, Status, Machine, Provider, Memory string
		} `json:"gpus"`
	}
	_ = s.getJSON(ctx, base+"/v1/gpus", hdr, &gpus)
	var workers struct {
		Workers []struct {
			ID, Hostname, Provider, Location, Status, Version string
			JobQueue                                          string                               `json:"jobQueue"`
			GPUs                                              []struct{ Name, MemoryTotal string } `json:"gpus"`
			Capabilities                                      []string                             `json:"capabilities"`
			Engine                                            *struct {
				URL    string   `json:"url"`
				Models []string `json:"models"`
				Status string   `json:"status"`
			} `json:"engine"`
		} `json:"workers"`
	}
	_ = s.getJSON(ctx, base+"/v1/fleet/workers", hdr, &workers)

	// Index GPUs by machine: count + a representative VRAM string.
	type gAgg struct {
		count int
		vram  string
	}
	byMachine := map[string]*gAgg{}
	for _, g := range gpus.Gpus {
		a := byMachine[g.Machine]
		if a == nil {
			a = &gAgg{}
			byMachine[g.Machine] = a
		}
		a.count++
		if a.vram == "" && isRealVRAM(g.Memory) {
			a.vram = g.Memory
		}
	}

	// Group machines by provider → region.
	provIdx := map[string]*fleetProviderGroup{}
	regIdx := map[string]map[string]*fleetRegionGroup{}
	regionSet := map[string]struct{}{}
	f := cloudFleet{Available: true, UpdatedAt: nowRFC()}
	for _, m := range machines.Machines {
		prov := orDash(m.Provider)
		region := orDash(m.Region)
		regionSet[region] = struct{}{}
		pg := provIdx[prov]
		if pg == nil {
			pg = &fleetProviderGroup{Provider: prov}
			provIdx[prov] = pg
			regIdx[prov] = map[string]*fleetRegionGroup{}
		}
		rg := regIdx[prov][region]
		if rg == nil {
			rg = &fleetRegionGroup{Region: region}
			regIdx[prov][region] = rg
		}
		ga := byMachine[m.ID]
		row := fleetMachineRow{ID: m.ID, Name: orDash(m.Name), Type: m.Type, Status: m.Status, GPUModel: m.GPU, VCPU: m.Vcpu, Mem: m.Mem, OS: m.OS}
		if ga != nil {
			row.GPUs = ga.count
			row.VRAM = ga.vram
		}
		rg.Machines = append(rg.Machines, row)
		rg.GPUs += row.GPUs
		pg.Machines++
		pg.GPUs += row.GPUs
		if machineOnline(m.Status) {
			pg.Online++
		}
		f.Totals.Online += boolToInt(machineOnline(m.Status))
		f.Totals.GPUs += row.GPUs
		f.Totals.Machines++
	}
	// Materialize provider groups (sorted) with their region groups (sorted).
	for _, pg := range provIdx {
		pg.Regions = pg.Regions[:0]
		for _, rg := range regIdx[pg.Provider] {
			pg.Regions = append(pg.Regions, *rg)
		}
		sort.Slice(pg.Regions, func(i, j int) bool { return pg.Regions[i].Region < pg.Regions[j].Region })
		f.Providers = append(f.Providers, *pg)
	}
	sort.Slice(f.Providers, func(i, j int) bool { return f.Providers[i].Machines > f.Providers[j].Machines })
	f.Totals.Providers = len(provIdx)
	f.Totals.Regions = len(regionSet)

	for _, wk := range workers.Workers {
		fw := fleetWorker{ID: wk.ID, Hostname: wk.Hostname, Provider: wk.Provider, Location: wk.Location, Status: wk.Status, Version: wk.Version, Capabilities: wk.Capabilities, JobQueue: wk.JobQueue}
		if len(wk.GPUs) > 0 {
			fw.GPU = wk.GPUs[0].Name
			if isRealVRAM(wk.GPUs[0].MemoryTotal) {
				fw.VRAM = wk.GPUs[0].MemoryTotal
			}
		}
		if wk.Engine != nil {
			fw.Serving = wk.Engine.Models
			fw.EngineStatus = wk.Engine.Status
		}
		f.Workers = append(f.Workers, fw)
	}

	f.Note = "Live fleet from visor (DO / GCP / AWS / BYO), grouped by provider and region."
	f.UtilNote = "Live GPU utilization, memory-used and temperature are not yet instrumented in the fleet data plane — only inventory, status and (BYO) VRAM total are reported."
	writeJSON(w, http.StatusOK, "private, no-store", f)
}

func isRealVRAM(s string) bool {
	s = strings.TrimSpace(s)
	return s != "" && s != "[N/A]" && !strings.EqualFold(s, "n/a")
}

// ── services: per-subsystem health + RED metrics ─────────────────────────────
//
// Real source: o11y /v1/o11y/status?product=<p> (live up/latency/deployments)
// fused with /v1/o11y/metrics?product=<p> (request/error/latency series). We
// probe a curated set of the unified binary's mounted subsystems concurrently.

// cloudSubsystems is the curated set of unified-binary subsystems worth probing
// on the operator status board. Adding a subsystem here is the one place to wire
// a new service into the board.
var cloudSubsystems = []string{
	"ai", "gateway", "iam", "kms", "s3", "analytics", "o11y", "commerce",
	"billing", "tasks", "visor", "world", "websearch", "docdb", "sql", "registry", "paas",
}

type serviceRow struct {
	Product       string  `json:"product"`
	Up            bool    `json:"up"`
	LatencyMs     float64 `json:"latencyMs"`
	Deployments   int     `json:"deployments"`
	DeploymentsUp int     `json:"deploymentsUp"`
	Requests      int64   `json:"requests"`
	Errors        int64   `json:"errors"`
	ErrorRate     float64 `json:"errorRate"`
	P95Ms         float64 `json:"p95Ms"`
	Instrumented  bool    `json:"instrumented"`
	Source        string  `json:"source"`
}

type cloudServices struct {
	Available bool         `json:"available"`
	UpdatedAt string       `json:"updatedAt"`
	Note      string       `json:"note"`
	Window    string       `json:"window"`
	Total     int          `json:"total"`
	Up        int          `json:"up"`
	Services  []serviceRow `json:"services"`
}

func (s *Server) handleCloudServices(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") || methodNotGet(w, r) {
		return
	}
	bearer, ok := s.requireAdmin(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 22*time.Second)
	defer cancel()
	hdr := map[string]string{"Authorization": bearer}
	base := apiHost()

	rows := make([]serviceRow, len(cloudSubsystems))
	var wg sync.WaitGroup
	sem := make(chan struct{}, 6)
	for i, name := range cloudSubsystems {
		wg.Add(1)
		go func(i int, name string) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			rows[i] = s.probeService(ctx, base, name, hdr)
		}(i, name)
	}
	wg.Wait()

	out := cloudServices{Available: true, UpdatedAt: nowRFC(), Window: "1h", Services: rows}
	for _, rw := range rows {
		out.Total++
		if rw.Up {
			out.Up++
		}
	}
	out.Note = "Per-subsystem health from o11y (live probe) fused with RED metrics over the last hour."
	writeJSON(w, http.StatusOK, "private, no-store", out)
}

// livenessURL maps a cloud subsystem to a real reachability endpoint, used to
// decide `up` when o11y carries no per-deployment telemetry for it. Each path is
// GET-able and answers (2xx/3xx or an auth gate) whenever the subsystem is live;
// an empty string means "no liveness probe" (leave up as whatever o11y said).
func livenessURL(name string) string {
	api := apiHost()
	switch name {
	case "ai":
		return api + "/v1/models"
	case "gateway":
		return api + "/health"
	case "iam":
		return api + "/v1/iam/.well-known/openid-configuration"
	case "kms":
		return api + "/v1/kms/health"
	case "s3":
		return api + "/v1/s3"
	case "analytics":
		return api + "/v1/analytics/overview"
	case "o11y":
		return api + "/v1/o11y"
	case "commerce":
		return api + "/v1/plans"
	case "billing":
		return api + "/v1/billing/balance"
	case "tasks":
		return api + "/v1/tasks"
	case "websearch":
		return api + "/v1/search"
	case "docdb":
		return api + "/v1/docdb"
	case "sql":
		return api + "/v1/sql"
	case "paas":
		return api + "/v1/platform/health"
	case "visor":
		return api + "/v1/machines"
	case "world":
		return "https://world.hanzo.ai/v1/world/health"
	case "registry":
		return "https://registry.hanzo.ai/v2/"
	default:
		return ""
	}
}

func (s *Server) probeService(ctx context.Context, base, name string, hdr map[string]string) serviceRow {
	row := serviceRow{Product: name}
	var st struct {
		Product     string  `json:"product"`
		Up          bool    `json:"up"`
		LatencyMs   float64 `json:"latencyMs"`
		Source      string  `json:"source"`
		Deployments []struct {
			Instance string `json:"instance"`
			Up       bool   `json:"up"`
		} `json:"deployments"`
	}
	o11yKnows := false
	if err := s.getJSON(ctx, base+"/v1/o11y/status?product="+name, hdr, &st); err == nil && len(st.Deployments) > 0 {
		// o11y has real per-deployment telemetry for this subsystem — trust it.
		o11yKnows = true
		row.Up = st.Up
		row.LatencyMs = st.LatencyMs
		row.Source = st.Source
		row.Deployments = len(st.Deployments)
		for _, d := range st.Deployments {
			if d.Up {
				row.DeploymentsUp++
			}
		}
	}
	// Liveness is authoritative when o11y has no opinion. A subsystem that simply
	// isn't wired into o11y is NOT down — probing its real endpoint keeps the board
	// honest (a live-but-uninstrumented service shows UP with no metrics, never a
	// false "down"). Any answer through the gateway (2xx/3xx, or an auth gate) means
	// the service is alive; only a transport error or a 5xx is truly down.
	if !o11yKnows {
		if u := livenessURL(name); u != "" {
			if _, code, err := s.get(ctx, u, hdr); err == nil {
				row.Up = code > 0 && code < 500
				row.Source = "liveness"
			}
		}
	}
	var mt struct {
		Summary struct {
			Requests  int64   `json:"requests"`
			Errors    int64   `json:"errors"`
			ErrorRate float64 `json:"errorRate"`
			P95Ms     float64 `json:"p95Ms"`
		} `json:"summary"`
	}
	if err := s.getJSON(ctx, base+"/v1/o11y/metrics?product="+name+"&sinceSec=3600&stepSec=300", hdr, &mt); err == nil {
		row.Instrumented = true
		row.Requests = mt.Summary.Requests
		row.Errors = mt.Summary.Errors
		row.ErrorRate = mt.Summary.ErrorRate
		row.P95Ms = mt.Summary.P95Ms
	}
	return row
}

// ── analytics: web analytics (Umami-style, analytics.hanzo.ai) ────────────────
//
// Real source: the standalone hanzoai/analytics product (analytics.hanzo.ai),
// Hanzo-IAM bearer. It exposes top pages/referrers/countries + live visitors +
// pageview/visitor totals across the platform's registered websites. There is NO
// aggregate endpoint in the cloud binary for these, so this handler is the thin
// proxy that fans out per-website and merges. Degrades honestly to
// {available:false} when the product is unreachable or has no websites.

type analyticsMetric struct {
	X string `json:"x"`
	Y int64  `json:"y"`
}

type analyticsSite struct {
	Name      string `json:"name"`
	Domain    string `json:"domain"`
	Pageviews int64  `json:"pageviews"`
	Visitors  int64  `json:"visitors"`
	Active    int64  `json:"active"`
}

type cloudAnalytics struct {
	Available    bool              `json:"available"`
	UpdatedAt    string            `json:"updatedAt"`
	Note         string            `json:"note"`
	Window       string            `json:"window"`
	Pageviews    int64             `json:"pageviews"`
	Visitors     int64             `json:"visitors"`
	ActiveNow    int64             `json:"activeNow"`
	Sites        []analyticsSite   `json:"sites"`
	TopPages     []analyticsMetric `json:"topPages"`
	TopReferrers []analyticsMetric `json:"topReferrers"`
	TopCountries []analyticsMetric `json:"topCountries"`
}

func (s *Server) handleCloudAnalytics(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") || methodNotGet(w, r) {
		return
	}
	bearer, ok := s.requireAdmin(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 22*time.Second)
	defer cancel()
	hdr := map[string]string{"Authorization": bearer}
	base := env("HANZO_ANALYTICS_BASE")
	if base == "" {
		base = "https://analytics.hanzo.ai"
	}
	base = trimSlash(base)

	var sites struct {
		Data []struct {
			ID     string `json:"id"`
			Name   string `json:"name"`
			Domain string `json:"domain"`
		} `json:"data"`
	}
	if err := s.getJSON(ctx, base+"/v1/analytics/websites", hdr, &sites); err != nil || len(sites.Data) == 0 {
		writeJSON(w, http.StatusOK, "private, no-store", cloudAnalytics{Available: false, UpdatedAt: nowRFC(), Window: "24h",
			Note: "Web analytics (analytics.hanzo.ai) has no websites registered or is unreachable."})
		return
	}

	end := time.Now()
	start := end.Add(-24 * time.Hour)
	q := "startAt=" + strconv.FormatInt(start.UnixMilli(), 10) + "&endAt=" + strconv.FormatInt(end.UnixMilli(), 10)

	out := cloudAnalytics{Available: true, UpdatedAt: nowRFC(), Window: "24h"}
	pages := map[string]int64{}
	refs := map[string]int64{}
	countries := map[string]int64{}
	var mu sync.Mutex
	var wg sync.WaitGroup
	sem := make(chan struct{}, 6)
	limit := len(sites.Data)
	if limit > 8 {
		limit = 8
	}
	for _, ws := range sites.Data[:limit] {
		wg.Add(1)
		go func(id, name, domain string) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			site := analyticsSite{Name: orDash(name), Domain: domain}
			var stats struct {
				Pageviews struct {
					Value int64 `json:"value"`
				} `json:"pageviews"`
				Visitors struct {
					Value int64 `json:"value"`
				} `json:"visitors"`
			}
			_ = s.getJSON(ctx, base+"/v1/analytics/websites/"+id+"/stats?"+q, hdr, &stats)
			site.Pageviews = stats.Pageviews.Value
			site.Visitors = stats.Visitors.Value
			var active struct {
				X int64 `json:"x"`
			}
			_ = s.getJSON(ctx, base+"/v1/analytics/websites/"+id+"/active", hdr, &active)
			site.Active = active.X

			mergeMetric(ctx, s, base, id, "url", q, hdr, pages, &mu)
			mergeMetric(ctx, s, base, id, "referrer", q, hdr, refs, &mu)
			mergeMetric(ctx, s, base, id, "country", q, hdr, countries, &mu)

			mu.Lock()
			out.Sites = append(out.Sites, site)
			out.Pageviews += site.Pageviews
			out.Visitors += site.Visitors
			out.ActiveNow += site.Active
			mu.Unlock()
		}(ws.ID, ws.Name, ws.Domain)
	}
	wg.Wait()

	sort.Slice(out.Sites, func(i, j int) bool { return out.Sites[i].Pageviews > out.Sites[j].Pageviews })
	out.TopPages = topMetrics(pages, 8)
	out.TopReferrers = topMetrics(refs, 8)
	out.TopCountries = topMetrics(countries, 8)
	out.Note = "Live web analytics across all registered Hanzo sites (analytics.hanzo.ai), last 24h."
	writeJSON(w, http.StatusOK, "private, no-store", out)
}

func mergeMetric(ctx context.Context, s *Server, base, id, typ, q string, hdr map[string]string, into map[string]int64, mu *sync.Mutex) {
	var rows []analyticsMetric
	if err := s.getJSON(ctx, base+"/v1/analytics/websites/"+id+"/metrics?type="+typ+"&"+q, hdr, &rows); err != nil {
		return
	}
	mu.Lock()
	for _, m := range rows {
		if strings.TrimSpace(m.X) == "" {
			continue
		}
		into[m.X] += m.Y
	}
	mu.Unlock()
}

func topMetrics(m map[string]int64, n int) []analyticsMetric {
	out := make([]analyticsMetric, 0, len(m))
	for k, v := range m {
		out = append(out, analyticsMetric{X: k, Y: v})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Y > out[j].Y })
	if len(out) > n {
		out = out[:n]
	}
	return out
}

// ── llm: platform LLM observability (per-org, per-model, RED) ─────────────────
//
// Real source: cloud admin /v1/admin/o11y?range= — already an aggregate over the
// hanzo.cloud_usage ledger + trace RED. Admin-gated upstream too (double gate);
// we pass it through. Honest degrade if the caller's token lacks the cloud-side
// global-admin bit even though its owner is an admin org.

func (s *Server) handleCloudLLM(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") || methodNotGet(w, r) {
		return
	}
	bearer, ok := s.requireAdmin(w, r)
	if !ok {
		return
	}
	rng := r.URL.Query().Get("range")
	if !oneOf(rng, "24h", "7d", "30d") {
		rng = "24h"
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()

	body, status, err := s.get(ctx, apiHost()+"/v1/admin/o11y?range="+rng, map[string]string{"Authorization": bearer})
	if err != nil || status < 200 || status >= 300 {
		writeJSON(w, http.StatusOK, "private, no-store", map[string]any{
			"available": false, "updatedAt": nowRFC(), "range": rng,
			"note": "Platform LLM observability requires a cloud global-admin token; not available for this session.",
		})
		return
	}
	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		writeJSON(w, http.StatusOK, "private, no-store", map[string]any{"available": false, "range": rng, "note": "LLM observability response was unreadable."})
		return
	}
	writeJSON(w, http.StatusOK, "private, no-store", map[string]any{"available": true, "updatedAt": nowRFC(), "range": rng, "data": payload})
}

// ── small shared helpers ─────────────────────────────────────────────────────

func nowRFC() string { return time.Now().UTC().Format(time.RFC3339) }

func orDash(s string) string {
	if strings.TrimSpace(s) == "" {
		return "—"
	}
	return s
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}
