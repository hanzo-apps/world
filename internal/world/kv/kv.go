// Package kv is world's thin, graceful-degrade client for cloud's shared hot
// cache (/v1/kv on api.hanzo.ai). It exists so the feed/response warm cache is
// SHARED across all world pods and survives a pod restart: warming once
// benefits the whole fleet, and a restarted pod reads a still-warm cache
// instead of cold-starting.
//
// Every method degrades cleanly — a nil/unconfigured client, an unreachable
// server, or any transport error yields a clean miss / no-op, never a
// blocking call or an error the caller must handle. A tiny circuit breaker
// parks a downed server for a cooldown so the hot path is not repeatedly
// stalled dialing a dead host. The queryable data lake lives in SQLite
// (package store); this is only the speed layer in front of feeds.
package kv

import (
	"context"
	"encoding/base64"
	"errors"
	"sort"
	"sync/atomic"
	"time"

	"github.com/hanzoai/bucket"
)

// breakerCooldown parks a failing server: after an error, ops short-circuit to
// "miss" for this long instead of re-dialing on every request.
const breakerCooldown = 15 * time.Second

// Two buckets, not one: cacheBucket holds SetBytes/GetBytes values, which
// expire on the TTL the first successful SetBytes call establishes (TTL is
// bucket-wide, not per key). setsBucket holds the timestamped registries, which
// bound themselves (ZDropBefore) and so carry no bucket expiry.
const (
	cacheBucket = "world-cache"
	setsBucket  = "world-cache-sets"
)

var errDisabled = errors.New("kv: disabled")

// Client wraps a bucket.Client. A zero/disabled Client (b == nil) is valid and
// behaves as a permanent clean miss, so local dev and CI need no shared cache.
type Client struct {
	b            *bucket.Client
	downUntil    atomic.Int64 // unix-nano; server parked until then
	cacheEnsured atomic.Bool  // cacheBucket created
	setsEnsured  atomic.Bool  // setsBucket created
}

// Open builds a client for baseURL (e.g. "https://api.hanzo.ai") authenticated
// with token. An empty baseURL returns a disabled client (pure miss) — the
// correct behavior for environments without a shared cache. A malformed
// baseURL degrades the same way rather than failing Open.
func Open(baseURL, token string) *Client {
	if baseURL == "" {
		return &Client{}
	}
	c, err := bucket.New(bucket.Config{BaseURL: baseURL, Token: token, Timeout: 2 * time.Second})
	if err != nil {
		return &Client{}
	}
	return &Client{b: c}
}

// Enabled reports whether a server is configured (not whether it is currently
// reachable).
func (c *Client) Enabled() bool { return c != nil && c.b != nil }

func (c *Client) available() bool {
	if c == nil || c.b == nil {
		return false
	}
	return time.Now().UnixNano() >= c.downUntil.Load()
}

// trip parks the server for the cooldown after a transport failure.
func (c *Client) trip() { c.downUntil.Store(time.Now().Add(breakerCooldown).UnixNano()) }

// ensureCache creates cacheBucket on first use, with ttl as its one-time
// bucket-wide expiry. Idempotent: an already-existing bucket is not an error.
func (c *Client) ensureCache(ctx context.Context, ttl time.Duration) bool {
	if c.cacheEnsured.Load() {
		return true
	}
	if _, err := c.b.Create(ctx, cacheBucket, 1, ttl); err != nil && !errors.Is(err, bucket.ErrConflict) {
		c.trip()
		return false
	}
	c.cacheEnsured.Store(true)
	return true
}

// ensureSets creates setsBucket on first use, with no expiry.
func (c *Client) ensureSets(ctx context.Context) bool {
	if c.setsEnsured.Load() {
		return true
	}
	if _, err := c.b.Create(ctx, setsBucket, 1, 0); err != nil && !errors.Is(err, bucket.ErrConflict) {
		c.trip()
		return false
	}
	c.setsEnsured.Store(true)
	return true
}

// GetBytes returns the value for key, or (nil,false) on miss/failure. A real
// cache miss (ErrNotFound) does not trip the breaker; a transport error does.
func (c *Client) GetBytes(ctx context.Context, key string) ([]byte, bool) {
	if !c.available() {
		return nil, false
	}
	e, err := c.b.Get(ctx, cacheBucket, key)
	if errors.Is(err, bucket.ErrNotFound) {
		return nil, false
	}
	if err != nil {
		c.trip()
		return nil, false
	}
	b, err := base64.StdEncoding.DecodeString(e.Value)
	if err != nil {
		// A value that isn't the base64 SetBytes writes can't be decoded as
		// bytes; treat it as absent rather than handing the caller garbage.
		return nil, false
	}
	return b, true
}

