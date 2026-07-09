package world

import (
	"sync"
	"time"
)

// Cache is an in-memory, TTL-bounded value cache shared across all endpoints.
// It is the Go twin of the edge functions' per-instance fallback caches: the
// key is the UPSTREAM identity (endpoint + query), the value is public data
// identical for every caller, so caching globally is correct and DRY.
//
// Each entry carries two horizons: a fresh TTL (served as a normal hit) and a
// longer "stale" window (served only when the upstream fetch fails, mirroring
// the STALE / stale-while-revalidate behavior of the originals). Growth is
// bounded: at the cap, entries past their stale horizon are evicted first, then
// the oldest remaining.
type Cache struct {
	mu  sync.Mutex
	m   map[string]cacheEntry
	max int
}

type cacheEntry struct {
	val      any
	freshExp time.Time
	staleExp time.Time
	stored   time.Time
}

// NewCache returns a cache bounded to max entries.
func NewCache(max int) *Cache {
	if max <= 0 {
		max = 1024
	}
	return &Cache{m: make(map[string]cacheEntry), max: max}
}

// Get returns the cached value if it is still fresh.
func (c *Cache) Get(key string) (any, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.m[key]
	if !ok || time.Now().After(e.freshExp) {
		return nil, false
	}
	return e.val, true
}

// GetStale returns the cached value if it is within its stale window (used as a
// last-resort fallback when the upstream is unavailable).
func (c *Cache) GetStale(key string) (any, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.m[key]
	if !ok || time.Now().After(e.staleExp) {
		return nil, false
	}
	return e.val, true
}

// Set stores val, fresh for ttl and served-when-degraded for an additional
// staleFor beyond ttl.
func (c *Cache) Set(key string, val any, ttl, staleFor time.Duration) {
	now := time.Now()
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.m) >= c.max {
		c.evictLocked(now)
	}
	c.m[key] = cacheEntry{
		val:      val,
		freshExp: now.Add(ttl),
		staleExp: now.Add(ttl + staleFor),
		stored:   now,
	}
}

// negPrefix namespaces negative-cache markers so they never collide with — or
// clobber — a key's last-good value, which must stay available as a stale
// fallback while the upstream is flapping.
const negPrefix = "\x00neg\x00"

// SetNegative records a short-lived failure marker for key so a flapping or
// blank upstream is not re-hit on every request. It stores under a separate
// namespaced key and therefore never touches the key's cached value, so a prior
// good body remains servable via GetStale. staleFor is 0 (the marker itself is
// never served, only observed), so it evicts first under memory pressure.
func (c *Cache) SetNegative(key string, ttl time.Duration) {
	c.Set(negPrefix+key, struct{}{}, ttl, 0)
}

// Negative reports whether key has a fresh failure marker (set by SetNegative).
func (c *Cache) Negative(key string) bool {
	_, ok := c.Get(negPrefix + key)
	return ok
}

// evictLocked drops entries past their stale horizon; if still at the cap, it
// drops the single oldest entry so a new one can be admitted.
func (c *Cache) evictLocked(now time.Time) {
	for k, e := range c.m {
		if now.After(e.staleExp) {
			delete(c.m, k)
		}
	}
	if len(c.m) < c.max {
		return
	}
	var oldestKey string
	var oldest time.Time
	first := true
	for k, e := range c.m {
		if first || e.stored.Before(oldest) {
			oldestKey, oldest, first = k, e.stored, false
		}
	}
	if oldestKey != "" {
		delete(c.m, oldestKey)
	}
}
