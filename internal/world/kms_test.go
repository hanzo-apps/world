package world

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

// kmsStub is an in-memory stand-in for the luxfi/kms REST surface: the login
// broker + the per-secret GET, keyed exactly as the real server keys it. It
// records what it was asked so tests can assert the URL/store-path convention.
type kmsStub struct {
	*httptest.Server
	wantID, wantSecret string
	values             map[string]string // name → value at path=world-secrets, env=prod
	loginDelay         time.Duration

	mu       sync.Mutex
	getPaths []string // store path parsed from each GET (must be "world-secrets")
	getEnvs  []string // ?env= seen on each GET
	logins   int
}

func newKMSStub(t *testing.T, values map[string]string) *kmsStub {
	t.Helper()
	s := &kmsStub{wantID: "world-id", wantSecret: "world-secret", values: values}
	s.Server = httptest.NewServer(http.HandlerFunc(s.handle))
	t.Cleanup(s.Close)
	return s
}

func (s *kmsStub) handle(w http.ResponseWriter, r *http.Request) {
	switch {
	case r.Method == http.MethodPost && r.URL.Path == "/v1/kms/auth/login":
		if s.loginDelay > 0 {
			time.Sleep(s.loginDelay)
		}
		var req struct{ ClientID, ClientSecret string }
		// decode {clientId, clientSecret}
		var m map[string]string
		body, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(body, &m)
		req.ClientID, req.ClientSecret = m["clientId"], m["clientSecret"]
		s.mu.Lock()
		s.logins++
		s.mu.Unlock()
		if req.ClientID != s.wantID || req.ClientSecret != s.wantSecret {
			writeJSONStub(w, 401, map[string]any{"message": "invalid credentials", "statusCode": 401})
			return
		}
		writeJSONStub(w, 200, map[string]any{"accessToken": "tok-123", "expiresIn": 86400, "tokenType": "Bearer"})

	case r.Method == http.MethodGet && strings.Contains(r.URL.Path, "/secrets/"):
		if r.Header.Get("Authorization") != "Bearer tok-123" {
			writeJSONStub(w, 401, map[string]any{"message": "missing bearer token", "statusCode": 401})
			return
		}
		i := strings.Index(r.URL.Path, "/secrets/")
		rest := r.URL.Path[i+len("/secrets/"):]
		idx := strings.LastIndex(rest, "/")
		if idx < 0 {
			writeJSONStub(w, 400, map[string]any{"message": "path and name required"})
			return
		}
		path, name := rest[:idx], rest[idx+1:]
		env := r.URL.Query().Get("env")
		s.mu.Lock()
		s.getPaths = append(s.getPaths, path)
		s.getEnvs = append(s.getEnvs, env)
		s.mu.Unlock()
		val, found := s.values[name]
		if !found {
			writeJSONStub(w, 404, map[string]any{"message": "not found"})
			return
		}
		writeJSONStub(w, 200, map[string]any{"secret": map[string]any{"value": val}})

	default:
		writeJSONStub(w, 404, map[string]any{"message": "no route"})
	}
}

func writeJSONStub(w http.ResponseWriter, code int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(body)
}

// pointWorldAtStub wires the KMS_* env at the given stub with valid creds.
func pointWorldAtStub(t *testing.T, s *kmsStub) {
	t.Helper()
	t.Setenv("KMS_HOST", s.URL)
	t.Setenv("KMS_ORG", "hanzo")
	t.Setenv("KMS_ENV", "prod")
	t.Setenv("KMS_PATH", "/world-secrets")
	t.Setenv("KMS_CLIENT_ID", s.wantID)
	t.Setenv("KMS_CLIENT_SECRET", s.wantSecret)
}

