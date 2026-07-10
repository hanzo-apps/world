package world

// RED adversarial test (NOT part of Blue's commits — orchestrator may keep or delete).
//
// Proves the unified IAM-introspection admin gate (introspectIdentity → requireAdmin)
// is fail-closed across the full matrix Blue left "network-bound"/untested:
//   - no token                          → 401
//   - non-admin owner                   → 403
//   - empty/missing owner               → 403  (NOT admin, even though isAdminOrg is not env-driven)
//   - IAM 401 / 500 / non-JSON 200      → 403  (introspection failure)
//   - admin / built-in owner            → gate PASSES (not 401/403)
//   - owner with surrounding whitespace → trimmed, PASSES
//   - shared identity cache poisoning   → a settings-populated non-admin identity
//                                         cannot elevate the admin gate

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// iamStub serves /v1/iam/oauth/userinfo with a fixed status + body.
func iamStub(t *testing.T, status int, body string) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/iam/oauth/userinfo" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)
	return srv
}

// apiStub returns 200 {} for any path — a passing gate must reach here and 200.
func apiStub(t *testing.T) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{}`))
	}))
	t.Cleanup(srv.Close)
	return srv
}

func TestRedAdminGateMatrix(t *testing.T) {
	const adminRoute = "/v1/world/cloud/fleet"

	cases := []struct {
		name       string
		iamStatus  int
		iamBody    string
		bearer     string // "" = send no Authorization header
		wantStatus int    // exact status when deterministic
		gatePass   bool   // true = assert NOT 401 and NOT 403 (downstream may vary)
	}{
		{name: "no token → 401", bearer: "", wantStatus: http.StatusUnauthorized},
		{name: "non-admin owner → 403", iamStatus: 200, iamBody: `{"owner":"acme","sub":"u1"}`, bearer: "Bearer good", wantStatus: http.StatusForbidden},
		{name: "empty owner → 403", iamStatus: 200, iamBody: `{"owner":"","sub":"u1"}`, bearer: "Bearer good", wantStatus: http.StatusForbidden},
		{name: "missing owner claim → 403", iamStatus: 200, iamBody: `{"sub":"u1"}`, bearer: "Bearer good", wantStatus: http.StatusForbidden},
		{name: "owner=null → 403", iamStatus: 200, iamBody: `{"owner":null,"sub":"u1"}`, bearer: "Bearer good", wantStatus: http.StatusForbidden},
		{name: "IAM 401 (bad token) → 403", iamStatus: 401, iamBody: `{"error":"invalid_token"}`, bearer: "Bearer bad", wantStatus: http.StatusForbidden},
		{name: "IAM 500 → 403", iamStatus: 500, iamBody: `oops`, bearer: "Bearer good", wantStatus: http.StatusForbidden},
		{name: "IAM 200 non-JSON → 403", iamStatus: 200, iamBody: `<html>not json</html>`, bearer: "Bearer good", wantStatus: http.StatusForbidden},
		{name: "IAM 200 owner as number → 403", iamStatus: 200, iamBody: `{"owner":123,"sub":"u1"}`, bearer: "Bearer good", wantStatus: http.StatusForbidden},
		{name: "admin owner → gate passes", iamStatus: 200, iamBody: `{"owner":"admin","sub":"z"}`, bearer: "Bearer good", gatePass: true},
		{name: "built-in owner → gate passes", iamStatus: 200, iamBody: `{"owner":"built-in","sub":"z"}`, bearer: "Bearer good", gatePass: true},
		{name: "admin owner padded whitespace → gate passes", iamStatus: 200, iamBody: `{"owner":"  admin  ","sub":"z"}`, bearer: "Bearer good", gatePass: true},
		{name: "near-miss 'administrator' → 403", iamStatus: 200, iamBody: `{"owner":"administrator","sub":"z"}`, bearer: "Bearer good", wantStatus: http.StatusForbidden},
		{name: "case-variant 'Admin' → 403", iamStatus: 200, iamBody: `{"owner":"Admin","sub":"z"}`, bearer: "Bearer good", wantStatus: http.StatusForbidden},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			iam := iamStub(t, tc.iamStatus, tc.iamBody)
			api := apiStub(t)
			t.Setenv("HANZO_IAM_ISSUER", iam.URL)
			t.Setenv("HANZO_API_BASE", api.URL)

			s := NewServer()
			mux := http.NewServeMux()
			s.Mount(mux)
			ts := httptest.NewServer(mux)
			t.Cleanup(ts.Close)

			req, _ := http.NewRequest(http.MethodGet, ts.URL+adminRoute, nil)
			if tc.bearer != "" {
				req.Header.Set("Authorization", tc.bearer)
			}
			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Fatalf("request: %v", err)
			}
			defer resp.Body.Close()

			if tc.gatePass {
				if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
					t.Fatalf("admin owner was REJECTED (%d); gate must pass", resp.StatusCode)
				}
				return
			}
			if resp.StatusCode != tc.wantStatus {
				t.Fatalf("got %d, want %d", resp.StatusCode, tc.wantStatus)
			}
		})
	}
}

// TestRedSharedCacheNoElevation proves the unification's shared "identity:" cache
// cannot elevate: an identity resolved for the SETTINGS path (non-admin owner) is
// the very same cache entry requireAdmin reads — and it still 403s. If the gate
// ever trusted a settings-populated entry as admin, this fails.
func TestRedSharedCacheNoElevation(t *testing.T) {
	iam := iamStub(t, 200, `{"owner":"acme","sub":"u1"}`)
	api := apiStub(t)
	t.Setenv("HANZO_IAM_ISSUER", iam.URL)
	t.Setenv("HANZO_API_BASE", api.URL)

	s := NewServer()
	mux := http.NewServeMux()
	s.Mount(mux)
	ts := httptest.NewServer(mux)
	t.Cleanup(ts.Close)

	bearer := "Bearer settings-first"

	// 1) Populate the shared identity cache exactly as the settings path would.
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	id, err := s.introspectIdentity(ctx, bearer)
	if err != nil || id.Org != "acme" || id.Sub != "u1" {
		t.Fatalf("cache priming failed: id=%+v err=%v", id, err)
	}

	// 2) Now hit the admin route with the SAME token. The gate reads the SAME cache
	//    entry (no second IAM call) and MUST still reject a non-admin owner.
	req, _ := http.NewRequest(http.MethodGet, ts.URL+"/v1/world/cloud/fleet", nil)
	req.Header.Set("Authorization", bearer)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("shared-cache elevation: non-admin token got %d on admin route, want 403", resp.StatusCode)
	}
}

// TestRedIsAdminOrgExact locks the admin-org predicate: only the two hardcoded
// orgs (trimmed) qualify; empty never does. This is the property that makes the
// "empty ADMIN_ORG == empty owner" class of bug structurally impossible — there
// is no env-driven admin org to leave unset.
func TestRedIsAdminOrgExact(t *testing.T) {
	admit := map[string]bool{
		"admin": true, "built-in": true,
		" admin ": true, "\tbuilt-in\n": true,
	}
	deny := []string{"", " ", "Admin", "ADMIN", "administrator", "built_in", "builtin", "admins", "acme", "\x00admin"}
	for in, want := range admit {
		if isAdminOrg(in) != want {
			t.Fatalf("isAdminOrg(%q) = %v, want %v", in, !want, want)
		}
	}
	for _, in := range deny {
		if isAdminOrg(in) {
			t.Fatalf("isAdminOrg(%q) = true, want false", in)
		}
	}
}
