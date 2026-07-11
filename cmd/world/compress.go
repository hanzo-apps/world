package main

import (
	"compress/gzip"
	"io"
	"net/http"
	"strings"
	"sync"
)

// gzip on the fly for the static SPA. The hanzoai/static image this binary
// replaced compressed responses for us; serving the Vite bundle raw (main.js
// 1.5MB, map.js 2.7MB) is the whole reason a cold load felt slow. Restoring
// gzip here cuts the JS/CSS wire size ~75%. Paired with immutable cache headers
// on hashed assets (see setCacheHeaders), each client pays the transfer once.
//
// Scope: wraps ONLY the SPA handler, never /v1/world/* — those include SSE /
// streaming endpoints that must not be buffered through a gzip.Writer.

var gzipPool = sync.Pool{
	New: func() any {
		w, _ := gzip.NewWriterLevel(io.Discard, gzip.DefaultCompression)
		return w
	},
}

// gzipStatic compresses compressible responses when the client accepts gzip.
// Range requests pass through untouched (compressing a byte-range is invalid).
func gzipStatic(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Range") != "" || !acceptsGzip(r) {
			next.ServeHTTP(w, r)
			return
		}
		gw := &gzipResponseWriter{ResponseWriter: w}
		defer gw.close()
		next.ServeHTTP(gw, r)
	})
}

func acceptsGzip(r *http.Request) bool {
	for _, enc := range strings.Split(r.Header.Get("Accept-Encoding"), ",") {
		if strings.EqualFold(strings.TrimSpace(strings.SplitN(enc, ";", 2)[0]), "gzip") {
			return true
		}
	}
	return false
}

// compressible reports whether a content type shrinks under gzip. Already-
// compressed media (png/jpg/woff2/…) is skipped so we never waste CPU or grow
// the payload.
func compressible(ct string) bool {
	ct = strings.ToLower(ct)
	switch {
	case strings.HasPrefix(ct, "text/"),
		strings.Contains(ct, "javascript"),
		strings.Contains(ct, "json"),
		strings.Contains(ct, "svg"),
		strings.Contains(ct, "xml"),
		strings.Contains(ct, "wasm"),
		strings.Contains(ct, "manifest"):
		return true
	}
	return false
}

type gzipResponseWriter struct {
	http.ResponseWriter
	gz       *gzip.Writer
	decided  bool
	compress bool
}

func (g *gzipResponseWriter) WriteHeader(status int) {
	g.decide(status)
	g.ResponseWriter.WriteHeader(status)
}

func (g *gzipResponseWriter) Write(b []byte) (int, error) {
	if !g.decided {
		g.decide(http.StatusOK) // FileServer may Write without an explicit WriteHeader
	}
	if g.compress {
		return g.gz.Write(b)
	}
	return g.ResponseWriter.Write(b)
}

// decide inspects the headers the wrapped handler set (Content-Type is already
// populated by http.ServeContent at this point) and commits to compress-or-not
// exactly once.
func (g *gzipResponseWriter) decide(status int) {
	if g.decided {
		return
	}
	g.decided = true
	h := g.Header()
	if status == http.StatusOK && h.Get("Content-Encoding") == "" && compressible(h.Get("Content-Type")) {
		g.compress = true
		h.Del("Content-Length") // length changes after compression
		h.Set("Content-Encoding", "gzip")
		h.Add("Vary", "Accept-Encoding")
		g.gz = gzipPool.Get().(*gzip.Writer)
		g.gz.Reset(g.ResponseWriter)
	}
}

func (g *gzipResponseWriter) close() {
	if g.gz != nil {
		_ = g.gz.Close()
		gzipPool.Put(g.gz)
		g.gz = nil
	}
}
