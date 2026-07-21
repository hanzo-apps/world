package world

import (
	"context"
	"math"
	"net/http"
	"sort"
	"sync"
	"time"

	"github.com/hanzoai/world/internal/world/markethours"
)

// Sector-rotation scanner. Detects where capital is rotating between market
// themes using a Relative Rotation Graph (RRG) — the canonical tool for reading
// leadership shifts. Each theme is scored on two axes measured against a
// benchmark (SPY):
//
//   - RS-Ratio    relative-strength LEVEL vs benchmark. >100 leads, <100 lags.
//   - RS-Momentum rate of change of that relative strength. >100 improving,
//     <100 weakening.
//
// The two axes give four quadrants that name a theme's place in the rotation
// cycle:
//
//	Leading    RS>100  Mom>100   outperforming and still accelerating
//	Weakening  RS>100  Mom<100   outperforming but momentum rolling over (top)
//	Lagging    RS<100  Mom<100   underperforming and still falling
//	Improving  RS<100  Mom>100   underperforming but momentum turning up (base)
//
// The clockwise Leading→Weakening→Lagging→Improving cycle is the rotation the
// panel visualizes: leadership distributing out of a hot theme (Weakening) while
// capital accumulates an out-of-favour one (Improving). The RS-Ratio / RS-Momentum
// pair is a faithful open approximation of JdK RS-Ratio / RS-Momentum (de
// Kempenaer); the proprietary constants are not public, so the values are
// z-normalised around 100 — the quadrant SIGN is scale-invariant, the spread is
// cosmetic.

const (
	rotationBenchmark = "SPY"
	rotationRange     = "range=6mo&interval=1d"
	rotationParallel  = 10
	rotationFetchTO   = 8 * time.Second
	rrgSpread         = 2.5 // z-score → RRG-unit spread around 100 (cosmetic)
	rrgLevelWindow    = 21  // ~1mo trailing window for the RS-Ratio z-score
	rrgMomLookback    = 5   // ~1wk change used for RS-Momentum
	rrgTailWeeks      = 8   // weekly-sampled trail points emitted per theme
)

// rotationMember is one symbol inside a theme basket.
type rotationMember struct{ symbol, name string }

// rotationTheme is a named basket of symbols priced as one equal-weight synthetic.
type rotationTheme struct {
	key, label, group string
	lead              bool // headline thesis themes drive the top-line signals
	members           []rotationMember
}

// The universe. Themes are ordered distribution-side first (AI/semis, the
// incumbents), then the accumulation-side energy complex (the buildout's power
// bill), then the broad GICS sectors as rotation context. SPY is the benchmark
// and is fetched separately.
var rotationThemes = []rotationTheme{
	{"ai_semis", "AI · Semis", "AI buildout", true, []rotationMember{
		{"SMH", "VanEck Semis"}, {"SOXX", "iShares Semis"}, {"NVDA", "Nvidia"},
		{"AMD", "AMD"}, {"AVGO", "Broadcom"}, {"SMCI", "Super Micro"},
	}},
	{"hyperscalers", "Hyperscalers", "AI buildout", true, []rotationMember{
		{"XLK", "Tech sector"}, {"MSFT", "Microsoft"}, {"GOOGL", "Alphabet"},
		{"META", "Meta"}, {"AMZN", "Amazon"},
	}},
	{"energy", "Energy", "Energy complex", true, []rotationMember{
		{"XLE", "Energy sector"}, {"XOP", "Oil & gas E&P"},
	}},
	{"natgas", "Natural gas", "Energy complex", true, []rotationMember{
		{"UNG", "Natgas fund"}, {"FCG", "Natgas producers"}, {"NG=F", "Henry Hub"},
	}},
	{"uranium", "Uranium", "Energy complex", true, []rotationMember{
		{"URA", "Uranium miners"}, {"URNM", "Uranium mining"}, {"CCJ", "Cameco"},
	}},
	{"nuclear_power", "Nuclear power", "Energy complex", true, []rotationMember{
		{"VST", "Vistra"}, {"CEG", "Constellation"}, {"NRG", "NRG Energy"}, {"XLU", "Utilities"},
	}},
	{"financials", "Financials", "Sectors", false, []rotationMember{{"XLF", "Financials"}}},
	{"health", "Health care", "Sectors", false, []rotationMember{{"XLV", "Health care"}}},
	{"industrials", "Industrials", "Sectors", false, []rotationMember{{"XLI", "Industrials"}}},
	{"staples", "Staples", "Sectors", false, []rotationMember{{"XLP", "Staples"}}},
	{"discretionary", "Discretionary", "Sectors", false, []rotationMember{{"XLY", "Discretionary"}}},
	{"materials", "Materials", "Sectors", false, []rotationMember{{"XLB", "Materials"}}},
	{"realestate", "Real estate", "Sectors", false, []rotationMember{{"XLRE", "Real estate"}}},
	{"communications", "Communications", "Sectors", false, []rotationMember{{"XLC", "Communications"}}},
}