func TestLoadKMSSecrets_InjectsAndPrecedence(t *testing.T) {
	s := newKMSStub(t, map[string]string{
		"HANZO_AI_KEY": "from-kms",
		"FRED_API_KEY": "from-kms-fred",
	})
	pointWorldAtStub(t, s)

	// FRED is set explicitly in env → must NOT be overwritten (explicit wins).
	t.Setenv("FRED_API_KEY", "explicit-wins")
	// HANZO_AI_KEY starts empty → must be injected from KMS.
	t.Setenv("HANZO_AI_KEY", "")
	// WS_RELAY_URL is not in KMS → must stay unset.
	t.Setenv("WS_RELAY_URL", "")

	LoadKMSSecrets(context.Background())

	if got := env("HANZO_AI_KEY"); got != "from-kms" {
		t.Fatalf("HANZO_AI_KEY: want injected %q, got %q", "from-kms", got)
	}
	if got := env("FRED_API_KEY"); got != "explicit-wins" {
		t.Fatalf("FRED_API_KEY: explicit env must win, got %q", got)
	}
	if got := env("WS_RELAY_URL"); got != "" {
		t.Fatalf("WS_RELAY_URL: absent-in-KMS key must stay unset, got %q", got)
	}

	// The store-path convention: every GET must resolve to path "world-secrets"
	// at env "prod" — byte-for-byte what secretKey() keys on.
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.logins != 1 {
		t.Fatalf("expected exactly 1 login, got %d", s.logins)
	}
	if len(s.getPaths) == 0 {
		t.Fatal("expected at least one secret GET")
	}
	for i, p := range s.getPaths {
		if p != "world-secrets" {
			t.Fatalf("GET[%d] store path = %q, want %q", i, p, "world-secrets")
		}
		if s.getEnvs[i] != "prod" {
			t.Fatalf("GET[%d] env = %q, want %q", i, s.getEnvs[i], "prod")
		}
	}
}

func TestLoadKMSSecrets_SkipsWithoutCreds(t *testing.T) {
	t.Setenv("KMS_CLIENT_ID", "")
	t.Setenv("KMS_CLIENT_SECRET", "")
	t.Setenv("HANZO_AI_KEY", "")

	LoadKMSSecrets(context.Background()) // must be a clean no-op

	if got := env("HANZO_AI_KEY"); got != "" {
		t.Fatalf("no creds ⇒ no injection, got HANZO_AI_KEY=%q", got)
	}
}

func TestLoadKMSSecrets_DegradesOnTimeout(t *testing.T) {
	s := newKMSStub(t, map[string]string{"HANZO_AI_KEY": "from-kms"})
	s.loginDelay = 300 * time.Millisecond
	pointWorldAtStub(t, s)
	t.Setenv("HANZO_AI_KEY", "")

	// Shrink the boot timeout so the slow login trips it.
	prev := kmsBootTimeout
	kmsBootTimeout = 50 * time.Millisecond
	defer func() { kmsBootTimeout = prev }()

	start := time.Now()
	LoadKMSSecrets(context.Background())
	elapsed := time.Since(start)

	if elapsed > 2*time.Second {
		t.Fatalf("degrade took too long: %v (must not block boot)", elapsed)
	}
	if got := env("HANZO_AI_KEY"); got != "" {
		t.Fatalf("timeout ⇒ no injection, got HANZO_AI_KEY=%q", got)
	}
}

func TestFetchKMSSecrets_LoginFailsOn401(t *testing.T) {
	s := newKMSStub(t, map[string]string{"HANZO_AI_KEY": "x"})
	cfg := kmsConfig{host: s.URL, org: "hanzo", env: "prod", path: "world-secrets", keys: []string{"HANZO_AI_KEY"}}

	_, err := fetchKMSSecrets(context.Background(), &http.Client{Timeout: 2 * time.Second}, cfg, "bad-id", "bad-secret")
	if err == nil {
		t.Fatal("expected login error on bad credentials, got nil")
	}
	if !strings.Contains(err.Error(), "401") {
		t.Fatalf("expected 401 in error, got %v", err)
	}
}

func TestFetchKMSSecrets_ValueRoundTripAnd404Skip(t *testing.T) {
	s := newKMSStub(t, map[string]string{"HANZO_AI_KEY": "round-trip-value"})
	cfg := kmsConfig{
		host: s.URL, org: "hanzo", env: "prod", path: "world-secrets",
		keys: []string{"HANZO_AI_KEY", "FRED_API_KEY"}, // FRED absent → 404 → skipped
	}

	got, err := fetchKMSSecrets(context.Background(), &http.Client{Timeout: 2 * time.Second}, cfg, s.wantID, s.wantSecret)
	if err != nil {
		t.Fatalf("fetch: %v", err)
	}
	if got["HANZO_AI_KEY"] != "round-trip-value" {
		t.Fatalf("value round-trip: got %q", got["HANZO_AI_KEY"])
	}
	if _, present := got["FRED_API_KEY"]; present {
		t.Fatalf("404 key must be skipped, but present: %q", got["FRED_API_KEY"])
	}
}
