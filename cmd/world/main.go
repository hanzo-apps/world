// Command world is the single process baked into the world image. It serves
// BOTH the static Vite SPA (world.hanzo.ai and every *.hanzo.app fork) and the
// same-origin /v1/world/* data + live-video backend the SPA fetches.
//
// One binary, two responsibilities kept orthogonal:
//   - /v1/world/*      → the Go data backend (internal/world), each endpoint a
//     faithful port of the original edge function.
//   - everything  → static files from --root, with SPA fallback to index.html
//     else          for client-routed paths (never for /api or asset misses).
//
// It listens on :3000 (the container/CR port); override with --addr or PORT.
package main

import (
	"context"
	"errors"
	"flag"
	"io/fs"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/hanzoai/world/internal/world"
)

func main() {
	var (
		addr      = flag.String("addr", envOr("WORLD_ADDR", ":"+envOr("PORT", "3000")), "listen address")
		root      = flag.String("root", envOr("WORLD_STATIC_ROOT", "dist"), "static SPA root directory")
		reactRoot = flag.String("react-root", envOr("WORLD_REACT_ROOT", "dist-react"), "canary React SPA root, served only to sessions that opted in via ?react")
	)
	flag.Parse()

	// Root context cancelled on SIGINT/SIGTERM: drives the world-model ingest
	// loop and triggers graceful HTTP shutdown from one signal source.
	rootCtx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	// Fetch secrets from KMS and inject them into the environment BEFORE the
	// server reads any config. Fail-open: no creds / unreachable KMS logs one
	// line and continues on plain env (see internal/world/kms.go).
	world.LoadKMSSecrets(rootCtx)

	srv := world.NewServer()
	defer srv.Close()           // release hanzo-kv + embedded datastore handles
	srv.StartModel(rootCtx)     // continuously-folded world-state engine
	srv.StartDatastore(rootCtx) // shared feed warmer + lake write-behind/prune
	srv.StartFund(rootCtx)      // autonomous PAPER-only multi-asset fund brain
	srv.StartAltAssets(rootCtx) // hourly Christie's auctions + LuxuryEstate warmer
	mux := http.NewServeMux()
	srv.Mount(mux) // /v1/world/* routes

	// Static SPA + fallback handles everything not matched by an /api route.
	// The vanilla Vite build (--root) is the default surface; the React rewrite
	// (--react-root) is served ONLY to a session that opted in via ?react, sticky
	// per a first-party cookie — so shipping this changes nothing until we flip
	// the default. gzipStatic wraps ONLY this handler — /v1/world/* keeps its
	// streaming endpoints unbuffered.
	mux.Handle("/", gzipStatic(newCanaryHandler(*root, *reactRoot)))

	httpSrv := &http.Server{
		Addr:              *addr,
		Handler:           logRequests(mux),
		ReadHeaderTimeout: 15 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	go func() {
		log.Printf("world: serving SPA from %q and /v1/world/* on %s", *root, *addr)
		if err := httpSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("world: server error: %v", err)
		}
	}()

	<-rootCtx.Done()
	log.Printf("world: shutting down")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = httpSrv.Shutdown(ctx)
}

// spaHandler serves files from root and falls back to index.html for any GET
// that doesn't resolve to a real file (client-side routing). It never serves the
// SPA shell for /api paths (those are handled by the mux) and returns 404 for
// missing static assets so a broken asset URL is visible, not masked by HTML.
type spaHandler struct {
	root      string
	indexHTML []byte
	csp       string
	fileSrv   http.Handler
}

func newSPAHandler(root, indexName string) *spaHandler {
	// Honor the same CSP env the prior hanzoai/static image used, so the world
	// CR needs no change on cutover; WORLD_CSP is an explicit alias.
	h := &spaHandler{
		root:    root,
		fileSrv: http.FileServer(http.Dir(root)),
		csp:     envOr("HANZO_STATIC_CSP", envOr("WORLD_CSP", "")),
	}
	if b, err := os.ReadFile(filepath.Join(root, indexName)); err == nil {
		h.indexHTML = b
	} else {
		log.Printf("world: warning: no %s under %q: %v", indexName, root, err)
	}
	return h
}

// surfaceCookie pins a browser session to the vanilla ("") or React ("react")
// world surface; ?react / ?gui toggles it. Readable by the client (not HttpOnly)
// so the app can show which surface it is on.
const surfaceCookie = "world_surface"

// canaryHandler routes each request to the vanilla SPA (default) or the React
// rewrite (opt-in). A visitor opts in with ?react (or ?gui=react): that sets the
// sticky cookie and redirects to a clean URL, so every following request (HTML,
// content-hashed assets, client routes) is served consistently from the React
// root for that session. ?react=0 / ?gui=vanilla opts back out. With no cookie
// the default surface is served — so this is a true canary: nothing changes for
// anyone until we flip the default.
type canaryHandler struct {
	vanilla *spaHandler
	react   *spaHandler // nil when no react root is present → always vanilla
}

