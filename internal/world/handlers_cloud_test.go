package world

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// TestCloudPulseDemoFlag verifies the honesty contract: with no service token
// configured (the default, and what the smoke suite exercises), /v1/world/cloud-pulse
// returns a clean 200 JSON payload that is EXPLICITLY flagged demo:true and
// carries a non-empty note. Platform numbers are never presented as live without
// the flag.
func TestCloudPulseDemoFlag(t *testing.T) {
	t.Setenv("HANZO_CLOUD_PULSE_TOKEN", "") // force the demo path
	s := NewServer()
	mux := http.NewServeMux()
	s.Mount(mux)
	ts := httptest.NewServer(mux)
	t.Cleanup(ts.Close)

	resp, err := http.Get(ts.URL + "/v1/world/cloud-pulse")
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("want 200, got %d", resp.StatusCode)
	}

	var p cloudPulse
	if err := json.NewDecoder(resp.Body).Decode(&p); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !p.Demo {
		t.Fatalf("demo path must set demo:true (honesty flag)")
	}
	if p.Source != "demo" {
		t.Fatalf("want source=demo, got %q", p.Source)
	}
	if p.Note == "" {
		t.Fatalf("demo payload must carry a human note")
	}
	if p.Overview.ModelsServed == 0 || len(p.Models) == 0 {
		t.Fatalf("demo payload should be populated (modelsServed=%d models=%d)", p.Overview.ModelsServed, len(p.Models))
	}
	if len(p.Regions) == 0 || p.Overview.Regions != len(p.Regions) {
		t.Fatalf("regions count mismatch: overview=%d array=%d", p.Overview.Regions, len(p.Regions))
	}
	if len(p.RequestSeries) != 24 || len(p.TokenSeries) != 24 {
		t.Fatalf("want 24-bucket series, got req=%d tok=%d", len(p.RequestSeries), len(p.TokenSeries))
	}
}
