package world

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
)

// TestCloudRouterStatsProxy verifies the Enso Live Training proxy:
//   - it UNWRAPS the ai casibase envelope {status,data:{…}} to the bare RouterStats,
//   - scope is HARD-PINNED to "platform" (the arm-opacity / no-vendor contract),
//   - ?hours= is forwarded and clamped to [1,168],
//   - an upstream failure degrades to a 200 flagged unavailable:true (honest
//     "connecting…", never fabricated, never 5xx).
func TestCloudRouterStatsProxy(t *testing.T) {
	// The bare aggregate the client must ultimately see...
	const inner = `{"scope":"platform","window":{"events":1234},"quality":{"engine_share":0.62,"shadow_agreement":null},"by_model":{"arm-1":700,"arm-2":534},"cost":{"saved_pct":21.5}}`
	// ...delivered by ai inside its casibase envelope, which the proxy unwraps.
	const canned = `{"status":"ok","msg":"","data":` + inner + `,"data2":null}`

	var gotScope, gotHours string
	fail := false
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/v1/router/stats") {
			http.NotFound(w, r)
			return
		}
		gotScope = r.URL.Query().Get("scope")
		gotHours = r.URL.Query().Get("hours")
		if fail {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, canned)
	}))
	t.Cleanup(upstream.Close)
	t.Setenv("HANZO_API_BASE", upstream.URL)

	s := NewServer()
	mux := http.NewServeMux()
	s.Mount(mux)
	ts := httptest.NewServer(mux)
	t.Cleanup(ts.Close)

	get := func(path string) *http.Response {
		resp, err := http.Get(ts.URL + path)
		if err != nil {
			t.Fatalf("GET %s: %v", path, err)
		}
		return resp
	}

	// 1) Happy path — verbatim passthrough + scope pinned to platform.
	resp := get("/v1/world/cloud/router-stats?hours=6")
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("want 200, got %d", resp.StatusCode)
	}
	if gotScope != "platform" {
		t.Fatalf("scope must be pinned to platform, upstream saw %q", gotScope)
	}
	if gotHours != "6" {
		t.Fatalf("hours must forward, upstream saw %q", gotHours)
	}
	var got, want map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatalf("decode proxied body: %v", err)
	}
	if err := json.Unmarshal([]byte(inner), &want); err != nil {
		t.Fatalf("decode inner: %v", err)
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("envelope not unwrapped to bare RouterStats:\n got=%v\nwant=%v", got, want)
	}

	// 2) A client-supplied scope cannot override the pin.
	get("/v1/world/cloud/router-stats?hours=12&scope=vendor").Body.Close()
	if gotScope != "platform" {
		t.Fatalf("client scope leaked through, upstream saw %q", gotScope)
	}

	// 3) hours clamps: >168 → 168, missing → 24. Distinct hours = distinct cache
	// keys, so each request actually reaches the upstream.
	get("/v1/world/cloud/router-stats?hours=99999").Body.Close()
	if gotHours != "168" {
		t.Fatalf("hours should clamp to 168, upstream saw %q", gotHours)
	}
	get("/v1/world/cloud/router-stats").Body.Close()
	if gotHours != "24" {
		t.Fatalf("missing hours should default to 24, upstream saw %q", gotHours)
	}

	// 4) Upstream failure → 200 flagged unavailable:true (honest, never 5xx, no
	// fabricated numbers). Use a fresh, uncached hours value so produce runs.
	fail = true
	resp5 := get("/v1/world/cloud/router-stats?hours=3")
	defer resp5.Body.Close()
	if resp5.StatusCode != http.StatusOK {
		t.Fatalf("upstream failure must degrade to 200, got %d", resp5.StatusCode)
	}
	var down map[string]any
	if err := json.NewDecoder(resp5.Body).Decode(&down); err != nil {
		t.Fatalf("decode unavailable body: %v", err)
	}
	if down["unavailable"] != true {
		t.Fatalf("upstream failure must set unavailable:true, got %v", down["unavailable"])
	}
}
