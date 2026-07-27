package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/zap-proto/zip"

	"github.com/hanzoai/world/internal/world"
)

// TestDataRoutesBeatTheSPACatchAll pins the one thing wiring the two halves
// together can get wrong: the SPA is mounted on "/*" AFTER the data plane, and
// zip resolves by pattern specificity rather than registration order. A /v1 path
// must reach its handler, an unknown /v1/world path must get the JSON 404, and
// everything else must still fall through to the shell.
func TestDataRoutesBeatTheSPACatchAll(t *testing.T) {
	root := writeTree(t)
	srv := world.NewServer()
	t.Cleanup(srv.Close)

	app := srv.NewApp()
	app.All("/*", zip.AdaptNetHTTP(gzipStatic(newSPAHandler(root))))
	ts := httptest.NewServer(world.Handler(app))
	defer ts.Close()

	do := func(method, path string) (*http.Response, string) {
		t.Helper()
		req, _ := http.NewRequest(method, ts.URL+path, nil)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("%s %s: %v", method, path, err)
		}
		t.Cleanup(func() { _ = resp.Body.Close() })
		b, _ := io.ReadAll(resp.Body)
		return resp, string(b)
	}

	t.Run("data route wins over the SPA", func(t *testing.T) {
		resp, body := do(http.MethodGet, "/v1/world/health")
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("status = %d: %s", resp.StatusCode, body)
		}
		if !strings.Contains(body, `"status":"ok"`) {
			t.Fatalf("not the health handler: %s", body)
		}
	})

	t.Run("bare /v1/feedback is not shadowed by the SPA", func(t *testing.T) {
		resp, body := do(http.MethodOptions, "/v1/feedback")
		if resp.StatusCode != http.StatusNoContent {
			t.Fatalf("status = %d: %s", resp.StatusCode, body)
		}
		if got := resp.Header.Get("Access-Control-Allow-Methods"); got != "POST, OPTIONS" {
			t.Fatalf("Allow-Methods = %q, want %q", got, "POST, OPTIONS")
		}
	})

	t.Run("unknown data path is the JSON 404, never the shell", func(t *testing.T) {
		resp, body := do(http.MethodGet, "/v1/world/nope")
		if resp.StatusCode != http.StatusNotFound {
			t.Fatalf("status = %d: %s", resp.StatusCode, body)
		}
		if strings.Contains(body, "<!doctype") {
			t.Fatalf("SPA shell leaked from a data path: %s", body)
		}
		if want := `{"error":"Not found: /v1/world/nope"}`; strings.TrimSpace(body) != want {
			t.Fatalf("body = %s, want %s", body, want)
		}
	})

	t.Run("client-routed path still gets the shell", func(t *testing.T) {
		resp, body := do(http.MethodGet, "/country/US")
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("status = %d: %s", resp.StatusCode, body)
		}
		if !strings.Contains(body, "<!doctype") {
			t.Fatalf("want the SPA shell, got: %s", body)
		}
	})

	t.Run("static asset still resolves", func(t *testing.T) {
		resp, body := do(http.MethodGet, "/assets/main-abc123.js")
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("status = %d", resp.StatusCode)
		}
		if !strings.Contains(body, "export const answer = 42;") {
			t.Fatal("asset body did not come from disk")
		}
		if !strings.Contains(resp.Header.Get("Cache-Control"), "immutable") {
			t.Fatalf("Cache-Control = %q, want immutable", resp.Header.Get("Cache-Control"))
		}
	})

	t.Run("missing asset is a 404, not the shell", func(t *testing.T) {
		resp, body := do(http.MethodGet, "/assets/gone.js")
		if resp.StatusCode != http.StatusNotFound {
			t.Fatalf("status = %d: %s", resp.StatusCode, body)
		}
		if strings.Contains(body, "<!doctype") {
			t.Fatal("SPA shell leaked from an asset miss")
		}
	})
}
