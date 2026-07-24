package world

import (
	"net/http"
	"testing"

	"github.com/hanzoai/world/internal/world/mcp"
)

// The six single-domain AI-plane endpoints are thin reshapes over existing
// sources. Each test seeds the underlying source's cache (or, for news, the feed
// cache) so the handler resolves offline, and asserts the documented shape.

func TestConflictsEndpointFilters(t *testing.T) {
	s := gwServer(t)
	seedSources(s) // e1 Ukraine (30 deaths=critical), e2 Sudan (3 deaths=minor)

	// No filter → both events, honest source tag.
	code, body := getJSONBody(t, s.handleConflicts, "/v1/world/conflicts")
	if code != 200 {
		t.Fatalf("status = %d", code)
	}
	if body["source"] != "ucdp-ged" {
		t.Fatalf("source = %v", body["source"])
	}
	if got := len(body["conflicts"].([]any)); got != 2 {
		t.Fatalf("conflicts = %d, want 2", got)
	}

	// severity=critical keeps only the 30-death event.
	_, body = getJSONBody(t, s.handleConflicts, "/v1/world/conflicts?severity=critical")
	crit := body["conflicts"].([]any)
	if len(crit) != 1 || crit[0].(map[string]any)["country"] != "Ukraine" {
		t.Fatalf("severity=critical = %v", crit)
	}

	// country substring (case-insensitive) on the UCDP name.
	_, body = getJSONBody(t, s.handleConflicts, "/v1/world/conflicts?country=sudan")
	if got := len(body["conflicts"].([]any)); got != 1 {
		t.Fatalf("country=sudan = %d, want 1", got)
	}

	// A non-matching country yields an honest empty + note (not a 5xx / fabrication).
	_, body = getJSONBody(t, s.handleConflicts, "/v1/world/conflicts?country=ZZ")
	if len(body["conflicts"].([]any)) != 0 || body["note"] == nil {
		t.Fatalf("country=ZZ = %v (note=%v)", body["conflicts"], body["note"])
	}
}

func TestInfraEndpoint(t *testing.T) {
	s := gwServer(t)
	seedCache(s, "service-status:", map[string]any{
		"success": true, "timestamp": nowISO(),
		"summary":  map[string]int{"operational": 1, "degraded": 0, "outage": 0, "unknown": 0},
		"services": []map[string]any{{"id": "aws", "name": "AWS", "category": "cloud", "status": "operational", "description": "ok"}},
	})

	// Default → the real provider/service board.
	code, body := getJSONBody(t, s.handleInfra, "/v1/world/infra")
	if code != 200 {
		t.Fatalf("status = %d", code)
	}
	if got := len(body["infrastructure"].([]any)); got != 1 {
		t.Fatalf("infrastructure = %d, want 1", got)
	}

	// A physical-infra type has no server-side geodata → honest empty + note.
	_, body = getJSONBody(t, s.handleInfra, "/v1/world/infra?type=cable")
	if len(body["infrastructure"].([]any)) != 0 || body["note"] == nil {
		t.Fatalf("type=cable = %v (note=%v)", body["infrastructure"], body["note"])
	}

	// 'near' is unsupported → still 200, with a note.
	_, body = getJSONBody(t, s.handleInfra, "/v1/world/infra?near=48.85,2.35,50")
	if body["note"] == nil {
		t.Fatalf("near should carry a note, got %v", body)
	}
}

func TestVesselHonestEmptyWithoutRelay(t *testing.T) {
	s := gwServer(t) // WS_RELAY_URL unset → relay not configured
	code, body := getJSONBody(t, s.handleVessel, "/v1/world/vessel?mmsi=123456789")
	if code != 200 {
		t.Fatalf("status = %d", code)
	}
	if len(body["vessels"].([]any)) != 0 {
		t.Fatalf("vessels = %v, want empty", body["vessels"])
	}
	if body["note"] != "AIS tracking not provisioned server-side" {
		t.Fatalf("note = %v", body["note"])
	}
}