// rotationUniverse is every distinct symbol to fetch (themes ∪ benchmark), deduped.
func rotationUniverse() []string {
	seen := map[string]bool{rotationBenchmark: true}
	out := []string{rotationBenchmark}
	for _, th := range rotationThemes {
		for _, m := range th.members {
			if !seen[m.symbol] {
				seen[m.symbol] = true
				out = append(out, m.symbol)
			}
		}
	}
	return out
}

// handleRotation serves the rotation scanner. Everything is computed server-side
// (one shared cache warms every viewer, one origin hits Yahoo) and degrades to a
// clean "unavailable" 200 — never a 5xx — when upstream data is thin.
func (s *Server) handleRotation(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") || methodNotGet(w, r) {
		return
	}
	s.cachedJSON(w, "rotation:v1",
		"public, max-age=900, s-maxage=900, stale-while-revalidate=1800",
		15*time.Minute, 30*time.Minute,
		func(ctx context.Context) (any, error) {
			return s.computeRotation(ctx)
		},
		func(w http.ResponseWriter, err error) {
			writeJSON(w, http.StatusOK, "", map[string]any{
				"asOf": nowISO(), "benchmark": rotationBenchmark, "unavailable": true,
				"themes": []any{}, "signals": []any{},
				"narrative": "Rotation data temporarily unavailable.",
			})
		})
}

// computeRotation fetches the universe, builds each theme's RRG track and the
// thesis signals. Pure math lives in the helpers below so it unit-tests without
// the network.
func (s *Server) computeRotation(ctx context.Context) (any, error) {
	closes := s.fetchCloses(ctx, rotationUniverse())
	bench := closes[rotationBenchmark]
	if len(bench) < rrgLevelWindow+rrgMomLookback+1 {
		return nil, errUnavailable
	}

	themes := make([]map[string]any, 0, len(rotationThemes))
	byKey := map[string]*rrgPoint{}
	for _, th := range rotationThemes {
		members := make([][]float64, 0, len(th.members))
		memViews := make([]map[string]any, 0, len(th.members))
		for _, m := range th.members {
			series := closes[m.symbol]
			if len(series) < rrgLevelWindow+rrgMomLookback+1 {
				continue
			}
			members = append(members, series)
			if p, ok := rrgLatest(relSeries(series, bench)); ok {
				memViews = append(memViews, map[string]any{
					"symbol": m.symbol, "name": m.name,
					"rsRatio": round2s(p.ratio), "rsMomentum": round2s(p.mom),
					"quadrant": p.quadrant(), "ret21": round2s(pctReturn(series, 21)),
				})
			}
		}
		if len(members) == 0 {
			continue
		}
		synth := basketSynthetic(members)
		rsr, rsm := rrgSeries(relSeries(synth, bench))
		if len(rsr) == 0 {
			continue
		}
		p := rrgPoint{ratio: rsr[len(rsr)-1], mom: rsm[len(rsm)-1]}
		byKey[th.key] = &p
		themes = append(themes, map[string]any{
			"key": th.key, "label": th.label, "group": th.group, "lead": th.lead,
			"rsRatio": round2s(p.ratio), "rsMomentum": round2s(p.mom),
			"quadrant": p.quadrant(), "heading": round2s(rrgHeading(rsr, rsm)),
			"ret5": round2s(pctReturn(synth, 5)), "ret21": round2s(pctReturn(synth, 21)),
			"ret63": round2s(pctReturn(synth, 63)),
			"tail":  rrgTail(rsr, rsm),
			"members": func() []map[string]any {
				sort.SliceStable(memViews, func(i, j int) bool {
					return asFloat(memViews[i]["rsMomentum"]) > asFloat(memViews[j]["rsMomentum"])
				})
				return memViews
			}(),
		})
	}

	// Rank themes for the leaderboard: strongest forward momentum first.
	sort.SliceStable(themes, func(i, j int) bool {
		return asFloat(themes[i]["rsMomentum"]) > asFloat(themes[j]["rsMomentum"])
	})

	signals, narrative := rotationSignals(byKey)
	return map[string]any{
		"asOf": nowISO(), "benchmark": rotationBenchmark, "window": "6mo",
		"marketSession": markethours.CurrentSession(time.Now()).String(),
		"themes":        themes, "signals": signals, "narrative": narrative,
	}, nil
}

