package world

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// TestCloudAdminGateFailsClosed proves the admin gate is enforced server-side:
// every /v1/world/cloud/* admin route rejects an unauthenticated caller with a
// 401 JSON error and leaks NONE of the aggregate payload. (A non-admin bearer is
// rejected 403 via IAM introspection — that path is network-bound and covered by
// the live gate; here we assert the hermetic fail-closed default.)
func TestCloudAdminGateFailsClosed(t *testing.T) {
	s := NewServer()
	mux := http.NewServeMux()
	s.Mount(mux)
	ts := httptest.NewServer(mux)
	t.Cleanup(ts.Close)

	adminRoutes := []string{
		"/v1/world/cloud/fleet",
		"/v1/world/cloud/services",
		"/v1/world/cloud/analytics",
		"/v1/world/cloud/llm",
		"/v1/world/cloud/clusters",
		"/v1/world/cloud/queue",
	}
	for _, route := range adminRoutes {
		t.Run(route, func(t *testing.T) {
			resp, err := http.Get(ts.URL + route)
			if err != nil {
				t.Fatalf("request failed: %v", err)
			}
			defer resp.Body.Close()
			if resp.StatusCode != http.StatusUnauthorized {
				t.Fatalf("want 401 for anon caller, got %d", resp.StatusCode)
			}
			if ct := resp.Header.Get("Content-Type"); !strings.Contains(ct, "application/json") {
				t.Fatalf("want JSON error, got content-type %q", ct)
			}
			var body map[string]any
			if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
				t.Fatalf("decode: %v", err)
			}
			if body["error"] == nil {
				t.Fatalf("expected an error field, got %v", body)
			}
			// The aggregate payload keys must NOT be present in a gated response.
			for _, leak := range []string{"providers", "services", "topPages", "data", "workers", "clusters", "depth", "running"} {
				if _, ok := body[leak]; ok {
					t.Fatalf("gated response leaked %q: %v", leak, body)
				}
			}
		})
	}
}

// TestProbeServiceLivenessFallback proves a subsystem that o11y has no telemetry
// for is reported UP (from a real liveness probe) rather than a false "down", and
// stays uninstrumented. A subsystem o11y DOES know about keeps o11y's verdict.
func TestProbeServiceLivenessFallback(t *testing.T) {
	// Upstream: o11y status/metrics 404 (no telemetry); a liveness path answers 200.
	live := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/v1/o11y/") {
			http.Error(w, "no data", http.StatusNotFound)
			return
		}
		w.WriteHeader(http.StatusOK) // liveness endpoint is alive
	}))
	t.Cleanup(live.Close)
	t.Setenv("HANZO_API_BASE", live.URL) // apiHost() reads this

	s := newTestServer(t)
	row := s.probeService(context.Background(), live.URL, "kms", map[string]string{})
	if !row.Up {
		t.Fatalf("live-but-uninstrumented subsystem must be UP via liveness, got down (%+v)", row)
	}
	if row.Instrumented {
		t.Fatalf("no o11y metrics ⇒ Instrumented must stay false, got true")
	}
	if row.Source != "liveness" {
		t.Fatalf("Source should mark the liveness fallback, got %q", row.Source)
	}
}

// TestLivenessURLCoversSubsystems proves every hardcoded cloudSubsystem has a
// liveness probe URL, so none can silently fall through to a false "down".
func TestLivenessURLCoversSubsystems(t *testing.T) {
	t.Setenv("HANZO_API_BASE", "https://api.hanzo.ai")
	for _, name := range cloudSubsystems {
		if livenessURL(name) == "" {
			t.Errorf("subsystem %q has no liveness URL — it can render a false 'down'", name)
		}
	}
}
