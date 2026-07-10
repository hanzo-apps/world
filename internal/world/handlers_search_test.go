package world

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// serve drives one handler with an in-memory request/response and returns the
// decoded JSON body plus status.
func serve(t *testing.T, h http.HandlerFunc, method, target, bearer, body string) (map[string]any, int) {
	t.Helper()
	var r *http.Request
	if body != "" {
		r = httptest.NewRequest(method, target, strings.NewReader(body))
	} else {
		r = httptest.NewRequest(method, target, nil)
	}
	if bearer != "" {
		r.Header.Set("Authorization", "Bearer "+bearer)
	}
	rec := httptest.NewRecorder()
	h(rec, r)
	res := rec.Result()
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	var m map[string]any
	if len(raw) > 0 {
		_ = json.Unmarshal(raw, &m)
	}
	return m, res.StatusCode
}

func TestSearchEndpointEmptyNever5xx(t *testing.T) {
	s := newTestServer(t)
	m, code := serve(t, s.handleSearch, http.MethodGet, "/v1/world/search", "", "")
	if code != http.StatusOK {
		t.Fatalf("status = %d, want 200", code)
	}
	if m["count"].(float64) != 0 {
		t.Fatalf("empty lake count = %v, want 0", m["count"])
	}
	if _, ok := m["results"].([]any); !ok {
		t.Fatalf("results not an array: %v", m["results"])
	}
}

func TestSearchAndAnalyticsReturnIngested(t *testing.T) {
	s := newTestServer(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go s.store.Lake.Run(ctx) // write-behind consumer

	// Ingest via the same path the feed handlers use.
	s.ingestFeedItems("https://cointelegraph.com/rss", []byte(stubRSS))

	// Poll until the write-behind flush lands (≤1s tick).
	var m map[string]any
	deadline := time.Now().Add(4 * time.Second)
	for time.Now().Before(deadline) {
		var code int
		m, code = serve(t, s.handleSearch, http.MethodGet, "/v1/world/search?q=bitcoin", "", "")
		if code != http.StatusOK {
			t.Fatalf("search status = %d", code)
		}
		if m["count"].(float64) >= 1 {
			break
		}
		time.Sleep(40 * time.Millisecond)
	}
	if m["count"].(float64) < 1 {
		t.Fatalf("ingested news not searchable: %v", m)
	}
	first := m["results"].([]any)[0].(map[string]any)
	if !strings.Contains(strings.ToLower(first["title"].(string)), "bitcoin") {
		t.Fatalf("top result title = %v, want a Bitcoin item", first["title"])
	}
	if first["kind"] != "news" {
		t.Fatalf("kind = %v, want news", first["kind"])
	}

	// Analytics reflects the same ingest.
	a, code := serve(t, s.handleAnalytics, http.MethodGet, "/v1/world/analytics", "", "")
	if code != http.StatusOK {
		t.Fatalf("analytics status = %d", code)
	}
	if a["total"].(float64) < 1 {
		t.Fatalf("analytics total = %v, want ≥1", a["total"])
	}
}