// fetchCloses pulls 6-month daily closes for every symbol in bounded parallel.
// The whole rotation result is cached + single-flighted one layer up, so this
// runs at most once per cache window regardless of viewer count. A thin/failed
// series is simply absent from the map; callers guard on length.
func (s *Server) fetchCloses(ctx context.Context, symbols []string) map[string][]float64 {
	out := make(map[string][]float64, len(symbols))
	var mu sync.Mutex
	sem := make(chan struct{}, rotationParallel)
	var wg sync.WaitGroup
	for _, sym := range symbols {
		sym := sym
		wg.Add(1)
		sem <- struct{}{}
		go func() {
			defer wg.Done()
			defer func() { <-sem }()
			fctx, cancel := context.WithTimeout(ctx, rotationFetchTO)
			defer cancel()
			yc, err := s.yahooChart(fctx, sym, rotationRange)
			if err != nil {
				return
			}
			if c := yc.closes(); len(c) > 1 {
				mu.Lock()
				out[sym] = c
				mu.Unlock()
			}
		}()
	}
	wg.Wait()
	return out
}

// ── pure RRG math (unit-tested) ──────────────────────────────────────────────

var errUnavailable = &rotationError{"insufficient data"}

type rotationError struct{ msg string }

func (e *rotationError) Error() string { return e.msg }

type rrgPoint struct{ ratio, mom float64 }

// quadrant names the RRG cell for a point. The >=100 / <100 split is the whole
// classification; the exact spread of the axes is cosmetic.
func (p rrgPoint) quadrant() string {
	switch {
	case p.ratio >= 100 && p.mom >= 100:
		return "leading"
	case p.ratio >= 100:
		return "weakening"
	case p.mom >= 100:
		return "improving"
	default:
		return "lagging"
	}
}

// pctReturn is the percent change over the last n bars (0 when the series is too
// short). Positive = up.
func pctReturn(closes []float64, n int) float64 {
	if len(closes) <= n || n <= 0 {
		if len(closes) < 2 {
			return 0
		}
		n = len(closes) - 1
	}
	past := closes[len(closes)-1-n]
	if past == 0 {
		return 0
	}
	return (closes[len(closes)-1] - past) / past * 100
}

// relSeries is the relative-strength line asset/benchmark, aligned from the right
// (most-recent bars) so equal indices are the same recent trading day even when
// two listings have slightly different history lengths.
func relSeries(a, b []float64) []float64 {
	n := len(a)
	if len(b) < n {
		n = len(b)
	}
	a, b = a[len(a)-n:], b[len(b)-n:]
	out := make([]float64, n)
	for i := 0; i < n; i++ {
		if b[i] != 0 {
			out[i] = a[i] / b[i]
		}
	}
	return out
}

// rrgSeries turns a relative-strength line into full RS-Ratio and RS-Momentum
// series, both z-normalised around 100. RS-Ratio is the trailing z-score of the
// relative LEVEL (leading vs lagging); RS-Momentum is the trailing z-score of the
// short change in RS-Ratio (improving vs weakening).
func rrgSeries(rel []float64) (rsr, rsm []float64) {
	n := len(rel)
	if n < rrgLevelWindow+rrgMomLookback+1 {
		return nil, nil
	}
	rsr = make([]float64, n)
	for i := range rel {
		rsr[i] = 100 + rrgSpread*trailingZ(rel, i, rrgLevelWindow)
	}
	rsm = make([]float64, n)
	for i := range rsr {
		mom := make([]float64, 0, rrgLevelWindow)
		// change in RS-Ratio over rrgMomLookback bars, z-scored over the window
		for j := i; j > i-rrgLevelWindow && j-rrgMomLookback >= 0; j-- {
			mom = append(mom, rsr[j]-rsr[j-rrgMomLookback])
		}
		rsm[i] = 100 + rrgSpread*zLast(mom)
	}
	return rsr, rsm
}

