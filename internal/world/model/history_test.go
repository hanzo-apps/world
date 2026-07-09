package model

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// TestHistoryPersistAndSeries proves the durable layer end-to-end: folds produce
// Points, the ring windows + persists them, a fresh History warm-loads the same
// series from disk, and the analyst digest summarizes the window within 2KB.
func TestHistoryPersistAndSeries(t *testing.T) {
	dir := t.TempDir()
	vol := 10.0
	src := Source{Name: "stub", Poll: func() ([]Observation, error) {
		return []Observation{{
			ID: "IR", Kind: KindCountry, Name: "Iran",
			Metrics: map[string]float64{MetricBaseline: 40, MetricNewsVolume: vol, MetricSentiment: -4},
		}}, nil
	}}
	e := New([]Source{src}, dir, time.Hour)

	// Two folds: cold populate, then a news surge — persist each (snapshot + point).
	e.IngestOnce(context.Background())
	e.persist()
	vol = 90
	e.IngestOnce(context.Background())
	e.persist()

	series := e.history.Series(24)
	if len(series) < 2 {
		t.Fatalf("history series = %d points, want >=2", len(series))
	}
	if last := series[len(series)-1]; last.Composite <= 0 {
		t.Fatalf("composite not computed: %+v", last)
	}
	foundMover := false
	for _, p := range series {
		for _, m := range p.TopMovers {
			if m.ID == "IR" && m.NewsVelocity > 0 {
				foundMover = true
			}
		}
	}
	if !foundMover {
		t.Fatalf("expected an IR news mover in the window, series=%+v", series)
	}

	// Persistence round-trip: a fresh ring over the same dir warm-loads it.
	h2 := NewHistory(dir, HistoryCap)
	h2.Load()
	if got := len(h2.Series(24)); got != len(series) {
		t.Fatalf("reloaded series = %d, want %d", got, len(series))
	}

	// The analyst window digest names the trend and stays under 2KB.
	dg := e.HistoryDigest(24)
	if !strings.Contains(dg, "Global instability index") {
		t.Fatalf("digest missing composite trend: %q", dg)
	}
	if len(dg) > 2000 {
		t.Fatalf("digest exceeds 2KB: %d bytes", len(dg))
	}

	// Out-of-window queries return an empty (non-nil) series.
	if s := e.history.Series(0); s == nil {
		t.Fatal("Series(0) must return a non-nil empty slice")
	}
}

// TestHistoryHTTP drives GET /v1/world/model/history: an empty ring answers 200
// with an empty series (never 5xx), and after a fold+persist it carries a point.
func TestHistoryHTTP(t *testing.T) {
	dir := t.TempDir()
	src := Source{Name: "stub", Poll: func() ([]Observation, error) {
		return []Observation{{ID: "US", Kind: KindCountry, Name: "United States",
			Metrics: map[string]float64{MetricBaseline: 10, MetricNewsVolume: 20, MetricSentiment: -2}}}, nil
	}}
	e := New([]Source{src}, dir, time.Hour)
	mux := http.NewServeMux()
	e.Mount(mux)
	ts := httptest.NewServer(mux)
	defer ts.Close()

	r0, err := http.Get(ts.URL + "/v1/world/model/history")
	if err != nil {
		t.Fatalf("history GET: %v", err)
	}
	if r0.StatusCode != http.StatusOK {
		t.Fatalf("empty history status = %d, want 200", r0.StatusCode)
	}
	_ = r0.Body.Close()

	e.IngestOnce(context.Background())
	e.persist()

	r1, err := http.Get(ts.URL + "/v1/world/model/history?hours=24")
	if err != nil {
		t.Fatalf("history GET: %v", err)
	}
	defer r1.Body.Close()
	var body struct {
		Hours  int     `json:"hours"`
		Count  int     `json:"count"`
		Series []Point `json:"series"`
	}
	if err := json.NewDecoder(r1.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.Hours != 24 || body.Count < 1 || len(body.Series) < 1 {
		t.Fatalf("history series empty after persist: %+v", body)
	}
}
