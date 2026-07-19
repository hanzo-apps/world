package world

// KMS boot-time secret injection.
//
// world reads every data-source credential (YOUTUBE_API_KEY, FRED_API_KEY,
// HANZO_CLOUD_PULSE_TOKEN, …) from the process environment via env(). In
// production those values live in Hanzo KMS (ghcr.io/luxfi/kms) under
// org=hanzo, env=prod, path=/world-secrets. Previously an out-of-cluster
// KMSSecret operator (secrets.lux.network) synced them into a K8s Secret that
// world mounted as envFrom; this file replaces that indirection — world
// fetches its own secrets at boot and injects them into its env BEFORE the
// server reads config. One less moving part, one less place a secret rests.
//
// Transport is plain net/http against the KMS REST surface (the login broker
// + a per-secret GET). world is a stdlib-only binary and stays that way: it
// deliberately does NOT import the native luxfi/zap client, which would pull a
// heavy transport+crypto dependency (X25519+ML-KEM handshake, mDNS) into an
// otherwise dependency-free image. It is the SAME KMS either way — "native"
// here means world fetches in-process instead of via an external sync sidecar.
//
// The KMS REST API exposes no path-enumeration endpoint (GET on a bare path
// 307-redirects into the per-secret route), so the set of keys world pulls is
// declared here, in ONE place — the in-repo analogue of the KMSSecret CR's
// `keys:` list. Override with KMS_KEYS (CSV) if the set ever needs to change
// without a rebuild.
//
// Fail-open, always: no creds, an unreachable KMS, or a slow KMS logs exactly
// one line and returns. world then runs on whatever plain env is present —
// every endpoint already degrades cleanly on a missing key. Boot is never
// blocked beyond kmsBootTimeout and never aborts.

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

const (
	kmsDefaultHost = "http://kms.hanzo.svc" // in-cluster KMS Service (:80 → kmsd :8080)
	kmsDefaultOrg  = "hanzo"                // projectSlug / JWT owner scope
	kmsDefaultEnv  = "prod"                 // envSlug — a first-class part of the store key
	kmsDefaultPath = "/world-secrets"       // secretsPath; store path = this, slash-trimmed
)

// kmsBootTimeout caps the entire KMS handshake (login + every per-key GET). A
// var, not a const, so tests can shrink it to exercise the degrade path.
var kmsBootTimeout = 5 * time.Second

// worldSecretKeys is the canonical set of secrets world pulls from KMS. It is
// the union of every credential env() reads across the handlers (see the
// Dockerfile's KMS-injected list). Aliases such as YT_API_KEY / FIRMS_API_KEY
// are resolved by env() at read time and are NOT fetched — only the canonical
// name is stored in KMS. A key absent from KMS simply 404s and is skipped.
var worldSecretKeys = []string{
	"HANZO_CLOUD_PULSE_TOKEN",   // cloud-map pulse backend service token
	"DIGITALOCEAN_ACCESS_TOKEN", // real DO fleet enumeration (DOKS clusters + nodes + droplets)
	"HANZO_AI_KEY",              // AI endpoints (gateway key)
	"HANZO_AI_BASE",             // AI gateway base URL override
	"HANZO_AI_MODEL",            // AI default model override
	"YOUTUBE_API_KEY",           // live-video reliability
	"FRED_API_KEY",              // macro / econ series
	"FINNHUB_API_KEY",           // market quotes
	"EIA_API_KEY",               // energy data
	"NASA_FIRMS_API_KEY",        // wildfire hotspots
	"ACLED_ACCESS_TOKEN",        // conflict / risk events
	"CLOUDFLARE_API_TOKEN",      // infra telemetry
	"WINGBITS_API_KEY",          // ADS-B feed
	"WS_RELAY_URL",              // live websocket relay
}

// kmsConfig is the resolved fetch scope. host has no trailing slash; path has
// no surrounding slashes (it is spliced verbatim into the store-key URL).
type kmsConfig struct {
	host string
	org  string
	env  string
	path string
	keys []string
}

func kmsConfigFromEnv() kmsConfig {
	c := kmsConfig{
		host: strings.TrimRight(kmsEnvOr("KMS_HOST", kmsDefaultHost), "/"),
		org:  kmsEnvOr("KMS_ORG", kmsDefaultOrg),
		env:  kmsEnvOr("KMS_ENV", kmsDefaultEnv),
		path: strings.Trim(kmsEnvOr("KMS_PATH", kmsDefaultPath), "/"),
		keys: worldSecretKeys,
	}
	if v := strings.TrimSpace(os.Getenv("KMS_KEYS")); v != "" {
		c.keys = splitTrim(v)
	}
	return c
}

