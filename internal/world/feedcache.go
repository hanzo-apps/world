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
// The warm-URL set (which feeds to keep fresh) is demand-driven and DECAYS: a
// request registers demand (Want), the background warmer keeps every feed under
// demand fresh, and demand nobody renews for warmTTL is forgotten. Decay is the
// point — the frontend synthesizes a feed per user topic, so without it every
// keyword anyone ever typed would be re-fetched by the fleet forever. A curated
// seed guarantees the highest-value panels are warm even on a brand-new pod
// before the first request. When hanzo-kv is unreachable, everything degrades to
// the in-mem tier — still correct, just per-pod and cold across restart.
type FeedCache struct {
	mu   sync.RWMutex
	mem  map[string]feedRow   // L1
	warm map[string]warmEntry // in-mem demand tier (fallback when kv is down)
	seed []string             // curated bootstrap feeds: warm on every pod, never decay
	kv   *kv.Client
	max  int
}

type feedRow struct {
	body []byte
	at   time.Time
}

// warmEntry is one URL's demand: when it was last asked for, and when that was
// last published to the shared registry (a rate-limited write, see Want).
type warmEntry struct{ seen, published time.Time }

const (
	// feedKeyPrefix / warmSetKey namespace the shared hanzo-kv keys. warmSetKey is
	// a TIMESTAMPED set (score = last demand); v2 because v1 was a plain set —
	// membership with no way to forget — and the two types cannot share a key.
	feedKeyPrefix = "world:feed:v1:"
	warmSetKey    = "world:feed:warm:v2"
	// feedKVTTL is the L2 safety horizon. The warmer refreshes every few minutes,
	// so a live entry is normally far younger; the TTL only bounds abandoned feeds.
	feedKVTTL = 3 * time.Hour
	// defaultFeedCacheMax bounds the L1 mirror (news feeds are small; ~500 covers
	// every frontend variant with room to spare).
	defaultFeedCacheMax = 1024
	// warmTTL is how long a feed keeps being warmed after the LAST request for it:
	// long enough to span a quiet night, short enough that an abandoned topic feed
	// stops costing the fleet a fetch every cycle.
	warmTTL = 24 * time.Hour
	// warmPublishEvery rate-limits the shared-tier write, so the instant read path
	// costs at most one registry write per feed per interval.
	warmPublishEvery = 5 * time.Minute
)

// NewFeedCache builds the cache over an (optional) hanzo-kv client. The curated
// seed is warm on every pod from boot and is deliberately NOT published to the
// shared registry: it is compiled into every pod already, and the registry is
// for demand — the thing that has to be able to decay.
func NewFeedCache(kvc *kv.Client, max int, seed []string) *FeedCache {
	if max <= 0 {
		max = defaultFeedCacheMax
	}
	return &FeedCache{
		mem:  make(map[string]feedRow),
		warm: make(map[string]warmEntry),
		seed: seed,
		kv:   kvc,
		max:  max,
	}
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

// Put write-throughs a freshly fetched body to both tiers. Body only: registering
// demand is Want's job, and keeping the two apart is what lets demand decay — the
// warmer writes through on every cycle, so a Put that also renewed demand would
// keep every feed it ever fetched alive forever. It uses a detached, bounded
// context for the shared-tier write so a write-through is never truncated by the
// request that triggered it — durability must outlive the request. The fetch time
// is now.
func (c *FeedCache) Put(url string, body []byte) {
	at := time.Now()
	c.storeMem(url, body, at)
	raw := encodeFeed(at, body)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	c.kv.SetBytes(ctx, feedKeyPrefix+url, raw, feedKVTTL)
}

// Want registers demand for a feed — the ONE way a URL enters the warm set. Every
// request path calls it (cache hit or miss); the warmer never does. So a feed
// stays warm exactly as long as someone is still asking for it: a topic feed a
// user deleted (or typed once) ages out after warmTTL instead of being re-fetched
// by the whole fleet forever. The shared write is rate-limited to keep the
// instant read path instant.
func (c *FeedCache) Want(url string) {
	now := time.Now()
	c.mu.Lock()
	e := c.warm[url]
	e.seen = now
	publish := now.Sub(e.published) >= warmPublishEvery
	if publish {
		e.published = now
	}
	c.warm[url] = e
	c.mu.Unlock()
	if !publish {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	c.kv.ZAdd(ctx, warmSetKey, now, url)
}

// Age returns how old the cached copy is, if any (for the warmer's
// skip-if-fresh, cross-pod dedupe).
func (c *FeedCache) Age(ctx context.Context, url string) (time.Duration, bool) {
	if _, at, ok := c.Get(ctx, url); ok {
		return time.Since(at), true
	}
	return 0, false
}

// WarmURLs is the set of feeds to keep fresh: the curated seed plus every feed
// still under demand — fleet-wide (hanzo-kv) unioned with this pod's own, deduped.
// Demand older than warmTTL is forgotten in both tiers here, which is the only
// thing that bounds either. L1 is deliberately NOT a source: it mirrors bodies,
// not demand, and treating it as demand kept every feed ever fetched warm forever.
func (c *FeedCache) WarmURLs(ctx context.Context) []string {
	cutoff := time.Now().Add(-warmTTL)
	c.kv.ZDropBefore(ctx, warmSetKey, cutoff)
	set := make(map[string]struct{}, len(c.seed))
	for _, u := range c.seed {
		set[u] = struct{}{}
	}
	for _, u := range c.kv.ZSince(ctx, warmSetKey, cutoff) {
		set[u] = struct{}{}
	}
	c.mu.Lock()
	for u, e := range c.warm {
		if e.seen.Before(cutoff) {
			delete(c.warm, u)
			continue
		}
		set[u] = struct{}{}
	}
	c.mu.Unlock()
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
