package world

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// TestCachedJSONServesStaleAndRefreshes: on a lapsed TTL with a stale value
// present, cachedJSON must serve the stale value INSTANTLY (not block on the
// slow produce) and refresh the cache in the background.
func TestCachedJSONServesStaleAndRefreshes(t *testing.T) {
	s := NewServer()
	const key = "swr-stale"
	// Stale-but-not-fresh: Get misses, GetStale hits (fresh horizon already past).
	s.cache.Set(key, map[string]any{"v": "old"}, -time.Second, time.Minute)

	var calls int32
	release := make(chan struct{})
	produce := func(ctx context.Context) (any, error) {
		atomic.AddInt32(&calls, 1)
		<-release // hold the refresh open so the request path can't wait on it
		return map[string]any{"v": "new"}, nil
	}

	rec := httptest.NewRecorder()
	done := make(chan struct{})
	go func() {
		s.cachedJSON(rec, key, "cc", time.Minute, time.Minute, produce,
			func(w http.ResponseWriter, err error) { t.Errorf("onError fired with stale present: %v", err) })
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		close(release)
		t.Fatal("cachedJSON blocked on the background refresh instead of serving stale instantly")
	}
	if body := rec.Body.String(); !strings.Contains(body, `"old"`) {
		t.Fatalf("served body = %q, want the stale value", body)
	}

	// Let the background refresh finish; the fresh value must land in the cache.
	close(release)
	deadline := time.Now().Add(2 * time.Second)
	for {
		if v, ok := s.cache.Get(key); ok {
			if m, _ := v.(map[string]any); m != nil && m["v"] == "new" {
				break
			}
		}
		if time.Now().After(deadline) {
			t.Fatal("background refresh did not update the cache with the fresh value")
		}
		time.Sleep(5 * time.Millisecond)
	}
	if got := atomic.LoadInt32(&calls); got != 1 {
		t.Fatalf("produce called %d times, want 1", got)
	}
}

// TestCachedJSONColdMissSingleFlight: N concurrent COLD callers (no stale) must
// coalesce to ONE produce; every caller gets the leader's value.
func TestCachedJSONColdMissSingleFlight(t *testing.T) {
	s := NewServer()
	const key = "swr-cold"
	var calls int32
	produce := func(ctx context.Context) (any, error) {
		atomic.AddInt32(&calls, 1)
		time.Sleep(100 * time.Millisecond) // hold the leader so followers coalesce
		return map[string]any{"v": "fresh"}, nil
	}

	const n = 12
	bodies := make([]string, n)
	start := make(chan struct{})
	var wg sync.WaitGroup
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			rec := httptest.NewRecorder()
			s.cachedJSON(rec, key, "cc", time.Minute, time.Minute, produce,
				func(w http.ResponseWriter, err error) { t.Errorf("onError fired: %v", err) })
			bodies[i] = rec.Body.String()
		}(i)
	}
	close(start)
	wg.Wait()

	if got := atomic.LoadInt32(&calls); got != 1 {
		t.Fatalf("produce called %d times, want 1 (cold misses must single-flight)", got)
	}
	for i, b := range bodies {
		if !strings.Contains(b, `"fresh"`) {
			t.Fatalf("caller %d body = %q, want the coalesced fresh value", i, b)
		}
	}
}
