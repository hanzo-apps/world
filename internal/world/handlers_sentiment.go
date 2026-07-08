package world

import (
	"context"
	"math"
	"net/http"
	"sync"
	"time"
)

// handlers_sentiment.go — /v1/world/sentiment.
//
// Realtime news-sentiment index built from GDELT tone (the same upstream the
// gdelt-doc/gdelt-geo routes use). GDELT hard-limits callers to one request per
// ~5 seconds and penalizes bursts, so a synchronous fan-out is impossible. The
// design decouples the slow producer from the fast API through the shared cache:
//
//   - The HTTP handler NEVER calls GDELT. It serves the last computed value
//     (fresh or stale) instantly, and — on a miss/expiry — kicks a single
//     background refresh, returning a clean "warming" body until data lands.
//   - The background refresh walks the GDELT queries SEQUENTIALLY, ~5.2s apart,
//     and aborts early if the upstream is blocking us, so a rate-limited cycle
//     costs seconds, not a minute. Whatever succeeds is cached; missing pieces
//     are null and fill in on the next cycle. Cache: 2m fresh / 30m stale.
//
// Output: a global sentiment index (0-100), per-topic and per-region breakdowns,
// each with a 24h tone sparkline and a velocity (rate of tone change).

const (
	gdeltPace       = 5200 * time.Millisecond // > GDELT's 1-req/5s limit
	sentimentTTL    = 2 * time.Minute
	sentimentStale  = 30 * time.Minute
	sentimentCC     = "public, max-age=120, s-maxage=120, stale-while-revalidate=600"
	sentimentKey    = "sentiment:v1"
	sentimentMinGap = 20 * time.Second // floor between background refresh attempts
)

type gdeltQuery struct{ id, name, query string }

// Topic queries — broad keyword unions, each one GDELT timelinetone call.
var sentimentTopics = []gdeltQuery{
	{"markets", "Markets", `(economy OR inflation OR "interest rates" OR stocks OR markets OR recession)`},
	{"conflict", "Conflict", `(war OR conflict OR military OR attack OR ceasefire OR troops)`},
	{"energy", "Energy", `(oil OR "natural gas" OR OPEC OR energy OR electricity OR pipeline)`},
	{"tech", "Tech", `("artificial intelligence" OR technology OR semiconductor OR software OR chips)`},
}

// Region queries — a broad civic-news union scoped by GDELT FIPS sourcecountry.
var sentimentRegions = []gdeltQuery{
	{"US", "United States", `(market OR economy OR government OR crisis OR policy) sourcecountry:US`},
	{"UK", "United Kingdom", `(market OR economy OR government OR crisis OR policy) sourcecountry:UK`},
	{"GM", "Germany", `(market OR economy OR government OR crisis OR policy) sourcecountry:GM`},
	{"CH", "China", `(market OR economy OR government OR crisis OR policy) sourcecountry:CH`},
	{"IN", "India", `(market OR economy OR government OR crisis OR policy) sourcecountry:IN`},
	{"BR", "Brazil", `(market OR economy OR government OR crisis OR policy) sourcecountry:BR`},
}

// sentimentGuard serializes background refreshes: one at a time, min-gap apart.
var sentimentGuard struct {
	mu      sync.Mutex
	running bool
	last    time.Time
}

// handleSentiment serves the cached sentiment payload and (on miss/expiry) kicks
// the single background refresh. It never blocks on GDELT.
func (s *Server) handleSentiment(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") {
		return
	}
	if v, ok := s.cache.Get(sentimentKey); ok {
		writeJSON(w, http.StatusOK, sentimentCC, v)
		return
	}
	s.triggerSentimentRefresh()
	if v, ok := s.cache.GetStale(sentimentKey); ok {
		writeJSON(w, http.StatusOK, sentimentCC, v)
		return
	}
	writeJSON(w, http.StatusOK, sentimentCC, sentimentWarming())
}

