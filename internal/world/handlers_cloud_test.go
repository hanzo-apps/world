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

// TestCloudPulseServiceVolume proves the real path: with a service token and a
// reachable super-admin usage ledger, /v1/world/cloud-pulse folds MEASURED
// platform volume (get-cloud-usages ?org=all) + visor counts, drops demo:true AND
// volumeModeled:true, and surfaces the ledger's top models — never modeled.
func TestCloudPulseServiceVolume(t *testing.T) {
	upstream := http.NewServeMux()
	upstream.HandleFunc("/v1/models", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"data":[{"id":"zen-1"},{"id":"zen-omni-30b"},{"id":"qwen3-235b"}]}`))
	})
	upstream.HandleFunc("/v1/machines", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"machines":[{"region":"nyc","status":"active"},{"region":"sfo","status":"active"},{"region":"nyc","status":"stopped"}]}`))
	})
	upstream.HandleFunc("/v1/gpus", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"gpus":[{"region":"nyc"},{"region":"nyc"},{"region":"sfo"}]}`))
	})
	upstream.HandleFunc("/v1/get-cloud-usages", func(w http.ResponseWriter, r *http.Request) {
		if got := r.URL.Query().Get("org"); got != "all" {
			t.Errorf("want org=all (platform-wide), got %q", got)
		}
		_, _ = w.Write([]byte(`{
			"range":"24h","interval":"1h",
			"totals":{"tokens":1180000000,"requests":1000000,"spendCents":42000,"models":3},
			"series":[{"t":"2026-07-16T00:00:00Z","tokens":40000000,"requests":34000},
			          {"t":"2026-07-16T01:00:00Z","tokens":41000000,"requests":35000}],
			"byModel":{"items":[
				{"model":"zen-omni-30b","spendCents":24000,"tokens":600000000,"requests":520000,"pct":57.1},
				{"model":"zen-1","spendCents":12000,"tokens":300000000,"requests":300000,"pct":28.6}]}
		}`))
	})
	up := httptest.NewServer(upstream)
	t.Cleanup(up.Close)

	t.Setenv("HANZO_CLOUD_PULSE_TOKEN", "svc-super-admin")
	t.Setenv("HANZO_API_BASE", up.URL)

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
	var p cloudPulse
	if err := json.NewDecoder(resp.Body).Decode(&p); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if p.Demo {
		t.Fatalf("service path must set demo:false")
	}
	if p.VolumeModeled {
		t.Fatalf("measured usage must clear volumeModeled")
	}
	if p.Source != "service" {
		t.Fatalf("want source=service, got %q", p.Source)
	}
	if p.Overview.Requests24h != 1_000_000 || p.Overview.Tokens24h != 1_180_000_000 {
		t.Fatalf("want measured 24h volume, got req=%d tok=%d", p.Overview.Requests24h, p.Overview.Tokens24h)
	}
	if p.Overview.ModelsServed != 3 {
		t.Fatalf("want modelsServed=3 (ai catalog), got %d", p.Overview.ModelsServed)
	}
	if p.Overview.NodesTotal != 3 || p.Overview.NodesOnline != 2 {
		t.Fatalf("want nodes 2/3 online, got %d/%d", p.Overview.NodesOnline, p.Overview.NodesTotal)
	}
	if p.Overview.GpusOnline != 3 {
		t.Fatalf("want gpusOnline=3, got %d", p.Overview.GpusOnline)
	}
	if len(p.Models) != 2 || p.Models[0].ID != "zen-omni-30b" {
		t.Fatalf("want ledger top models, got %+v", p.Models)
	}
	if len(p.RequestSeries) != 2 || p.RequestSeries[1] != 35000 {
		t.Fatalf("want measured series buckets, got %v", p.RequestSeries)
	}
}
