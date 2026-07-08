package world

import "net/http"

// Mount registers every /api/* route on mux. All non-/api routes are handled by
// the static SPA server wired up in cmd/world.
func (s *Server) Mount(mux *http.ServeMux) {
	// health / meta
	mux.HandleFunc("/api/health", s.handleHealth)
	mux.HandleFunc("/api/version", s.handleVersion)
	mux.HandleFunc("/api/download", s.handleDownload)

	// conflict
	mux.HandleFunc("/api/acled", s.handleACLED)
	mux.HandleFunc("/api/acled-conflict", s.handleACLEDConflict)
	mux.HandleFunc("/api/ucdp", s.handleUCDP)
	mux.HandleFunc("/api/ucdp-events", s.handleUCDPEvents)
	mux.HandleFunc("/api/hapi", s.handleHAPI)

	// markets
	mux.HandleFunc("/api/coingecko", s.handleCoingecko)
	mux.HandleFunc("/api/polymarket", s.handlePolymarket)
	mux.HandleFunc("/api/finnhub", s.handleFinnhub)
	mux.HandleFunc("/api/yahoo-finance", s.handleYahooFinance)
	mux.HandleFunc("/api/stock-index", s.handleStockIndex)
	mux.HandleFunc("/api/stablecoin-markets", s.handleStablecoins)
	mux.HandleFunc("/api/etf-flows", s.handleETFFlows)
	mux.HandleFunc("/api/macro-signals", s.handleMacroSignals)

	// flights / geo / hazards
	mux.HandleFunc("/api/opensky", s.handleOpenSky)
	mux.HandleFunc("/api/ais-snapshot", s.handleAISSnapshot)
	mux.HandleFunc("/api/firms-fires", s.handleFIRMS)
	mux.HandleFunc("/api/earthquakes", s.handleEarthquakes)
	mux.HandleFunc("/api/climate-anomalies", s.handleClimate)
	mux.HandleFunc("/api/wingbits", s.handleWingbits)
	mux.HandleFunc("/api/wingbits/", s.handleWingbits)

	// news / media
	mux.HandleFunc("/api/gdelt-doc", s.handleGDELTDoc)
	mux.HandleFunc("/api/gdelt-geo", s.handleGDELTGeo)
	mux.HandleFunc("/api/rss-proxy", s.handleRSSProxy)
	mux.HandleFunc("/api/hackernews", s.handleHackerNews)
	mux.HandleFunc("/api/github-trending", s.handleGitHubTrending)
	mux.HandleFunc("/api/arxiv", s.handleArxiv)
	mux.HandleFunc("/api/tech-events", s.handleTechEvents)
	mux.HandleFunc("/api/fwdstart", s.handleFwdstart)
	mux.HandleFunc("/api/youtube/live", s.handleYouTubeLive)
	mux.HandleFunc("/api/youtube/embed", s.handleYouTubeEmbed)

	// econ / humanitarian
	mux.HandleFunc("/api/fred-data", s.handleFRED)
	mux.HandleFunc("/api/worldbank", s.handleWorldBank)
	mux.HandleFunc("/api/eia", s.handleEIA)
	mux.HandleFunc("/api/eia/", s.handleEIA)
	mux.HandleFunc("/api/unhcr-population", s.handleUNHCR)
	mux.HandleFunc("/api/worldpop-exposure", s.handleWorldPop)

	// infrastructure / status
	mux.HandleFunc("/api/cyber-threats", s.handleCyberThreats)
	mux.HandleFunc("/api/cloudflare-outages", s.handleCloudflareOutages)
	mux.HandleFunc("/api/faa-status", s.handleFAAStatus)
	mux.HandleFunc("/api/nga-warnings", s.handleNGAWarnings)
	mux.HandleFunc("/api/service-status", s.handleServiceStatus)
	mux.HandleFunc("/api/pizzint/dashboard-data", s.handlePizzintDashboard)
	mux.HandleFunc("/api/pizzint/gdelt/batch", s.handlePizzintGdeltBatch)

	// computed intelligence
	mux.HandleFunc("/api/risk-scores", s.handleRiskScores)
	mux.HandleFunc("/api/theater-posture", s.handleTheaterPosture)
	mux.HandleFunc("/api/temporal-baseline", s.handleTemporalBaseline)

	// AI (Hanzo inference)
	mux.HandleFunc("/api/groq-summarize", s.handleSummarize)
	mux.HandleFunc("/api/openrouter-summarize", s.handleSummarize)
	mux.HandleFunc("/api/classify-batch", s.handleClassifyBatch)
	mux.HandleFunc("/api/classify-event", s.handleClassifyEvent)
	mux.HandleFunc("/api/country-intel", s.handleCountryIntel)

	// social share (OpenGraph)
	mux.HandleFunc("/api/story", s.handleStory)
	mux.HandleFunc("/api/og-story", s.handleOGStory)
}
