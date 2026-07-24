package world

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

// The AI-plane event aggregator maps the backend's EXISTING sources onto the
// canonical ZAP topic records the world-gw gateway ingests. These tests drive it
// entirely offline by seeding the shared cache with each source's value under the
// exact key its sibling handler uses — the same "seed the cache, no network"
// technique the dashboard tests use for identity.

// gwServer builds an offline server (no hanzo-kv, temp data dir).
func gwServer(t *testing.T) *Server {
	t.Helper()
	t.Setenv("WORLD_KV_DISABLE", "1")
	t.Setenv("WORLD_DATA_DIR", t.TempDir())
	s := NewServer()
	t.Cleanup(s.Close)
	return s
}

func seedCache(s *Server, key string, val any) { s.cache.Set(key, val, time.Hour, time.Hour) }

// seedSources primes every cheap source the aggregator reads, so a full-fan-out
// snapshot resolves with zero network calls.
func seedSources(s *Server) {
	seedCache(s, "ucdp:gedevents:v2", map[string]any{"data": []map[string]any{
		{"id": "e1", "date_start": "2026-07-20", "country": "Ukraine", "side_a": "Government of Ukraine",
			"side_b": "Russia", "deaths_best": 30, "latitude": 49.0, "longitude": 32.0, "type_of_violence": "state-based"},
		{"id": "e2", "date_start": "2026-07-19", "country": "Sudan", "side_a": "RSF",
			"side_b": "SAF", "deaths_best": 3, "latitude": 15.5, "longitude": 32.5, "type_of_violence": "state-based"},
	}})
	seedCache(s, "earthquakes:4.5_day", []byte(`{"features":[{"id":"q1","properties":{"mag":5.5,"place":"Off the coast of Japan","time":1750000000000,"url":"https://earthquake.usgs.gov/q1"},"geometry":{"coordinates":[140.1,37.2,10.0]}}]}`))
	seedCache(s, "aiplane:crypto", []map[string]any{
		{"symbol": "BTC", "id": "bitcoin", "name": "Bitcoin", "price": 65000.0, "change24h": 1.5, "category": "crypto", "source": "coingecko"},
	})
	seedCache(s, "aiplane:quotes:equities", []map[string]any{
		{"symbol": "^GSPC", "name": "S&P 500", "price": 5000.0, "changePercent": 0.5, "currency": "USD", "category": "equities", "source": "yahoo"},
	})
	seedCache(s, "aiplane:news:world", []feedBatchItem{{Title: "World headline", Link: "https://example.com/n1", PubDate: "2026-07-21T09:00:00Z"}})
}

func getJSONBody(t *testing.T, h http.HandlerFunc, target string) (int, map[string]any) {
	t.Helper()
	r := httptest.NewRequest(http.MethodGet, target, nil)
	w := httptest.NewRecorder()
	h(w, r)
	var body map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode %s: %v (body=%s)", target, err, w.Body.String())
	}
	return w.Code, body
}

var zapTopicSet = func() map[string]bool {
	m := map[string]bool{}
	for _, t := range zapTopics {
		m[t] = true
	}
	return m
}()

// assertValidRecord checks a poll/stream record is a well-formed topic record.
func assertValidRecord(t *testing.T, rec map[string]any) {
	t.Helper()
	topic, _ := rec["topic"].(string)
	if !zapTopicSet[topic] {
		t.Fatalf("record topic %q not in the canonical ZAP catalog", topic)
	}
	payload, ok := rec["payload"].(map[string]any)
	if !ok {
		t.Fatalf("record payload is not an object: %v", rec["payload"])
	}
	for _, k := range []string{"id", "ts", "topic"} {
		if _, ok := payload[k]; !ok {
			t.Fatalf("record payload missing %q: %v", k, payload)
		}
	}
}

func TestEventsPollReturnsTopicRecords(t *testing.T) {
	s := gwServer(t)
	seedSources(s)

	code, body := getJSONBody(t, s.handleEvents, "/v1/world/events")
	if code != 200 {
		t.Fatalf("status = %d", code)
	}
	events, ok := body["events"].([]any)
	if !ok || len(events) == 0 {
		t.Fatalf("events = %v, want non-empty array", body["events"])
	}
	seen := map[string]bool{}
	for _, e := range events {
		rec := e.(map[string]any)
		assertValidRecord(t, rec)
		seen[rec["topic"].(string)] = true
	}
	// Every seeded cheap source must be represented.
	for _, want := range []string{topicConflicts, topicEarthquakes, topicCrypto, topicQuotes, topicNews} {
		if !seen[want] {
			t.Errorf("poll snapshot missing topic %q (got %v)", want, seen)
		}
	}
	// No fabricated topics for un-seeded layers.
	if seen[topicFires] || seen[topicWeather] {
		t.Errorf("emitted a topic with no source: %v", seen)
	}
}

