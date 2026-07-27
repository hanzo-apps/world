package world

import (
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/zap-proto/zip"
)

// The world data plane is ONE table: every path, and the net/http handler that
// owns that path's method policy (preflight / methodNotGet) and CORS headers.
// NewApp projects the table onto a zip router; Routes projects it to path
// strings. Two projections of one declaration, so a route can never exist in
// one and be missing from the other.

const (
	// worldPrefix is the group every data route hangs off.
	worldPrefix = "/v1/world"

	// feedbackPath is the content-free AI reward-signal BFF. BARE /v1/feedback
	// (matching the gateway path) so the @hanzo/ai SDK's same-origin baseUrl:''
	// → POST /v1/feedback reaches it — hence its own registration beside the
	// world group rather than inside it.
	feedbackPath = "/v1/feedback"
)

// route is one endpoint: a path relative to worldPrefix, and its handler.
type route struct {
	path string
	h    http.HandlerFunc
}

// NewApp returns the zip app the world data plane runs on: the shared config,
// the request log, every /v1/world/* route and the bare /v1/feedback. cmd/world
// adds the static SPA catch-all after it and the tests serve it as-is, so the
// process and the suite exercise ONE construction.
func (s *Server) NewApp() *zip.App {
	app := zip.New(zip.Config{
		AppName:               "world",
		DisableStartupMessage: true,
		// net/http sent no Server header; "-" suppresses zip's so the response
		// header block is unchanged.
		ServerHeader: "-",
		// The ServeMux had no request-body cap — the handlers cap themselves
		// (256 KiB is the largest). fasthttp needs a number; this is far above
		// any real request, so the effective behaviour is unchanged.
		BodyLimit: 32 << 20,
	})
	app.Use(logRequests)

	v1 := app.Group("/v1")
	world := v1.Group("/world")
	for _, rt := range s.worldRoutes() {
		world.All(pattern(rt.path), bridge(worldPrefix+rt.path, rt.h))
	}
	v1.All("/feedback", bridge(feedbackPath, s.handleFeedback))

	// The MCP server dispatches its read-only tool calls IN-PROCESS through this
	// same app (the /v1/world/mcp route is in the table below). Tool paths only
	// ever target data routes, never /v1/world/mcp, so there is no recursion.
	s.mcp.SetDispatcher(Handler(app))
	return app
}

// logRequests times every data request. Static traffic passes through unlogged,
// exactly as it did under the net/http wrapper.
func logRequests(c *zip.Ctx) error {
	if !strings.HasPrefix(c.Path(), worldPrefix+"/") {
		return c.Continue()
	}
	start := time.Now()
	method, path := c.Method(), c.Path()
	err := c.Continue()
	log.Printf("api %s %s %s", method, path, time.Since(start).Round(time.Millisecond))
	return err
}

// Routes returns every registered path (for tests + introspection).
func (s *Server) Routes() []string {
	rs := s.worldRoutes()
	out := make([]string, 0, len(rs)+1)
	for _, rt := range rs {
		out = append(out, worldPrefix+rt.path)
	}
	return append(out, feedbackPath)
}

