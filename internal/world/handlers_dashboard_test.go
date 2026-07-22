package world

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"
)

// The dashboard endpoint is the durable home for a signed-in user's composed
// dashboard (what the AI analyst and toolbar build on the fly). The invariants
// that MUST hold:
//   1. an opaque config object round-trips: PUT then GET returns it verbatim,
//   2. it is isolated per identity (one user never sees another's dashboard),
//   3. anonymous callers are refused (401) — they keep localStorage,
//   4. the body is validated to be a JSON object at the boundary (400 otherwise).
//
// Identity normally resolves via IAM userinfo; introspectIdentity memoizes it in
// the server cache keyed by the bearer hash, so seeding that cache drives the
// handler with a known identity WITHOUT a network call — the same real SQLite
// store (WORLD_DATA_DIR temp dir) backs it, not a mock.

// seedIdentity primes the identity cache so a bearer resolves to (org, sub)
// offline — mirrors introspectIdentity's key derivation exactly.
func seedIdentity(s *Server, bearer, org, sub string) {
	sum := sha256.Sum256([]byte(bearer))
	key := "identity:" + hex.EncodeToString(sum[:12])
	s.cache.Set(key, wIdentity{Org: org, Sub: sub}, time.Minute, time.Minute)
}

// seedAdmin primes an identity IAM marks as an admin owner (isAdmin=true), so it
// may publish its org's shared doc even when the org is not a global-admin org.
func seedAdmin(s *Server, bearer, org, sub string) {
	sum := sha256.Sum256([]byte(bearer))
	key := "identity:" + hex.EncodeToString(sum[:12])
	s.cache.Set(key, wIdentity{Org: org, Sub: sub, Admin: true}, time.Minute, time.Minute)
}

func callDashboard(s *Server, method, bearer, body string) *httptest.ResponseRecorder {
	return callPath(s, s.handleDashboard, "/v1/world/dashboard", method, bearer, body)
}

func callDashboardShared(s *Server, method, bearer, body string) *httptest.ResponseRecorder {
	return callPath(s, s.handleDashboardShared, "/v1/world/dashboard/shared", method, bearer, body)
}

func callPath(s *Server, h http.HandlerFunc, path, method, bearer, body string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	if bearer != "" {
		r.Header.Set("Authorization", bearer)
	}
	if body != "" {
		r.Header.Set("Content-Type", "application/json")
	}
	w := httptest.NewRecorder()
	h(w, r)
	return w
}

