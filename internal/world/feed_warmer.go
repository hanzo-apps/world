package world

import (
	"context"
	"math/rand"
	"sync"
	"time"
)

// Background feed warmer: the reason news is INSTANT.
//
// On boot and every interval (jittered) it fetches every warm feed, write-throughs
// the body to the shared cache, and folds the items into the lake. So the
// on-demand endpoints (rss-proxy, feeds-batch) ALWAYS serve from the warm cache
// and never block a request on an upstream — stale-while-revalidate, with the
// revalidation done here in the background instead of on the request path.
//
// Cross-pod dedupe is implicit: a feed whose SHARED (hanzo-kv) copy is still
// fresh is skipped, so N pods don't all hammer the same upstream every cycle;
// whichever pod refreshes first, the rest read its result.
const (
	feedWarmInterval     = 5 * time.Minute
	feedWarmParallel     = 8
	feedWarmFetchTimeout = 10 * time.Second
	// feedWarmFreshWindow: skip refetch when a cached copy is younger than this
	// (slightly under the interval so each cycle still refreshes its own feeds).
	feedWarmFreshWindow = 4 * time.Minute
)

// startFeedWarmer launches the warmer loop until ctx is cancelled. It warms once
// shortly after boot (so a cold pod fills fast) then on the jittered interval.
func (s *Server) startFeedWarmer(ctx context.Context) {
	go func() {
		s.warmFeeds(ctx)
		for {
			select {
			case <-ctx.Done():
				return
			case <-time.After(jitter(feedWarmInterval)):
				s.warmFeeds(ctx)
			}
		}
	}()
}

// warmFeeds refreshes every warm feed in parallel (bounded), skipping any whose
// shared copy is still fresh. Each fetch is independently bounded; one slow
// upstream cannot hold up the rest.
func (s *Server) warmFeeds(ctx context.Context) {
	urls := s.feeds.WarmURLs(ctx)
	if len(urls) == 0 {
		return
	}
	sem := make(chan struct{}, feedWarmParallel)
	var wg sync.WaitGroup
	refreshed := 0
	var mu sync.Mutex
	for _, u := range urls {
		if ctx.Err() != nil {
			break
		}
		if age, ok := s.feeds.Age(ctx, u); ok && age < feedWarmFreshWindow {
			continue // a peer (or an earlier cycle) already refreshed it
		}
		wg.Add(1)
		sem <- struct{}{}
		go func(u string) {
			defer wg.Done()
			defer func() { <-sem }()
			fctx, cancel := context.WithTimeout(ctx, feedWarmFetchTimeout)
			defer cancel()
			if body, ok := s.fetchFeedBody(fctx, u); ok {
				s.feeds.Put(u, body)
				s.ingestFeedItems(u, body)
				mu.Lock()
				refreshed++
				mu.Unlock()
			}
		}(u)
	}
	wg.Wait()
	if refreshed > 0 {
		logf("world-feeds: warmed %d/%d feeds", refreshed, len(urls))
	}
}

// jitter returns d spread by ±20% so pods don't synchronize their warm cycles.
func jitter(d time.Duration) time.Duration {
	spread := int64(d) / 5 // 20%
	if spread <= 0 {
		return d
	}
	return d + time.Duration(rand.Int63n(2*spread)-spread)
}
