package world

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// stubIAM stands up a userinfo endpoint that maps a bearer token to an IAM
// identity, and points the server's issuer at it. This exercises the real
// introspectIdentity path hermetically (no live IAM).
func stubIAM(t *testing.T, tokenToIdentity map[string]wIdentity) {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/iam/oauth/userinfo" {
			http.NotFound(w, r)
			return
		}
		tok := r.Header.Get("Authorization")
		id, ok := tokenToIdentity[tok]
		if !ok {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		_ = json.NewEncoder(w).Encode(id)
	}))
	t.Cleanup(srv.Close)
	t.Setenv("HANZO_IAM_ISSUER", srv.URL)
}

func TestSettingsAnonymousUnauthorized(t *testing.T) {
	s := newTestServer(t)
	_, code := serve(t, s.handleSettings, http.MethodGet, "/v1/world/settings", "", "")
	if code != http.StatusUnauthorized {
		t.Fatalf("anonymous GET status = %d, want 401", code)
	}
	_, code = serve(t, s.handleSettings, http.MethodPut, "/v1/world/settings", "", `{"a":1}`)
	if code != http.StatusUnauthorized {
		t.Fatalf("anonymous PUT status = %d, want 401", code)
	}
}

func TestSettingsUpsertGetPerIdentity(t *testing.T) {
	s := newTestServer(t)
	stubIAM(t, map[string]wIdentity{
		"Bearer alice": {Org: "acme", Sub: "alice"},
		"Bearer bob":   {Org: "acme", Sub: "bob"},
	})

	// Alice stores her dashboard.
	m, code := serve(t, s.handleSettings, http.MethodPut, "/v1/world/settings", "alice", `{"layout":"grid","cell":40}`)
	if code != http.StatusOK || m["ok"] != true {
		t.Fatalf("alice PUT = %d %v", code, m)
	}
	// Bob stores a different one.
	if m, code := serve(t, s.handleSettings, http.MethodPut, "/v1/world/settings", "bob", `{"layout":"list"}`); code != http.StatusOK || m["ok"] != true {
		t.Fatalf("bob PUT = %d %v", code, m)
	}

	// Each reads back exactly their own — server-side, cross-device, isolated.
	m, code = serve(t, s.handleSettings, http.MethodGet, "/v1/world/settings", "alice", "")
	if code != http.StatusOK {
		t.Fatalf("alice GET status = %d", code)
	}
	if got, want := jsonStr(t, m["settings"]), normJSON(t, `{"layout":"grid","cell":40}`); got != want {
		t.Fatalf("alice settings = %s, want %s", got, want)
	}
	m, _ = serve(t, s.handleSettings, http.MethodGet, "/v1/world/settings", "bob", "")
	if got, want := jsonStr(t, m["settings"]), normJSON(t, `{"layout":"list"}`); got != want {
		t.Fatalf("bob settings = %s, want %s (identity isolation broken)", got, want)
	}
}

func TestSettingsRejectsNonObject(t *testing.T) {
	s := newTestServer(t)
	stubIAM(t, map[string]wIdentity{"Bearer alice": {Org: "acme", Sub: "alice"}})
	_, code := serve(t, s.handleSettings, http.MethodPut, "/v1/world/settings", "alice", `[1,2,3]`)
	if code != http.StatusBadRequest {
		t.Fatalf("array body status = %d, want 400", code)
	}
}

func TestSettingsMissingIsEmptyObject(t *testing.T) {
	s := newTestServer(t)
	stubIAM(t, map[string]wIdentity{"Bearer newuser": {Org: "acme", Sub: "newuser"}})
	m, code := serve(t, s.handleSettings, http.MethodGet, "/v1/world/settings", "newuser", "")
	if code != http.StatusOK {
		t.Fatalf("status = %d", code)
	}
	if got := jsonStr(t, m["settings"]); got != `{}` {
		t.Fatalf("absent settings = %s, want {}", got)
	}
}

func jsonStr(t *testing.T, v any) string {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return string(b)
}

// normJSON round-trips a JSON literal through decode+encode so map key ordering
// matches jsonStr's output (Go marshals map keys sorted) — order-independent
// comparison.
func normJSON(t *testing.T, s string) string {
	t.Helper()
	var v any
	if err := json.Unmarshal([]byte(s), &v); err != nil {
		t.Fatalf("unmarshal %q: %v", s, err)
	}
	return jsonStr(t, v)
}