// dashboardConfig decodes the { "config": {...} } GET envelope.
func dashboardConfig(t *testing.T, w *httptest.ResponseRecorder) map[string]string {
	t.Helper()
	var body struct {
		Config map[string]string `json:"config"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode config: %v (body=%s)", err, w.Body.String())
	}
	return body.Config
}

func TestDashboardRoundTripAndIdentityIsolation(t *testing.T) {
	s := testServer(t)
	const alice, bob = "Bearer alice-token", "Bearer bob-token"
	seedIdentity(s, alice, "acme", "alice")
	seedIdentity(s, bob, "acme", "bob")

	// Nothing stored yet → GET is an empty object, never a 5xx or null.
	if w := callDashboard(s, "GET", alice, ""); w.Code != 200 {
		t.Fatalf("GET empty status = %d", w.Code)
	} else if got := dashboardConfig(t, w); len(got) != 0 {
		t.Fatalf("GET empty config = %v, want {}", got)
	}

	// PUT the composed dashboard (opaque mirror of the localStorage keys).
	cfg := `{"panel-order":"[\"live-news\",\"markets\"]","worldmonitor-panels":"{\"markets\":{\"enabled\":true}}","hanzo-world-map-mode":"3d"}`
	w := callDashboard(s, "PUT", alice, cfg)
	if w.Code != 200 {
		t.Fatalf("PUT status = %d (body=%s)", w.Code, w.Body.String())
	}
	var put struct {
		OK bool `json:"ok"`
	}
	if json.Unmarshal(w.Body.Bytes(), &put); !put.OK {
		t.Fatalf("PUT ok = false (store not durable? body=%s)", w.Body.String())
	}

	// GET returns EXACTLY what was stored, verbatim.
	want := map[string]string{
		"panel-order":          `["live-news","markets"]`,
		"worldmonitor-panels":  `{"markets":{"enabled":true}}`,
		"hanzo-world-map-mode": "3d",
	}
	if got := dashboardConfig(t, callDashboard(s, "GET", alice, "")); !reflect.DeepEqual(got, want) {
		t.Fatalf("GET after PUT = %v, want %v", got, want)
	}

	// Isolation: a different identity must see NONE of alice's dashboard.
	if got := dashboardConfig(t, callDashboard(s, "GET", bob, "")); len(got) != 0 {
		t.Fatalf("identity leak: bob sees %v", got)
	}

	// Upsert replaces alice's config; bob still isolated + empty.
	if w := callDashboard(s, "PUT", alice, `{"hanzo-world-map-mode":"2d"}`); w.Code != 200 {
		t.Fatalf("upsert status = %d", w.Code)
	}
	if got := dashboardConfig(t, callDashboard(s, "GET", alice, "")); !reflect.DeepEqual(got, map[string]string{"hanzo-world-map-mode": "2d"}) {
		t.Fatalf("upsert result = %v", got)
	}
}

func TestDashboardRejectsAnonAndNonObject(t *testing.T) {
	s := testServer(t)
	const alice = "Bearer alice-token"
	seedIdentity(s, alice, "acme", "alice")

	// Anonymous → 401 (keeps localStorage), and nothing is stored.
	if w := callDashboard(s, "PUT", "", `{"a":"1"}`); w.Code != 401 {
		t.Fatalf("anon PUT status = %d, want 401", w.Code)
	}
	if w := callDashboard(s, "GET", "", ""); w.Code != 401 {
		t.Fatalf("anon GET status = %d, want 401", w.Code)
	}

	// A non-object body (array / scalar) is refused at the boundary.
	for _, bad := range []string{`[1,2,3]`, `"nope"`, `42`, `not json`} {
		if w := callDashboard(s, "PUT", alice, bad); w.Code != 400 {
			t.Fatalf("PUT %q status = %d, want 400", bad, w.Code)
		}
	}

	// A wrong method is rejected.
	if w := callDashboard(s, "DELETE", alice, ""); w.Code != 405 {
		t.Fatalf("DELETE status = %d, want 405", w.Code)
	}
}

// The org-shared dashboard is the ONE org default an admin publishes for the whole
// org. The invariants that MUST hold:
//  1. an admin PUBLISHES it and it round-trips (PUT then GET returns it verbatim),
//  2. every signed-in MEMBER of that org may READ it,
//  3. a NON-admin member may NOT publish it (403), leaving it unchanged,
//  4. publishing the shared doc NEVER touches any user's per-user dashboard,
//  5. it is isolated per org (another org sees NONE of it),
//  6. anonymous callers are refused (401).
func TestDashboardSharedOrgDefault(t *testing.T) {
	s := testServer(t)
	const admin, member, outsider = "Bearer admin-tok", "Bearer member-tok", "Bearer outsider-tok"
	seedAdmin(s, admin, "acme", "admin-user")        // org admin (isAdmin) of acme
	seedIdentity(s, member, "acme", "member-user")   // ordinary acme member
	seedIdentity(s, outsider, "other", "other-user") // a different org entirely

	// Nothing published yet → a member's GET is an empty object.
	if got := dashboardConfig(t, callDashboardShared(s, "GET", member, "")); len(got) != 0 {
		t.Fatalf("shared GET before publish = %v, want {}", got)
	}

	// A non-admin member may NOT publish — 403, and nothing is stored.
	if w := callDashboardShared(s, "PUT", member, `{"panel-order":"[\"news\"]"}`); w.Code != 403 {
		t.Fatalf("non-admin publish status = %d, want 403", w.Code)
	}
	if got := dashboardConfig(t, callDashboardShared(s, "GET", member, "")); len(got) != 0 {
		t.Fatalf("shared doc changed after refused publish: %v", got)
	}

	// The admin publishes the org default.
	shared := `{"panel-order":"[\"markets\",\"live-news\"]","hanzo-world-map-mode":"2d"}`
	if w := callDashboardShared(s, "PUT", admin, shared); w.Code != 200 {
		t.Fatalf("admin publish status = %d (body=%s)", w.Code, w.Body.String())
	} else {
		var put struct {
			OK bool `json:"ok"`
		}
		if json.Unmarshal(w.Body.Bytes(), &put); !put.OK {
			t.Fatalf("admin publish ok = false (body=%s)", w.Body.String())
		}
	}

	// Every member of the org reads EXACTLY what the admin published.
	want := map[string]string{
		"panel-order":          `["markets","live-news"]`,
		"hanzo-world-map-mode": "2d",
	}
	if got := dashboardConfig(t, callDashboardShared(s, "GET", member, "")); !reflect.DeepEqual(got, want) {
		t.Fatalf("member shared GET = %v, want %v", got, want)
	}
	if got := dashboardConfig(t, callDashboardShared(s, "GET", admin, "")); !reflect.DeepEqual(got, want) {
		t.Fatalf("admin shared GET = %v, want %v", got, want)
	}

	// Publishing the shared doc must NOT create/alter any per-user dashboard.
	if got := dashboardConfig(t, callDashboard(s, "GET", member, "")); len(got) != 0 {
		t.Fatalf("shared publish leaked into member's per-user dashboard: %v", got)
	}
	if got := dashboardConfig(t, callDashboard(s, "GET", admin, "")); len(got) != 0 {
		t.Fatalf("shared publish leaked into admin's per-user dashboard: %v", got)
	}

	// Org isolation: a different org's shared default is untouched (empty).
	if got := dashboardConfig(t, callDashboardShared(s, "GET", outsider, "")); len(got) != 0 {
		t.Fatalf("org leak: other org sees %v", got)
	}

	// Anonymous callers are refused on both verbs.
	if w := callDashboardShared(s, "GET", "", ""); w.Code != 401 {
		t.Fatalf("anon shared GET status = %d, want 401", w.Code)
	}
	if w := callDashboardShared(s, "PUT", "", shared); w.Code != 401 {
		t.Fatalf("anon shared PUT status = %d, want 401", w.Code)
	}
}

// A global-admin ORG (WORLD_ADMIN_ORGS / the base {admin,built-in}) may publish
// even without the per-identity isAdmin flag — the second half of isOrgAdmin.
func TestDashboardSharedAdminOrgMayPublish(t *testing.T) {
	s := testServer(t)
	const op = "Bearer op-tok"
	seedIdentity(s, op, "admin", "op-user") // owner is the base admin org

	if w := callDashboardShared(s, "PUT", op, `{"hanzo-world-map-mode":"3d"}`); w.Code != 200 {
		t.Fatalf("admin-org publish status = %d (body=%s)", w.Code, w.Body.String())
	}
	if got := dashboardConfig(t, callDashboardShared(s, "GET", op, "")); !reflect.DeepEqual(got, map[string]string{"hanzo-world-map-mode": "3d"}) {
		t.Fatalf("admin-org shared GET = %v", got)
	}
}
