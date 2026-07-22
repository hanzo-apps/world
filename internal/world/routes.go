package world

import "net/http"

// Mount registers every /v1/world/* route on mux. All non-/api routes are handled by
// the static SPA server wired up in cmd/world.
func (s *Server) Mount(mux *http.ServeMux) {
	s.mount(mux)
	// The MCP server dispatches its read-only tool calls IN-PROCESS through this
	// same mux (the /v1/world/mcp route is registered in mount, above). Tool paths
	// only ever target data routes, never /v1/world/mcp, so there is no recursion.
	s.mcp.SetDispatcher(mux)
}

// registrar abstracts HandleFunc so routes register once and enumerate for tests.
type registrar interface {
	HandleFunc(pattern string, handler func(http.ResponseWriter, *http.Request))
}

func (s *Server) mount(mux registrar) {
	// health / meta
	mux.HandleFunc("/v1/world/health", s.handleHealth)
	mux.HandleFunc("/v1/world/version", s.handleVersion)
	mux.HandleFunc("/v1/world/download", s.handleDownload)

	// conflict
	mux.HandleFunc("/v1/world/acled", s.handleACLED)
	mux.HandleFunc("/v1/world/acled-conflict", s.handleACLEDConflict)
	mux.HandleFunc("/v1/world/ucdp", s.handleUCDP)
	mux.HandleFunc("/v1/world/ucdp-events", s.handleUCDPEvents)
	mux.HandleFunc("/v1/world/hapi", s.handleHAPI)

	// markets
	mux.HandleFunc("/v1/world/coingecko", s.handleCoingecko)
	mux.HandleFunc("/v1/world/polymarket", s.handlePolymarket)
	mux.HandleFunc("/v1/world/finnhub", s.handleFinnhub)
	mux.HandleFunc("/v1/world/yahoo-finance", s.handleYahooFinance)
	mux.HandleFunc("/v1/world/yahoo-batch", s.handleYahooBatch)
	mux.HandleFunc("/v1/world/stock-index", s.handleStockIndex)
	mux.HandleFunc("/v1/world/stablecoin-markets", s.handleStablecoins)
	mux.HandleFunc("/v1/world/etf-flows", s.handleETFFlows)
	mux.HandleFunc("/v1/world/macro-signals", s.handleMacroSignals)
	mux.HandleFunc("/v1/world/rotation", s.handleRotation)
	// Autonomous multi-asset fund brain (PAPER-only): the full conviction book,
	// the paper ledger the autonomous engine writes, and a deterministic daily
	// brief. Exact paths beat the /v1/world/ catch-all. No real orders — ever.
	mux.HandleFunc("/v1/world/fund", s.handleFund)
	mux.HandleFunc("/v1/world/fund/ledger", s.handleFundLedger)
	mux.HandleFunc("/v1/world/fund/brief", s.handleFundBrief)
	mux.HandleFunc("/v1/world/indicators", s.handleIndicators)
	mux.HandleFunc("/v1/world/sentiment", s.handleSentiment)
	mux.HandleFunc("/v1/world/defi", s.handleDefi)
	mux.HandleFunc("/v1/world/insider", s.handleInsider)
	mux.HandleFunc("/v1/world/layoffs", s.handleLayoffs)
	mux.HandleFunc("/v1/world/congress", s.handleCongress)

	// alt assets — art/collectibles auction results (Christie's public realized
	// sale totals) + luxury real-estate listings (LuxuryEstate). Scraped hourly +
	// cached; honest empty {items:[]} on a source failure, never fabricated. These
	// power the finance-terminal AltFeed panels (src/components/finance/AltFeedPanel.ts).
	mux.HandleFunc("/v1/world/auctions", s.handleAuctions)
	mux.HandleFunc("/v1/world/luxury-realestate", s.handleLuxuryRealestate)

	// flights / geo / hazards
	mux.HandleFunc("/v1/world/opensky", s.handleOpenSky)
	mux.HandleFunc("/v1/world/ais-snapshot", s.handleAISSnapshot)
	mux.HandleFunc("/v1/world/firms-fires", s.handleFIRMS)
	mux.HandleFunc("/v1/world/earthquakes", s.handleEarthquakes)
	mux.HandleFunc("/v1/world/hko-warnings", s.handleHKOWarnings)
	mux.HandleFunc("/v1/world/climate-anomalies", s.handleClimate)
	mux.HandleFunc("/v1/world/wingbits", s.handleWingbits)
	mux.HandleFunc("/v1/world/wingbits/", s.handleWingbits)

	// news / media
	mux.HandleFunc("/v1/world/gdelt-doc", s.handleGDELTDoc)
	mux.HandleFunc("/v1/world/gdelt-geo", s.handleGDELTGeo)
	mux.HandleFunc("/v1/world/rss-proxy", s.handleRSSProxy)
	mux.HandleFunc("/v1/world/feeds-batch", s.handleFeedsBatch)
	mux.HandleFunc("/v1/world/hackernews", s.handleHackerNews)
	mux.HandleFunc("/v1/world/github-trending", s.handleGitHubTrending)
	mux.HandleFunc("/v1/world/arxiv", s.handleArxiv)
	mux.HandleFunc("/v1/world/tech-events", s.handleTechEvents)
	mux.HandleFunc("/v1/world/fwdstart", s.handleFwdstart)
	mux.HandleFunc("/v1/world/youtube/live", s.handleYouTubeLive)
	mux.HandleFunc("/v1/world/youtube/embed", s.handleYouTubeEmbed)
	mux.HandleFunc("/v1/world/youtube/search", s.handleYouTubeSearch)
	mux.HandleFunc("/v1/world/monitors", s.handleMonitors)
	mux.HandleFunc("/v1/world/monitors/matches", s.handleMonitorMatches)
	// model-improvement consent opt-in (proxied to ai's OrgSettings, the source of truth)
	mux.HandleFunc("/v1/world/training-contribution", s.handleTrainingContribution)

	// ingested-data lake — the "one place to query everything" (search +
	// analytics across ALL ingested items: news, model observations, …).
	mux.HandleFunc("/v1/world/search", s.handleSearch)
	mux.HandleFunc("/v1/world/analytics", s.handleAnalytics)

	// per-identity settings — server-side dashboard sync for signed-in users
	// (bearer-gated; anonymous keeps localStorage).
	mux.HandleFunc("/v1/world/settings", s.handleSettings)

	// per-identity DASHBOARD composition — the signed-in user's full dashboard
	// (panels, order, spans/cols, layers, sources, custom widgets) that the AI
	// analyst and toolbar compose on the fly, persisted so it follows them across
	// devices. Same per-identity store as settings/monitors, 'dashboard' namespace.
	mux.HandleFunc("/v1/world/dashboard", s.handleDashboard)

	// per-identity USAGE HISTORY — the signed-in user's real actions (recent
	// searches, watch queue) persisted so they follow them across devices. Same
	// per-identity store, 'history' namespace; opaque blob, never fabricated.
	mux.HandleFunc("/v1/world/history", s.handleHistory)

	// econ / humanitarian
	mux.HandleFunc("/v1/world/fred-data", s.handleFRED)
	mux.HandleFunc("/v1/world/china-macro", s.handleChinaMacro)
	mux.HandleFunc("/v1/world/worldbank", s.handleWorldBank)
	mux.HandleFunc("/v1/world/eia", s.handleEIA)
	mux.HandleFunc("/v1/world/eia/", s.handleEIA)
	mux.HandleFunc("/v1/world/unhcr-population", s.handleUNHCR)
	mux.HandleFunc("/v1/world/worldpop-exposure", s.handleWorldPop)

	// infrastructure / status
	mux.HandleFunc("/v1/world/cyber-threats", s.handleCyberThreats)
	mux.HandleFunc("/v1/world/cloudflare-outages", s.handleCloudflareOutages)
	mux.HandleFunc("/v1/world/faa-status", s.handleFAAStatus)
	mux.HandleFunc("/v1/world/nga-warnings", s.handleNGAWarnings)
	mux.HandleFunc("/v1/world/service-status", s.handleServiceStatus)
	mux.HandleFunc("/v1/world/pizzint/dashboard-data", s.handlePizzintDashboard)
	mux.HandleFunc("/v1/world/pizzint/gdelt/batch", s.handlePizzintGdeltBatch)

	// computed intelligence
	mux.HandleFunc("/v1/world/risk-scores", s.handleRiskScores)
	mux.HandleFunc("/v1/world/theater-posture", s.handleTheaterPosture)
	mux.HandleFunc("/v1/world/temporal-baseline", s.handleTemporalBaseline)

	// SaaS mode — anonymized platform-wide aggregate (signed-out investor view).
	// Demo-flagged by default; real non-sensitive counts when a service token is
	// configured. Org-scoped drill-down goes straight to api.hanzo.ai, not here.
	mux.HandleFunc("/v1/world/cloud-pulse", s.handleCloudPulse)

	// AI Compute pulse (AI variant): live inference volume + serving fleet, pushed
	// over SSE (EventSource) with a plain-GET JSON snapshot as the poll fallback.
	// Same honest platform aggregate as cloud-pulse; "unavailable" without a token.
	mux.HandleFunc("/v1/world/ai-pulse", s.handleAIPulse)

	// Enso flywheel (AI variant): the router self-improvement loop — routing-ledger
	// tail + reward tail (super-admin) folded with the latest enso-bench eval
	// scores (embedded snapshot / ENSO_BENCH_URL). Event-typed; evals-only degrade.
	mux.HandleFunc("/v1/world/enso-training", s.handleEnsoTraining)

	// Cloud console. PUBLIC excitement layer (real, non-sensitive):
	mux.HandleFunc("/v1/world/cloud/models", s.handleCloudModels)
	// PUBLIC map layers (real telemetry when reachable; modeled/demo carries a flag):
	mux.HandleFunc("/v1/world/cloud/chain-nodes", s.handleCloudChainNodes)
	mux.HandleFunc("/v1/world/cloud/byo-gpu", s.handleCloudBYOGPU)
	mux.HandleFunc("/v1/world/cloud/traffic", s.handleCloudTraffic)
	// Native LB request-geo aggregate (points + throughput) for the Hanzo-mode globe.
	// Proxies the ai backend's public /v1/traffic/globe; honest empty state, no demo.
	mux.HandleFunc("/v1/world/cloud/traffic-globe", s.handleCloudTrafficGlobe)
	// PUBLIC status.hanzo.ai summary (Gatus proxy: per-service up/down + incidents):
	mux.HandleFunc("/v1/world/cloud/status-page", s.handleCloudStatusPage)
	// PUBLIC Enso Live Training — ai gateway /v1/router/stats?scope=platform proxy
	// (aggregates only; arms already opaque "arm-N" upstream — no vendor names):
	mux.HandleFunc("/v1/world/cloud/router-stats", s.handleCloudRouterStats)
	// PUBLIC flywheel history — ai gateway /v1/router/history?scope=platform proxy:
	// daily reward-rate + cumulative cost-saved + adoption + retrain timeline. Honest
	// empty until the ledger fills; never a fabricated curve.
	mux.HandleFunc("/v1/world/cloud/router-history", s.handleCloudRouterHistory)
	// Enso Router controls: ORG cost↔quality preference (GET|PUT, caller bearer
	// forwarded → ai /v1/router/preference) + the PUBLIC mean-field judge panel
	// (GET, scope=platform → ai /v1/router/judge-panel). Both degrade to a
	// well-formed {available:false} on any upstream failure — including a 404 while
	// the gateway route is not yet deployed — never a 5xx.
	mux.HandleFunc("/v1/world/cloud/router-preference", s.handleCloudRouterPreference)
	mux.HandleFunc("/v1/world/cloud/judge-panel", s.handleCloudJudgePanel)
	// ADMIN-only aggregates (requireAdmin, fail-closed 403; forward caller bearer):
	mux.HandleFunc("/v1/world/cloud/fleet", s.handleCloudFleet)
	mux.HandleFunc("/v1/world/cloud/services", s.handleCloudServices)
	mux.HandleFunc("/v1/world/cloud/analytics", s.handleCloudAnalytics)
	mux.HandleFunc("/v1/world/cloud/llm", s.handleCloudLLM)
	// DOKS cluster nodes grouped by cluster (hanzo-k8s, …) + the GPU job queue
	// (gpu-jobs: depth, what's running from which service). Same requireAdmin gate.
	mux.HandleFunc("/v1/world/cloud/clusters", s.handleCloudClusters)
	mux.HandleFunc("/v1/world/cloud/queue", s.handleCloudQueue)
	// ADMIN-only Enso benchmark suite: private, competitive head-to-head (names
	// competitor models + Enso). Same requireAdmin gate (401/403 fail-closed);
	// reshapes the embedded enso-bench snapshot — never leaks to a non-admin.
	mux.HandleFunc("/v1/world/enso-benchmarks", s.handleEnsoBenchmarks)

	// AI (Hanzo inference)
	mux.HandleFunc("/v1/world/groq-summarize", s.handleSummarize)
	mux.HandleFunc("/v1/world/openrouter-summarize", s.handleSummarize)
	mux.HandleFunc("/v1/world/classify-batch", s.handleClassifyBatch)
	mux.HandleFunc("/v1/world/classify-event", s.handleClassifyEvent)
	mux.HandleFunc("/v1/world/country-intel", s.handleCountryIntel)
	mux.HandleFunc("/v1/world/analyst", s.handleAnalyst)
	mux.HandleFunc("/v1/world/models", s.handleModels)
	// Content-free AI reward-signal BFF. BARE /v1/feedback (matching the gateway
	// path) so the @hanzo/ai SDK's same-origin baseUrl:'' → POST /v1/feedback
	// reaches it. An exact pattern, so it beats the "/" SPA catch-all.
	mux.HandleFunc("/v1/feedback", s.handleFeedback)

	// social share (OpenGraph)
	mux.HandleFunc("/v1/world/story", s.handleStory)
	mux.HandleFunc("/v1/world/og-story", s.handleOGStory)

	// world model (continuously-folded world-state engine)
	s.worldModel.Mount(mux)

	// MCP server (streamable-HTTP, JSON-RPC 2.0): a read-only projection of the
	// routes above. Registered here so it enumerates in Routes(); its dispatcher
	// is wired in Mount. Exact path beats the /v1/world/ catch-all below.
	mux.HandleFunc("/v1/world/mcp", s.mcp.ServeHTTP)

	// Catch-all for any unregistered /v1/world/* path: a JSON 404, never the SPA
	// shell. Exact and subtree routes above are longer prefixes and win.
	mux.HandleFunc("/v1/world/", s.handleAPINotFound)
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

// Routes returns every registered /v1/world path (for tests + introspection).
func (s *Server) Routes() []string {
	c := &routeCollector{}
	s.mount(c)
	return c.paths
}

// routeCollector implements the minimal registrar interface for enumeration.
type routeCollector struct{ paths []string }

func (c *routeCollector) HandleFunc(pattern string, _ func(http.ResponseWriter, *http.Request)) {
	c.paths = append(c.paths, pattern)
}
