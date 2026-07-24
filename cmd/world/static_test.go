package main

import (
	"bytes"
	"compress/gzip"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// writeTree lays out a minimal Vite-style dist for the SPA handler tests.
func writeTree(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "assets"), 0o755); err != nil {
		t.Fatal(err)
	}
	// A hashed JS bundle large enough that gzip clearly wins.
	js := strings.Repeat("export const answer = 42;\n", 4000)
	files := map[string]string{
		"index.html":             "<!doctype html><title>world</title>",
		"assets/main-abc123.js":  js,
		"assets/main-abc123.css": strings.Repeat(".panel{display:flex}\n", 2000),
		"favicon.ico":            "\x00\x00binary",
		"manifest.webmanifest":   `{"name":"world"}`,
	}
	for name, body := range files {
		if err := os.WriteFile(filepath.Join(root, name), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return root
}

func TestStaticGzipAndCache(t *testing.T) {
	root := writeTree(t)
	srv := httptest.NewServer(gzipStatic(newSPAHandler(root, "index.html")))
	defer srv.Close()

	get := func(path, ae string) *http.Response {
		req, _ := http.NewRequest(http.MethodGet, srv.URL+path, nil)
		req.Header.Set("Accept-Encoding", ae)
		resp, err := http.DefaultTransport.RoundTrip(req) // no transparent gunzip
		if err != nil {
			t.Fatalf("GET %s: %v", path, err)
		}
		return resp
	}

	rawLen := func(root, name string) int {
		b, _ := os.ReadFile(filepath.Join(root, name))
		return len(b)
	}

	t.Run("hashed js is gzipped, immutable, and smaller on the wire", func(t *testing.T) {
		resp := get("/assets/main-abc123.js", "gzip")
		defer resp.Body.Close()
		if got := resp.Header.Get("Content-Encoding"); got != "gzip" {
			t.Fatalf("Content-Encoding = %q, want gzip", got)
		}
		if got := resp.Header.Get("Cache-Control"); !strings.Contains(got, "immutable") {
			t.Fatalf("Cache-Control = %q, want immutable", got)
		}
		if !strings.Contains(resp.Header.Get("Vary"), "Accept-Encoding") {
			t.Fatalf("Vary = %q, want Accept-Encoding", resp.Header.Get("Vary"))
		}
		body, _ := io.ReadAll(resp.Body)
		raw := rawLen(root, "assets/main-abc123.js")
		if len(body) >= raw {
			t.Fatalf("gzip wire size %d not smaller than raw %d", len(body), raw)
		}
		// And it must actually decode back to the original bytes.
		zr, err := gzip.NewReader(bytes.NewReader(body))
		if err != nil {
			t.Fatalf("gzip.NewReader: %v", err)
		}
		dec, _ := io.ReadAll(zr)
		if len(dec) != raw {
			t.Fatalf("decoded %d bytes, want %d", len(dec), raw)
		}
	})

	t.Run("no gzip when client does not accept it", func(t *testing.T) {
		resp := get("/assets/main-abc123.js", "identity")
		defer resp.Body.Close()
		if resp.Header.Get("Content-Encoding") != "" {
			t.Fatalf("unexpected Content-Encoding %q", resp.Header.Get("Content-Encoding"))
		}
	})

	t.Run("unhashed files revalidate, never immutable", func(t *testing.T) {
		for _, p := range []string{"/favicon.ico", "/manifest.webmanifest"} {
			resp := get(p, "gzip")
			resp.Body.Close()
			if cc := resp.Header.Get("Cache-Control"); cc != "no-cache" {
				t.Fatalf("%s Cache-Control = %q, want no-cache", p, cc)
			}
		}
	})

	t.Run("already-compressed media is not re-gzipped", func(t *testing.T) {
		resp := get("/favicon.ico", "gzip")
		defer resp.Body.Close()
		if resp.Header.Get("Content-Encoding") == "gzip" {
			t.Fatal("favicon.ico should not be gzipped")
		}
	})

	t.Run("index shell served with no-cache and gzip", func(t *testing.T) {
		resp := get("/", "gzip")
		defer resp.Body.Close()
		if cc := resp.Header.Get("Cache-Control"); cc != "no-cache" {
			t.Fatalf("index Cache-Control = %q, want no-cache", cc)
		}
		if resp.Header.Get("Content-Encoding") != "gzip" {
			t.Fatalf("index should be gzipped, got %q", resp.Header.Get("Content-Encoding"))
		}
	})
}

// writeReactTree lays out a minimal dist-react (its index is index.react.html).
func writeReactTree(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "index.react.html"),
		[]byte("<!doctype html><title>world-react</title>"), 0o644); err != nil {
		t.Fatal(err)
	}
	return root
}

