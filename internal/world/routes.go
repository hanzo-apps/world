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
	mux.HandleFunc("/v1/world/indicators", s.handleIndicators)
	mux.HandleFunc("/v1/world/sentiment", s.handleSentiment)

	// flights / geo / hazards
	mux.HandleFunc("/v1/world/opensky", s.handleOpenSky)
	mux.HandleFunc("/v1/world/ais-snapshot", s.handleAISSnapshot)
	mux.HandleFunc("/v1/world/firms-fires", s.handleFIRMS)
	mux.HandleFunc("/v1/world/earthquakes", s.handleEarthquakes)
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

	// ingested-data lake — the "one place to query everything" (search +
	// analytics across ALL ingested items: news, model observations, …).
	mux.HandleFunc("/v1/world/search", s.handleSearch)
	mux.HandleFunc("/v1/world/analytics", s.handleAnalytics)

	// per-identity settings — server-side dashboard sync for signed-in users
	// (bearer-gated; anonymous keeps localStorage).
	mux.HandleFunc("/v1/world/settings", s.handleSettings)

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

	// Cloud console. PUBLIC excitement layer (real, non-sensitive):
	mux.HandleFunc("/v1/world/cloud/models", s.handleCloudModels)
	// PUBLIC map layers (real telemetry when reachable; modeled/demo carries a flag):
	mux.HandleFunc("/v1/world/cloud/chain-nodes", s.handleCloudChainNodes)
	mux.HandleFunc("/v1/world/cloud/byo-gpu", s.handleCloudBYOGPU)
	mux.HandleFunc("/v1/world/cloud/traffic", s.handleCloudTraffic)
	// PUBLIC status.hanzo.ai summary (Gatus proxy: per-service up/down + incidents):
	mux.HandleFunc("/v1/world/cloud/status-page", s.handleCloudStatusPage)
	// ADMIN-only aggregates (requireAdmin, fail-closed 403; forward caller bearer):
	mux.HandleFunc("/v1/world/cloud/fleet", s.handleCloudFleet)
	mux.HandleFunc("/v1/world/cloud/services", s.handleCloudServices)
	mux.HandleFunc("/v1/world/cloud/analytics", s.handleCloudAnalytics)
	mux.HandleFunc("/v1/world/cloud/llm", s.handleCloudLLM)

	// AI (Hanzo inference)
	mux.HandleFunc("/v1/world/groq-summarize", s.handleSummarize)
	mux.HandleFunc("/v1/world/openrouter-summarize", s.handleSummarize)
	mux.HandleFunc("/v1/world/classify-batch", s.handleClassifyBatch)
	mux.HandleFunc("/v1/world/classify-event", s.handleClassifyEvent)
	mux.HandleFunc("/v1/world/country-intel", s.handleCountryIntel)
	mux.HandleFunc("/v1/world/analyst", s.handleAnalyst)
	mux.HandleFunc("/v1/world/models", s.handleModels)

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
