package world

import (
	"context"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

// hostGate paces outbound feed fetches by what the upstream host itself asks for.
//
// Feed hosts budget by IP, not by feed. Reddit answers EVERY RSS request with the
// budget it just spent — `x-ratelimit-used: 1, x-ratelimit-remaining: 0.0,
// x-ratelimit-reset: 57` — i.e. one anonymous request per window per IP, and it
// 429s everything else in that window. The whole fleet shares one egress IP, so a
// warm set holding ten curated Reddit feeds plus one per user topic spends that
// budget many times over every cycle and the panels serve empty.
//
// So: one request in flight per host, and the next one waits out the pause the
// last response named. Nothing is configured per host — a host that publishes no
// budget is never delayed, which is every other feed in the catalog. The gate
// lives under fetchFeedBody, the one live-fetch path, so the background warmer and
// the rss-proxy fall-through draw on the same budget instead of racing each other
// for it.
type hostGate struct {
	mu    sync.Mutex
	hosts map[string]*hostTurn
}

// hostTurn is one host's queue: the mutex admits a single request at a time, next
// is the earliest moment the host said it would accept another.
type hostTurn struct {
	sync.Mutex
	next time.Time
}

// maxHostWait caps how long a host can hold the gate, so an absurd (or hostile)
// Retry-After cannot stall a warm cycle indefinitely.
const maxHostWait = 90 * time.Second

func newHostGate() *hostGate { return &hostGate{hosts: map[string]*hostTurn{}} }

// enter takes host's turn, blocking until the pause its last response asked for
// has elapsed. It returns a release that records the next pause from THIS
// response's headers and hands the turn on — call it exactly once, with the
// headers of the response (nil when the request never produced one). ok is false
// only when ctx expired while queueing, in which case release is nil and no turn
// was taken; the caller degrades exactly as it would on a failed fetch.
func (g *hostGate) enter(ctx context.Context, host string) (release func(http.Header), ok bool) {
	g.mu.Lock()
	t := g.hosts[host]
	if t == nil {
		t = &hostTurn{}
		g.hosts[host] = t
	}
	g.mu.Unlock()

	t.Lock()
	if d := time.Until(t.next); d > 0 {
		timer := time.NewTimer(d)
		defer timer.Stop()
		select {
		case <-ctx.Done():
			t.Unlock()
			return nil, false
		case <-timer.C:
		}
	}
	return func(h http.Header) {
		t.next = time.Now().Add(statedPause(h))
		t.Unlock()
	}, true
}

// statedPause reads how long a host asked us to wait before the next request:
// Retry-After (the standard, sent with a 429) or the x-ratelimit-* family (which
// Reddit sends on every response, including the 200 that spent the budget). Zero
// when the host published nothing or still has budget left — the common case, and
// the reason this costs untouched feeds nothing.
func statedPause(h http.Header) time.Duration {
	if h == nil {
		return 0
	}
	if d, ok := seconds(h.Get("Retry-After")); ok {
		return min(d, maxHostWait)
	}
	// A remaining count of 1 or more means the next request is free, whatever the
	// reset clock says. Reddit reports this as a float ("0.0").
	if n, ok := seconds(h.Get("X-Ratelimit-Remaining")); ok && n >= time.Second {
		return 0
	}
	if d, ok := seconds(h.Get("X-Ratelimit-Reset")); ok {
		return min(d+time.Second, maxHostWait) // a second of slack past the window
	}
	return 0
}

// seconds parses a header value as a (possibly fractional) count of seconds. It
// reports false for absent, unparseable or non-positive values — including the
// HTTP-date form of Retry-After, which feed hosts do not use and which would be
// misread as a duration.
func seconds(v string) (time.Duration, bool) {
	f, err := strconv.ParseFloat(strings.TrimSpace(v), 64)
	if err != nil || f <= 0 {
		return 0, false
	}
	return time.Duration(f * float64(time.Second)), true
}
