// Package world is the self-contained data backend baked into the world image.
//
// It serves the same-origin /api/* endpoints the SPA fetches (world.hanzo.ai
// and any *.hanzo.app fork), each a faithful Go port of the original edge
// function: fetch the real upstream, transform to the shape the frontend
// expects, cache briefly in-memory, and degrade cleanly (never 5xx) when an
// optional API key is absent. AI endpoints route to Hanzo's own inference
// instead of third-party LLM providers.
package world

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"
)

const (
	// maxBody caps every upstream body read (OOM / abuse guard). The largest
	// real payloads are UCDP GED pages and threat-intel exports.
	maxBody = 24 << 20 // 24 MiB
	// browserUA is sent to upstreams that block non-browser TLS clients.
	browserUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
		"(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

// Server holds the shared HTTP client, in-memory cache, and AI client used by
// every handler. It is safe for concurrent use.
type Server struct {
	client *http.Client
	cache  *Cache
	ai     *AIClient
}

// NewServer constructs the backend.
func NewServer() *Server {
	return &Server{
		client: &http.Client{Timeout: 25 * time.Second},
		cache:  NewCache(4096),
		ai:     newAIClient(),
	}
}

// ── upstream fetch ──────────────────────────────────────────────────────────

// get performs a bounded GET and returns the body and status. A transport
// error is returned as err; a non-2xx status is returned to the caller (not an
// error) so handlers can mirror the upstream status when they choose to.
func (s *Server) get(ctx context.Context, url string, headers map[string]string) (body []byte, status int, err error) {
	return s.do(ctx, http.MethodGet, url, headers, nil)
}

func (s *Server) do(ctx context.Context, method, url string, headers map[string]string, reqBody []byte) ([]byte, int, error) {
	var r io.Reader
	if reqBody != nil {
		r = bytes.NewReader(reqBody)
	}
	req, err := http.NewRequestWithContext(ctx, method, url, r)
	if err != nil {
		return nil, 0, err
	}
	if _, ok := headers["Accept"]; !ok {
		req.Header.Set("Accept", "application/json")
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := s.client.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer func() { _ = resp.Body.Close() }()
	b, err := io.ReadAll(io.LimitReader(resp.Body, maxBody))
	if err != nil {
		return nil, resp.StatusCode, err
	}
	return b, resp.StatusCode, nil
}

// getJSON GETs url and decodes a 2xx JSON body into v. A non-2xx status is an
// error (the common case where handlers want "success or fail").
func (s *Server) getJSON(ctx context.Context, url string, headers map[string]string, v any) error {
	b, status, err := s.get(ctx, url, headers)
	if err != nil {
		return err
	}
	if status < 200 || status >= 300 {
		return fmt.Errorf("upstream status %d", status)
	}
	return json.Unmarshal(b, v)
}

// getText GETs url and returns the raw 2xx body as a string.
func (s *Server) getText(ctx context.Context, url string, headers map[string]string) (string, error) {
	b, status, err := s.get(ctx, url, headers)
	if err != nil {
		return "", err
	}
	if status < 200 || status >= 300 {
		return "", fmt.Errorf("upstream status %d", status)
	}
	return string(b), nil
}

// ── responses ───────────────────────────────────────────────────────────────

// setCORS allows any origin: these are public-data proxies served same-origin
// to the SPA (world.hanzo.ai and every *.hanzo.app fork), so a wildcard is both
// correct and forkable. No credentials are ever involved.
func setCORS(w http.ResponseWriter, methods string) {
	h := w.Header()
	h.Set("Access-Control-Allow-Origin", "*")
	h.Set("Access-Control-Allow-Methods", methods)
	h.Set("Access-Control-Allow-Headers", "Content-Type")
	h.Set("Access-Control-Max-Age", "86400")
	h.Set("Vary", "Origin")
}

// preflight writes a 204 for an OPTIONS request and reports whether it handled
// the request. Every handler calls this first.
func preflight(w http.ResponseWriter, r *http.Request, methods string) bool {
	setCORS(w, methods)
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return true
	}
	return false
}

func writeJSON(w http.ResponseWriter, status int, cacheControl string, v any) {
	b, err := json.Marshal(v)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"error":"encode failed"}`))
		return
	}
	writeBytes(w, status, "application/json", cacheControl, b)
}

func writeBytes(w http.ResponseWriter, status int, contentType, cacheControl string, body []byte) {
	h := w.Header()
	h.Set("Content-Type", contentType)
	if cacheControl != "" {
		h.Set("Cache-Control", cacheControl)
	}
	w.WriteHeader(status)
	_, _ = w.Write(body)
}

// writeError writes a JSON error body with the given status.
func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, "", map[string]any{"error": msg})
}

// methodNotGet writes a 405 unless the request is a GET; reports whether it
// handled (short-circuited) the request.
func methodNotGet(w http.ResponseWriter, r *http.Request) bool {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return true
	}
	return false
}

// ── caching helpers ─────────────────────────────────────────────────────────

// cachedJSON serves a JSON endpoint through the shared cache. produce returns
// the value to cache and return; on error, a stale cached value is served if
// available, otherwise onError decides the response. This captures the dominant
// "check cache → fetch → transform → cache → fallback" pattern once.
func (s *Server) cachedJSON(
	w http.ResponseWriter,
	key, cacheControl string,
	ttl, staleFor time.Duration,
	produce func(ctx context.Context) (any, error),
	onError func(w http.ResponseWriter, err error),
) {
	if v, ok := s.cache.Get(key); ok {
		writeJSON(w, http.StatusOK, cacheControl, v)
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 24*time.Second)
	defer cancel()
	v, err := produce(ctx)
	if err != nil {
		if stale, ok := s.cache.GetStale(key); ok {
			writeJSON(w, http.StatusOK, cacheControl, stale)
			return
		}
		onError(w, err)
		return
	}
	s.cache.Set(key, v, ttl, staleFor)
	writeJSON(w, http.StatusOK, cacheControl, v)
}

// passthrough proxies a fixed upstream URL, returning its body verbatim with a
// short in-memory TTL cache. Used by the pure pass-through endpoints. On upstream
// failure a stale body is served if present, else degraded is written.
func (s *Server) passthrough(
	w http.ResponseWriter,
	key, upstream, contentType, cacheControl string,
	headers map[string]string,
	ttl, staleFor time.Duration,
	degraded func(w http.ResponseWriter, err error),
) {
	if v, ok := s.cache.Get(key); ok {
		writeBytes(w, http.StatusOK, contentType, cacheControl, v.([]byte))
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 24*time.Second)
	defer cancel()
	body, status, err := s.get(ctx, upstream, headers)
	if err != nil || status < 200 || status >= 300 {
		if v, ok := s.cache.GetStale(key); ok {
			writeBytes(w, http.StatusOK, contentType, cacheControl, v.([]byte))
			return
		}
		if err == nil {
			err = fmt.Errorf("upstream status %d", status)
		}
		degraded(w, err)
		return
	}
	s.cache.Set(key, body, ttl, staleFor)
	writeBytes(w, http.StatusOK, contentType, cacheControl, body)
}

// ── env ─────────────────────────────────────────────────────────────────────

// env returns the first non-empty value among keys (supports fallback aliases).
func env(keys ...string) string {
	for _, k := range keys {
		if v := strings.TrimSpace(os.Getenv(k)); v != "" {
			return v
		}
	}
	return ""
}

func logf(format string, args ...any) { log.Printf(format, args...) }