// triggerSentimentRefresh starts a background refresh unless one is running or
// the last attempt was too recent.
func (s *Server) triggerSentimentRefresh() {
	sentimentGuard.mu.Lock()
	if sentimentGuard.running || (!sentimentGuard.last.IsZero() && time.Since(sentimentGuard.last) < sentimentMinGap) {
		sentimentGuard.mu.Unlock()
		return
	}
	sentimentGuard.running = true
	sentimentGuard.last = time.Now()
	sentimentGuard.mu.Unlock()

	go func() {
		defer func() {
			_ = recover()
			sentimentGuard.mu.Lock()
			sentimentGuard.running = false
			sentimentGuard.mu.Unlock()
		}()
		ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
		defer cancel()
		if v, ok := s.computeSentiment(ctx); ok {
			s.cache.Set(sentimentKey, v, sentimentTTL, sentimentStale)
		}
	}()
}

// computeSentiment walks the topic + region GDELT queries sequentially with
// pacing, then assembles the index. ok=false only on a total blackout (nothing
// fetched), so a fully-degraded payload is never cached over good stale data.
func (s *Server) computeSentiment(ctx context.Context) (map[string]any, bool) {
	jobs := append(append([]gdeltQuery{}, sentimentTopics...), sentimentRegions...)
	series := make(map[string][]float64, len(jobs))
	consecFail := 0
	for i, job := range jobs {
		if ctx.Err() != nil {
			break
		}
		if vals, ok := s.gdeltToneSeries(ctx, job.query); ok {
			series[job.id] = vals
			consecFail = 0
		} else if consecFail++; consecFail >= 2 {
			break // upstream is blocking us — stop burning the cycle
		}
		if i < len(jobs)-1 {
			select {
			case <-ctx.Done():
			case <-time.After(gdeltPace):
			}
		}
	}
	if len(series) == 0 {
		return sentimentWarming(), false
	}

	topics := map[string]any{}
	var topicSeries [][]float64
	for _, tq := range sentimentTopics {
		reading := toneReading(series[tq.id])
		topics[tq.id] = reading
		if sv := series[tq.id]; len(sv) > 0 {
			topicSeries = append(topicSeries, sv)
		}
	}

	regions := make([]map[string]any, 0, len(sentimentRegions))
	for _, rq := range sentimentRegions {
		entry := map[string]any{"code": rq.id, "name": rq.name}
		for k, v := range toneReading(series[rq.id]) {
			entry[k] = v
		}
		regions = append(regions, entry)
	}

	global := globalReading(topicSeries)

	return map[string]any{
		"timestamp": nowISO(),
		"global":    global,
		"topics":    topics,
		"regions":   regions,
		"source":    "gdelt",
		"method":    "GDELT DOC 2.0 timelinetone (24h avg article tone); index = clamp(50 + tone·5, 0, 100)",
		"coverage":  map[string]any{"queried": len(sentimentTopics) + len(sentimentRegions), "resolved": len(series)},
	}, true
}

// gdeltToneSeries fetches a timelinetone series for one query. ok=false on any
// non-JSON / rate-limited / empty response (the caller degrades to null).
func (s *Server) gdeltToneSeries(ctx context.Context, query string) ([]float64, bool) {
	u := "https://api.gdeltproject.org/api/v2/doc/doc?query=" + urlQueryEscape(query) +
		"&mode=timelinetone&timespan=24h&format=json"
	var raw struct {
		Timeline []struct {
			Data []struct {
				Value float64 `json:"value"`
			} `json:"data"`
		} `json:"timeline"`
	}
	if err := s.getJSON(ctx, u, map[string]string{"User-Agent": browserUA}, &raw); err != nil {
		return nil, false
	}
	if len(raw.Timeline) == 0 || len(raw.Timeline[0].Data) == 0 {
		return nil, false
	}
	vals := make([]float64, len(raw.Timeline[0].Data))
	for i, d := range raw.Timeline[0].Data {
		vals[i] = d.Value
	}
	return vals, true
}

// ── assembly helpers ─────────────────────────────────────────────────────────

