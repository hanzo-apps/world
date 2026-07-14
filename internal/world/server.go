// Package world is the self-contained data backend baked into the world image.
//
// It serves the same-origin /v1/world/* endpoints the SPA fetches (world.hanzo.ai
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
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/hanzoai/world/internal/world/kv"
	"github.com/hanzoai/world/internal/world/mcp"
	"github.com/hanzoai/world/internal/world/model"
	"github.com/hanzoai/world/internal/world/store"
)

const (
	// maxBody caps every upstream body read (OOM / abuse guard). The largest
	// real payloads are UCDP GED pages and threat-intel exports.
	maxBody = 24 << 20 // 24 MiB
	// browserUA is sent to upstreams that block non-browser TLS clients.
	browserUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
		"(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

// Server holds the shared HTTP client, in-memory cache, AI client, and the
// world-model engine used by every handler. It is safe for concurrent use.
type Server struct {
	client     *http.Client
	cache      *Cache
	flight     *flightGroup
	ai         *AIClient
	worldModel *model.Engine
	mcp        *mcp.Server

	// Datastore layer (see datastore.go): kv is the shared hanzo-kv hot cache,
	// feeds is the two-tier warm feed-body cache in front of it, and store is the
	// embedded SQLite lake + per-identity settings.
	kv    *kv.Client
	store *store.DB
	feeds *FeedCache
}

// NewServer constructs the backend, its world-model engine (built from the feed
// sources in model_sources.go), and the datastore layer. Call StartModel and
// StartDatastore to begin the background loops.
func NewServer() *Server {
	s := &Server{
		client: &http.Client{Timeout: 25 * time.Second},
		cache:  NewCache(4096),
		flight: newFlightGroup(),
		ai:     newAIClient(),
		mcp:    mcp.New(),
	}
	s.worldModel = model.New(s.modelSources(), modelDataDir(), modelInterval())
	s.initDatastore()
	return s
}

// StartModel begins the world-model ingest loop; it folds once immediately then
// every interval, snapshotting to disk, until ctx is cancelled. Safe to call
// once from main after the server is built.
func (s *Server) StartModel(ctx context.Context) { s.worldModel.Start(ctx) }

// modelDataDir is where the model snapshot + history ring are persisted for warm
// restart. WORLD_DATA_DIR wins; otherwise prefer the mounted pod volume /data,
// falling back to a temp dir when it is absent or read-only (local dev, CI) so
// persistence never fails hard.
func modelDataDir() string {
	if v := env("WORLD_DATA_DIR"); v != "" {
		return v
	}
	const prod = "/data"
	if st, err := os.Stat(prod); err == nil && st.IsDir() {
		if f, err := os.CreateTemp(prod, ".probe-"); err == nil {
			_ = f.Close()
			_ = os.Remove(f.Name())
			return prod
		}
	}
	return filepath.Join(os.TempDir(), "hanzo-world")
}

// modelInterval is the ingest cadence (WORLD_MODEL_INTERVAL, e.g. "10m"),
// defaulting to the engine default.
func modelInterval() time.Duration {
	if v := env("WORLD_MODEL_INTERVAL"); v != "" {
		if d, err := time.ParseDuration(v); err == nil && d > 0 {
			return d
		}
	}
	return model.DefaultInterval
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

// flightGroup coalesces concurrent work on a cache key so N simultaneous misses
// cause ONE upstream fetch. It is the single-flight guard shared by cachedJSON
// and passthrough: a blocking caller (do) leads or waits-and-shares; a
// background revalidation (tryGo) leads or skips when a leader is already
// running. Keyed by the cache key, so different endpoints never collide.
type flightGroup struct {
	mu sync.Mutex
	m  map[string]*flightCall
}

type flightCall struct {
	done chan struct{}
	val  any
	err  error
}

func newFlightGroup() *flightGroup { return &flightGroup{m: map[string]*flightCall{}} }

// do runs fn for key, coalescing concurrent callers: the first (leader) runs fn
// once; the rest block on it and share its (val, err).
func (g *flightGroup) do(key string, fn func() (any, error)) (any, error) {
	g.mu.Lock()
	if c, ok := g.m[key]; ok {
		g.mu.Unlock()
		<-c.done
		return c.val, c.err
	}
	c := &flightCall{done: make(chan struct{})}
	g.m[key] = c
	g.mu.Unlock()
	g.run(key, c, fn)
	return c.val, c.err
}

// tryGo runs fn in the background for key unless a call is already in flight,
// so concurrent misses don't stack refreshes. Reports whether it started one.
func (g *flightGroup) tryGo(key string, fn func() (any, error)) bool {
	g.mu.Lock()
	if _, ok := g.m[key]; ok {
		g.mu.Unlock()
		return false
	}
	c := &flightCall{done: make(chan struct{})}
	g.m[key] = c
	g.mu.Unlock()
	go g.run(key, c, fn)
	return true
}

// run executes fn, records its result, then releases the key and wakes waiters.
// A panic in fn is converted to an error (never crashes the background refresh
// goroutine) so a failed produce degrades cleanly like any other error.
func (g *flightGroup) run(key string, c *flightCall, fn func() (any, error)) {
	defer func() {
		if r := recover(); r != nil {
			c.err = fmt.Errorf("panic: %v", r)
		}
		g.mu.Lock()
		delete(g.m, key)
		g.mu.Unlock()
		close(c.done)
	}()
	c.val, c.err = fn()
}

// cachedJSON serves a JSON endpoint through the shared cache with
// stale-while-revalidate. produce returns the value to cache and return.
//   - Fresh hit: served immediately.
//   - Stale hit (TTL lapsed, still within the stale window): the stale value is
//     served INSTANTLY and a single coalesced background refresh is kicked, so a
//     lapsed TTL never blocks a request on the ~10s upstream.
//   - True cold miss: blocks on produce, but single-flighted so N cold callers
//     cause one upstream fetch; on error a stale value is served if one appeared,
//     otherwise onError decides the response.
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
	fetch := func() (any, error) {
		ctx, cancel := context.WithTimeout(context.Background(), 24*time.Second)
		defer cancel()
		v, err := produce(ctx)
		if err != nil {
			return nil, err
		}
		s.cache.Set(key, v, ttl, staleFor)
		return v, nil
	}
	if stale, ok := s.cache.GetStale(key); ok {
		s.flight.tryGo(key, fetch)
		writeJSON(w, http.StatusOK, cacheControl, stale)
		return
	}
	v, err := s.flight.do(key, fetch)
	if err != nil {
		if stale, ok := s.cache.GetStale(key); ok {
			writeJSON(w, http.StatusOK, cacheControl, stale)
			return
		}
		onError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, cacheControl, v)
}

// negativeTTL is how long a blank/failed upstream is remembered so a flapping
// source is not re-hit on every request. Short by design: recovery within one
// window, never masking a genuinely-recovered upstream for long.
const negativeTTL = 30 * time.Second

// isBlankBody reports whether an upstream body carries no usable content — empty
// or whitespace-only. Detection only; the caching POLICY (treat blank as a
// failure) lives in passthrough. A blank 200 is exactly as useless as a 5xx, so
// it must never become the cached value.
func isBlankBody(body []byte) bool { return len(bytes.TrimSpace(body)) == 0 }

// fetchAndCache fetches upstream for key and applies the pass-through caching
// POLICY once: a good body is cached fresh (Set); a blank 200 or non-2xx is a
// failure that is never cached (it would poison good data) and instead sets a
// short negative marker so a flapping source is not re-hit every request. Shared
// by passthrough and the boot warmer so the policy lives in exactly one place.
func (s *Server) fetchAndCache(ctx context.Context, key, upstream string, headers map[string]string, ttl, staleFor time.Duration) ([]byte, error) {
	body, status, err := s.get(ctx, upstream, headers)
	if err != nil || status < 200 || status >= 300 || isBlankBody(body) {
		if err == nil {
			if status < 200 || status >= 300 {
				err = fmt.Errorf("upstream status %d", status)
			} else {
				err = fmt.Errorf("upstream returned empty body")
			}
		}
		s.cache.SetNegative(key, negativeTTL)
		return nil, err
	}
	s.cache.Set(key, body, ttl, staleFor)
	return body, nil
}

// passthrough proxies a fixed upstream URL, returning its body verbatim with a
// short in-memory TTL cache and stale-while-revalidate. Used by the pure
// pass-through endpoints.
//   - Fresh hit: served immediately.
//   - Recent failure (negative marker): serve last-good stale or degrade — the
//     upstream is not re-hit.
//   - Stale hit: the stale body is served INSTANTLY and a single coalesced
//     background refresh is kicked, so a lapsed TTL never blocks the request.
//   - Cold miss: blocks on the fetch, single-flighted so N cold callers cause one
//     upstream hit; on failure a stale body is served if present, else the
//     upstream is negative-cached briefly and degraded is written no-store.
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
	if s.cache.Negative(key) {
		s.degradeBytes(w, key, contentType, cacheControl, degraded, fmt.Errorf("upstream recently failed"))
		return
	}
	fetch := func() (any, error) {
		ctx, cancel := context.WithTimeout(context.Background(), 24*time.Second)
		defer cancel()
		body, err := s.fetchAndCache(ctx, key, upstream, headers, ttl, staleFor)
		if err != nil {
			return nil, err
		}
		return body, nil
	}
	if v, ok := s.cache.GetStale(key); ok {
		s.flight.tryGo(key, fetch)
		writeBytes(w, http.StatusOK, contentType, cacheControl, v.([]byte))
		return
	}
	v, err := s.flight.do(key, fetch)
	if err != nil {
		s.degradeBytes(w, key, contentType, cacheControl, degraded, err)
		return
	}
	writeBytes(w, http.StatusOK, contentType, cacheControl, v.([]byte))
}

// degradeBytes serves the last-good stale body when present, else the handler's
// degraded response with Cache-Control: no-store so a transient failure is never
// cached downstream. The no-store header is set before degraded runs; the
// degraded callbacks pass "" for cache-control, so writeBytes/writeJSON leave it
// intact.
func (s *Server) degradeBytes(
	w http.ResponseWriter,
	key, contentType, cacheControl string,
	degraded func(w http.ResponseWriter, err error),
	err error,
) {
	if v, ok := s.cache.GetStale(key); ok {
		writeBytes(w, http.StatusOK, contentType, cacheControl, v.([]byte))
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	degraded(w, err)
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
