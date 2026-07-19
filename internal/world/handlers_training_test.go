package world

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// TestTrainingContributionProxy verifies the model-improvement consent proxy:
//   - signed out (no bearer) → 401 (the toggle's hidden state) with NO upstream call,
//   - GET forwards the caller's bearer + X-Org-Id to ai /v1/get-training-contribution
//     and UNWRAPS the casibase envelope {status,data:{enabled}} to a bare {enabled},
//   - POST forwards the {enabled} body to ai /v1/update-training-contribution and
//     unwraps the resolved state.
func TestTrainingContributionProxy(t *testing.T) {
	var gotAuth, gotOrg, gotPath, gotBody string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		gotOrg = r.Header.Get("X-Org-Id")
		gotPath = r.URL.Path
		b, _ := io.ReadAll(r.Body)
		gotBody = string(b)
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/v1/get-training-contribution":
			_, _ = io.WriteString(w, `{"status":"ok","msg":"","data":{"enabled":true},"data2":null}`)
		case "/v1/update-training-contribution":
			// Echo the requested state, as the real controller does.
			var body struct {
				Enabled bool `json:"enabled"`
			}
			_ = json.Unmarshal([]byte(gotBody), &body)
			enabled := "false"
			if body.Enabled {
				enabled = "true"
			}
			_, _ = io.WriteString(w, `{"status":"ok","msg":"","data":{"enabled":`+enabled+`},"data2":null}`)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(upstream.Close)
	t.Setenv("HANZO_API_BASE", upstream.URL)

	s := NewServer()
	mux := http.NewServeMux()
	s.Mount(mux)
	ts := httptest.NewServer(mux)
	t.Cleanup(ts.Close)

	do := func(method, path, bearer, org, body string) *http.Response {
		var r io.Reader
		if body != "" {
			r = strings.NewReader(body)
		}
		req, _ := http.NewRequest(method, ts.URL+path, r)
		if bearer != "" {
			req.Header.Set("Authorization", bearer)
		}
		if org != "" {
			req.Header.Set("X-Org-Id", org)
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("%s %s: %v", method, path, err)
		}
		return resp
	}

	// 1) Signed out → 401, and the upstream is never touched.
	gotPath = ""
	resp := do("GET", "/v1/world/training-contribution", "", "", "")
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("signed-out GET = %d, want 401", resp.StatusCode)
	}
	if gotPath != "" {
		t.Errorf("upstream called on a signed-out request (path %q); must be gated before forwarding", gotPath)
	}

	// 2) GET forwards bearer + org and unwraps the envelope to {enabled:true}.
	resp = do("GET", "/v1/world/training-contribution", "Bearer tok-123", "maxpower", "")
	var g struct {
		Enabled bool `json:"enabled"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&g); err != nil {
		t.Fatalf("decode GET: %v", err)
	}
	_ = resp.Body.Close()
	if !g.Enabled {
		t.Errorf("GET enabled = false, want true (unwrapped from the ai envelope)")
	}
	if gotAuth != "Bearer tok-123" {
		t.Errorf("forwarded Authorization = %q, want the caller's own bearer", gotAuth)
	}
	if gotOrg != "maxpower" {
		t.Errorf("forwarded X-Org-Id = %q, want maxpower", gotOrg)
	}
	if gotPath != "/v1/get-training-contribution" {
		t.Errorf("GET hit %q, want /v1/get-training-contribution", gotPath)
	}

	// 3) POST forwards the body and unwraps the resolved opt-in state.
	resp = do("POST", "/v1/world/training-contribution", "Bearer tok-123", "maxpower", `{"enabled":true}`)
	var p struct {
		Enabled bool `json:"enabled"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&p); err != nil {
		t.Fatalf("decode POST: %v", err)
	}
	_ = resp.Body.Close()
	if !p.Enabled {
		t.Errorf("POST enabled = false, want true")
	}
	if gotPath != "/v1/update-training-contribution" {
		t.Errorf("POST hit %q, want /v1/update-training-contribution", gotPath)
	}
	if !strings.Contains(gotBody, `"enabled":true`) {
		t.Errorf("forwarded body = %q, want the {enabled:true} opt-in", gotBody)
	}
}