// toneReading turns a 24h tone series into {tone,index,label,velocity,sparkline}.
func toneReading(series []float64) map[string]any {
	if len(series) == 0 {
		return map[string]any{"tone": nil, "index": nil, "label": "Unknown", "velocity": nil, "sparkline": []float64{}}
	}
	cur := series[len(series)-1]
	idx := toneToIndex(cur)
	return map[string]any{
		"tone":      round2s(cur),
		"index":     idx,
		"label":     sentimentLabel(idx),
		"velocity":  round2s(seriesVelocity(series)),
		"sparkline": downsample(series, 32),
	}
}

// globalReading is the elementwise mean of the topic series (tail-aligned), i.e.
// a broad-news sentiment index that is internally consistent with the topics.
func globalReading(topicSeries [][]float64) map[string]any {
	if len(topicSeries) == 0 {
		return toneReading(nil)
	}
	minLen := len(topicSeries[0])
	for _, s := range topicSeries {
		if len(s) < minLen {
			minLen = len(s)
		}
	}
	if minLen == 0 {
		return toneReading(nil)
	}
	mean := make([]float64, minLen)
	for _, s := range topicSeries {
		off := len(s) - minLen
		for i := 0; i < minLen; i++ {
			mean[i] += s[off+i]
		}
	}
	for i := range mean {
		mean[i] /= float64(len(topicSeries))
	}
	return toneReading(mean)
}

// toneToIndex maps GDELT average tone (roughly −10..+10, typically −5..+2) to a
// 0-100 sentiment index: 0 tone → 50 (neutral), +10 → 100, −10 → 0.
func toneToIndex(tone float64) int {
	return int(math.Round(clampF(50+tone*5, 0, 100)))
}

func sentimentLabel(index int) string {
	switch {
	case index >= 60:
		return "Positive"
	case index >= 53:
		return "Mildly positive"
	case index > 47:
		return "Neutral"
	case index >= 40:
		return "Cautious"
	default:
		return "Negative"
	}
}

// seriesVelocity is the tone change of the recent window vs the prior window
// (each ~a quarter of the 24h series) — a smoothed rate of change.
func seriesVelocity(vals []float64) float64 {
	n := len(vals)
	if n < 4 {
		return 0
	}
	q := n / 4
	if q < 1 {
		q = 1
	}
	recent := meanOf(vals[n-q:])
	earlier := meanOf(vals[n-2*q : n-q])
	return recent - earlier
}

func meanOf(xs []float64) float64 {
	if len(xs) == 0 {
		return 0
	}
	var s float64
	for _, x := range xs {
		s += x
	}
	return s / float64(len(xs))
}

// downsample reduces vals to at most n points by even striding (keeps the last).
func downsample(vals []float64, n int) []float64 {
	if len(vals) <= n {
		out := make([]float64, len(vals))
		for i, v := range vals {
			out[i] = round2s(v)
		}
		return out
	}
	out := make([]float64, 0, n)
	step := float64(len(vals)-1) / float64(n-1)
	for i := 0; i < n; i++ {
		idx := int(math.Round(float64(i) * step))
		if idx >= len(vals) {
			idx = len(vals) - 1
		}
		out = append(out, round2s(vals[idx]))
	}
	return out
}

// sentimentWarming is the clean placeholder served until the first refresh lands.
func sentimentWarming() map[string]any {
	topics := map[string]any{}
	for _, tq := range sentimentTopics {
		topics[tq.id] = toneReading(nil)
	}
	regions := make([]map[string]any, 0, len(sentimentRegions))
	for _, rq := range sentimentRegions {
		entry := map[string]any{"code": rq.id, "name": rq.name}
		for k, v := range toneReading(nil) {
			entry[k] = v
		}
		regions = append(regions, entry)
	}
	return map[string]any{
		"timestamp": nowISO(),
		"global":    toneReading(nil),
		"topics":    topics,
		"regions":   regions,
		"source":    "gdelt",
		"status":    "warming",
		"method":    "GDELT DOC 2.0 timelinetone (24h avg article tone); index = clamp(50 + tone·5, 0, 100)",
	}
}