func TestEventsLayersSinceLimitFilters(t *testing.T) {
	s := gwServer(t)
	seedSources(s)

	// layers filter: only conflicts.
	_, body := getJSONBody(t, s.handleEvents, "/v1/world/events?layers=conflicts")
	for _, e := range body["events"].([]any) {
		if tp := e.(map[string]any)["topic"].(string); tp != topicConflicts {
			t.Fatalf("layers=conflicts leaked topic %q", tp)
		}
	}

	// limit cap.
	_, body = getJSONBody(t, s.handleEvents, "/v1/world/events?limit=1")
	if got := len(body["events"].([]any)); got != 1 {
		t.Fatalf("limit=1 returned %d events", got)
	}

	// since filter: nothing is newer than the far future.
	_, body = getJSONBody(t, s.handleEvents, "/v1/world/events?since=2099-01-01T00:00:00Z&layers=conflicts")
	if got := len(body["events"].([]any)); got != 0 {
		t.Fatalf("since=2099 returned %d events, want 0", got)
	}

	// An all-unknown layers filter selects nothing (never falls through to all,
	// so it also never triggers a network fetch).
	code, body := getJSONBody(t, s.handleEvents, "/v1/world/events?layers=nonsense&junk=1")
	if code != 200 || len(body["events"].([]any)) != 0 {
		t.Fatalf("layers=nonsense: code=%d events=%v", code, body["events"])
	}
}

// streamRec is a race-safe streaming ResponseWriter/Flusher that signals once the
// first NDJSON line lands, so the test can cancel and join deterministically.
type streamRec struct {
	mu      sync.Mutex
	buf     bytes.Buffer
	hdr     http.Header
	code    int
	gotLine chan struct{}
	once    sync.Once
}

func newStreamRec() *streamRec { return &streamRec{hdr: http.Header{}, gotLine: make(chan struct{})} }
func (r *streamRec) Header() http.Header { return r.hdr }
func (r *streamRec) WriteHeader(c int)   { r.code = c }
func (r *streamRec) Flush()              {}
func (r *streamRec) Write(b []byte) (int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	n, _ := r.buf.Write(b)
	if bytes.Contains(b, []byte("\n")) && r.buf.Len() > 1 {
		r.once.Do(func() { close(r.gotLine) })
	}
	return n, nil
}
func (r *streamRec) body() string { r.mu.Lock(); defer r.mu.Unlock(); return r.buf.String() }

func TestEventsStreamNDJSONAllMirrorAndCancel(t *testing.T) {
	s := gwServer(t)
	seedSources(s)

	req := httptest.NewRequest(http.MethodGet, "/v1/world/events?stream=1&layers=conflicts,earthquakes,crypto,quotes", nil)
	ctx, cancel := context.WithCancel(req.Context())
	req = req.WithContext(ctx)
	w := newStreamRec()

	done := make(chan struct{})
	go func() { s.handleEvents(w, req); close(done) }()

	select {
	case <-w.gotLine:
	case <-time.After(5 * time.Second):
		cancel()
		t.Fatal("stream produced no line within 5s")
	}
	cancel()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("stream did not return after ctx cancel")
	}

	if ct := w.hdr.Get("Content-Type"); !strings.Contains(ct, "ndjson") {
		t.Fatalf("stream Content-Type = %q", ct)
	}
	specific, all := 0, 0
	for _, line := range strings.Split(w.body(), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		var rec map[string]any
		if err := json.Unmarshal([]byte(line), &rec); err != nil {
			t.Fatalf("stream line not valid JSON: %q (%v)", line, err)
		}
		assertValidRecord(t, rec)
		if rec["topic"].(string) == topicAll {
			all++
		} else {
			specific++
		}
	}
	if specific == 0 {
		t.Fatal("stream emitted no specific records")
	}
	// Every specific record is ALSO emitted on world.events.all.
	if all != specific {
		t.Fatalf("all-mirror count = %d, want %d (one per specific record)", all, specific)
	}
}
