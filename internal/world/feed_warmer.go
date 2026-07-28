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
	feedWarmInterval = 5 * time.Minute
	// feedWarmParallel bounds concurrent HOSTS, not feeds. A host's feeds are
	// walked one at a time because that is the unit an upstream budgets by (see
	// hostGate) — fetching them in parallel just converts them into 429s.
	feedWarmParallel = 8
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

// warmFeeds refreshes every stale warm feed, HOST BY HOST: distinct hosts run in
// parallel (bounded), one host's feeds run one after another. Grouping is what
// keeps a rate-limited upstream from starving the rest — a Reddit feed waiting out
// its window would otherwise sit on a shared slot, and ten of them hold every
// slot there is. Only one cycle runs at a time: a paced host can outlast the
// interval, and overlapping cycles would just queue duplicate work behind it.
func (s *Server) warmFeeds(ctx context.Context) {
	if !s.warming.TryLock() {
		return // previous cycle still draining a slow host
	}
	defer s.warming.Unlock()

	urls := s.feeds.WarmURLs(ctx)
	byHost := make(map[string][]string, len(urls))
	stale := 0
	for _, u := range urls {
		if age, ok := s.feeds.Age(ctx, u); ok && age < feedWarmFreshWindow {
			continue // a peer (or an earlier cycle) already refreshed it
		}
		h := feedHost(u)
		byHost[h] = append(byHost[h], u)
		stale++
	}
	if stale == 0 {
		return
	}
	sem := make(chan struct{}, feedWarmParallel)
	var wg sync.WaitGroup
	var mu sync.Mutex
	refreshed := 0
	for _, group := range byHost {
		if ctx.Err() != nil {
			break
		}
		wg.Add(1)
		sem <- struct{}{}
		go func(group []string) {
			defer wg.Done()
			defer func() { <-sem }()
			for _, u := range group {
				if ctx.Err() != nil {
					return
				}
				if body, ok := s.fetchFeedBody(ctx, u); ok {
					s.feeds.Put(u, body)
					s.ingestFeedItems(u, body)
					mu.Lock()
					refreshed++
					mu.Unlock()
				}
			}
		}(group)
	}
	wg.Wait()
	if refreshed > 0 {
		logf("world-feeds: warmed %d/%d feeds across %d hosts", refreshed, stale, len(byHost))
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
