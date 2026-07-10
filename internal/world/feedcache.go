package world

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/binary"
	"io"
	"sync"
	"time"

	"github.com/hanzoai/world/internal/world/kv"
)

// FeedCache is the warm cache for raw RSS/Atom bodies behind the instant
// news/feeds panels. It is a two-tier cache, ONE way to read a feed body:
//
//	L1 — a per-pod in-memory mirror: hot reads never touch the network.
//	L2 — hanzo-kv (shared, cross-pod, survives pod restart): a warm body written
//	     by any pod's warmer is instantly available to every pod, and a restarted
//	     pod repopulates L1 from L2 instead of cold-starting.
//
// The warm-URL set (which feeds to keep fresh) is demand-driven: any feed served
// once is registered, persisted fleet-wide in hanzo-kv, and kept fresh by the
// background warmer. A curated seed guarantees the highest-value panels are warm
// even on a brand-new pod before the first request. When hanzo-kv is
// unreachable, everything degrades to the in-mem tier — still correct, just
// per-pod and cold across restart.
type FeedCache struct {
	mu   sync.RWMutex
	mem  map[string]feedRow  // L1
	warm map[string]struct{} // in-mem warm-set fallback when kv is down
	kv   *kv.Client
	max  int
}

type feedRow struct {
	body []byte
	at   time.Time
}

const (
	// feedKeyPrefix / warmSetKey namespace the shared hanzo-kv keys.
	feedKeyPrefix = "world:feed:v1:"
	warmSetKey    = "world:feed:warm:v1"
	// feedKVTTL is the L2 safety horizon. The warmer refreshes every few minutes,
	// so a live entry is normally far younger; the TTL only bounds abandoned feeds.
	feedKVTTL = 3 * time.Hour
	// defaultFeedCacheMax bounds the L1 mirror (news feeds are small; ~500 covers
	// every frontend variant with room to spare).
	defaultFeedCacheMax = 1024
)

// NewFeedCache builds the cache over an (optional) hanzo-kv client, seeding the
// warm set with the curated bootstrap feeds so a cold pod warms them first.
func NewFeedCache(kvc *kv.Client, max int, seed []string) *FeedCache {
	if max <= 0 {
		max = defaultFeedCacheMax
	}
	c := &FeedCache{
		mem:  make(map[string]feedRow),
		warm: make(map[string]struct{}),
		kv:   kvc,
		max:  max,
	}
	for _, u := range seed {
		c.warm[u] = struct{}{}
	}
	// Publish the seed to the shared warm set too (best-effort), so every pod
	// converges on the same fleet-wide set.
	if len(seed) > 0 {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		c.kv.SAdd(ctx, warmSetKey, seed...)
		cancel()
	}
	return c
}

// Get returns a cached feed body and its fetch time. L1 first (instant); on miss
// it consults the shared L2 and, on a hit, backfills L1 so subsequent reads are
// instant. Never touches upstream.
func (c *FeedCache) Get(ctx context.Context, url string) ([]byte, time.Time, bool) {
	c.mu.RLock()
	row, ok := c.mem[url]
	c.mu.RUnlock()
	if ok {
		return row.body, row.at, true
	}
	if raw, ok := c.kv.GetBytes(ctx, feedKeyPrefix+url); ok {
		if at, body, ok := decodeFeed(raw); ok {
			c.storeMem(url, body, at)
			return body, at, true
		}
	}
	return nil, time.Time{}, false
}

// Put write-throughs a freshly fetched body to both tiers and registers the URL
// in the warm set (demand-driven). It uses a detached, bounded context for the
// shared-tier writes so a write-through is never truncated by the request that
// triggered it — durability must outlive the request. The fetch time is now.
func (c *FeedCache) Put(url string, body []byte) {
	at := time.Now()
	c.storeMem(url, body, at)
	c.mu.Lock()
	c.warm[url] = struct{}{}
	c.mu.Unlock()
	raw := encodeFeed(at, body)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	c.kv.SetBytes(ctx, feedKeyPrefix+url, raw, feedKVTTL)
	c.kv.SAdd(ctx, warmSetKey, url)
}

// Age returns how old the cached copy is, if any (for the warmer's
// skip-if-fresh, cross-pod dedupe).
func (c *FeedCache) Age(ctx context.Context, url string) (time.Duration, bool) {
	if _, at, ok := c.Get(ctx, url); ok {
		return time.Since(at), true
	}
	return 0, false
}

// WarmURLs is the set of feeds to keep fresh: the fleet-wide set from hanzo-kv
// unioned with the in-mem set (seed + demand). Deduped.
func (c *FeedCache) WarmURLs(ctx context.Context) []string {
	set := make(map[string]struct{})
	for _, u := range c.kv.SMembers(ctx, warmSetKey) {
		set[u] = struct{}{}
	}
	c.mu.RLock()
	for u := range c.warm {
		set[u] = struct{}{}
	}
	for u := range c.mem {
		set[u] = struct{}{}
	}
	c.mu.RUnlock()
	out := make([]string, 0, len(set))
	for u := range set {
		out = append(out, u)
	}
	return out
}

// Len reports the L1 mirror size (for tests/introspection).
func (c *FeedCache) Len() int {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return len(c.mem)
}

// storeMem writes L1, evicting the oldest entry when at capacity.
func (c *FeedCache) storeMem(url string, body []byte, at time.Time) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if _, exists := c.mem[url]; !exists && len(c.mem) >= c.max {
		var oldestKey string
		var oldest time.Time
		first := true
		for k, r := range c.mem {
			if first || r.at.Before(oldest) {
				oldestKey, oldest, first = k, r.at, false
			}
		}
		if oldestKey != "" {
			delete(c.mem, oldestKey)
		}
	}
	c.mem[url] = feedRow{body: body, at: at}
}

// ── L2 encoding: [8-byte unix-nano fetch time][gzip(body)] ───────────────────

func encodeFeed(at time.Time, body []byte) []byte {
	var buf bytes.Buffer
	var ts [8]byte
	binary.BigEndian.PutUint64(ts[:], uint64(at.UnixNano()))
	buf.Write(ts[:])
	gz := gzip.NewWriter(&buf)
	_, _ = gz.Write(body)
	_ = gz.Close()
	return buf.Bytes()
}

func decodeFeed(raw []byte) (time.Time, []byte, bool) {
	if len(raw) < 8 {
		return time.Time{}, nil, false
	}
	at := time.Unix(0, int64(binary.BigEndian.Uint64(raw[:8])))
	gz, err := gzip.NewReader(bytes.NewReader(raw[8:]))
	if err != nil {
		return time.Time{}, nil, false
	}
	defer func() { _ = gz.Close() }()
	body, err := io.ReadAll(io.LimitReader(gz, maxBody))
	if err != nil {
		return time.Time{}, nil, false
	}
	return at, body, true
}
