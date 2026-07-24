package world

import (
	"context"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/hanzoai/world/internal/world/mcp"
)

// handlers_worldgw.go implements the six single-domain AI-plane endpoints the
// world-gw MCP/ZAP gateway proxies (conflicts, infra, vessel, news, markets,
// feeds). Each is a THIN reshape over an EXISTING backend source — the same
// producers the event aggregator uses (handlers_events.go) or the same cache
// key/fetcher a sibling handler uses — never a second fetcher for the same data.
// All are public reads, mirroring their siblings; honest empty + a "note" field
// wherever a source is genuinely not provisioned server-side.

// ── /v1/world/conflicts ──────────────────────────────────────────────────────

// handleConflicts filters the UCDP GED conflict events (the same conflictRecords
// the aggregator emits) by country / since / severity.
func (s *Server) handleConflicts(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") || methodNotGet(w, r) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	q := r.URL.Query()
	country := strings.ToLower(strings.TrimSpace(q.Get("country")))
	severity := strings.ToLower(strings.TrimSpace(q.Get("severity")))
	since := parseAnyTime(q.Get("since"))

	out := make([]map[string]any, 0, 64)
	for _, rec := range s.conflictRecords(ctx) {
		if !since.IsZero() && rec.TS.Before(since) {
			continue
		}
		if severity != "" && asString(mapGet(rec.Payload, "severity")) != severity {
			continue
		}
		if country != "" && !strings.Contains(strings.ToLower(asString(mapGet(rec.Payload, "country"))), country) {
			continue
		}
		out = append(out, rec.Payload)
	}
	resp := map[string]any{"conflicts": out, "count": len(out), "source": "ucdp-ged", "asOf": nowISO()}
	if country != "" && len(out) == 0 {
		resp["note"] = "country matches on the UCDP country NAME (substring, case-insensitive); an ISO code may not match"
	}
	writeJSON(w, http.StatusOK, "public, max-age=300, s-maxage=300, stale-while-revalidate=60", resp)
}

// ── /v1/world/infra ──────────────────────────────────────────────────────────

var serviceCategorySet = map[string]bool{"cloud": true, "dev": true, "comm": true, "ai": true, "saas": true}
var physicalInfraSet = map[string]bool{"cable": true, "base": true, "nuclear": true, "power": true, "telecom": true}

// handleInfra returns the real provider/service infrastructure-status board (the
// same data /v1/world/service-status serves, one fetcher). Physical-asset
// geolocation (cables/bases/nuclear/power/telecom) and the geospatial 'near'
// filter are not provisioned server-side — those get an honest empty + note.
func (s *Server) handleInfra(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") || methodNotGet(w, r) {
		return
	}
	q := r.URL.Query()
	typ := strings.ToLower(strings.TrimSpace(q.Get("type")))
	near := strings.TrimSpace(q.Get("near"))

	if physicalInfraSet[typ] {
		writeJSON(w, http.StatusOK, "public, max-age=60", map[string]any{
			"infrastructure": []any{}, "type": typ,
			"note": "physical-infrastructure geodata (cables, bases, nuclear, power, telecom) is not provisioned server-side; /v1/world/infra surfaces provider/service infrastructure status",
		})
		return
	}
	category := ""
	note := ""
	if serviceCategorySet[typ] {
		category = typ
	} else if typ != "" {
		note = "unknown type " + typ + "; returning the full provider/service infrastructure board. "
	}

	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	v, ok := s.snapshotJSON(ctx, "service-status:"+category, time.Minute, 10*time.Minute,
		func(c context.Context) (any, error) { return s.serviceStatusBoard(c, category) })
	board := mapOf(v)
	services := sliceOfMaps(mapGet(board, "services"))
	if services == nil {
		services = []map[string]any{}
	}
	if near != "" {
		note += "geospatial 'near' filter unsupported: server-side infrastructure is provider-status, not geolocated"
	}
	resp := map[string]any{
		"infrastructure": services,
		"summary":        mapGet(board, "summary"),
		"type":           typ,
		"count":          len(services),
		"asOf":           nowISO(),
	}
	if note != "" {
		resp["note"] = strings.TrimSpace(note)
	}
	if !ok {
		resp["note"] = strings.TrimSpace("service-status upstream unavailable. " + note)
	}
	writeJSON(w, http.StatusOK, "public, max-age=60, s-maxage=60, stale-while-revalidate=30", resp)
}

// ── /v1/world/vessel ─────────────────────────────────────────────────────────

