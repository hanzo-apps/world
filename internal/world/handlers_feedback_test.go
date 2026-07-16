package world

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

// upstreamFeedback stubs the ONE gateway's /feedback endpoint, recording the last
// forwarded body + auth so a test can assert exactly what the BFF forwards.
type upstreamFeedback struct {
	mu   sync.Mutex
	hits int
	body map[string]any
	auth string
}

func (u *upstreamFeedback) server(t *testing.T) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasSuffix(r.URL.Path, "/feedback") {
			http.Error(w, "unexpected path "+r.URL.Path, http.StatusNotFound)
			return
		}
		b, _ := io.ReadAll(r.Body)
		u.mu.Lock()
		u.hits++
		u.auth = r.Header.Get("Authorization")
		u.body = map[string]any{}
		_ = json.Unmarshal(b, &u.body)
		u.mu.Unlock()
		w.WriteHeader(http.StatusNoContent)
	}))
}

func newFeedbackTestServer(t *testing.T, base string) *httptest.Server {
	s := NewServer()
	s.ai.base = base
	mux := http.NewServeMux()
	s.Mount(mux)
	ts := httptest.NewServer(mux)
	t.Cleanup(ts.Close)
	return ts
}

func postFeedback(t *testing.T, url, bearer, body string) int {
	req, _ := http.NewRequest(http.MethodPost, url+"/v1/feedback", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if bearer != "" {
		req.Header.Set("Authorization", bearer)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	defer resp.Body.Close()
	return resp.StatusCode
}

// TestFeedbackWhitelistContentFree is the content-free invariant guard: whatever
// junk the client posts, the BFF forwards ONLY {request_id, signal, rating?}.
func TestFeedbackWhitelistContentFree(t *testing.T) {
	up := &upstreamFeedback{}
	upSrv := up.server(t)
	defer upSrv.Close()
	ts := newFeedbackTestServer(t, upSrv.URL)

	// A hostile body smuggling prompt/response text alongside the reward signal.
	body := `{"request_id":"cmpl-abc123","signal":"up","prompt":"secret prompt",` +
		`"response":"secret response","text":"leak","rating":2,"extra":{"k":"v"}}`
	if code := postFeedback(t, ts.URL, "Bearer user-tok", body); code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", code)
	}
	up.mu.Lock()
	defer up.mu.Unlock()
	if up.hits != 1 {
		t.Fatalf("upstream hits = %d, want 1", up.hits)
	}
	if up.auth != "Bearer user-tok" {
		t.Errorf("forwarded auth = %q, want the caller bearer", up.auth)
	}
	// EXACTLY request_id + signal survive — no rating (signal != rating), and no
	// prompt/response/text/extra can ever transit.
	want := map[string]any{"request_id": "cmpl-abc123", "signal": "up"}
	if len(up.body) != len(want) {
		t.Fatalf("forwarded body has %d keys, want %d: %+v", len(up.body), len(want), up.body)
	}
	for k, v := range want {
		if up.body[k] != v {
			t.Errorf("forwarded[%q] = %v, want %v", k, up.body[k], v)
		}
	}
	for _, banned := range []string{"prompt", "response", "text", "extra", "rating"} {
		if _, ok := up.body[banned]; ok {
			t.Errorf("content-free VIOLATION: forwarded body carried %q: %+v", banned, up.body)
		}
	}
}

// TestFeedbackRatingRules pins the discriminated-union invariant server-side: a
// rating rides ONLY with signal "rating" (1..3); dismiss/up never carry one, and
// an out-of-range rating is dropped.
func TestFeedbackRatingRules(t *testing.T) {
	cases := []struct {
		name       string
		body       string
		wantRating any // nil ⇒ no rating key forwarded
	}{
		{"rating carries valid stars", `{"request_id":"r1","signal":"rating","rating":3}`, float64(3)},
		{"rating drops zero", `{"request_id":"r1","signal":"rating","rating":0}`, nil},
		{"rating drops four", `{"request_id":"r1","signal":"rating","rating":4}`, nil},
		{"dismiss never carries a rating", `{"request_id":"r1","signal":"dismiss","rating":2}`, nil},
		{"up never carries a rating", `{"request_id":"r1","signal":"up","rating":2}`, nil},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			up := &upstreamFeedback{}
			upSrv := up.server(t)
			defer upSrv.Close()
			ts := newFeedbackTestServer(t, upSrv.URL)
			if code := postFeedback(t, ts.URL, "Bearer u", c.body); code != http.StatusNoContent {
				t.Fatalf("status = %d, want 204", code)
			}
			up.mu.Lock()
			defer up.mu.Unlock()
			got, ok := up.body["rating"]
			if c.wantRating == nil {
				if ok {
					t.Errorf("rating forwarded (%v) but should have been dropped: %+v", got, up.body)
				}
				return
			}
			if got != c.wantRating {
				t.Errorf("rating = %v, want %v", got, c.wantRating)
			}
		})
	}
}

