// Package fund is the autonomous multi-asset fund brain. It generalises the
// rotation scanner into a full fund book: asset-class sleeves, each scored off
// daily closes vs a benchmark (SPY) with a Relative Rotation Graph, each holding
// a preferred portfolio of members with conviction-tilted weights. On top of the
// book sits a paper-only execution engine (broker.go, ledger.go, engine.go) that
// recomputes the book on an interval and emits rebalance orders to an append-only
// paper ledger — it NEVER touches a real venue.
//
// This file is the pure book math: a faithful Go port of research/fund_book.py.
// It has no dependency on the network or the parent world package, so every
// scoring and weighting decision unit-tests without a fetch.
package fund

import (
	"math"
	"sort"
	"time"
)

// Benchmark is the relative-strength reference every sleeve is scored against.
const Benchmark = "SPY"

// Window labels the price history the book is computed over (6 months of daily
// closes), carried through to the emitted book for the frontend.
const Window = "6mo"

// RRG scoring constants (port of fund_book.py). The RS-Ratio / RS-Momentum pair
// is a faithful open approximation of JdK RS-Ratio / RS-Momentum: the quadrant
// SIGN is scale-invariant, the spread around 100 is cosmetic.
const (
	rrgBase     = 100.0
	rrgSpread   = 2.5 // z-score → RRG-unit spread around 100
	rrgMinBars  = 40  // a sleeve member needs at least this many aligned bars
	rrgLevelWin = 21  // trailing window for the RS-Ratio / RS-Momentum z-scores
	rrgMomLag   = 5   // ~1wk change of the relative line used for RS-Momentum
)

// Member is one symbol inside a sleeve.
type Member struct{ Symbol, Name string }

// SleeveDef is a named asset-class basket. Order is stable (it drives the
// per-sleeve allocation denominator and the fetch universe).
type SleeveDef struct {
	Name    string
	Members []Member
}

// Sleeves is the fund universe: the nine asset-class sleeves prototyped in
// research/fund_book.py plus a DeFi sleeve (priced via liquid crypto proxies on
// the same Yahoo path). Ordering is the canonical book order.
var Sleeves = []SleeveDef{
	{"AI", []Member{
		{"NVDA", "Nvidia"}, {"AVGO", "Broadcom"}, {"AMD", "AMD"}, {"SMH", "Semis ETF"},
		{"MSFT", "Microsoft"}, {"GOOGL", "Alphabet"}, {"META", "Meta"}, {"AMZN", "Amazon"},
	}},
	{"Bitcoin", []Member{
		{"BTC-USD", "Bitcoin"}, {"IBIT", "iShares BTC"}, {"MSTR", "MicroStrategy"},
		{"COIN", "Coinbase"}, {"MARA", "Marathon"},
	}},
	{"Gold", []Member{
		{"GLD", "Gold trust"}, {"GC=F", "Gold spot"}, {"GDX", "Gold miners"}, {"NEM", "Newmont"},
	}},
	{"Silver", []Member{
		{"SLV", "Silver trust"}, {"SI=F", "Silver spot"}, {"SIL", "Silver miners"}, {"PAAS", "Pan American"},
	}},
	{"Uranium", []Member{
		{"URA", "Uranium ETF"}, {"CCJ", "Cameco"}, {"URNM", "Uranium miners"}, {"LEU", "Centrus"},
	}},
	{"Real estate", []Member{
		{"VNQ", "REIT ETF"}, {"XLRE", "Real estate ETF"}, {"IYR", "US real estate"}, {"PLD", "Prologis"},
	}},
	{"Energy", []Member{
		{"XLE", "Energy ETF"}, {"XOP", "E&P ETF"}, {"CVX", "Chevron"}, {"XOM", "Exxon"},
	}},
	{"Natural gas", []Member{
		{"UNG", "Natgas fund"}, {"FCG", "Natgas producers"}, {"NG=F", "Henry Hub"}, {"LNG", "Cheniere"},
	}},
	{"Nuclear power", []Member{
		{"VST", "Vistra"}, {"CEG", "Constellation"}, {"NRG", "NRG"}, {"SMR", "NuScale"},
	}},
	// DeFi sleeve — the decentralized-finance settlement + protocol layer, priced
	// via its liquid token proxies (Yahoo crypto tickers). The /v1/world/defi data
	// endpoint surfaces the underlying TVL/yield fundamentals separately.
	{"DeFi", []Member{
		{"ETH-USD", "Ethereum"}, {"UNI-USD", "Uniswap"}, {"AAVE-USD", "Aave"},
		{"MKR-USD", "Maker"}, {"LDO-USD", "Lido"},
	}},
}

