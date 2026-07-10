package world

import (
	"context"
	"testing"
)

// TestOpenSkyAnonymousUnchanged: with no credentials, the OpenSky headers are the
// historical anonymous set — no Authorization — so the flights proxy is
// byte-identical to before this change until keys are provisioned.
func TestOpenSkyAnonymousUnchanged(t *testing.T) {
	t.Setenv("OPENSKY_CLIENT_ID", "")
	t.Setenv("OPENSKY_CLIENT_SECRET", "")
	s := NewServer()

	if tok := s.openSkyToken(context.Background()); tok != "" {
		t.Fatalf("no creds must yield empty token, got %q", tok)
	}
	h := s.openSkyAuthHeaders(context.Background())
	if _, ok := h["Authorization"]; ok {
		t.Fatalf("anonymous path must not set Authorization")
	}
	if h["User-Agent"] != browserUA {
		t.Fatalf("expected browser UA preserved, got %q", h["User-Agent"])
	}
}

// TestOpenSkyInvalidCredsFallBack: with credentials present but rejected by the
// token endpoint (real 401), the token resolves to "" and no bad Bearer is
// attached — the layer degrades to anonymous rather than sending a broken token.
func TestOpenSkyInvalidCredsFallBack(t *testing.T) {
	t.Setenv("OPENSKY_CLIENT_ID", "world-smoke-invalid")
	t.Setenv("OPENSKY_CLIENT_SECRET", "not-a-real-secret")
	s := NewServer()

	if tok := s.openSkyToken(context.Background()); tok != "" {
		t.Fatalf("invalid creds must yield empty token, got %q", tok)
	}
	if _, ok := s.openSkyAuthHeaders(context.Background())["Authorization"]; ok {
		t.Fatalf("invalid creds must not attach an Authorization header")
	}
}