// worldRoutes declares the /v1/world data plane, paths relative to that prefix.
func (s *Server) worldRoutes() []route {
	rs := []route{
		// health / meta
		{"/health", s.handleHealth},
		{"/version", s.handleVersion},
		{"/download", s.handleDownload},

		// conflict
		{"/acled", s.handleACLED},
		{"/acled-conflict", s.handleACLEDConflict},
		{"/ucdp", s.handleUCDP},
		{"/ucdp-events", s.handleUCDPEvents},
		{"/hapi", s.handleHAPI},

		// markets
		{"/coingecko", s.handleCoingecko},
		{"/polymarket", s.handlePolymarket},
		{"/finnhub", s.handleFinnhub},
		{"/yahoo-finance", s.handleYahooFinance},
		{"/yahoo-batch", s.handleYahooBatch},
		{"/stock-index", s.handleStockIndex},
		{"/stablecoin-markets", s.handleStablecoins},
		{"/etf-flows", s.handleETFFlows},
		{"/macro-signals", s.handleMacroSignals},
		{"/rotation", s.handleRotation},
		// Autonomous multi-asset fund brain (PAPER-only): the full conviction book,
		// the paper ledger the autonomous engine writes, and a deterministic daily
		// brief. Exact paths beat the /v1/world/ catch-all. No real orders — ever.
		{"/fund", s.handleFund},
		{"/fund/ledger", s.handleFundLedger},
		{"/fund/brief", s.handleFundBrief},
		{"/indicators", s.handleIndicators},
		{"/sentiment", s.handleSentiment},
		{"/defi", s.handleDefi},
		{"/insider", s.handleInsider},
		{"/layoffs", s.handleLayoffs},
		{"/congress", s.handleCongress},

		// alt assets — art/collectibles auction results (Christie's public realized
		// sale totals) + luxury real-estate listings (LuxuryEstate). Scraped hourly +
		// cached; honest empty {items:[]} on a source failure, never fabricated. These
		// power the finance-terminal AltFeed panels (src/components/finance/AltFeedPanel.ts).
		{"/auctions", s.handleAuctions},
		{"/luxury-realestate", s.handleLuxuryRealestate},

		// flights / geo / hazards
		{"/opensky", s.handleOpenSky},
		{"/ais-snapshot", s.handleAISSnapshot},
		{"/firms-fires", s.handleFIRMS},
		{"/earthquakes", s.handleEarthquakes},
		{"/hko-warnings", s.handleHKOWarnings},
		{"/climate-anomalies", s.handleClimate},
		{"/wingbits", s.handleWingbits},
		{"/wingbits/", s.handleWingbits},

		// news / media
		{"/gdelt-doc", s.handleGDELTDoc},
		{"/gdelt-geo", s.handleGDELTGeo},
		{"/rss-proxy", s.handleRSSProxy},
		{"/feeds-batch", s.handleFeedsBatch},
		{"/hackernews", s.handleHackerNews},
		{"/github-trending", s.handleGitHubTrending},
		{"/arxiv", s.handleArxiv},
		{"/tech-events", s.handleTechEvents},
		{"/fwdstart", s.handleFwdstart},
		{"/youtube/live", s.handleYouTubeLive},
		{"/youtube/embed", s.handleYouTubeEmbed},
		{"/youtube/search", s.handleYouTubeSearch},
		{"/monitors", s.handleMonitors},
		{"/monitors/matches", s.handleMonitorMatches},
		// model-improvement consent opt-in (proxied to ai's OrgSettings, the source of truth)
		{"/training-contribution", s.handleTrainingContribution},

		// ingested-data lake — the "one place to query everything" (search +
		// analytics across ALL ingested items: news, model observations, …).
		{"/search", s.handleSearch},
		{"/analytics", s.handleAnalytics},

		// per-identity settings — server-side dashboard sync for signed-in users
		// (bearer-gated; anonymous keeps localStorage).
		{"/settings", s.handleSettings},

		// per-identity DASHBOARD composition — the signed-in user's full dashboard
		// (panels, order, spans/cols, layers, sources, custom widgets) that the AI
		// analyst and toolbar compose on the fly, persisted so it follows them across
		// devices. Same per-identity store as settings/monitors, 'dashboard' namespace.
		{"/dashboard", s.handleDashboard},

		// org-shared DASHBOARD default — the layout an org ADMIN publishes for the whole
		// org. GET returns the org default to any signed-in member; PUT publishes it and
		// is admin-ONLY (403 otherwise). Same opaque-blob contract as the per-user
		// dashboard, keyed by org; the frontend hydrates it as the default, then the
		// user's own doc overrides it.
		{"/dashboard/shared", s.handleDashboardShared},

		// per-identity USAGE HISTORY — the signed-in user's real actions (recent
		// searches, watch queue) persisted so they follow them across devices. Same
		// per-identity store, 'history' namespace; opaque blob, never fabricated.
		{"/history", s.handleHistory},

		// econ / humanitarian
		{"/fred-data", s.handleFRED},
		{"/china-macro", s.handleChinaMacro},
		{"/worldbank", s.handleWorldBank},
		{"/eia", s.handleEIA},
		{"/eia/", s.handleEIA},
		{"/unhcr-population", s.handleUNHCR},
		{"/worldpop-exposure", s.handleWorldPop},

		// infrastructure / status
		{"/cyber-threats", s.handleCyberThreats},
		{"/cloudflare-outages", s.handleCloudflareOutages},
		{"/faa-status", s.handleFAAStatus},
		{"/nga-warnings", s.handleNGAWarnings},
		{"/service-status", s.handleServiceStatus},
		{"/pizzint/dashboard-data", s.handlePizzintDashboard},
		{"/pizzint/gdelt/batch", s.handlePizzintGdeltBatch},

		// computed intelligence
		{"/risk-scores", s.handleRiskScores},
		{"/theater-posture", s.handleTheaterPosture},
		{"/temporal-baseline", s.handleTemporalBaseline},

		// SaaS mode — anonymized platform-wide aggregate (signed-out investor view).
		// Demo-flagged by default; real non-sensitive counts when a service token is
		// configured. Org-scoped drill-down goes straight to api.hanzo.ai, not here.
		{"/cloud-pulse", s.handleCloudPulse},

		// AI Compute pulse (AI variant): live inference volume + serving fleet, pushed
		// over SSE (EventSource) with a plain-GET JSON snapshot as the poll fallback.
		// Same honest platform aggregate as cloud-pulse; "unavailable" without a token.
		{"/ai-pulse", s.handleAIPulse},

		// Enso flywheel (AI variant): the router self-improvement loop — routing-ledger
		// tail + reward tail (super-admin) folded with the latest enso-bench eval
		// scores (embedded snapshot / ENSO_BENCH_URL). Event-typed; evals-only degrade.
		{"/enso-training", s.handleEnsoTraining},

		// Cloud console. PUBLIC excitement layer (real, non-sensitive):
		{"/cloud/models", s.handleCloudModels},
		// PUBLIC map layers (real telemetry when reachable; modeled/demo carries a flag):
		{"/cloud/chain-nodes", s.handleCloudChainNodes},
		{"/cloud/byo-gpu", s.handleCloudBYOGPU},
		{"/cloud/traffic", s.handleCloudTraffic},
		// Native LB request-geo aggregate (points + throughput) for the Hanzo-mode globe.
		// Proxies the ai backend's public /v1/traffic/globe; honest empty state, no demo.
		{"/cloud/traffic-globe", s.handleCloudTrafficGlobe},
		// PUBLIC status.hanzo.ai summary (Gatus proxy: per-service up/down + incidents):
		{"/cloud/status-page", s.handleCloudStatusPage},
		// PUBLIC Enso Live Training — ai gateway /v1/router/stats?scope=platform proxy
		// (aggregates only; arms already opaque "arm-N" upstream — no vendor names):
		{"/cloud/router-stats", s.handleCloudRouterStats},
		// PUBLIC flywheel history — ai gateway /v1/router/history?scope=platform proxy:
		// daily reward-rate + cumulative cost-saved + adoption + retrain timeline. Honest
		// empty until the ledger fills; never a fabricated curve.
		{"/cloud/router-history", s.handleCloudRouterHistory},
		// Enso Router controls: ORG cost↔quality preference (GET|PUT, caller bearer
		// forwarded → ai /v1/router/preference) + the PUBLIC mean-field judge panel
		// (GET, scope=platform → ai /v1/router/judge-panel). Both degrade to a
		// well-formed {available:false} on any upstream failure — including a 404 while
		// the gateway route is not yet deployed — never a 5xx.
		{"/cloud/router-preference", s.handleCloudRouterPreference},
		{"/cloud/judge-panel", s.handleCloudJudgePanel},
		// ADMIN-only aggregates (requireAdmin, fail-closed 403; forward caller bearer):
		{"/cloud/fleet", s.handleCloudFleet},
		{"/cloud/services", s.handleCloudServices},
		{"/cloud/analytics", s.handleCloudAnalytics},
		{"/cloud/llm", s.handleCloudLLM},
		// DOKS cluster nodes grouped by cluster (hanzo-k8s, …) + the GPU job queue
		// (gpu-jobs: depth, what's running from which service). Same requireAdmin gate.
		{"/cloud/clusters", s.handleCloudClusters},
		{"/cloud/queue", s.handleCloudQueue},
		// ADMIN-only Enso benchmark suite: private, competitive head-to-head (names
		// competitor models + Enso). Same requireAdmin gate (401/403 fail-closed);
		// reshapes the embedded enso-bench snapshot — never leaks to a non-admin.
		{"/enso-benchmarks", s.handleEnsoBenchmarks},

		// AI (Hanzo inference)
		{"/groq-summarize", s.handleSummarize},
		{"/openrouter-summarize", s.handleSummarize},
		{"/classify-batch", s.handleClassifyBatch},
		{"/classify-event", s.handleClassifyEvent},
		{"/country-intel", s.handleCountryIntel},
		{"/analyst", s.handleAnalyst},
		{"/models", s.handleModels},

		// social share (OpenGraph)
		{"/story", s.handleStory},
		{"/og-story", s.handleOGStory},
	}

	// world model (continuously-folded world-state engine) — collected through
	// the engine's own registrar seam so its routes join this one table rather
	// than needing a second mux.
	c := &collector{}
	s.worldModel.Mount(c)
	rs = append(rs, c.routes...)

	// MCP server (streamable-HTTP, JSON-RPC 2.0): a read-only projection of the
	// routes above. Declared here so it enumerates in Routes(); its dispatcher is
	// wired in Mount.
	rs = append(rs, route{"/mcp", s.mcp.ServeHTTP})

	// Catch-all for any unregistered /v1/world/* path: a JSON 404, never the SPA
	// shell. Every exact and subtree route above is more specific and wins.
	return append(rs, route{"/", s.handleAPINotFound})
}

// collector adapts the model engine's registrar seam into route values, so the
// engine keeps declaring its own paths and they still land in the one table.
type collector struct{ routes []route }

func (c *collector) HandleFunc(p string, h func(http.ResponseWriter, *http.Request)) {
	c.routes = append(c.routes, route{strings.TrimPrefix(p, worldPrefix), h})
}

// handleAPINotFound answers unmatched /v1/world/* paths with a JSON 404 so a bad
// endpoint is visible rather than masked by the static index.html.
func (s *Server) handleAPINotFound(w http.ResponseWriter, r *http.Request) {
	setCORS(w, "GET, POST, OPTIONS")
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	writeError(w, http.StatusNotFound, "Not found: "+r.URL.Path)
}