// Universe is every distinct symbol the book needs (all sleeve members ∪ the
// benchmark), deduped and stable — the exact set the price fetch must supply.
func Universe() []string {
	seen := map[string]bool{Benchmark: true}
	out := []string{Benchmark}
	for _, sl := range Sleeves {
		for _, m := range sl.Members {
			if !seen[m.Symbol] {
				seen[m.Symbol] = true
				out = append(out, m.Symbol)
			}
		}
	}
	return out
}

// Stance names what to do with a sleeve, derived from its top holding's RRG
// quadrant. It is also the conviction dial that sizes the sleeve's allocation.
const (
	StanceCore       = "Core"       // leading:   outperforming and accelerating
	StanceAccumulate = "Accumulate" // improving:  basing but momentum turning up
	StanceTrim       = "Trim"       // weakening:  leading but momentum rolling over
	StanceAvoid      = "Avoid"      // lagging:    underperforming and still falling
)

// stanceForQuadrant maps an RRG quadrant to its stance (port of STANCE).
func stanceForQuadrant(q string) string {
	switch q {
	case "leading":
		return StanceCore
	case "improving":
		return StanceAccumulate
	case "weakening":
		return StanceTrim
	default:
		return StanceAvoid
	}
}

// stanceConviction is the fraction of a sleeve's equal share that its stance
// warrants. Core is full weight; Avoid is zero (rotate to cash). It is the ONE
// place sleeve-level sizing policy lives.
func stanceConviction(stance string) float64 {
	switch stance {
	case StanceCore:
		return 1.0
	case StanceAccumulate:
		return 0.6
	case StanceTrim:
		return 0.3
	default: // Avoid
		return 0.0
	}
}

// Pick is one scored holding inside a sleeve, with its within-sleeve weight.
type Pick struct {
	Symbol     string  `json:"symbol"`
	Name       string  `json:"name"`
	RSRatio    float64 `json:"rsRatio"`
	RSMomentum float64 `json:"rsMomentum"`
	Quadrant   string  `json:"quadrant"`
	Ret21      float64 `json:"ret21"`
	Ret63      float64 `json:"ret63"`
	Weight     float64 `json:"weight"` // % within the sleeve, sums to ~100
	// Target is the pick's share of TOTAL fund equity (0..1): the sleeve's
	// allocation × its within-sleeve weight. This is what the engine trades to.
	Target float64 `json:"target"`
}

// SleeveView is one scored sleeve: its stance, aggregate momentum, and its
// preferred portfolio, momentum-ranked.
type SleeveView struct {
	Sleeve   string  `json:"sleeve"`
	Stance   string  `json:"stance"`
	Quadrant string  `json:"quadrant"`
	Momentum float64 `json:"momentum"`
	Ret63    float64 `json:"ret63"`
	Alloc    float64 `json:"alloc"` // sleeve's share of total equity (0..1)
	Picks    []Pick  `json:"picks"`
}

// Book is the full fund book: every sleeve, ranked, plus the overall stance and
// the target cash the conviction model leaves unallocated.
type Book struct {
	AsOf       string       `json:"asOf"`
	Benchmark  string       `json:"benchmark"`
	Window     string       `json:"window"`
	Stance     string       `json:"stance"`     // one-line headline read
	TargetCash float64      `json:"targetCash"` // 1 − Σ sleeve alloc (0..1)
	Sleeves    []SleeveView `json:"sleeves"`
}

