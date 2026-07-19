package world

import (
	"encoding/json"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
)

// Usage history is the signed-in user's REAL actions (recent searches, watch queue)
// persisted per identity. It shares handleIdentityBlob with the dashboard but under a
// SEPARATE 'history' namespace, so the invariants are: an opaque blob round-trips,
// it is isolated per identity and from the dashboard namespace, anon is refused, and
// non-object bodies are rejected.

func callHistory(s *Server, method, bearer, body string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, "/v1/world/history", strings.NewReader(body))
	if bearer != "" {
		r.Header.Set("Authorization", bearer)
	}
	if body != "" {
		r.Header.Set("Content-Type", "application/json")
	}
	w := httptest.NewRecorder()
	s.handleHistory(w, r)
	return w
}

func blobConfig(t *testing.T, w *httptest.ResponseRecorder) map[string]string {
	t.Helper()
	var body struct {
		Config map[string]string `json:"config"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode config: %v (body=%s)", err, w.Body.String())
	}
	return body.Config
}

func TestHistoryRoundTripIsolationAndGates(t *testing.T) {
	s := testServer(t)
	const alice, bob = "Bearer alice-hist", "Bearer bob-hist"
	seedIdentity(s, alice, "acme", "alice")
	seedIdentity(s, bob, "acme", "bob")

	// Nothing stored yet → empty object.
	if got := blobConfig(t, callHistory(s, "GET", alice, "")); len(got) != 0 {
		t.Fatalf("empty history = %v, want {}", got)
	}

	// PUT real usage (recent searches + watch queue), verbatim opaque strings.
	blob := `{"worldmonitor_recent_searches":"[\"nvidia\",\"opec\"]","hanzo-world-watch-queue":"{\"items\":[]}"}`
	if w := callHistory(s, "PUT", alice, blob); w.Code != 200 {
		t.Fatalf("PUT status = %d (body=%s)", w.Code, w.Body.String())
	}
	want := map[string]string{
		"worldmonitor_recent_searches": `["nvidia","opec"]`,
		"hanzo-world-watch-queue":      `{"items":[]}`,
	}
	if got := blobConfig(t, callHistory(s, "GET", alice, "")); !reflect.DeepEqual(got, want) {
		t.Fatalf("history round-trip = %v, want %v", got, want)
	}

	// Isolation: another identity sees NONE of alice's history.
	if got := blobConfig(t, callHistory(s, "GET", bob, "")); len(got) != 0 {
		t.Fatalf("identity leak: bob sees %v", got)
	}

	// History is a DISTINCT namespace from dashboard: alice's dashboard stays empty
	// even though her history is populated (no cross-namespace bleed).
	if got := blobConfig(t, callDashboard(s, "GET", alice, "")); len(got) != 0 {
		t.Fatalf("namespace bleed: alice's dashboard = %v after writing history", got)
	}

	// Anonymous → 401; non-object body → 400.
	if w := callHistory(s, "GET", "", ""); w.Code != 401 {
		t.Fatalf("anon GET = %d, want 401", w.Code)
	}
	if w := callHistory(s, "PUT", alice, `[1,2,3]`); w.Code != 400 {
		t.Fatalf("array PUT = %d, want 400", w.Code)
	}
}