// rrgLatest is the final RRG point of a relative line, or ok=false when short.
func rrgLatest(rel []float64) (rrgPoint, bool) {
	rsr, rsm := rrgSeries(rel)
	if len(rsr) == 0 {
		return rrgPoint{}, false
	}
	return rrgPoint{ratio: rsr[len(rsr)-1], mom: rsm[len(rsm)-1]}, true
}

// rrgTail samples the last rrgTailWeeks weekly points (every 5th bar) as the
// rotation trail the panel draws — the visible path through the quadrants.
func rrgTail(rsr, rsm []float64) []map[string]any {
	var tail []map[string]any
	for i := len(rsr) - 1; i >= 0 && len(tail) < rrgTailWeeks; i -= 5 {
		tail = append(tail, map[string]any{"rsRatio": round2s(rsr[i]), "rsMomentum": round2s(rsm[i])})
	}
	// oldest → newest so the consumer draws the path forward
	for i, j := 0, len(tail)-1; i < j; i, j = i+1, j-1 {
		tail[i], tail[j] = tail[j], tail[i]
	}
	return tail
}

// rrgHeading is the compass bearing (degrees, 0=east, CCW) of the latest tail
// segment — the direction the theme is rotating. Distribution tracks head down
// (toward Weakening/Lagging), accumulation tracks head up (toward Improving).
func rrgHeading(rsr, rsm []float64) float64 {
	n := len(rsr)
	if n < 6 {
		return 0
	}
	dx, dy := rsr[n-1]-rsr[n-6], rsm[n-1]-rsm[n-6]
	if dx == 0 && dy == 0 {
		return 0
	}
	deg := math.Atan2(dy, dx) * 180 / math.Pi
	if deg < 0 {
		deg += 360
	}
	return deg
}

// basketSynthetic equal-weights members into one synthetic price line, each
// member indexed to 100 at the aligned window start so different price scales
// (a $2 fund and a $900 stock, or a NG=F futures level) contribute equally.
func basketSynthetic(members [][]float64) []float64 {
	if len(members) == 0 {
		return nil
	}
	n := 0
	for _, m := range members {
		if n == 0 || len(m) < n {
			n = len(m)
		}
	}
	if n < 2 {
		return nil
	}
	out := make([]float64, n)
	for _, m := range members {
		m = m[len(m)-n:]
		base := m[0]
		if base == 0 {
			continue
		}
		for i := 0; i < n; i++ {
			out[i] += m[i] / base * 100
		}
	}
	inv := 1 / float64(len(members))
	for i := range out {
		out[i] *= inv
	}
	return out
}

// trailingZ is the z-score of x[i] within the window ending at i.
func trailingZ(x []float64, i, window int) float64 {
	lo := i - window + 1
	if lo < 0 {
		lo = 0
	}
	seg := x[lo : i+1]
	m, sd := meanStd(seg)
	if sd == 0 {
		return 0
	}
	return (x[i] - m) / sd
}

// zLast is the z-score of the first element of xs (the newest, since callers
// build the window newest-first) within xs.
func zLast(xs []float64) float64 {
	if len(xs) < 2 {
		return 0
	}
	m, sd := meanStd(xs)
	if sd == 0 {
		return 0
	}
	return (xs[0] - m) / sd
}

func meanStd(xs []float64) (mean, std float64) {
	if len(xs) == 0 {
		return 0, 0
	}
	var sum float64
	for _, v := range xs {
		sum += v
	}
	mean = sum / float64(len(xs))
	var ss float64
	for _, v := range xs {
		d := v - mean
		ss += d * d
	}
	return mean, math.Sqrt(ss / float64(len(xs)))
}

// ── thesis signals ───────────────────────────────────────────────────────────

