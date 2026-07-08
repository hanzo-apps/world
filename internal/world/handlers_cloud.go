package world

import (
	"context"
	"math"
	"net/http"
	"sort"
	"time"
)

// SaaS-mode "cloud pulse": the anonymized, platform-wide aggregate the signed-out
// investor view renders (world.hanzo.ai/?variant=saas). It is deliberately
// non-sensitive — counts and volume buckets only, never per-org spend or names.
//
// HONESTY CONTRACT (see cloud-pulse.ts on the client):
//   - There is NO unauthenticated Hanzo endpoint that exposes platform-wide
//     counts (verified against the OpenAPI specs: billing/visor/admin/ml/ai/o11y
//     are all bearer-required; the only public surface, /v1/world/*, is external
//     world data). So by default this route returns a clearly-labeled DEMO
//     dataset with demo:true — the flag travels in the payload and the UI shows a
//     "demo data" note. We never fake platform numbers silently.
//   - When an operator wires a service token (HANZO_CLOUD_PULSE_TOKEN, from KMS),
//     we make SERVICE-side calls to the real cloud for non-sensitive COUNTS only
//     (models served, node/region/GPU counts) and set demo:false. Request/token
//     VOLUME still has no aggregate source, so it stays modeled and is flagged
//     volumeModeled:true — again, never silently faked.
//
// Signed-in, org-scoped drill-down (the user's own fleet / models / bill) does
// NOT come through here — those panels call api.hanzo.ai directly with the
// caller's IAM token (no shared key). This route is the public teaser only.

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
}

// handleCloudPulse serves the public SaaS aggregate. It never 5xxes: any upstream
// failure degrades to the demo dataset with demo:true.
func (s *Server) handleCloudPulse(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") || methodNotGet(w, r) {
		return
	}
	s.cachedJSON(w, "cloud-pulse", "public, max-age=15, s-maxage=15, stale-while-revalidate=60",
		20*time.Second, 5*time.Minute,
		func(ctx context.Context) (any, error) {
			base := demoPulse()
			if p, ok := s.tryServicePulse(ctx, base); ok {
				return p, nil
			}
			return base, nil
		},
		func(w http.ResponseWriter, _ error) {
			// Unreachable in practice (produce never errors), but keep the
			// never-5xx guarantee explicit.
			writeJSON(w, http.StatusOK, "", demoPulse())
		},
	)
}

// tryServicePulse overlays REAL non-sensitive counts onto the demo scaffold when
// a service token is configured (HANZO_CLOUD_PULSE_TOKEN, KMS-injected). It
// returns ok=false — leaving the honest demo dataset in place — when the token is
// absent or any required call fails. Only counts are read; no spend, no names.
func (s *Server) tryServicePulse(ctx context.Context, base cloudPulse) (cloudPulse, bool) {
	tok := env("HANZO_CLOUD_PULSE_TOKEN")
	if tok == "" {
		return cloudPulse{}, false
	}
	apiBase := env("HANZO_API_BASE", "HANZO_AI_BASE")
	if apiBase == "" {
		apiBase = "https://api.hanzo.ai"
	}
	apiBase = trimSlash(apiBase)
	hdr := map[string]string{"Authorization": "Bearer " + tok}

	// Models served (ai gateway, OpenAI-compatible list).
	var models struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := s.getJSON(ctx, apiBase+"/v1/models", hdr, &models); err != nil || len(models.Data) == 0 {
		return cloudPulse{}, false
	}

	// Fleet (visor). status is a free string; treat non-terminal states as online.
	var machines struct {
		Machines []struct {
			Region string `json:"region"`
			Status string `json:"status"`
		} `json:"machines"`
	}
	if err := s.getJSON(ctx, apiBase+"/v1/machines", hdr, &machines); err != nil {
		return cloudPulse{}, false
	}
	var gpus struct {
		Gpus []struct {
			Region string `json:"region"`
		} `json:"gpus"`
	}
	// GPUs are a bonus count; a failure here should not sink real machine data.
	_ = s.getJSON(ctx, apiBase+"/v1/gpus", hdr, &gpus)

	regionSet := map[string]int{}
	online := 0
	for _, m := range machines.Machines {
		if machineOnline(m.Status) {
			online++
		}
		if m.Region != "" {
			regionSet[m.Region]++
		}
	}

	p := base
	p.Demo = false
	p.VolumeModeled = true
	p.Source = "service"
	p.Note = "Live counts from Hanzo Cloud (models/nodes/regions). Request & token volume is modeled — no aggregate volume endpoint is exposed."
	p.Overview.ModelsServed = len(models.Data)
	p.Overview.NodesTotal = len(machines.Machines)
	p.Overview.NodesOnline = online
	p.Overview.GpusOnline = len(gpus.Gpus)
	if len(regionSet) > 0 {
		p.Overview.Regions = len(regionSet)
	}
	return p, true
}

func machineOnline(status string) bool {
	switch status {
	case "active", "running", "online", "ready", "healthy", "":
		return true
	default:
		return false
	}
}