// handleVessel looks a vessel up in the AIS relay snapshot by mmsi / imo / name.
// The relay is optional (WS_RELAY_URL); when it is not configured — the common
// case server-side — this returns an honest empty set with a note rather than
// fabricated positions.
func (s *Server) handleVessel(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") || methodNotGet(w, r) {
		return
	}
	base := relayBase()
	if base == "" {
		writeJSON(w, http.StatusOK, "public, max-age=30", map[string]any{
			"vessels": []any{}, "note": "AIS tracking not provisioned server-side",
		})
		return
	}
	q := r.URL.Query()
	mmsi := strings.TrimSpace(q.Get("mmsi"))
	imo := strings.TrimSpace(q.Get("imo"))
	name := strings.ToLower(strings.TrimSpace(q.Get("name")))

	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	var snap map[string]any
	if err := s.getJSON(ctx, base+"/ais/snapshot", map[string]string{"Accept": "application/json"}, &snap); err != nil {
		writeJSON(w, http.StatusOK, "no-store", map[string]any{"vessels": []any{}, "note": "AIS relay unreachable"})
		return
	}
	out := make([]map[string]any, 0, 8)
	for _, ves := range sliceOfMaps(mapGet(snap, "vessels")) {
		if mmsi != "" && asString(mapGet(ves, "mmsi")) != mmsi {
			continue
		}
		if imo != "" && asString(mapGet(ves, "imo")) != imo {
			continue
		}
		if name != "" && !strings.Contains(strings.ToLower(asString(mapGet(ves, "name"))), name) {
			continue
		}
		out = append(out, ves)
	}
	writeJSON(w, http.StatusOK, "public, max-age=8, s-maxage=8", map[string]any{"vessels": out, "count": len(out)})
}

// ── /v1/world/news ───────────────────────────────────────────────────────────

// newsCategoryAlias maps the gw's news vocabulary (world|markets|tech|finance|
// happy) onto the curated feed categories (mcp.FeedCategories). Unknowns fall
// back to "world".
var newsCategoryAlias = map[string]string{
	"finance": "markets", "happy": "world", "security": "security", "ai": "ai",
	"world": "world", "markets": "markets", "tech": "tech",
}

// handleNews returns the latest curated-feed headlines for one category — the
// same feed pipeline the aggregator's world.news.live producer uses.
func (s *Server) handleNews(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") || methodNotGet(w, r) {
		return
	}
	q := r.URL.Query()
	category := newsCategoryAlias[strings.ToLower(strings.TrimSpace(q.Get("category")))]
	if category == "" {
		category = "world"
	}
	limit := clampInt(q.Get("limit"), 20, 1, 100)

	ctx, cancel := context.WithTimeout(r.Context(), 25*time.Second)
	defer cancel()
	items := s.newsSnapshot(ctx, category, limit)
	writeJSON(w, http.StatusOK, "public, max-age=60, s-maxage=60, stale-while-revalidate=300",
		map[string]any{"items": items, "category": category, "count": len(items), "asOf": nowISO()})
}

// newsSnapshot fetches the curated feeds for one category through the SHARED feed
// pipeline (feedXML warm cache → parseFeedItems → enrichFeedItems), merges them
// newest-first and caps to limit. Cached briefly under a per-category key so the
// stream loop and repeated polls do not re-parse every call.
func (s *Server) newsSnapshot(ctx context.Context, category string, limit int) []feedBatchItem {
	cats := mcp.FeedCategories()
	urls, ok := cats[category]
	if !ok {
		category, urls = "world", cats["world"]
	}
	key := "aiplane:news:" + category
	if v, hit := s.cache.Get(key); hit {
		if items, ok := v.([]feedBatchItem); ok {
			return capNews(items, limit)
		}
	}
	merged := make([]feedBatchItem, 0, len(urls)*feedsBatchMaxItems)
	var mu sync.Mutex
	var wg sync.WaitGroup
	for _, u := range urls {
		wg.Add(1)
		go func(u string) {
			defer wg.Done()
			body, ok, fresh := s.feedXML(ctx, u)
			if !ok {
				return
			}
			items := enrichFeedItems(parseFeedItems(body, feedsBatchMaxItems), "full")
			mu.Lock()
			merged = append(merged, items...)
			mu.Unlock()
			if fresh {
				s.ingestFeedItems(u, body)
			}
		}(u)
	}
	wg.Wait()
	sort.SliceStable(merged, func(i, j int) bool {
		return parseAnyTime(merged[i].PubDate).After(parseAnyTime(merged[j].PubDate))
	})
	s.cache.Set(key, merged, 2*time.Minute, 10*time.Minute)
	return capNews(merged, limit)
}

func capNews(items []feedBatchItem, limit int) []feedBatchItem {
	if limit > 0 && len(items) > limit {
		return items[:limit]
	}
	return items
}

// ── /v1/world/markets ────────────────────────────────────────────────────────

