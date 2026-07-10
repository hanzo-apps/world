package world

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"time"
)

// OpenSky OAuth2 (client-credentials) support.
//
// OpenSky moved its API behind Keycloak: anonymous callers are heavily
// rate-limited (429 from datacenter IPs), authenticated ones are not. When an
// operator provisions OPENSKY_CLIENT_ID / OPENSKY_CLIENT_SECRET (delivered via
// KMS → world-secrets, already wired), we fetch a bearer token from OpenSky's
// token endpoint, cache it for its lifetime, and attach it to the states/all
// proxy. With no credentials the code path is byte-identical to before —
// anonymous request, no Authorization header — so nothing regresses until keys
// land.

const openSkyTokenURL = "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token"

// openSkyAuthHeaders returns the OpenSky request headers, adding a Bearer token
// only when client credentials are configured AND a token is obtainable. The
// anonymous result is exactly the historical header set.
func (s *Server) openSkyAuthHeaders(ctx context.Context) map[string]string {
	h := map[string]string{"User-Agent": browserUA, "Accept-Language": "en-US,en;q=0.9"}
	if tok := s.openSkyToken(ctx); tok != "" {
		h["Authorization"] = "Bearer " + tok
	}
	return h
}

// openSkyToken returns a cached OAuth2 access token, fetching a fresh one via the
// client-credentials grant when the cache is cold. Returns "" (→ anonymous) when
// credentials are absent or the token endpoint fails — never an error, so the
// flights layer always degrades cleanly.
func (s *Server) openSkyToken(ctx context.Context) string {
	id := env("OPENSKY_CLIENT_ID")
	secret := env("OPENSKY_CLIENT_SECRET")
	if id == "" || secret == "" {
		return ""
	}
	const key = "opensky-oauth-token"
	if v, ok := s.cache.Get(key); ok {
		return v.(string)
	}

	form := url.Values{
		"grant_type":    {"client_credentials"},
		"client_id":     {id},
		"client_secret": {secret},
	}
	b, status, err := s.do(ctx, http.MethodPost, openSkyTokenURL,
		map[string]string{
			"Content-Type": "application/x-www-form-urlencoded",
			"Accept":       "application/json",
		},
		[]byte(form.Encode()))
	if err != nil || status < 200 || status >= 300 {
		return ""
	}
	var tr struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int    `json:"expires_in"`
	}
	if json.Unmarshal(b, &tr) != nil || tr.AccessToken == "" {
		return ""
	}

	// Cache for the token's lifetime, refreshing ~30s early to avoid a stale-token
	// race; a missing/implausible expiry falls back to a conservative 25 minutes.
	ttl := time.Duration(tr.ExpiresIn) * time.Second
	if ttl <= time.Minute {
		ttl = 25 * time.Minute
	} else {
		ttl -= 30 * time.Second
	}
	s.cache.Set(key, tr.AccessToken, ttl, ttl)
	return tr.AccessToken
}
