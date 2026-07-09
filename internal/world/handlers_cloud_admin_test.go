package world

import (
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
			for _, leak := range []string{"providers", "services", "topPages", "data", "workers"} {
				if _, ok := body[leak]; ok {
					t.Fatalf("gated response leaked %q: %v", leak, body)
				}
			}
		})
	}
}