// handleMarkets returns quotes / crypto. Equities+FX+commodities come from Yahoo
// (quotesSnapshot); crypto from CoinGecko (cryptoSnapshot) — the same producers
// the aggregator projects onto world.markets.{quotes,crypto}.
func (s *Server) handleMarkets(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") || methodNotGet(w, r) {
		return
	}
	q := r.URL.Query()
	ticker := strings.TrimSpace(q.Get("ticker"))
	category := strings.ToLower(strings.TrimSpace(q.Get("category")))

	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	resp := map[string]any{"category": category, "asOf": nowISO()}

	if ticker != "" {
		if category == "crypto" {
			resp["crypto"] = s.cryptoSnapshot(ctx, ticker)
		} else {
			cat := category
			if !oneOf(cat, "fx", "commodities", "equities") {
				cat = "equities"
			}
			resp["quotes"] = s.quotesSnapshot(ctx, cat, ticker)
		}
		writeJSON(w, http.StatusOK, marketsCC, resp)
		return
	}

	switch category {
	case "crypto":
		resp["crypto"] = s.cryptoSnapshot(ctx, "")
	case "fx", "commodities", "equities":
		resp["quotes"] = s.quotesSnapshot(ctx, category, "")
	default: // "" / "all" → both equities and crypto
		resp["quotes"] = s.quotesSnapshot(ctx, "equities", "")
		resp["crypto"] = s.cryptoSnapshot(ctx, "")
	}
	writeJSON(w, http.StatusOK, marketsCC, resp)
}

const marketsCC = "public, max-age=60, s-maxage=60, stale-while-revalidate=60"

type symInfo struct{ sym, name string }

var quoteSets = map[string][]symInfo{
	"equities": {{"^GSPC", "S&P 500"}, {"^IXIC", "Nasdaq Composite"}, {"^DJI", "Dow Jones"}, {"^FTSE", "FTSE 100"}, {"^N225", "Nikkei 225"}, {"^GDAXI", "DAX"}},
	"fx":       {{"EURUSD=X", "EUR/USD"}, {"GBPUSD=X", "GBP/USD"}, {"USDJPY=X", "USD/JPY"}, {"USDCNY=X", "USD/CNY"}},
	"commodities": {{"GC=F", "Gold"}, {"CL=F", "WTI Crude"}, {"BZ=F", "Brent Crude"}, {"SI=F", "Silver"}, {"NG=F", "Natural Gas"}},
}

// quotesSnapshot fetches Yahoo chart quotes for a category's symbol set (or a
// single ticker), computing price + intraday % change from the last two closes.
// Cached briefly per (category|ticker). Reuses the shared s.yahooChart fetcher.
func (s *Server) quotesSnapshot(ctx context.Context, category, ticker string) []map[string]any {
	set := quoteSets[category]
	if set == nil {
		set = quoteSets["equities"]
	}
	key := "aiplane:quotes:" + category
	if ticker != "" {
		set = []symInfo{{upper(ticker), upper(ticker)}}
		key = "aiplane:quote:" + upper(ticker)
	}
	if v, hit := s.cache.Get(key); hit {
		if out, ok := v.([]map[string]any); ok {
			return out
		}
	}
	out := make([]map[string]any, len(set))
	var wg sync.WaitGroup
	for i, si := range set {
		wg.Add(1)
		go func(i int, si symInfo) {
			defer wg.Done()
			out[i] = s.oneQuote(ctx, si, category)
		}(i, si)
	}
	wg.Wait()
	final := make([]map[string]any, 0, len(out))
	for _, q := range out {
		if q != nil {
			final = append(final, q)
		}
	}
	if len(final) > 0 {
		s.cache.Set(key, final, 2*time.Minute, 10*time.Minute)
	}
	return final
}

func (s *Server) oneQuote(ctx context.Context, si symInfo, category string) map[string]any {
	yc, err := s.yahooChart(ctx, si.sym, "range=5d&interval=1d")
	if err != nil {
		return nil
	}
	closes := yc.closes()
	if len(closes) < 2 {
		return nil
	}
	last, prev := closes[len(closes)-1], closes[len(closes)-2]
	change := 0.0
	if prev != 0 {
		change = (last - prev) / prev * 100
	}
	cur := "USD"
	if len(yc.Chart.Result) > 0 && yc.Chart.Result[0].Meta.Currency != "" {
		cur = yc.Chart.Result[0].Meta.Currency
	}
	cat := category
	if cat == "" {
		cat = "equities"
	}
	return map[string]any{
		"symbol": si.sym, "name": si.name, "price": round2s(last),
		"changePercent": round2s(change), "currency": cur, "category": cat, "source": "yahoo",
	}
}