// LoadKMSSecrets fetches world's secrets from KMS and injects any that are not
// already set in the environment (an explicit env value ALWAYS wins). It is the
// first thing cmd/world runs, before the server reads any config. Safe to call
// unconditionally: with no KMS_CLIENT_ID / KMS_CLIENT_SECRET it is a logged
// no-op. It never panics, never crashes the process, and never blocks longer
// than kmsBootTimeout.
func LoadKMSSecrets(ctx context.Context) {
	clientID := strings.TrimSpace(os.Getenv("KMS_CLIENT_ID"))
	clientSecret := strings.TrimSpace(os.Getenv("KMS_CLIENT_SECRET"))
	if clientID == "" || clientSecret == "" {
		logf("world: KMS fetch skipped (KMS_CLIENT_ID/KMS_CLIENT_SECRET unset); using plain env")
		return
	}
	cfg := kmsConfigFromEnv()

	cctx, cancel := context.WithTimeout(ctx, kmsBootTimeout)
	defer cancel()
	hc := &http.Client{Timeout: kmsBootTimeout}

	secrets, err := fetchKMSSecrets(cctx, hc, cfg, clientID, clientSecret)
	if err != nil {
		logf("world: KMS fetch degraded (%v); using plain env", err)
		return
	}

	injected := 0
	for k, v := range secrets {
		if strings.TrimSpace(os.Getenv(k)) != "" {
			continue // explicit env wins — never clobber an operator override
		}
		if err := os.Setenv(k, v); err != nil {
			logf("world: KMS setenv %s: %v", k, err)
			continue
		}
		injected++
	}
	logf("world: KMS injected %d secret(s) of %d requested (host=%s org=%s env=%s path=/%s)",
		injected, len(cfg.keys), cfg.host, cfg.org, cfg.env, cfg.path)
}

// fetchKMSSecrets logs in once, then GETs each requested key. A per-key
// transport error or 404 is skipped (logged, not fatal) so one missing/broken
// secret never denies the rest. A login failure aborts (nothing can be read
// without a token). Returns the map of successfully fetched name→value.
func fetchKMSSecrets(ctx context.Context, hc *http.Client, cfg kmsConfig, clientID, clientSecret string) (map[string]string, error) {
	token, err := kmsLogin(ctx, hc, cfg.host, clientID, clientSecret)
	if err != nil {
		return nil, err
	}
	out := make(map[string]string, len(cfg.keys))
	for _, name := range cfg.keys {
		if err := ctx.Err(); err != nil {
			// Deadline hit mid-fetch — return what we have rather than spam a
			// failure line per remaining key.
			return out, err
		}
		v, ok, err := kmsGetSecret(ctx, hc, cfg, token, name)
		switch {
		case err != nil:
			logf("world: KMS get %s: %v", name, err)
		case ok:
			out[name] = v
		}
	}
	return out, nil
}

// kmsLogin exchanges clientId/clientSecret for an IAM-signed bearer via the KMS
// login broker (POST /v1/kms/auth/login → {accessToken,expiresIn,tokenType}).
func kmsLogin(ctx context.Context, hc *http.Client, host, clientID, clientSecret string) (string, error) {
	body, err := json.Marshal(map[string]string{"clientId": clientID, "clientSecret": clientSecret})
	if err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, host+"/v1/kms/auth/login", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := hc.Do(req)
	if err != nil {
		return "", fmt.Errorf("login: %w", err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("login: kms returned %d", resp.StatusCode)
	}
	var out struct {
		AccessToken string `json:"accessToken"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return "", fmt.Errorf("login: decode: %w", err)
	}
	if out.AccessToken == "" {
		return "", fmt.Errorf("login: empty accessToken")
	}
	return out.AccessToken, nil
}

// kmsGetSecret reads one secret value.
//
//	GET {host}/v1/kms/orgs/{org}/secrets/{path}/{name}?env={env}
//	→ 200 {"secret":{"value":"…"}}   |   404 {"message":"not found"}
//
// The server splits the URL tail at its LAST '/' into (storePath, name) and
// keys the record at kms/secrets/{storePath}/{env}/{name} — so {path} here IS
// the store path, byte-for-byte. ok=false on a 404 (secret simply not set).
func kmsGetSecret(ctx context.Context, hc *http.Client, cfg kmsConfig, token, name string) (value string, ok bool, err error) {
	u := cfg.host + "/v1/kms/orgs/" + url.PathEscape(cfg.org) + "/secrets"
	if cfg.path != "" {
		u += "/" + cfg.path
	}
	u += "/" + url.PathEscape(name) + "?env=" + url.QueryEscape(cfg.env)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return "", false, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/json")

	resp, err := hc.Do(req)
	if err != nil {
		return "", false, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	switch resp.StatusCode {
	case http.StatusOK:
		var out struct {
			Secret struct {
				Value string `json:"value"`
			} `json:"secret"`
		}
		if err := json.Unmarshal(raw, &out); err != nil {
			return "", false, fmt.Errorf("decode: %w", err)
		}
		return out.Secret.Value, true, nil
	case http.StatusNotFound:
		return "", false, nil
	default:
		return "", false, fmt.Errorf("kms returned %d", resp.StatusCode)
	}
}

// kmsEnvOr returns the trimmed env value for key, or def when unset/blank.
func kmsEnvOr(key, def string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return def
}

// splitTrim splits a CSV into non-empty trimmed fields.
func splitTrim(s string) []string {
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}