// demoPulse builds the illustrative dataset. Numbers follow a smooth diurnal
// curve keyed on wall-clock time so the ticker feels alive across refreshes,
// but the demo flag makes clear these are not live platform metrics.
func demoPulse() cloudPulse {
	now := time.Now().UTC()
	// Diurnal load factor in [0.55, 1.0]: peaks ~16:00 UTC, troughs ~04:00 UTC.
	hourFrac := float64(now.Hour()) + float64(now.Minute())/60
	load := 0.775 + 0.225*math.Sin((hourFrac-10)/24*2*math.Pi)
	// A slow per-minute wobble so the live-activity sparkline moves each poll.
	wobble := 1 + 0.04*math.Sin(float64(now.Unix()%600)/600*2*math.Pi)

	regions := demoRegions()
	baseRPS := 4200.0 * load * wobble
	nodesOnline, nodesTotal, gpus := 0, 0, 0
	for i := range regions {
		regions[i].RequestsPerSec = round1(baseRPS * regions[i].RequestsPerSec) // field held a weight
		nodesTotal += regions[i].Nodes
		gpus += regions[i].Gpus
		if regions[i].Status == "online" {
			nodesOnline += regions[i].Nodes
		}
	}

	models := demoModels(baseRPS)
	requests24h := int64(baseRPS * 86400)
	tokens24h := requests24h * 1180 // ~1.18k tokens/request average

	return cloudPulse{
		Demo:          true,
		VolumeModeled: true,
		Source:        "demo",
		Note:          "Demo data — no unauthenticated platform-metrics endpoint exists. Sign in to see your org's real fleet, models and bill.",
		UpdatedAt:     now.Format(time.RFC3339),
		Window:        "24h",
		Overview: cloudOverview{
			RequestsPerSec: round1(baseRPS),
			Requests24h:    requests24h,
			Tokens24h:      tokens24h,
			ModelsServed:   len(models),
			NodesOnline:    nodesOnline,
			NodesTotal:     nodesTotal,
			GpusOnline:     gpus,
			Regions:        len(regions),
			UptimePct:      99.98,
		},
		RequestSeries: demoSeries(baseRPS, now, 1),
		TokenSeries:   demoSeries(baseRPS*1180, now, 1),
		Models:        models,
		Regions:       regions,
	}
}

// demoSeries returns 24 hourly buckets ending now, following the same diurnal
// curve as the headline so the sparkline and the number agree.
func demoSeries(scale float64, now time.Time, _ int) []int64 {
	out := make([]int64, 24)
	for i := 0; i < 24; i++ {
		h := float64(now.Add(time.Duration(i-23) * time.Hour).Hour())
		load := 0.775 + 0.225*math.Sin((h-10)/24*2*math.Pi)
		jitter := 1 + 0.03*math.Sin(float64(i)*1.7)
		out[i] = int64(scale * load * jitter * 3600)
	}
	return out
}

func demoModels(baseRPS float64) []cloudModel {
	// Representative of Hanzo's served surface: Zen family (qwen3+ base) plus
	// routed frontier models. Shares are illustrative.
	rows := []struct {
		id, name string
		share    float64
	}{
		{"zen-omni-30b", "Zen Omni 30B", 0.28},
		{"zen-coder-32b", "Zen Coder 32B", 0.19},
		{"zen-1", "Zen 1", 0.14},
		{"qwen3-235b", "Qwen3 235B", 0.12},
		{"zen-nano-4b", "Zen Nano 4B", 0.10},
		{"deepseek-v3", "DeepSeek V3", 0.07},
		{"zen-vl-8b", "Zen VL 8B", 0.06},
		{"llama-3.3-70b", "Llama 3.3 70B", 0.04},
	}
	out := make([]cloudModel, len(rows))
	for i, r := range rows {
		req := int64(baseRPS * r.share * 86400)
		out[i] = cloudModel{
			ID:          r.id,
			Name:        r.name,
			Requests24h: req,
			Tokens24h:   req * 1180,
			Share:       r.share,
		}
	}
	sort.SliceStable(out, func(a, b int) bool { return out[a].Requests24h > out[b].Requests24h })
	return out
}

// demoRegions models Hanzo's DOKS footprint. RequestsPerSec temporarily carries
// a per-region weight (summing to 1.0) that demoPulse scales into a real rate.
func demoRegions() []cloudRegion {
	return []cloudRegion{
		{ID: "nyc", Name: "New York", City: "New York", Country: "USA", Lat: 40.7128, Lon: -74.0060, Nodes: 42, Gpus: 168, Status: "online", RequestsPerSec: 0.24},
		{ID: "sfo", Name: "San Francisco", City: "San Francisco", Country: "USA", Lat: 37.7749, Lon: -122.4194, Nodes: 38, Gpus: 152, Status: "online", RequestsPerSec: 0.21},
		{ID: "ams", Name: "Amsterdam", City: "Amsterdam", Country: "Netherlands", Lat: 52.3676, Lon: 4.9041, Nodes: 26, Gpus: 96, Status: "online", RequestsPerSec: 0.15},
		{ID: "fra", Name: "Frankfurt", City: "Frankfurt", Country: "Germany", Lat: 50.1109, Lon: 8.6821, Nodes: 22, Gpus: 88, Status: "online", RequestsPerSec: 0.12},
		{ID: "lon", Name: "London", City: "London", Country: "UK", Lat: 51.5074, Lon: -0.1278, Nodes: 18, Gpus: 64, Status: "online", RequestsPerSec: 0.10},
		{ID: "sgp", Name: "Singapore", City: "Singapore", Country: "Singapore", Lat: 1.3521, Lon: 103.8198, Nodes: 16, Gpus: 60, Status: "online", RequestsPerSec: 0.08},
		{ID: "blr", Name: "Bangalore", City: "Bangalore", Country: "India", Lat: 12.9716, Lon: 77.5946, Nodes: 12, Gpus: 40, Status: "degraded", RequestsPerSec: 0.06},
		{ID: "syd", Name: "Sydney", City: "Sydney", Country: "Australia", Lat: -33.8688, Lon: 151.2093, Nodes: 8, Gpus: 24, Status: "online", RequestsPerSec: 0.04},
	}
}

func trimSlash(s string) string {
	for len(s) > 0 && s[len(s)-1] == '/' {
		s = s[:len(s)-1]
	}
	return s
}