var cryptoDefault = []struct{ id, sym, name string }{
	{"bitcoin", "BTC", "Bitcoin"}, {"ethereum", "ETH", "Ethereum"}, {"solana", "SOL", "Solana"},
	{"binancecoin", "BNB", "BNB"}, {"ripple", "XRP", "XRP"}, {"cardano", "ADA", "Cardano"},
	{"dogecoin", "DOGE", "Dogecoin"}, {"tron", "TRX", "TRON"}, {"chainlink", "LINK", "Chainlink"},
	{"avalanche-2", "AVAX", "Avalanche"},
}

// cryptoSnapshot fetches CoinGecko simple-price for the default coin set (or a
// single ticker/id), returning {symbol,id,name,price,change24h} rows. Cached
// briefly. Mirrors sourceMarkets' CoinGecko fetch — no second crypto fetcher.
func (s *Server) cryptoSnapshot(ctx context.Context, ticker string) []map[string]any {
	coins := cryptoDefault
	key := "aiplane:crypto"
	if ticker != "" {
		coins = []struct{ id, sym, name string }{resolveCoin(ticker)}
		key = "aiplane:crypto:" + coins[0].id
	}
	if v, hit := s.cache.Get(key); hit {
		if out, ok := v.([]map[string]any); ok {
			return out
		}
	}
	ids := make([]string, len(coins))
	for i, c := range coins {
		ids[i] = c.id
	}
	u := "https://api.coingecko.com/api/v3/simple/price?ids=" + urlQueryEscape(joinComma(ids)) +
		"&vs_currencies=usd&include_24hr_change=true"
	var raw map[string]struct {
		USD    float64 `json:"usd"`
		Change float64 `json:"usd_24h_change"`
	}
	if err := s.getJSON(ctx, u, map[string]string{"Accept": "application/json"}, &raw); err != nil {
		if v, hit := s.cache.GetStale(key); hit {
			if out, ok := v.([]map[string]any); ok {
				return out
			}
		}
		return nil
	}
	out := make([]map[string]any, 0, len(coins))
	for _, c := range coins {
		d, ok := raw[c.id]
		if !ok {
			continue
		}
		out = append(out, map[string]any{
			"symbol": c.sym, "id": c.id, "name": c.name,
			"price": round2s(d.USD), "change24h": round2s(d.Change), "category": "crypto", "source": "coingecko",
		})
	}
	if len(out) > 0 {
		s.cache.Set(key, out, 2*time.Minute, 10*time.Minute)
	}
	return out
}

// resolveCoin maps a ticker/id to a CoinGecko id + display symbol, using the
// default roster when it recognises the input, else treating it as a raw id.
func resolveCoin(ticker string) struct{ id, sym, name string } {
	t := strings.ToLower(strings.TrimSpace(ticker))
	for _, c := range cryptoDefault {
		if c.id == t || strings.ToLower(c.sym) == t {
			return c
		}
	}
	return struct{ id, sym, name string }{id: t, sym: strings.ToUpper(t), name: ticker}
}

// ── /v1/world/feeds ──────────────────────────────────────────────────────────

// topicSource documents which real server-side source backs each ZAP topic (""
// = not provisioned server-side, i.e. the aggregator emits nothing for it).
var topicSource = map[string]string{
	topicAll:         "aggregate of every server-side event topic",
	topicConflicts:   "UCDP GED (/v1/world/ucdp-events)",
	topicEarthquakes: "USGS 4.5+/day (/v1/world/earthquakes)",
	topicFires:       "NASA FIRMS (/v1/world/firms-fires; emitted when the fires layer is active)",
	topicQuotes:      "Yahoo Finance indices",
	topicCrypto:      "CoinGecko",
	topicAIS:         "", // AIS relay is client-side / not provisioned server-side
	topicOpenSky:     "", // OpenSky live states are not aggregated onto the event plane
	topicNews:        "curated RSS feeds (/v1/world/feeds-batch)",
	topicWeather:     "Open-Meteo climate anomalies (/v1/world/climate-anomalies; emitted when the climate layer is active)",
}

// handleFeeds returns the feed/topic catalog: the canonical ZAP topics (with the
// real source backing each, and whether it is emitted server-side) plus the
// backend's curated news feed categories.
func (s *Server) handleFeeds(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") || methodNotGet(w, r) {
		return
	}
	topics := make([]map[string]any, 0, len(zapTopics))
	for _, t := range zapTopics {
		src := topicSource[t]
		topics = append(topics, map[string]any{"topic": t, "emitted": src != "", "source": src})
	}
	writeJSON(w, http.StatusOK, "public, max-age=300, s-maxage=300, stale-while-revalidate=60", map[string]any{
		"topics":         topics,
		"feedCategories": mcp.FeedCategoryNames(),
		"layers":         []string{"conflicts", "earthquakes", "fires", "weather", "news", "quotes", "crypto"},
		"asOf":           nowISO(),
	})
}
