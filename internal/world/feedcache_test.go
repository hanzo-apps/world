package world

import (
	"context"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/hanzoai/world/internal/world/kv"
)

func TestFeedEncodeDecodeRoundTrip(t *testing.T) {
	at := time.Now().Truncate(time.Nanosecond)
	body := []byte("<rss><item>hello</item></rss>")
	gotAt, gotBody, ok := decodeFeed(encodeFeed(at, body))
	if !ok {
		t.Fatal("decode failed")
	}
	if !gotAt.Equal(at) {
		t.Fatalf("time round-trip = %v, want %v", gotAt, at)
	}
	if string(gotBody) != string(body) {
		t.Fatalf("body round-trip = %q, want %q", gotBody, body)
	}
	if _, _, ok := decodeFeed([]byte("short")); ok {
		t.Fatal("decode of truncated blob should fail")
	}
}

// TestFeedCacheSharedAcrossPods proves the L2 (hanzo-kv) tier: a body written by
// one pod is served to another pod whose L1 is cold — i.e. warming once benefits
// the fleet, and a restarted pod (empty L1) reads a still-warm shared cache.
func TestFeedCacheSharedAcrossPods(t *testing.T) {
	mr := miniredis.RunT(t)
	kvA := kv.Open(mr.Addr(), "")
	kvB := kv.Open(mr.Addr(), "")
	t.Cleanup(func() { kvA.Close(); kvB.Close() })

	podA := NewFeedCache(kvA, 0, nil)
	podB := NewFeedCache(kvB, 0, nil) // separate pod: cold L1, shared L2

	const url = "https://feeds.example.com/rss.xml"
	body := []byte("<rss><channel><item><title>Shared</title></item></channel></rss>")
	podA.Want(url) // a request on podA…
	podA.Put(url, body)

	if podB.Len() != 0 {
		t.Fatalf("podB L1 should start cold, has %d", podB.Len())
	}
	got, _, ok := podB.Get(context.Background(), url)
	if !ok || string(got) != string(body) {
		t.Fatalf("podB Get via shared L2 = %q ok=%v, want the shared body", got, ok)
	}
	if podB.Len() != 1 {
		t.Fatal("podB should have backfilled L1 from L2")
	}
	// …is demand the whole fleet honours: podB, which never saw the request, knows
	// to keep it fresh.
	if !hasURL(podB.WarmURLs(context.Background()), url) {
		t.Fatal("shared warm set missing the demand-added url")
	}
}

// The warm set must be able to SHRINK. The frontend synthesizes a feed per user
// topic, so a set that only ever grows means every keyword anyone ever typed is
// re-fetched by every pod every cycle, forever — including after the topic is
// deleted. Demand nobody renews within warmTTL is dropped from both tiers.
func TestWarmSetForgetsUnrequestedFeeds(t *testing.T) {
	mr := miniredis.RunT(t)
	kvc := kv.Open(mr.Addr(), "")
	t.Cleanup(kvc.Close)
	c := NewFeedCache(kvc, 0, []string{"https://seed.example/rss"})

	const topic = "https://news.google.com/rss/search?q=zebra"
	c.Want(topic)
	c.Put(topic, []byte("<rss/>")) // the warmer's write-through must not renew demand
	if !hasURL(c.WarmURLs(context.Background()), topic) {
		t.Fatal("a requested feed must be warm")
	}

	// Age the demand past its window in both tiers — the score IS the last time
	// anyone asked, so re-registering it in the past is exactly "nobody asked since".
	stale := time.Now().Add(-warmTTL - time.Minute)
	kvc.ZAdd(context.Background(), warmSetKey, stale, topic)
	c.mu.Lock()
	c.warm[topic] = warmEntry{seen: stale}
	c.mu.Unlock()

	warm := c.WarmURLs(context.Background())
	if hasURL(warm, topic) {
		t.Fatalf("abandoned topic feed still warm: %v", warm)
	}
	if !hasURL(warm, "https://seed.example/rss") {
		t.Fatalf("curated seed must never decay: %v", warm)
	}
	c.mu.RLock()
	n := len(c.warm)
	c.mu.RUnlock()
	if n != 0 {
		t.Fatalf("in-mem demand tier kept %d expired entries", n)
	}
	// And the fleet-wide registry itself shrank — not just this pod's view of it.
	if members, _ := mr.ZMembers(warmSetKey); len(members) != 0 {
		t.Fatalf("shared registry still holds %v", members)
	}
}

// TestFeedCacheDegradesWithoutKV proves the graceful fallback: with hanzo-kv
// disabled the cache is per-pod (L1 only) and correct — a "restart" (new cache)
// is cold, never a crash.
func TestFeedCacheDegradesWithoutKV(t *testing.T) {
	disabled := kv.Open("", "") // no hanzo-kv
	c := NewFeedCache(disabled, 0, nil)

	const url = "https://feeds.example.com/x.xml"
	body := []byte("<rss/>")
	c.Put(url, body)

	got, _, ok := c.Get(context.Background(), url)
	if !ok || string(got) != string(body) {
		t.Fatalf("same-pod L1 Get = %q ok=%v", got, ok)
	}
	// A fresh cache (simulated restart) with no shared L2 must miss — proving the
	// per-pod degrade is honest, not silently wrong.
	fresh := NewFeedCache(disabled, 0, nil)
	if _, _, ok := fresh.Get(context.Background(), url); ok {
		t.Fatal("restart with kv disabled should be cold, got a hit")
	}
}

func TestFeedCacheSeedInWarmSet(t *testing.T) {
	c := NewFeedCache(kv.Open("", ""), 0, []string{"https://a.example/rss", "https://b.example/rss"})
	warm := c.WarmURLs(context.Background())
	if !hasURL(warm, "https://a.example/rss") || !hasURL(warm, "https://b.example/rss") {
		t.Fatalf("seed missing from warm set: %v", warm)
	}
}

func TestFeedCacheEvictsOldest(t *testing.T) {
	c := NewFeedCache(kv.Open("", ""), 2, nil)
	c.Put("u1", []byte("1"))
	time.Sleep(2 * time.Millisecond)
	c.Put("u2", []byte("2"))
	time.Sleep(2 * time.Millisecond)
	c.Put("u3", []byte("3")) // over cap → evict u1 (oldest)
	if c.Len() != 2 {
		t.Fatalf("L1 size = %d, want 2 (bounded)", c.Len())
	}
	if _, _, ok := c.Get(context.Background(), "u1"); ok {
		t.Fatal("oldest entry u1 was not evicted")
	}
	if _, _, ok := c.Get(context.Background(), "u3"); !ok {
		t.Fatal("newest entry u3 missing")
	}
}

func hasURL(ss []string, want string) bool {
	for _, s := range ss {
		if s == want {
			return true
		}
	}
	return false
}