// SetBytes writes key=val. val is arbitrary bytes (feed bodies are
// gzip-compressed), but /v1/kv values are carried as UTF-8 text on the wire —
// arbitrary binary put through directly would be silently mangled at the JSON
// boundary — so SetBytes/GetBytes base64-encode at this layer; callers still
// deal only in []byte. ttl establishes cacheBucket's expiry the first time
// any key is written (TTL is bucket-wide, not per key) — a later call passing
// a different ttl does not change it. Best-effort: failures trip the breaker
// and are otherwise ignored (the value is still cached in the per-pod
// mirror).
func (c *Client) SetBytes(ctx context.Context, key string, val []byte, ttl time.Duration) {
	if !c.available() || !c.ensureCache(ctx, ttl) {
		return
	}
	if _, err := c.b.Put(ctx, cacheBucket, key, base64.StdEncoding.EncodeToString(val)); err != nil {
		c.trip()
	}
}

// ── Timestamped set (member → unix seconds last renewed) ─────────────────────
//
// The fleet-wide warm-URL registry. A plain set would grow forever — a member
// added once is a member for good — so membership carries the time it was last
// renewed, and the reader takes only what is still inside its window. Stored as
// one JSON object under key in setsBucket. Read-modify-write, so two concurrent
// writers can race and one renewal can be lost; the registry is a self-healing
// hint (a missed renewal waits for the next request), never a correctness value.

// ZAdd sets each member's stamp to at, as ZADD sets a score. Best-effort.
func (c *Client) ZAdd(ctx context.Context, key string, at time.Time, members ...string) {
	if !c.available() || len(members) == 0 || !c.ensureSets(ctx) {
		return
	}
	cur, ok := c.readStamps(ctx, key)
	if !ok {
		return
	}
	ts := at.Unix()
	changed := false
	for _, m := range members {
		if prev, seen := cur[m]; !seen || prev != ts {
			cur[m] = ts
			changed = true
		}
	}
	if changed {
		c.writeStamps(ctx, key, cur)
	}
}

// ZSince returns the members renewed at or after since, or nil on miss/failure.
func (c *Client) ZSince(ctx context.Context, key string, since time.Time) []string {
	if !c.available() {
		return nil
	}
	cur, _ := c.readStamps(ctx, key)
	min := since.Unix()
	var out []string
	for m, ts := range cur {
		if ts >= min {
			out = append(out, m)
		}
	}
	sort.Strings(out)
	return out
}

// ZDropBefore forgets members not renewed since cutoff — the only thing that
// bounds the registry's size. Best-effort.
func (c *Client) ZDropBefore(ctx context.Context, key string, cutoff time.Time) {
	if !c.available() {
		return
	}
	cur, ok := c.readStamps(ctx, key)
	if !ok || len(cur) == 0 {
		return
	}
	min := cutoff.Unix()
	n := len(cur)
	for m, ts := range cur {
		if ts < min {
			delete(cur, m)
		}
	}
	if len(cur) != n {
		c.writeStamps(ctx, key, cur)
	}
}

// readStamps reads the registry under key. ok is false only on a transport
// failure; a missing key is an empty registry.
func (c *Client) readStamps(ctx context.Context, key string) (map[string]int64, bool) {
	out := map[string]int64{}
	if err := c.b.GetJSON(ctx, setsBucket, key, &out); err != nil {
		if errors.Is(err, bucket.ErrNotFound) {
			return map[string]int64{}, true
		}
		c.trip()
		return nil, false
	}
	return out, true
}

func (c *Client) writeStamps(ctx context.Context, key string, v map[string]int64) {
	if !c.ensureSets(ctx) {
		return
	}
	if _, err := c.b.PutJSON(ctx, setsBucket, key, v); err != nil {
		c.trip()
	}
}

// Ping checks reachability (used once at boot to log status). Returns an
// error when disabled or unreachable. A 404 for a key that cannot exist still
// proves the server round-tripped; any other error means it did not.
func (c *Client) Ping(ctx context.Context) error {
	if c == nil || c.b == nil {
		return errDisabled
	}
	_, err := c.b.Get(ctx, cacheBucket, "__ping__")
	if err == nil || errors.Is(err, bucket.ErrNotFound) {
		return nil
	}
	return err
}

// Close is a no-op: the client holds no persistent connection to release.
// Kept so callers written against a stateful client need no change.
func (c *Client) Close() {}