func newCanaryHandler(root, reactRoot string) http.Handler {
	c := &canaryHandler{vanilla: newSPAHandler(root, "index.html")}
	if reactRoot != "" {
		// Only enable the canary if the React build actually shipped in the image
		// (its index loaded); otherwise fall through to vanilla, never 404.
		if r := newSPAHandler(reactRoot, "index.react.html"); r.indexHTML != nil {
			c.react = r
		}
	}
	return c
}

func (c *canaryHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Honor an explicit toggle on a navigation: set/clear the sticky cookie, then
	// redirect to the same path without the toggle query so the address bar and
	// shared links stay clean and the reload is served from the chosen root.
	if (r.Method == http.MethodGet || r.Method == http.MethodHead) && hasToggle(r.URL.Query()) {
		q := r.URL.Query()
		want := wantsReact(q)
		ck := &http.Cookie{Name: surfaceCookie, Path: "/", SameSite: http.SameSiteLaxMode}
		if want {
			ck.Value, ck.MaxAge = "react", 30*24*3600
		} else {
			ck.Value, ck.MaxAge = "", -1
		}
		http.SetCookie(w, ck)
		q.Del("react")
		q.Del("gui")
		u := *r.URL
		u.RawQuery = q.Encode()
		http.Redirect(w, r, u.RequestURI(), http.StatusFound)
		return
	}
	if c.react != nil && surfaceFromCookie(r) == "react" {
		c.react.ServeHTTP(w, r)
		return
	}
	c.vanilla.ServeHTTP(w, r)
}

func hasToggle(q url.Values) bool { return q.Has("react") || q.Has("gui") }

// wantsReact reads the toggle intent: ?react (bare or =1/true/on/react) or
// ?gui=react opts in; ?react=0/false/off or ?gui=<anything-else> opts out.
func wantsReact(q url.Values) bool {
	if q.Has("gui") {
		return strings.EqualFold(strings.TrimSpace(q.Get("gui")), "react")
	}
	switch strings.ToLower(strings.TrimSpace(q.Get("react"))) {
	case "", "1", "true", "on", "react":
		return true
	default:
		return false
	}
}

func surfaceFromCookie(r *http.Request) string {
	if ck, err := r.Cookie(surfaceCookie); err == nil {
		return ck.Value
	}
	return ""
}

func (h *spaHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	clean := filepath.Clean(r.URL.Path)
	// Resolve against root; reject traversal.
	rel := strings.TrimPrefix(clean, "/")
	full := filepath.Join(h.root, rel)
	if !strings.HasPrefix(full, filepath.Clean(h.root)) {
		http.Error(w, "Forbidden", http.StatusForbidden)
		return
	}

	if rel == "" || rel == "." {
		h.serveIndex(w, r)
		return
	}
	info, err := os.Stat(full)
	switch {
	case err == nil && !info.IsDir():
		setCacheHeaders(w, rel)
		h.fileSrv.ServeHTTP(w, r) // real file
	case errors.Is(err, fs.ErrNotExist) && !hasExt(rel):
		h.serveIndex(w, r) // client-routed path → SPA shell
	default:
		http.NotFound(w, r) // missing asset (has extension) or dir
	}
}

func (h *spaHandler) serveIndex(w http.ResponseWriter, r *http.Request) {
	if h.indexHTML == nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	if h.csp != "" {
		w.Header().Set("Content-Security-Policy", h.csp)
	}
	w.WriteHeader(http.StatusOK)
	if r.Method != http.MethodHead {
		_, _ = w.Write(h.indexHTML)
	}
}

// setCacheHeaders makes Vite's content-hashed bundles cacheable forever while
// keeping every unhashed file (favicons, manifest, service worker) revalidated
// so SW updates and icon swaps are never stuck behind a stale cache.
func setCacheHeaders(w http.ResponseWriter, rel string) {
	if strings.HasPrefix(rel, "assets/") {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		return
	}
	w.Header().Set("Cache-Control", "no-cache")
}

// hasExt reports whether the last path segment has a file extension, used to
// distinguish an asset miss (foo.js → 404) from a client route (/country/US →
// SPA shell).
func hasExt(rel string) bool {
	base := filepath.Base(rel)
	return strings.Contains(base, ".")
}

func logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/v1/world/") {
			start := time.Now()
			next.ServeHTTP(w, r)
			log.Printf("api %s %s %s", r.Method, r.URL.Path, time.Since(start).Round(time.Millisecond))
			return
		}
		next.ServeHTTP(w, r)
	})
}

func envOr(key, def string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return def
}