func TestNewsEndpoint(t *testing.T) {
	s := gwServer(t)
	rss := []byte(`<?xml version="1.0"?><rss><channel>` +
		`<item><title>Test world headline</title><link>https://example.com/a</link><pubDate>Mon, 20 Jul 2026 10:00:00 GMT</pubDate></item>` +
		`</channel></rss>`)
	for _, u := range mcp.FeedCategories()["world"] {
		s.feeds.Put(u, rss) // warm the feed cache so feedXML never hits the network
	}

	code, body := getJSONBody(t, s.handleNews, "/v1/world/news?category=world&limit=5")
	if code != 200 {
		t.Fatalf("status = %d", code)
	}
	if body["category"] != "world" {
		t.Fatalf("category = %v", body["category"])
	}
	items := body["items"].([]any)
	if len(items) == 0 {
		t.Fatalf("items empty; feed pipeline did not resolve")
	}
	if items[0].(map[string]any)["title"] != "Test world headline" {
		t.Fatalf("item title = %v", items[0])
	}

	// The gw alias finance→markets must resolve (no crash, valid category).
	_, body = getJSONBody(t, s.handleNews, "/v1/world/news?category=finance")
	if body["category"] != "markets" {
		t.Fatalf("finance should alias to markets, got %v", body["category"])
	}
}

func TestMarketsEndpoint(t *testing.T) {
	s := gwServer(t)
	seedCache(s, "aiplane:crypto", []map[string]any{
		{"symbol": "BTC", "id": "bitcoin", "name": "Bitcoin", "price": 65000.0, "change24h": 1.5, "category": "crypto", "source": "coingecko"},
	})
	seedCache(s, "aiplane:quotes:equities", []map[string]any{
		{"symbol": "^GSPC", "name": "S&P 500", "price": 5000.0, "changePercent": 0.5, "currency": "USD", "category": "equities", "source": "yahoo"},
	})

	// Default → both quotes and crypto.
	code, body := getJSONBody(t, s.handleMarkets, "/v1/world/markets")
	if code != 200 {
		t.Fatalf("status = %d", code)
	}
	if len(body["quotes"].([]any)) != 1 || len(body["crypto"].([]any)) != 1 {
		t.Fatalf("default markets = %v", body)
	}

	// category=crypto → crypto only, no quotes key.
	_, body = getJSONBody(t, s.handleMarkets, "/v1/world/markets?category=crypto")
	if _, hasQuotes := body["quotes"]; hasQuotes {
		t.Fatalf("category=crypto must not include quotes: %v", body)
	}
	if len(body["crypto"].([]any)) != 1 {
		t.Fatalf("category=crypto crypto = %v", body["crypto"])
	}
}

func TestFeedsCatalog(t *testing.T) {
	s := gwServer(t)
	code, body := getJSONBody(t, s.handleFeeds, "/v1/world/feeds")
	if code != 200 {
		t.Fatalf("status = %d", code)
	}
	topics := body["topics"].([]any)
	if len(topics) != len(zapTopics) {
		t.Fatalf("topics count = %d, want %d", len(topics), len(zapTopics))
	}
	emitted := map[string]bool{}
	for _, tp := range topics {
		m := tp.(map[string]any)
		emitted[m["topic"].(string)] = m["emitted"].(bool)
	}
	// A backed topic is emitted; a not-provisioned one is honestly flagged false.
	if !emitted[topicConflicts] {
		t.Errorf("conflicts should be emitted")
	}
	if emitted[topicAIS] || emitted[topicOpenSky] {
		t.Errorf("ais/opensky are not server-side sources; must be emitted=false")
	}
	if _, ok := body["feedCategories"].([]any); !ok {
		t.Fatalf("feedCategories missing: %v", body["feedCategories"])
	}
}

// Every AI-plane endpoint must reject a non-GET and ignore junk params gracefully.
func TestAIPlaneMethodAndJunkParams(t *testing.T) {
	s := gwServer(t)
	seedSources(s)
	seedCache(s, "service-status:", map[string]any{"services": []map[string]any{}, "summary": map[string]int{}})

	handlers := map[string]http.HandlerFunc{
		"/v1/world/conflicts": s.handleConflicts,
		"/v1/world/infra":     s.handleInfra,
		"/v1/world/vessel":    s.handleVessel,
		"/v1/world/news":      s.handleNews,
		"/v1/world/markets":   s.handleMarkets,
		"/v1/world/feeds":     s.handleFeeds,
	}
	for path, h := range handlers {
		// junk params → still a clean 200.
		if code, _ := getJSONBody(t, h, path+"?bogus=1&foo=bar&limit=abc"); code != 200 {
			t.Errorf("%s with junk params: status = %d, want 200", path, code)
		}
	}

	// The route registrar wires every AI-plane path so the mux serves them (not the
	// SPA catch-all).
	want := []string{"/v1/world/events", "/v1/world/conflicts", "/v1/world/infra",
		"/v1/world/vessel", "/v1/world/news", "/v1/world/markets", "/v1/world/feeds"}
	have := map[string]bool{}
	for _, p := range s.Routes() {
		have[p] = true
	}
	for _, p := range want {
		if !have[p] {
			t.Errorf("route %s not registered", p)
		}
	}
}
