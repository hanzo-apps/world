package world

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"regexp"
	"testing"
)

var dottedQuad = regexp.MustCompile(`\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b`)

// serveWorld mounts a fresh world Server and returns its test URL.
func serveWorld(t *testing.T) string {
	t.Helper()
	s := NewServer()
	mux := http.NewServeMux()
	s.Mount(mux)
	ts := httptest.NewServer(mux)
	t.Cleanup(ts.Close)
	return ts.URL
}

// TestCloudTrafficGlobe_PassthroughLive: when the ai backend's /v1/traffic/globe is
// reachable, the world proxy unwraps the {status,data} envelope and passes the real
// points + totals through with live:true.
func TestCloudTrafficGlobe_PassthroughLive(t *testing.T) {
	ai := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/traffic/globe" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"ok","data":{
			"window":{"minutes":60,"since":"2026-07-16T00:00:00Z","until":"2026-07-16T01:00:00Z"},
			"points":[{"country":"US","region":"CA","lat":36.12,"lon":-119.68,"count":5,"byService":{"chat":5}},
			          {"country":"GB","lat":55.38,"lon":-3.44,"count":2,"byService":{"models":2}}],
			"totals":{"rps_1m":0.08,"rpm_60m":0.12,"top_countries":[{"country":"US","count":5},{"country":"GB","count":2}]}}}`))
	}))
	t.Cleanup(ai.Close)
	t.Setenv("HANZO_API_BASE", ai.URL)

	resp, err := http.Get(serveWorld(t) + "/v1/world/cloud/traffic-globe")
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("want 200, got %d", resp.StatusCode)
	}
	var g trafficGlobe
	if err := json.NewDecoder(resp.Body).Decode(&g); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !g.Live {
		t.Error("live must be true when the native endpoint answered")
	}
	if len(g.Points) != 2 {
		t.Fatalf("points = %d, want 2", len(g.Points))
	}
	if g.Points[0].Country != "US" || g.Points[0].Region != "CA" || g.Points[0].Count != 5 || g.Points[0].ByService["chat"] != 5 {
		t.Errorf("point[0] not passed through: %+v", g.Points[0])
	}
	if g.Totals.RPS1m != 0.08 || g.Totals.RPM60m != 0.12 {
		t.Errorf("totals not passed through: %+v", g.Totals)
	}
	if len(g.Totals.TopCountries) != 2 || g.Totals.TopCountries[0].Country != "US" {
		t.Errorf("top_countries not passed through: %+v", g.Totals.TopCountries)
	}
	// Privacy: the proxy must never introduce an IP.
	raw, _ := json.Marshal(g)
	if dottedQuad.Match(raw) {
		t.Fatalf("proxy output contains an IP: %s", raw)
	}
}

// TestCloudTrafficGlobe_HonestEmptyWhenUnreachable: an unreachable ai backend yields
// the honest empty globe — never demo, never a 5xx.
func TestCloudTrafficGlobe_HonestEmptyWhenUnreachable(t *testing.T) {
	bad := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {}))
	badURL := bad.URL
	bad.Close() // now refuses connections → fetch fails fast
	t.Setenv("HANZO_API_BASE", badURL)

	resp, err := http.Get(serveWorld(t) + "/v1/world/cloud/traffic-globe")
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("want 200 (never 5xx), got %d", resp.StatusCode)
	}
	var g trafficGlobe
	if err := json.NewDecoder(resp.Body).Decode(&g); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if g.Live {
		t.Error("live must be false when the native endpoint is unreachable")
	}
	if g.Points == nil || len(g.Points) != 0 {
		t.Errorf("points must be an empty (non-nil) slice, got %+v", g.Points)
	}
	if g.Totals.RPS1m != 0 || g.Totals.RPM60m != 0 || len(g.Totals.TopCountries) != 0 {
		t.Errorf("empty globe must have zero totals, got %+v", g.Totals)
	}
}
