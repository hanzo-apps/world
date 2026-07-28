package world

import (
	"context"
	"net/http"
	"sync"
	"testing"
	"time"
)

// The header sets below are copied verbatim from what the hosts actually sent to
// a world pod, so the parser is tested against reality rather than a guess.
func TestStatedPause(t *testing.T) {
	for _, tc := range []struct {
		name string
		h    http.Header
		want time.Duration
	}{
		{"no budget published: the common feed, never delayed", http.Header{}, 0},
		{"nil headers (the request never got a response)", nil, 0},
		{
			// Observed on a 200 from www.reddit.com/r/worldnews/.rss — the budget is
			// spent by the very request that succeeded, so the pause applies even
			// though nothing failed.
			"reddit 200, budget spent",
			http.Header{"X-Ratelimit-Used": {"1"}, "X-Ratelimit-Remaining": {"0.0"}, "X-Ratelimit-Reset": {"57"}},
			58 * time.Second,
		},
		{
			"reddit with budget left: no wait, whatever the reset clock says",
			http.Header{"X-Ratelimit-Remaining": {"4.0"}, "X-Ratelimit-Reset": {"57"}},
			0,
		},
		{"retry-after wins over the ratelimit family", http.Header{
			"Retry-After": {"30"}, "X-Ratelimit-Remaining": {"0.0"}, "X-Ratelimit-Reset": {"57"},
		}, 30 * time.Second},
		{"an absurd pause is capped, not obeyed", http.Header{"Retry-After": {"86400"}}, maxHostWait},
		{"retry-after as an HTTP date is not mistaken for seconds",
			http.Header{"Retry-After": {"Wed, 21 Oct 2026 07:28:00 GMT"}}, 0},
	} {
		if got := statedPause(tc.h); got != tc.want {
			t.Errorf("%s: statedPause = %v, want %v", tc.name, got, tc.want)
		}
	}
}

// A host that states a pause must hold the next request for it; a host that
// states nothing must not be delayed at all. This is the whole point of the gate:
// ten Reddit feeds warmed together used to become nine 429s.
func TestHostGatePacesOnlyWhatTheHostAsksFor(t *testing.T) {
	g := newHostGate()
	paced := http.Header{"X-Ratelimit-Remaining": {"0.0"}, "X-Ratelimit-Reset": {"0.2"}}

	rel, ok := g.enter(context.Background(), "www.reddit.com")
	if !ok {
		t.Fatal("first enter must not block")
	}
	rel(paced) // 0.2s + 1s slack

	start := time.Now()
	rel, ok = g.enter(context.Background(), "www.reddit.com")
	if !ok {
		t.Fatal("second enter must succeed")
	}
	rel(nil)
	if waited := time.Since(start); waited < time.Second {
		t.Errorf("second fetch waited %v, want >= 1s (the pause reddit stated)", waited)
	}

	// A different host shares no budget and is not made to wait behind reddit.
	start = time.Now()
	rel, ok = g.enter(context.Background(), "www.federalreserve.gov")
	if !ok {
		t.Fatal("unrelated host must not block")
	}
	rel(http.Header{})
	if waited := time.Since(start); waited > 200*time.Millisecond {
		t.Errorf("unrelated host waited %v, want ~0", waited)
	}
}

// Queueing must respect the caller's deadline: a user request hands over a short
// ctx and degrades to the cached copy instead of hanging out a 57s window.
func TestHostGateGivesUpOnDeadline(t *testing.T) {
	g := newHostGate()
	rel, ok := g.enter(context.Background(), "www.reddit.com")
	if !ok {
		t.Fatal("first enter must not block")
	}
	rel(http.Header{"Retry-After": {"60"}})

	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	if _, ok := g.enter(ctx, "www.reddit.com"); ok {
		t.Fatal("enter must report failure when ctx expires while queueing")
	}
}

// Concurrent fetchers of one host must serialize — the gate is what turns the
// warmer's parallel burst into a queue.
func TestHostGateAdmitsOneAtATime(t *testing.T) {
	g := newHostGate()
	var mu sync.Mutex
	inFlight, maxSeen := 0, 0
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			rel, ok := g.enter(context.Background(), "www.reddit.com")
			if !ok {
				t.Error("enter failed")
				return
			}
			mu.Lock()
			inFlight++
			if inFlight > maxSeen {
				maxSeen = inFlight
			}
			mu.Unlock()
			time.Sleep(5 * time.Millisecond)
			mu.Lock()
			inFlight--
			mu.Unlock()
			rel(http.Header{})
		}()
	}
	wg.Wait()
	if maxSeen != 1 {
		t.Errorf("saw %d concurrent fetches of one host, want 1", maxSeen)
	}
}
