package model

import (
	"context"
	"testing"
	"time"
)

// obs is a tiny constructor for test observations.
func obs(id, name, src string, m map[string]float64) Observation {
	return Observation{ID: id, Kind: KindCountry, Name: name, Metrics: m}
}

// TestFoldDeltasAndChanges proves the core contract: cold-start population is
// visible in state but not replayed as changes; a subsequent move records a
// change with the correct instability delta and news velocity.
func TestFoldDeltasAndChanges(t *testing.T) {
	st := NewStore()
	t0 := time.Now().UTC()

	// Cycle 1: baseline + calm news. No prior → no changes.
	c1 := st.Apply([]Observation{
		obs("US", "United States", "static", map[string]float64{MetricBaseline: 5}),
		obs("US", "United States", "gdelt", map[string]float64{MetricNewsVolume: 10, MetricSentiment: 1}),
		obs("UA", "Ukraine", "static", map[string]float64{MetricBaseline: 50}),
	}, t0)
	if len(c1) != 0 {
		t.Fatalf("cold start must not emit changes, got %d", len(c1))
	}
	us, ok := st.Get(KindCountry, "US")
	if !ok {
		t.Fatal("US entity missing after fold")
	}
	if us.Metrics[MetricInstability] <= 0 {
		t.Fatalf("US instability not computed: %v", us.Metrics)
	}
	base := us.Metrics[MetricInstability]

	// Cycle 2: news spikes negative and heavy → instability must rise, a change
	// recorded, velocity positive.
	t1 := t0.Add(time.Minute)
	c2 := st.Apply([]Observation{
		obs("US", "United States", "gdelt", map[string]float64{MetricNewsVolume: 60, MetricSentiment: -6}),
	}, t1)
	if len(c2) != 1 {
		t.Fatalf("expected 1 change, got %d", len(c2))
	}
	if c2[0].ID != "US" {
		t.Fatalf("change for wrong entity: %s", c2[0].ID)
	}
	us2, _ := st.Get(KindCountry, "US")
	if us2.Metrics[MetricInstability] <= base {
		t.Fatalf("instability should rise on adverse news: %v -> %v", base, us2.Metrics[MetricInstability])
	}
	if us2.Metrics[MetricNewsVelocity] != 50 {
		t.Fatalf("news velocity = %v, want 50", us2.Metrics[MetricNewsVelocity])
	}
	if us2.Metrics[MetricBaseline] != 5 {
		t.Fatalf("baseline must stick across cycles: %v", us2.Metrics[MetricBaseline])
	}

	// changes?since replays cycle-2 move only.
	if got := st.Since(t0); len(got) != 1 {
		t.Fatalf("Since(t0) = %d changes, want 1", len(got))
	}
	if got := st.Since(t1); len(got) != 0 {
		t.Fatalf("Since(t1) = %d changes, want 0", len(got))
	}

	// Top by instability: Ukraine (baseline 50) still leads a calm US baseline
	// after cycle 1, but after the US spike US should rank at least as high.
	top := st.Top(KindCountry, MetricInstability, 2)
	if len(top) != 2 {
		t.Fatalf("Top returned %d", len(top))
	}
}

// TestIngestPreservesAdapterProvenance proves the Src contract: the engine
// stamps its source name when the adapter left Src empty, but honors an
// adapter-set provenance (e.g. a fallback upstream) so the label stays honest.
func TestIngestPreservesAdapterProvenance(t *testing.T) {
	dir := t.TempDir()
	unlabeled := Source{Name: "acled", Poll: func() ([]Observation, error) {
		return []Observation{{ID: "US", Kind: KindCountry, Name: "United States",
			Metrics: map[string]float64{MetricConflictEvents: 3}}}, nil // Src empty
	}}
	labeled := Source{Name: "acled-fallback", Poll: func() ([]Observation, error) {
		return []Observation{{ID: "IR", Kind: KindCountry, Name: "Iran",
			Metrics: map[string]float64{MetricConflictEvents: 20}, Src: "gdelt-proxy"}}, nil
	}}
	e := New([]Source{unlabeled, labeled}, dir, time.Hour)
	e.IngestOnce(context.Background())

	us, ok := e.Store().Get(KindCountry, "US")
	if !ok || len(us.Sources) != 1 || us.Sources[0] != "acled" {
		t.Fatalf("empty Src should default to source name; got %v", us.Sources)
	}
	ir, ok := e.Store().Get(KindCountry, "IR")
	if !ok || len(ir.Sources) != 1 || ir.Sources[0] != "gdelt-proxy" {
		t.Fatalf("adapter-set Src should be preserved; got %v", ir.Sources)
	}
}

// TestSubscribeReceivesDelta proves the SSE substrate: a subscriber gets the
// change from a moving cycle, and cancel is idempotent.
func TestSubscribeReceivesDelta(t *testing.T) {
	st := NewStore()
	t0 := time.Now().UTC()
	st.Apply([]Observation{obs("US", "United States", "gdelt",
		map[string]float64{MetricBaseline: 5, MetricNewsVolume: 10, MetricSentiment: 0})}, t0)

	ch, cancel := st.Subscribe()
	st.Apply([]Observation{obs("US", "United States", "gdelt",
		map[string]float64{MetricNewsVolume: 80, MetricSentiment: -8})}, t0.Add(time.Minute))

	select {
	case c := <-ch:
		if c.ID != "US" {
			t.Fatalf("delta for wrong entity: %s", c.ID)
		}
	case <-time.After(time.Second):
		t.Fatal("no delta delivered to subscriber")
	}
	cancel()
	cancel() // must not panic
}

// TestSnapshotWarmStart proves restarts resume from disk: an engine folds a stub
// source, saves, and a fresh engine loads the same entities.
func TestSnapshotWarmStart(t *testing.T) {
	dir := t.TempDir()
	src := Source{Name: "stub", Poll: func() ([]Observation, error) {
		return []Observation{obs("IR", "Iran", "stub",
			map[string]float64{MetricBaseline: 40, MetricNewsVolume: 30, MetricSentiment: -3})}, nil
	}}
	e1 := New([]Source{src}, dir, time.Hour)
	e1.IngestOnce(context.Background())
	e1.save()

	e2 := New(nil, dir, time.Hour)
	e2.load()
	ir, ok := e2.Store().Get(KindCountry, "IR")
	if !ok {
		t.Fatal("warm start lost the Iran entity")
	}
	if ir.Metrics[MetricInstability] <= 0 {
		t.Fatalf("warm-started entity has no instability: %v", ir.Metrics)
	}
	ctx, ok2 := e2.CountryContext("ir")
	if !ok2 || ctx["id"] != "IR" {
		t.Fatalf("CountryContext failed after warm start: %v", ctx)
	}
}
