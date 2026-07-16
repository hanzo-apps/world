package world

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// TestEnsoTrainingEvalsOnly: with no service token the ledger is unreachable, but
// the embedded enso-bench eval scores are always served — state "demo", real
// eval rows, ledger.available:false. The panel is useful signed-out.
func TestEnsoTrainingEvalsOnly(t *testing.T) {
	t.Setenv("HANZO_CLOUD_PULSE_TOKEN", "")
	t.Setenv("ENSO_BENCH_URL", "")
	ts := aiPulseServer(t)

	resp, err := http.Get(ts.URL + "/v1/world/enso-training")
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	defer resp.Body.Close()
	var et ensoTraining
	if err := json.NewDecoder(resp.Body).Decode(&et); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if et.State != "demo" {
		t.Fatalf("want state=demo without token, got %q", et.State)
	}
	if et.Ledger.Available {
		t.Fatalf("ledger must be unavailable without a token")
	}
	if et.Evals.Bench != "gpqa_diamond" || len(et.Evals.Systems) == 0 {
		t.Fatalf("embedded evals must load, got bench=%q systems=%d", et.Evals.Bench, len(et.Evals.Systems))
	}
	if et.Evals.Source != "embedded" {
		t.Fatalf("want embedded eval source, got %q", et.Evals.Source)
	}
	// Systems are ranked by accuracy desc.
	for i := 1; i < len(et.Evals.Systems); i++ {
		if et.Evals.Systems[i-1].AccuracyPct < et.Evals.Systems[i].AccuracyPct {
			t.Fatalf("evals not sorted by accuracy desc: %+v", et.Evals.Systems)
		}
	}
	if !hasEventType(et.Events, "eval") {
		t.Fatalf("timeline must carry an eval event, got %+v", et.Events)
	}
}

// TestEnsoTrainingLiveFold: with a token + reachable exports, the ledger + reward
// JSONL fold into the mix, confidence histogram, and reward stats.
func TestEnsoTrainingLiveFold(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/v1/export-routing-ledger", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("since") == "" {
			t.Errorf("ledger export must carry a since cursor")
		}
		w.Header().Set("Content-Type", "application/x-ndjson")
		_, _ = w.Write([]byte(
			`{"task":"code","routed_model":"zen-coder","confidence":0.92,"source":"engine"}` + "\n" +
				`{"task":"chat","routed_model":"zen-omni","confidence":0.55,"source":"heuristic"}` + "\n" +
				`{"task":"code","routed_model":"zen-coder","confidence":0.88,"source":"engine"}` + "\n" +
				`{"task":"math","routed_model":"zen-1","confidence":0.15,"source":"heuristic"}` + "\n"))
	})
	mux.HandleFunc("/v1/export-routing-rewards", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/x-ndjson")
		_, _ = w.Write([]byte(
			`{"model":"zen-coder","task":"code","reward":0.8,"at":"2026-07-16T00:00:00Z"}` + "\n" +
				`{"model":"zen-1","task":"math","reward":0.6,"at":"2026-07-16T01:00:00Z"}` + "\n"))
	})
	up := httptest.NewServer(mux)
	t.Cleanup(up.Close)

	t.Setenv("HANZO_CLOUD_PULSE_TOKEN", "svc-super-admin")
	t.Setenv("HANZO_API_BASE", up.URL)
	t.Setenv("ENSO_BENCH_URL", "")
	ts := aiPulseServer(t)

	resp, err := http.Get(ts.URL + "/v1/world/enso-training")
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	defer resp.Body.Close()
	var et ensoTraining
	if err := json.NewDecoder(resp.Body).Decode(&et); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if et.State != "live" {
		t.Fatalf("want state=live, got %q", et.State)
	}
	l := et.Ledger
	if !l.Available || l.Total != 4 || l.Engine != 2 || l.Heuristic != 2 || l.EnginePct != 50 {
		t.Fatalf("bad ledger mix: %+v", l)
	}
	if l.AvgConfidence != 0.63 {
		t.Fatalf("want avgConfidence 0.63, got %v", l.AvgConfidence)
	}
	if bucketCount(l.Confidence, "80–100%") != 2 || bucketCount(l.Confidence, "0–20%") != 1 {
		t.Fatalf("bad confidence histogram: %+v", l.Confidence)
	}
	if countByName(l.Tasks, "code") != 2 || countByName(l.Models, "zen-coder") != 2 {
		t.Fatalf("bad task/model distribution: tasks=%+v models=%+v", l.Tasks, l.Models)
	}
	if l.Rewarded != 2 || l.AvgReward != 0.7 {
		t.Fatalf("want rewarded=2 avgReward=0.7, got %d / %v", l.Rewarded, l.AvgReward)
	}
	if !hasEventType(et.Events, "ledger") || !hasEventType(et.Events, "reward") {
		t.Fatalf("timeline must carry ledger + reward events, got %+v", et.Events)
	}
}

func hasEventType(events []ensoEvent, typ string) bool {
	for _, e := range events {
		if e.Type == typ {
			return true
		}
	}
	return false
}

func bucketCount(buckets []ensoBucket, label string) int {
	for _, b := range buckets {
		if b.Label == label {
			return b.Count
		}
	}
	return -1
}

func countByName(counts []ensoCount, name string) int {
	for _, c := range counts {
		if c.Name == name {
			return c.Count
		}
	}
	return -1
}
