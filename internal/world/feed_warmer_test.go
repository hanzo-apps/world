package world

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sync/atomic"
	"testing"
	"time"

	"github.com/hanzoai/world/internal/world/kv"
)

const stubRSS = `<?xml version="1.0"?><rss version="2.0"><channel>
<item><title>Bitcoin warms the cache</title><link>https://x/1</link><pubDate>Mon, 02 Jan 2006 15:04:05 -0700</pubDate></item>
<item><title>SEC regulation update</title><link>https://x/2</link></item>
</channel></rss>`

// stubFeed stands up a counting RSS upstream and allowlists its host for the
// duration of the test (the SSRF boundary is a package var).
func stubFeed(t *testing.T) (feedURL string, hits *int32) {
	t.Helper()
	var n int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		atomic.AddInt32(&n, 1)
		w.Header().Set("Content-Type", "application/xml")
		_, _ = w.Write([]byte(stubRSS))
	}))
	t.Cleanup(srv.Close)
	host := mustHost(t, srv.URL)
	allowedRSSDomains[host] = true
	t.Cleanup(func() { delete(allowedRSSDomains, host) })
	return srv.URL + "/rss.xml", &n
}

// newTestServer builds a Server with the embedded store in a temp dir and
// hanzo-kv disabled (pure per-pod cache) — hermetic, no external services.
func newTestServer(t *testing.T) *Server {
	t.Helper()
	t.Setenv("WORLD_DATA_DIR", t.TempDir())
	t.Setenv("WORLD_KV_DISABLE", "1")
	s := NewServer()
	t.Cleanup(s.Close)
	return s
}

func TestWarmerPopulatesCache(t *testing.T) {
	feedURL, hits := stubFeed(t)
	s := newTestServer(t)
	// Seed the warm set with the stub feed (demand-driven registration stand-in).
	s.feeds = NewFeedCache(kv.Open("", ""), 0, []string{feedURL})

	s.warmFeeds(context.Background())

	if got := atomic.LoadInt32(hits); got != 1 {
		t.Fatalf("upstream fetched %d times, want 1", got)
	}
	body, _, ok := s.feeds.Get(context.Background(), feedURL)
	if !ok || len(body) == 0 {
		t.Fatal("warmer did not populate the cache")
	}
	if string(body) != stubRSS {
		t.Fatalf("cached body mismatch")
	}
}

func TestWarmerSkipsFreshFeeds(t *testing.T) {
	feedURL, hits := stubFeed(t)
	s := newTestServer(t)
	s.feeds = NewFeedCache(kv.Open("", ""), 0, nil)
	// Pre-warm: a fresh copy already in cache (age < freshWindow).
	s.feeds.Put(feedURL, []byte(stubRSS))

	s.warmFeeds(context.Background())

	if got := atomic.LoadInt32(hits); got != 0 {
		t.Fatalf("upstream hit %d times, want 0 (fresh feed must be skipped)", got)
	}
}

// TestWarmedFeedServedInstantly is the end-to-end promise: once warmed, the
// feeds-batch fall-through serves from cache WITHOUT any upstream fetch.
func TestWarmedFeedServedInstantly(t *testing.T) {
	feedURL, hits := stubFeed(t)
	s := newTestServer(t)
	s.feeds = NewFeedCache(kv.Open("", ""), 0, []string{feedURL})
	s.warmFeeds(context.Background()) // one upstream fetch

	// A subsequent request must be served from the warm cache — no new fetch.
	start := time.Now()
	body, ok, fresh := s.feedXML(context.Background(), feedURL)
	elapsed := time.Since(start)
	if !ok || fresh {
		t.Fatalf("feedXML ok=%v fresh=%v, want served-from-cache", ok, fresh)
	}
	if len(body) == 0 {
		t.Fatal("empty body from warm cache")
	}
	if got := atomic.LoadInt32(hits); got != 1 {
		t.Fatalf("upstream hit %d times, want 1 (warm read must not refetch)", got)
	}
	if elapsed > 50*time.Millisecond {
		t.Fatalf("warm read took %s, want <50ms", elapsed)
	}
}

func mustHost(t *testing.T, raw string) string {
	t.Helper()
	u, err := url.Parse(raw)
	if err != nil {
		t.Fatalf("parse %q: %v", raw, err)
	}
	return u.Hostname()
}