// TestFeedbackNoOpPaths pins fire-and-forget: no bearer, a bad signal, an empty
// request_id, and malformed JSON all 204 WITHOUT forwarding anything upstream.
func TestFeedbackNoOpPaths(t *testing.T) {
	cases := []struct {
		name, bearer, body string
	}{
		{"no bearer", "", `{"request_id":"r1","signal":"up"}`},
		{"unknown signal", "Bearer u", `{"request_id":"r1","signal":"explode"}`},
		{"empty request_id", "Bearer u", `{"request_id":"","signal":"up"}`},
		{"malformed json", "Bearer u", `{not json`},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			up := &upstreamFeedback{}
			upSrv := up.server(t)
			defer upSrv.Close()
			ts := newFeedbackTestServer(t, upSrv.URL)
			if code := postFeedback(t, ts.URL, c.bearer, c.body); code != http.StatusNoContent {
				t.Fatalf("status = %d, want 204 no-op", code)
			}
			up.mu.Lock()
			defer up.mu.Unlock()
			if up.hits != 0 {
				t.Errorf("upstream was hit %d times, want 0 (no-op)", up.hits)
			}
		})
	}
}

// TestFeedbackPreflight pins the CORS preflight (the SDK's fetch may preflight).
func TestFeedbackPreflight(t *testing.T) {
	ts := newFeedbackTestServer(t, "http://127.0.0.1:0")
	req, _ := http.NewRequest(http.MethodOptions, ts.URL+"/v1/feedback", nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("preflight failed: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("preflight status = %d, want 204", resp.StatusCode)
	}
	if m := resp.Header.Get("Access-Control-Allow-Methods"); !strings.Contains(m, "POST") {
		t.Errorf("allow-methods = %q, want it to include POST", m)
	}
}

// TestAnalystResponseCarriesID pins that the gateway response id is threaded out
// of the completion into the analyst JSON payload, so the SPA can key a reward
// signal to it. The stub returns an OpenAI-shaped body WITH an id.
func TestAnalystResponseCarriesID(t *testing.T) {
	ai := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		resp := map[string]any{
			"id":      "chatcmpl-XYZ789",
			"choices": []any{map[string]any{"message": map[string]any{"content": `{"reply":"hello","actions":[]}`}}},
			"usage":   map[string]any{"total_tokens": 7},
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	}))
	defer ai.Close()

	s := NewServer()
	s.ai.base = ai.URL
	mux := http.NewServeMux()
	s.Mount(mux)
	ts := httptest.NewServer(mux)
	defer ts.Close()

	body := `{"messages":[{"role":"user","content":"hi"}],"context":""}`
	req, _ := http.NewRequest(http.MethodPost, ts.URL+"/v1/world/analyst", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer user-token")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	defer resp.Body.Close()
	var out struct {
		Reply string `json:"reply"`
		ID    string `json:"id"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if out.Reply != "hello" {
		t.Fatalf("reply = %q, want hello", out.Reply)
	}
	if out.ID != "chatcmpl-XYZ789" {
		t.Fatalf("id = %q, want chatcmpl-XYZ789 (gateway response id must be threaded out)", out.ID)
	}
}
