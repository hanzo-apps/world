package world

import (
	"context"
	"time"
)

// Boot cache warmer: keeps the hottest GDELT-backed cache keys warm so the
// request path serves a fresh hit instead of blocking ~10s on a cold GDELT
// fetch when a key's 5m TTL lapses.
//
// The hot keys are the ones the SPA hits on every load: the analyst grounding
// snapshot (gdelt-doc query=world) and the protests panel (gdelt-geo default).
// Each pod warms its OWN in-memory cache (unlike the shared hanzo-kv feed cache,
// there is no cross-pod copy to reuse), on boot and every ~4min — just under the
// TTL, so a key is refreshed before it can expire. GDELT rate-limits callers to
// one request per ~5s, so the specs are walked sequentially with gdeltPace gaps.
const cacheWarmInterval = 4 * time.Minute

// warmSpec is one hot cache key. warm re-produces its value under the exact key
// the handler reads (via the shared key/produce helpers in handlers_news.go).
type warmSpec struct {
	name string
	warm func(ctx context.Context) error
}

// warmSpecs is the table of hot keys, each wired to the same produce path and
// key strings its handler uses so warmer and handler can never drift.
func (s *Server) warmSpecs() []warmSpec {
	return []warmSpec{
		{"gdelt-doc query=world", func(ctx context.Context) error {
			v, err := s.produceGDELTDoc(ctx, "world", "72h", 8)
			if err != nil {
				return err
			}
			s.cache.Set(gdeltDocKey("world", 8, "72h"), v, gdeltTTL, gdeltStale)
			return nil
		}},
		{"gdelt-geo query=protest", func(ctx context.Context) error {
			key := gdeltGeoKey("protest", "geojson", 250, "7d")
			_, err := s.fetchAndCache(ctx, key, gdeltGeoURL("protest", "geojson", 250, "7d"), nil, gdeltTTL, gdeltStale)
			return err
		}},
	}
}

// startCacheWarmer launches the warmer loop until ctx is cancelled: it warms
// once shortly after boot then on the jittered interval.
func (s *Server) startCacheWarmer(ctx context.Context) {
	go func() {
		s.warmCaches(ctx)
		for {
			select {
			case <-ctx.Done():
				return
			case <-time.After(jitter(cacheWarmInterval)):
				s.warmCaches(ctx)
			}
		}
	}()
}

// warmCaches (re)produces every hot key sequentially, each independently
// bounded, with GDELT pacing between them. A failure is logged and skipped; the
// next cycle retries and the stale value keeps serving in the meantime.
func (s *Server) warmCaches(ctx context.Context) {
	specs := s.warmSpecs()
	for i, spec := range specs {
		if ctx.Err() != nil {
			return
		}
		wctx, cancel := context.WithTimeout(ctx, 24*time.Second)
		err := spec.warm(wctx)
		cancel()
		if err != nil {
			logf("world-warm: %s failed: %v", spec.name, err)
		}
		if i < len(specs)-1 {
			select {
			case <-ctx.Done():
				return
			case <-time.After(gdeltPace):
			}
		}
	}
}