// rotationSignals reads the lead themes' quadrants into the named thesis triggers
// and a one-line narrative. The headline "Great Rotation" fires only when BOTH
// the distribution (AI/semis rolling over from leadership) and accumulation
// (energy complex momentum turning up) legs are live.
func rotationSignals(byKey map[string]*rrgPoint) ([]map[string]any, string) {
	ai := worst(byKey, "ai_semis", "hyperscalers")             // topmost of the AI complex
	energy := best(byKey, "energy", "natgas", "uranium", "nuclear_power")

	distScore := distributionScore(ai)
	accScore := accumulationScore(energy)

	sig := func(key, label string, score float64, note string) map[string]any {
		state := "off"
		if score >= 0.66 {
			state = "active"
		} else if score >= 0.33 {
			state = "watch"
		}
		return map[string]any{"key": key, "label": label,
			"score": round2s(score), "state": state, "note": note}
	}

	signals := []map[string]any{
		sig("ai_distribution", "AI · Semis distribution", distScore,
			"Leadership high but momentum rolling over — classic top-of-cycle distribution."),
		sig("energy_accumulation", "Energy complex accumulation", accScore,
			"Natgas · uranium · nuclear power — the AI buildout's power bill — turning up from a base."),
	}

	rotScore := rotationSignalScore(byKey) // == min(distScore, accScore)
	rotState := "off"
	switch {
	case rotScore >= 0.66:
		rotState = "active"
	case rotScore >= 0.33:
		rotState = "watch"
	}
	signals = append([]map[string]any{{
		"key": "great_rotation", "label": "Great Rotation · AI → Energy",
		"score": round2s(rotScore), "state": rotState,
		"note": "Capital distributing out of the AI trade and into the power complex that feeds it.",
	}}, signals...)

	return signals, rotationNarrative(rotState, ai, energy)
}

// rotationSignalScore is the headline Great Rotation score: the MIN of the
// distribution leg (the AI complex topping out of leadership) and the
// accumulation leg (the energy complex turning up from a base). It cannot be high
// unless BOTH legs are live — one theme alone is not a rotation.
func rotationSignalScore(byKey map[string]*rrgPoint) float64 {
	ai := worst(byKey, "ai_semis", "hyperscalers")
	energy := best(byKey, "energy", "natgas", "uranium", "nuclear_power")
	return math.Min(distributionScore(ai), accumulationScore(energy))
}

// distributionScore rises as a theme sits deeper in Weakening (leading level,
// negative momentum) — the shape of a topping leader.
func distributionScore(p *rrgPoint) float64 {
	if p == nil {
		return 0
	}
	lead := clamp01((p.ratio - 100) / 5)   // how far above the benchmark
	roll := clamp01((100 - p.mom) / 5)      // how hard momentum is rolling over
	return lead*0.5 + roll*0.5
}

// accumulationScore rises as a theme sits deeper in Improving (lagging level,
// positive momentum) — the shape of an early rotation-in.
func accumulationScore(p *rrgPoint) float64 {
	if p == nil {
		return 0
	}
	base := clamp01((100 - p.ratio) / 5)    // how far below the benchmark it started
	turn := clamp01((p.mom - 100) / 5)      // how hard momentum is turning up
	// A theme already Leading still counts as strong accumulation if momentum is high.
	if p.ratio >= 100 {
		base = 0.5
	}
	return base*0.4 + turn*0.6
}

func rotationNarrative(state string, ai, energy *rrgPoint) string {
	switch state {
	case "active":
		return "Rotation live: the AI trade is distributing at the top while the energy complex that powers it accumulates."
	case "watch":
		return "Early rotation: AI leadership is fraying and the power complex is starting to turn up. Watch for confirmation."
	default:
		return "No decisive rotation yet — AI leadership intact, energy complex still basing."
	}
}

// worst returns the highest-RS-Ratio (most extended / topmost) of the named
// points — the one most exposed to distribution.
func worst(byKey map[string]*rrgPoint, keys ...string) *rrgPoint {
	var out *rrgPoint
	for _, k := range keys {
		if p := byKey[k]; p != nil && (out == nil || p.ratio > out.ratio) {
			out = p
		}
	}
	return out
}

// best returns the highest-RS-Momentum (strongest turn-up) of the named points.
func best(byKey map[string]*rrgPoint, keys ...string) *rrgPoint {
	var out *rrgPoint
	for _, k := range keys {
		if p := byKey[k]; p != nil && (out == nil || p.mom > out.mom) {
			out = p
		}
	}
	return out
}
