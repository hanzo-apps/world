package world

import (
	"bufio"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// aiPulseUpstream is a fake api.hanzo.ai serving the four reads ai-pulse folds.
func aiPulseUpstream(t *testing.T) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("/v1/machines", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"machines":[{"region":"nyc","status":"active"},{"region":"sfo","status":"active"},{"region":"nyc","status":"stopped"}]}`))
	})
	mux.HandleFunc("/v1/gpus", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"gpus":[{"region":"nyc"},{"region":"sfo"},{"region":"nyc"}]}`))
	})
	mux.HandleFunc("/v1/models", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"data":[{"id":"zen-1"},{"id":"zen-omni-30b"}]}`))
	})
	mux.HandleFunc("/v1/get-cloud-usages", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{
			"range":"24h","interval":"1h",
			"totals":{"tokens":1180000000,"requests":1000000,"spendCents":42000,"models":2},
			"series":[{"t":"2026-07-16T00:00:00Z","tokens":40000000,"requests":34000},
			          {"t":"2026-07-16T01:00:00Z","tokens":72000000,"requests":36000}],
			"byModel":{"items":[{"model":"zen-omni-30b","spendCents":24000,"tokens":600000000,"requests":520000,"pct":57.1}]}
		}`))
	})
	up := httptest.NewServer(mux)
	t.Cleanup(up.Close)
	return up
}

func aiPulseServer(t *testing.T) *httptest.Server {
	t.Helper()
	s := NewServer()
	mux := http.NewServeMux()
	s.Mount(mux)
	ts := httptest.NewServer(mux)
	t.Cleanup(ts.Close)
	return ts
}

// TestAIPulseUnavailableWithoutToken: the honest degrade — no token, so the JSON
// snapshot is state:"unavailable" with a reason, never a zeroed "live".
func TestAIPulseUnavailableWithoutToken(t *testing.T) {
	t.Setenv("HANZO_CLOUD_PULSE_TOKEN", "")
	ts := aiPulseServer(t)

	resp, err := http.Get(ts.URL + "/v1/world/ai-pulse")
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	defer resp.Body.Close()
	var p aiPulse
	if err := json.NewDecoder(resp.Body).Decode(&p); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if p.State != "unavailable" || p.Reason == "" {
		t.Fatalf("want unavailable+reason, got state=%q reason=%q", p.State, p.Reason)
	}
	if p.Usage != nil || p.Fleet != nil {
		t.Fatalf("unavailable must carry no fabricated usage/fleet")
	}
}

// TestAIPulseLiveSnapshot: with a token + reachable upstream, the poll-fallback
// JSON snapshot carries measured usage and the live fleet.
func TestAIPulseLiveSnapshot(t *testing.T) {
	up := aiPulseUpstream(t)
	t.Setenv("HANZO_CLOUD_PULSE_TOKEN", "svc-super-admin")
	t.Setenv("HANZO_API_BASE", up.URL)
	ts := aiPulseServer(t)

	resp, err := http.Get(ts.URL + "/v1/world/ai-pulse")
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	defer resp.Body.Close()
	var p aiPulse
	if err := json.NewDecoder(resp.Body).Decode(&p); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if p.State != "live" {
		t.Fatalf("want state=live, got %q (reason %q)", p.State, p.Reason)
	}
	if p.Usage == nil || p.Usage.Requests24h != 1_000_000 || p.Usage.SpendCents != 42000 {
		t.Fatalf("want measured usage, got %+v", p.Usage)
	}
	if len(p.Usage.Models) != 1 || p.Usage.Models[0].ID != "zen-omni-30b" {
		t.Fatalf("want ledger top model, got %+v", p.Usage.Models)
	}
	// Recent bucket over 1h interval: 36000 req / 3600s = 10 req/s.
	if p.Usage.RequestsPerSec != 10 {
		t.Fatalf("want recent-bucket rate 10 req/s, got %v", p.Usage.RequestsPerSec)
	}
	if p.Fleet == nil || p.Fleet.MachinesOnline != 2 || p.Fleet.Machines != 3 || p.Fleet.Gpus != 3 {
		t.Fatalf("want live fleet 2/3 + 3 gpus, got %+v", p.Fleet)
	}
	if p.Fleet.ModelsServed != 2 {
		t.Fatalf("want modelsServed=2, got %d", p.Fleet.ModelsServed)
	}
}

// TestAIPulseSSEFrames: an EventSource-style request gets the typed usage/fleet/
// status frames in the first (immediate) emit.
func TestAIPulseSSEFrames(t *testing.T) {
	up := aiPulseUpstream(t)
	t.Setenv("HANZO_CLOUD_PULSE_TOKEN", "svc-super-admin")
	t.Setenv("HANZO_API_BASE", up.URL)
	ts := aiPulseServer(t)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, ts.URL+"/v1/world/ai-pulse", nil)
	req.Header.Set("Accept", "text/event-stream")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("sse request failed: %v", err)
	}
	defer resp.Body.Close()
	if ct := resp.Header.Get("Content-Type"); !strings.Contains(ct, "text/event-stream") {
		t.Fatalf("want event-stream, got %q", ct)
	}

	seen := map[string]bool{}
	sc := bufio.NewScanner(resp.Body)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		var ev struct {
			Type  string `json:"type"`
			State string `json:"state"`
		}
		if json.Unmarshal([]byte(strings.TrimPrefix(line, "data:")), &ev) != nil {
			continue
		}
		seen[ev.Type] = true
		if ev.Type == "status" { // terminal frame of the first emit
			if ev.State != "live" {
				t.Fatalf("want status state=live, got %q", ev.State)
			}
			break
		}
	}
	for _, want := range []string{"usage", "fleet", "status"} {
		if !seen[want] {
			t.Fatalf("missing %q frame (saw %v)", want, seen)
		}
	}
}
