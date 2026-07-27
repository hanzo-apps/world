package world

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

// These cover the properties the zip port had to preserve and nothing else: the
// ServeMux trailing-slash → wildcard translation, method policy staying inside
// the handlers, and the streaming relay. Each one fails loudly if the routing
// layer is rebuilt wrongly, which the broad live sweep in routes_test.go cannot
// distinguish from an upstream being down.

// get is a short-deadline GET against the live world server.
func get(t *testing.T, ts *liveServer, method, path string) (*http.Response, string) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	t.Cleanup(cancel)
	req, err := http.NewRequestWithContext(ctx, method, ts.URL+path, nil)
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	t.Cleanup(func() { _ = resp.Body.Close() })
	b, _ := io.ReadAll(resp.Body)
	return resp, string(b)
}

// TestSubtreeRoutesReachTheirHandler: the four ServeMux subtree patterns became
// wildcards, so their children must still land on the owning handler — and only
// a genuinely unregistered path may fall through to the JSON 404.
func TestSubtreeRoutesReachTheirHandler(t *testing.T) {
	ts := serveLive(t, NewServer())

	t.Run("wingbits subtree keeps the full path", func(t *testing.T) {
		// No API key configured, so this is hermetic: the handler answers with its
		// own "not configured" body, which the catch-all would never produce.
		_, body := get(t, ts, http.MethodGet, "/v1/world/wingbits/flights")
		var out map[string]any
		if err := json.Unmarshal([]byte(body), &out); err != nil {
			t.Fatalf("body is not JSON: %v (%s)", err, body)
		}
		if _, ok := out["configured"]; !ok {
			t.Fatalf("did not reach handleWingbits: %s", body)
		}
	})

	t.Run("model country subtree carries the ISO", func(t *testing.T) {
		// The world model starts empty, so US is absent — but the reply must come
		// from the model engine (its {v, …} envelope), proving the ISO reached it.
		resp, body := get(t, ts, http.MethodGet, "/v1/world/model/country/US")
		var out map[string]any
		if err := json.Unmarshal([]byte(body), &out); err != nil {
			t.Fatalf("body is not JSON: %v (%s)", err, body)
		}
		if _, ok := out["v"]; !ok {
			t.Fatalf("did not reach the model engine (status %d): %s", resp.StatusCode, body)
		}
		if !strings.Contains(body, "US") && resp.StatusCode != http.StatusOK {
			t.Fatalf("ISO not carried through: %s", body)
		}
	})

	t.Run("bare model country root is the engine's 400", func(t *testing.T) {
		resp, body := get(t, ts, http.MethodGet, "/v1/world/model/country/")
		if resp.StatusCode != http.StatusBadRequest {
			t.Fatalf("status = %d, want 400: %s", resp.StatusCode, body)
		}
		if !strings.Contains(body, "ISO code required") {
			t.Fatalf("not the engine's own error: %s", body)
		}
	})

	t.Run("unregistered path is the JSON 404, not the SPA and not the framework", func(t *testing.T) {
		resp, body := get(t, ts, http.MethodGet, "/v1/world/definitely-not-a-route")
		if resp.StatusCode != http.StatusNotFound {
			t.Fatalf("status = %d, want 404: %s", resp.StatusCode, body)
		}
		want := `{"error":"Not found: /v1/world/definitely-not-a-route"}`
		if strings.TrimSpace(body) != want {
			t.Fatalf("body = %s, want %s", body, want)
		}
	})
}

// TestMethodPolicyStaysInTheHandler: every path is registered for every method
// because the handlers do their own dispatch. If the port had split routes by
// verb instead, these would come back as the framework's 405/404 rather than the
// handler's own answer.
func TestMethodPolicyStaysInTheHandler(t *testing.T) {
	ts := serveLive(t, NewServer())

	t.Run("OPTIONS preflight is the handler's 204 + CORS", func(t *testing.T) {
		resp, _ := get(t, ts, http.MethodOptions, "/v1/world/models")
		if resp.StatusCode != http.StatusNoContent {
			t.Fatalf("status = %d, want 204", resp.StatusCode)
		}
		if got := resp.Header.Get("Access-Control-Allow-Methods"); got != "GET, OPTIONS" {
			t.Fatalf("Allow-Methods = %q, want %q", got, "GET, OPTIONS")
		}
		if got := resp.Header.Get("Access-Control-Allow-Origin"); got != "*" {
			t.Fatalf("Allow-Origin = %q, want *", got)
		}
	})

	t.Run("a wrong method gets the handler's own 405 body", func(t *testing.T) {
		resp, body := get(t, ts, http.MethodPost, "/v1/world/models")
		if resp.StatusCode != http.StatusMethodNotAllowed {
			t.Fatalf("status = %d, want 405: %s", resp.StatusCode, body)
		}
		want := `{"error":"Method not allowed"}`
		if strings.TrimSpace(body) != want {
			t.Fatalf("body = %s, want %s", body, want)
		}
	})

	t.Run("the catch-all keeps its own wider CORS", func(t *testing.T) {
		resp, _ := get(t, ts, http.MethodOptions, "/v1/world/definitely-not-a-route")
		if resp.StatusCode != http.StatusNoContent {
			t.Fatalf("status = %d, want 204", resp.StatusCode)
		}
		if got := resp.Header.Get("Access-Control-Allow-Methods"); got != "GET, POST, OPTIONS" {
			t.Fatalf("Allow-Methods = %q, want %q", got, "GET, POST, OPTIONS")
		}
	})
}

// TestModelStreamIsRelayedNotBuffered: /v1/world/model/stream never completes —
// it pushes events until the client leaves. A buffering bridge would hold the
// whole response, so the client would not even see the headers. Getting the
// first event proves the relay forwards and flushes as the handler writes.
func TestModelStreamIsRelayedNotBuffered(t *testing.T) {
	ts := serveLive(t, NewServer())

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, ts.URL+"/v1/world/model/stream", nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("stream did not respond (buffered?): %v", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if ct := resp.Header.Get("Content-Type"); !strings.Contains(ct, "text/event-stream") {
		t.Fatalf("Content-Type = %q, want text/event-stream", ct)
	}
	line, err := bufio.NewReader(resp.Body).ReadString('\n')
	if err != nil {
		t.Fatalf("read first event: %v", err)
	}
	if strings.TrimSpace(line) != "event: snapshot" {
		t.Fatalf("first line = %q, want %q", strings.TrimSpace(line), "event: snapshot")
	}
}

// TestRouteTableHasNoDuplicates: two registrations of one path are an ambiguous
// overlap that panics the router at boot. Catch it here instead.
func TestRouteTableHasNoDuplicates(t *testing.T) {
	seen := map[string]bool{}
	for _, r := range NewServer().Routes() {
		if seen[r] {
			t.Errorf("route %q registered twice", r)
		}
		seen[r] = true
		if !strings.HasPrefix(r, "/v1/") {
			t.Errorf("route %q is not under /v1/", r)
		}
	}
}
