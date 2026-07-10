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
		addr = flag.String("addr", envOr("WORLD_ADDR", ":"+envOr("PORT", "3000")), "listen address")
		root = flag.String("root", envOr("WORLD_STATIC_ROOT", "dist"), "static SPA root directory")
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
	defer srv.Close()       // release hanzo-kv + embedded datastore handles
	srv.StartModel(rootCtx) // continuously-folded world-state engine
	srv.StartDatastore(rootCtx) // shared feed warmer + lake write-behind/prune
	mux := http.NewServeMux()
	srv.Mount(mux) // /v1/world/* routes

	// Static SPA + fallback handles everything not matched by an /api route.
	mux.Handle("/", newSPAHandler(*root))

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

func newSPAHandler(root string) http.Handler {
	// Honor the same CSP env the prior hanzoai/static image used, so the world
	// CR needs no change on cutover; WORLD_CSP is an explicit alias.
	h := &spaHandler{
		root:    root,
		fileSrv: http.FileServer(http.Dir(root)),
		csp:     envOr("HANZO_STATIC_CSP", envOr("WORLD_CSP", "")),
	}
	if b, err := os.ReadFile(filepath.Join(root, "index.html")); err == nil {
		h.indexHTML = b
	} else {
		log.Printf("world: warning: no index.html under %q: %v", root, err)
	}
	return h
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