func TestCanarySurfaceSelection(t *testing.T) {
	vanilla := writeTree(t)
	react := writeReactTree(t)
	h := newCanaryHandler(vanilla, react)

	// A client that does NOT follow redirects and keeps no cookies, so each call
	// is explicit about what it sends.
	do := func(target string, cookie *http.Cookie) *http.Response {
		req := httptest.NewRequest(http.MethodGet, target, nil)
		if cookie != nil {
			req.AddCookie(cookie)
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec.Result()
	}

	t.Run("default is vanilla", func(t *testing.T) {
		resp := do("/", nil)
		body, _ := io.ReadAll(resp.Body)
		if !strings.Contains(string(body), "world</title>") || strings.Contains(string(body), "world-react") {
			t.Fatalf("default surface should be vanilla, got %q", body)
		}
	})

	t.Run("?react sets the cookie and redirects to a clean URL", func(t *testing.T) {
		resp := do("/?react=1&keep=me", nil)
		if resp.StatusCode != http.StatusFound {
			t.Fatalf("status = %d, want 302", resp.StatusCode)
		}
		loc := resp.Header.Get("Location")
		if strings.Contains(loc, "react") || !strings.Contains(loc, "keep=me") {
			t.Fatalf("Location %q should drop the toggle and keep other query", loc)
		}
		var set *http.Cookie
		for _, c := range resp.Cookies() {
			if c.Name == surfaceCookie {
				set = c
			}
		}
		if set == nil || set.Value != "react" || set.MaxAge <= 0 {
			t.Fatalf("expected a sticky %s=react cookie, got %+v", surfaceCookie, set)
		}
	})

	t.Run("cookie=react serves the React surface", func(t *testing.T) {
		resp := do("/", &http.Cookie{Name: surfaceCookie, Value: "react"})
		body, _ := io.ReadAll(resp.Body)
		if !strings.Contains(string(body), "world-react") {
			t.Fatalf("cookie=react should serve React index, got %q", body)
		}
	})

	t.Run("?react=0 clears the cookie", func(t *testing.T) {
		resp := do("/?react=0", &http.Cookie{Name: surfaceCookie, Value: "react"})
		var cleared bool
		for _, c := range resp.Cookies() {
			if c.Name == surfaceCookie && c.MaxAge < 0 {
				cleared = true
			}
		}
		if !cleared {
			t.Fatalf("?react=0 should expire the %s cookie", surfaceCookie)
		}
	})

	t.Run("no react root → always vanilla, even with the cookie", func(t *testing.T) {
		vanillaOnly := newCanaryHandler(vanilla, "")
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.AddCookie(&http.Cookie{Name: surfaceCookie, Value: "react"})
		rec := httptest.NewRecorder()
		vanillaOnly.ServeHTTP(rec, req)
		body, _ := io.ReadAll(rec.Result().Body)
		if !strings.Contains(string(body), "world</title>") || strings.Contains(string(body), "world-react") {
			t.Fatalf("with no react root the cookie must be ignored, got %q", body)
		}
	})
}
