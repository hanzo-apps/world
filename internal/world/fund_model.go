package world

import (
	"math"
	"sort"
)

// The fund model. A multi-asset-class conviction book layered on the same RRG
// kernel the rotation scanner computes (handlers_rotation.go): each asset-class
// SLEEVE is an equal-weight synthetic scored on the RS-Ratio / RS-Momentum plane
// against the benchmark (SPY), and conviction is the quadrant base plus a
// momentum tilt plus an oversold bonus — the faithful Go port of the reference
// model in research/rotation_model.py §5 (the "Book").
//
// The book is a PREFERRED PORTFOLIO, not an instruction to trade: model output,
// not investment advice. The autonomous engine (fund_engine.go) consumes it to
// drive a PAPER ledger only — see the Broker seam in fund_broker.go.

// A sleeve is a named asset-class basket priced as one equal-weight synthetic.
// Members index to 100 at the aligned window start so a $2 fund and a $900 coin
// contribute equally (basketSynthetic, shared with the rotation scanner).
type sleeve struct {
	key, label, class string
	members           []string
}

// fundSleeves is the multi-asset universe: the AI buildout and its power bill
// (energy complex), the monetary/hard-asset hedges (Bitcoin, gold, silver), the
// on-chain risk sleeve (DeFi), and real assets (real estate). SPY is the
// benchmark (rotationBenchmark) and is priced separately.
var fundSleeves = []sleeve{
	{"ai", "AI", "Equities · AI buildout", []string{"SMH", "SOXX", "NVDA", "AMD", "AVGO", "MSFT", "GOOGL", "META"}},
	{"bitcoin", "Bitcoin", "Digital assets", []string{"IBIT", "BTC-USD", "COIN", "MSTR"}},
	{"defi", "DeFi", "Digital assets", []string{"ETH-USD", "SOL-USD", "UNI-USD", "AAVE-USD"}},
	{"gold", "Gold", "Precious metals", []string{"GLD", "IAU", "GDX"}},
	{"silver", "Silver", "Precious metals", []string{"SLV", "SIL", "PSLV"}},
	{"uranium", "Uranium", "Energy complex", []string{"URA", "URNM", "CCJ"}},
	{"realestate", "Real estate", "Real assets", []string{"XLRE", "VNQ", "IYR"}},
	{"energy", "Energy", "Energy complex", []string{"XLE", "XOP", "CVX", "XOM"}},
	{"natgas", "Natural gas", "Energy complex", []string{"UNG", "FCG", "NG=F"}},
	{"nuclear", "Nuclear power", "Energy complex", []string{"VST", "CEG", "NRG", "XLU"}},
}

// fundUniverse is every distinct symbol to fetch (sleeves ∪ benchmark), deduped.
func fundUniverse() []string {
	seen := map[string]bool{rotationBenchmark: true}
	out := []string{rotationBenchmark}
	for _, sl := range fundSleeves {
		for _, sym := range sl.members {
			if !seen[sym] {
				seen[sym] = true
				out = append(out, sym)
			}
		}
	}
	return out
}

// Conviction weighting — the faithful port of research/rotation_model.py §5.
//
//	QUAD_BASE = {improving 1.0, leading 0.72, weakening 0.22, lagging 0.08}
//	conviction = QUAD_BASE + clip((mom-100)*0.16, -1.2, 1.2)
//	             + (improving & ret63<0 ? min(0.3, -ret63/100) : 0)
//
// Accumulate the turn-up (Improving), hold the leader (Leading), trim the topping
// leader (Weakening), avoid the falling laggard (Lagging); tilt by momentum; and
// pay a small bonus to a deeply-oversold theme that is turning up.
var quadBase = map[string]float64{
	"improving": 1.0, "leading": 0.72, "weakening": 0.22, "lagging": 0.08,
}

var quadStance = map[string]string{
	"improving": "Accumulate", "leading": "Core", "weakening": "Trim", "lagging": "Avoid",
}

// conviction scores one sleeve from its latest RRG point and 3-month return.
func conviction(p rrgPoint, ret63 float64) float64 {
	c := quadBase[p.quadrant()] + clampf((p.mom-100)*0.16, -1.2, 1.2)
	if p.quadrant() == "improving" && ret63 < 0 {
		c += math.Min(0.3, -ret63/100)
	}
	if c < 0 {
		return 0
	}
	return c
}

// clampf clamps v to [lo, hi]. (clamp01 is the [0,1] special case in
// handlers_cloud_router_pref.go; this is the general form the tilt needs.)
func clampf(v, lo, hi float64) float64 {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

// sleeveScore is one sleeve's full read: its RRG point, returns, and conviction.
type sleeveScore struct {
	key, label, class, stance string
	ratio, mom                float64
	quadrant                  string
	ret21, ret63              float64
	conviction                float64
	weight                    float64 // normalized preferred-portfolio weight, [0,1]
}

// scoreSleeves builds every sleeve's synthetic, scores it on the RRG plane, and
// normalizes conviction across the sleeves that have enough data into a preferred
// portfolio (weights sum to 1). A sleeve whose members are all too thin is
// dropped. Pure — the network lives in the caller (fetchCloses). This is the
// engine of both /v1/world/fund and the autonomous rebalancer.
func scoreSleeves(closes map[string][]float64) []sleeveScore {
	bench := closes[rotationBenchmark]
	if len(bench) < rrgLevelWindow+rrgMomLookback+1 {
		return nil
	}
	scores := make([]sleeveScore, 0, len(fundSleeves))
	var total float64
	for _, sl := range fundSleeves {
		members := make([][]float64, 0, len(sl.members))
		for _, sym := range sl.members {
			series := closes[sym]
			if len(series) < rrgLevelWindow+rrgMomLookback+1 {
				continue
			}
			members = append(members, series)
		}
		if len(members) == 0 {
			continue
		}
		synth := basketSynthetic(members)
		p, ok := rrgLatest(relSeries(synth, bench))
		if !ok {
			continue
		}
		ret63 := pctReturn(synth, 63)
		c := conviction(p, ret63)
		total += c
		scores = append(scores, sleeveScore{
			key: sl.key, label: sl.label, class: sl.class, stance: quadStance[p.quadrant()],
			ratio: p.ratio, mom: p.mom, quadrant: p.quadrant(),
			ret21: pctReturn(synth, 21), ret63: ret63, conviction: c,
		})
	}
	if total > 0 {
		for i := range scores {
			scores[i].weight = scores[i].conviction / total
		}
	}
	// Preferred portfolio order: highest conviction first.
	sort.SliceStable(scores, func(i, j int) bool { return scores[i].conviction > scores[j].conviction })
	return scores
}

// overallStance summarizes the book in one word from the aggregate posture:
// how much conviction sits in the accumulate/core sleeves vs trim/avoid.
func overallStance(scores []sleeveScore) (string, float64) {
	var risk, total float64
	for _, s := range scores {
		total += s.weight
		if s.quadrant == "improving" || s.quadrant == "leading" {
			risk += s.weight
		}
	}
	if total == 0 {
		return "neutral", 0
	}
	frac := risk / total
	switch {
	case frac >= 0.66:
		return "risk-on", frac
	case frac >= 0.40:
		return "balanced", frac
	default:
		return "risk-off", frac
	}
}