// z is the population z-score of the LAST element of xs within xs (port of the
// fund_book.py z()). 0 when too short or flat.
func z(xs []float64) float64 {
	n := len(xs)
	if n < 2 {
		return 0
	}
	var sum float64
	for _, v := range xs {
		sum += v
	}
	m := sum / float64(n)
	var ss float64
	for _, v := range xs {
		d := v - m
		ss += d * d
	}
	sd := math.Sqrt(ss / float64(n))
	if sd == 0 {
		return 0
	}
	return (xs[n-1] - m) / sd
}

// ret is the percent change over the last n bars, or (0,false) when too short
// (port of ret()). Positive = up.
func ret(c []float64, n int) (float64, bool) {
	if len(c) <= n || n <= 0 {
		return 0, false
	}
	past := c[len(c)-1-n]
	if past == 0 {
		return 0, false
	}
	return (c[len(c)-1]/past - 1) * 100, true
}

// tailN returns the last n elements of xs (all of xs when shorter).
func tailN(xs []float64, n int) []float64 {
	if len(xs) <= n {
		return xs
	}
	return xs[len(xs)-n:]
}

// rrg computes a member's (RS-Ratio, RS-Momentum) against the benchmark, or
// ok=false when fewer than rrgMinBars aligned bars exist (port of rrg()).
func rrg(c, bench []float64) (rsRatio, rsMom float64, ok bool) {
	n := len(c)
	if len(bench) < n {
		n = len(bench)
	}
	if n < rrgMinBars {
		return 0, 0, false
	}
	a, b := c[len(c)-n:], bench[len(bench)-n:]
	rel := make([]float64, n)
	for i := 0; i < n; i++ {
		if b[i] == 0 {
			return 0, 0, false
		}
		rel[i] = a[i] / b[i]
	}
	rsRatio = rrgBase + rrgSpread*z(tailN(rel, rrgLevelWin))
	dm := make([]float64, 0, n-rrgMomLag)
	for i := rrgMomLag; i < n; i++ {
		dm = append(dm, rel[i]-rel[i-rrgMomLag])
	}
	rsMom = rrgBase + rrgSpread*z(tailN(dm, rrgLevelWin))
	return rsRatio, rsMom, true
}

// quadrant names the RRG cell for a point. The >=100 / <100 split is the whole
// classification (port of quad()).
func quadrant(rsRatio, rsMom float64) string {
	switch {
	case rsRatio >= rrgBase && rsMom >= rrgBase:
		return "leading"
	case rsRatio >= rrgBase:
		return "weakening"
	case rsMom >= rrgBase:
		return "improving"
	default:
		return "lagging"
	}
}

// round1 rounds to one decimal (the book's wire precision, matching the python
// prototype). Non-finite inputs collapse to 0 so a stray NaN never reaches the
// JSON encoder.
func round1(f float64) float64 {
	if math.IsNaN(f) || math.IsInf(f, 0) {
		return 0
	}
	return math.Round(f*10) / 10
}

