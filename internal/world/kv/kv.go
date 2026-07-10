// Package kv is world's thin, graceful-degrade client for hanzo-kv — the shared
// Valkey/Redis hot cache (k8s Service hanzo-kv:6379, ns hanzo). It exists so the
// feed/response warm cache is SHARED across all world pods and survives a pod
// restart: warming once benefits the whole fleet, and a restarted pod reads a
// still-warm cache instead of cold-starting.
//
// Every method degrades cleanly — a nil/unconfigured client, an unreachable
// server, or any transport error yields a clean miss / no-op, never a blocking
// call or an error the caller must handle. A tiny circuit breaker parks a
// downed server for a cooldown so the hot path is not repeatedly stalled dialing
// a dead host. The queryable data lake lives in SQLite (package store); this is
// only the speed layer in front of feeds.
package kv

import (
	"context"
	"sync/atomic"
	"time"

	"github.com/redis/go-redis/v9"
)

// breakerCooldown parks a failing server: after an error, ops short-circuit to
// "miss" for this long instead of re-dialing on every request.
const breakerCooldown = 15 * time.Second

// Client wraps a go-redis client. A zero/disabled Client (r == nil) is valid and
// behaves as a permanent clean miss, so local dev and CI need no Redis.
type Client struct {
	r         *redis.Client
	downUntil atomic.Int64 // unix-nano; server parked until then
}

// Open builds a client for addr (e.g. "hanzo-kv:6379"). An empty addr returns a
// disabled client (pure miss) — the correct behavior for environments without
// hanzo-kv. Timeouts are short so a slow/dead server degrades fast; retries are
// disabled because we fail over to the embedded/in-mem cache, not by retrying.
func Open(addr, password string) *Client {
	if addr == "" {
		return &Client{}
	}
	return &Client{r: redis.NewClient(&redis.Options{
		Addr:         addr,
		Password:     password,
		DialTimeout:  2 * time.Second,
		ReadTimeout:  time.Second,
		WriteTimeout: time.Second,
		PoolSize:     8,
		MaxRetries:   -1, // fail fast; degrade rather than retry
	})}
}

// Enabled reports whether a server is configured (not whether it is currently
// reachable).
func (c *Client) Enabled() bool { return c != nil && c.r != nil }

func (c *Client) available() bool {
	if c == nil || c.r == nil {
		return false
	}
	return time.Now().UnixNano() >= c.downUntil.Load()
}

// trip parks the server for the cooldown after a transport failure.
func (c *Client) trip() { c.downUntil.Store(time.Now().Add(breakerCooldown).UnixNano()) }

// GetBytes returns the value for key, or (nil,false) on miss/failure. A real
// cache miss (redis.Nil) does not trip the breaker; a transport error does.
func (c *Client) GetBytes(ctx context.Context, key string) ([]byte, bool) {
	if !c.available() {
		return nil, false
	}
	b, err := c.r.Get(ctx, key).Bytes()
	if err == redis.Nil {
		return nil, false
	}
	if err != nil {
		c.trip()
		return nil, false
	}
	return b, true
}

// SetBytes writes key=val with a TTL. Best-effort: failures trip the breaker and
// are otherwise ignored (the value is still cached in the per-pod mirror).
func (c *Client) SetBytes(ctx context.Context, key string, val []byte, ttl time.Duration) {
	if !c.available() {
		return
	}
	if err := c.r.Set(ctx, key, val, ttl).Err(); err != nil {
		c.trip()
	}
}

// SAdd adds members to a set (the fleet-wide warm-URL registry). Best-effort.
func (c *Client) SAdd(ctx context.Context, key string, members ...string) {
	if !c.available() || len(members) == 0 {
		return
	}
	vals := make([]any, len(members))
	for i, m := range members {
		vals[i] = m
	}
	if err := c.r.SAdd(ctx, key, vals...).Err(); err != nil {
		c.trip()
	}
}

// SMembers returns the set members, or nil on miss/failure.
func (c *Client) SMembers(ctx context.Context, key string) []string {
	if !c.available() {
		return nil
	}
	v, err := c.r.SMembers(ctx, key).Result()
	if err != nil {
		c.trip()
		return nil
	}
	return v
}

// Ping checks reachability (used once at boot to log status). Returns an error
// when disabled or unreachable.
func (c *Client) Ping(ctx context.Context) error {
	if c == nil || c.r == nil {
		return redis.ErrClosed
	}
	return c.r.Ping(ctx).Err()
}

// Close releases the connection pool. Safe on a disabled client.
func (c *Client) Close() {
	if c != nil && c.r != nil {
		_ = c.r.Close()
	}
}