// BuildBook scores every sleeve off the supplied closes and returns the full
// book. prices maps symbol → daily closes; it must include the benchmark. ok is
// false only when the benchmark itself is too thin to score anything.
//
// This is a faithful port of the fund_book.py main loop: per-member RRG, drop
// members with too little history, momentum-rank the picks, tilt weights by
// (rsMomentum−95) conviction, set the sleeve stance from the top pick's
// quadrant, and rank sleeves by aggregate momentum. It additionally computes the
// overall allocation (sleeve conviction × within-sleeve weight) the engine
// trades to.
func BuildBook(prices map[string][]float64, asOf time.Time) (Book, bool) {
	bench := prices[Benchmark]
	if len(bench) < rrgMinBars {
		return Book{}, false
	}

	views := make([]SleeveView, 0, len(Sleeves))
	for _, sl := range Sleeves {
		picks := make([]Pick, 0, len(sl.Members))
		for _, m := range sl.Members {
			c := prices[m.Symbol]
			if len(c) < rrgMinBars {
				continue
			}
			r, mom, ok := rrg(c, bench)
			if !ok {
				continue
			}
			r21, _ := ret(c, 21)
			r63, _ := ret(c, 63)
			picks = append(picks, Pick{
				Symbol: m.Symbol, Name: m.Name,
				RSRatio: round1(r), RSMomentum: round1(mom), Quadrant: quadrant(r, mom),
				Ret21: round1(r21), Ret63: round1(r63),
			})
		}
		if len(picks) == 0 {
			continue
		}
		// momentum-rank, strongest first.
		sort.SliceStable(picks, func(i, j int) bool { return picks[i].RSMomentum > picks[j].RSMomentum })

		// conviction-tilted within-sleeve weights (port): max(0.1, rsMom−95), normalised to 100.
		var tot float64
		conv := make([]float64, len(picks))
		for i, p := range picks {
			conv[i] = math.Max(0.1, p.RSMomentum-95)
			tot += conv[i]
		}
		if tot == 0 {
			tot = 1
		}
		var avgMom, avgR63 float64
		for i := range picks {
			picks[i].Weight = round1(conv[i] / tot * 100)
			avgMom += picks[i].RSMomentum
			avgR63 += picks[i].Ret63
		}
		avgMom /= float64(len(picks))
		avgR63 /= float64(len(picks))

		stance := stanceForQuadrant(picks[0].Quadrant)
		views = append(views, SleeveView{
			Sleeve: sl.Name, Stance: stance, Quadrant: picks[0].Quadrant,
			Momentum: round1(avgMom), Ret63: round1(avgR63), Picks: picks,
		})
	}

	// rank sleeves by aggregate momentum, strongest first.
	sort.SliceStable(views, func(i, j int) bool { return views[i].Momentum > views[j].Momentum })

	// overall allocation: each sleeve gets an equal 1/N base, dialled by its
	// stance conviction; the pick's target is that × its within-sleeve weight.
	// What conviction leaves unspent is target cash.
	n := float64(len(Sleeves))
	var allocated float64
	for i := range views {
		alloc := stanceConviction(views[i].Stance) / n
		views[i].Alloc = round1(alloc*100) / 100 // 4-dp fraction for display stability
		allocated += alloc
		for j := range views[i].Picks {
			views[i].Picks[j].Target = alloc * views[i].Picks[j].Weight / 100
		}
	}

	return Book{
		AsOf: asOf.UTC().Format(time.RFC3339), Benchmark: Benchmark, Window: Window,
		Stance: overallStance(views), TargetCash: math.Max(0, 1-allocated),
		Sleeves: views,
	}, true
}

// Targets is the fund's target book: symbol → share of total equity (0..1),
// summing to (1 − TargetCash). It is the single source of truth the engine
// diffs current positions against.
func (b Book) Targets() map[string]float64 {
	out := make(map[string]float64)
	for _, sv := range b.Sleeves {
		for _, p := range sv.Picks {
			if p.Target > 0 {
				out[p.Symbol] += p.Target
			}
		}
	}
	return out
}

// overallStance reads the modal-ish top of the ranked book into a one-line
// headline: the strongest sleeve's stance, qualified by how much of the book is
// in a Core/Accumulate posture vs Trim/Avoid.
func overallStance(views []SleeveView) string {
	if len(views) == 0 {
		return "Flat — no sleeve has enough data to score."
	}
	var risk int
	for _, v := range views {
		if v.Stance == StanceCore || v.Stance == StanceAccumulate {
			risk++
		}
	}
	lead := views[0]
	switch {
	case risk == 0:
		return "Defensive — every sleeve is weakening or lagging; rotate to cash."
	case risk >= (len(views)+1)/2:
		return "Risk-on — " + lead.Sleeve + " leads (" + lead.Stance + "); majority of sleeves accumulating or core."
	default:
		return "Selective — " + lead.Sleeve + " leads (" + lead.Stance + "); rotation is narrow, most sleeves trimming."
	}
}
