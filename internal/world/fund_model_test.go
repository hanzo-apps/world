package world

import (
	"math"
	"testing"
)

// conviction is the load-bearing scoring formula (research/rotation_model.py §5).
// Pin every branch: quadrant base, momentum tilt (clamped), and the oversold
// bonus that only pays an Improving sleeve that is down over 3 months.
func TestConviction(t *testing.T) {
	cases := []struct {
		name       string
		ratio, mom float64
		ret63      float64
		want       float64
	}{
		// Leading at the axis: base 0.72, zero tilt.
		{"leading flat", 101, 100, 5, 0.72},
		// Improving with strong momentum: base 1.0 + clip((110-100)*0.16)=1.6→1.2.
		{"improving hot", 98, 110, 5, 1.0 + 1.2},
		// Weakening rolling over: base 0.22 + clip((92-100)*0.16=-1.28→-1.2).
		{"weakening roll", 103, 92, 5, math.Max(0, 0.22-1.2)},
		// Lagging deep: base 0.08 + clip((90-100)*0.16=-1.6→-1.2) → floored at 0.
		{"lagging floor", 97, 90, -10, 0},
		// Oversold Improving bonus: base 1.0 + tilt((103-100)*0.16=0.48)
		// + min(0.3, 12/100=0.12) = 1.60.
		{"improving oversold bonus", 98, 103, -12, 1.0 + 0.48 + 0.12},
		// Improving but UP over 3mo: no bonus.
		{"improving no bonus when up", 98, 103, 8, 1.0 + 0.48},
		// Bonus caps at 0.3 even for a −50% ret63.
		{"improving bonus caps", 98, 101, -50, 1.0 + clampf((101-100)*0.16, -1.2, 1.2) + 0.3},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := conviction(rrgPoint{ratio: c.ratio, mom: c.mom}, c.ret63)
			if math.Abs(got-c.want) > 1e-9 {
				t.Fatalf("conviction(%.0f,%.0f,ret63=%.0f) = %.4f, want %.4f",
					c.ratio, c.mom, c.ret63, got, c.want)
			}
		})
	}
}

func TestConvictionNeverNegative(t *testing.T) {
	// Worst case: lagging, momentum crushed, ret63 positive (no bonus).
	if got := conviction(rrgPoint{ratio: 90, mom: 80}, 20); got < 0 {
		t.Fatalf("conviction must floor at 0, got %.4f", got)
	}
}

func TestClampf(t *testing.T) {
	for _, c := range []struct{ v, lo, hi, want float64 }{
		{0.5, -1.2, 1.2, 0.5},
		{-3, -1.2, 1.2, -1.2},
		{3, -1.2, 1.2, 1.2},
		{-1.2, -1.2, 1.2, -1.2},
	} {
		if got := clampf(c.v, c.lo, c.hi); got != c.want {
			t.Fatalf("clampf(%.2f) = %.2f, want %.2f", c.v, got, c.want)
		}
	}
}

// scoreSleeves must: drop sleeves with no usable data, normalize weights to sum
// 1, and rank by conviction. Build a synthetic close book with a rising sleeve
// and a falling sleeve so the quadrants are deterministic.
func TestScoreSleeves(t *testing.T) {
	closes := syntheticUniverse(t)
	scores := scoreSleeves(closes)
	if len(scores) == 0 {
		t.Fatal("expected scored sleeves, got none")
	}

	// Weights normalize to 1 (within float tolerance).
	var sum float64
	for _, s := range scores {
		if s.weight < 0 {
			t.Fatalf("sleeve %s has negative weight %.4f", s.key, s.weight)
		}
		sum += s.weight
	}
	if math.Abs(sum-1) > 1e-6 {
		t.Fatalf("weights sum to %.6f, want 1", sum)
	}

	// Ranked by conviction descending.
	for i := 1; i < len(scores); i++ {
		if scores[i-1].conviction < scores[i].conviction {
			t.Fatalf("scores not sorted by conviction: [%d]=%.3f < [%d]=%.3f",
				i-1, scores[i-1].conviction, i, scores[i].conviction)
		}
	}
	// Every scored sleeve carries a coherent quadrant/stance pair.
	for _, s := range scores {
		if quadStance[s.quadrant] != s.stance {
			t.Fatalf("sleeve %s quadrant %q stance %q mismatch", s.key, s.quadrant, s.stance)
		}
		if s.class == "" || s.label == "" {
			t.Fatalf("sleeve %s missing label/class metadata", s.key)
		}
	}
	// The rank order is exactly the conviction order (the normalization preserves
	// it), so the top sleeve is the highest-conviction one.
	top := scores[0]
	for _, s := range scores {
		if s.conviction > top.conviction {
			t.Fatalf("sleeve %s conviction %.3f exceeds top %s %.3f — not sorted",
				s.key, s.conviction, top.key, top.conviction)
		}
	}
}

// A sleeve with genuinely stronger relative momentum must earn a higher
// conviction than a decisively weaker one. Construct two synthetic sleeves —
// one whose relative line accelerates up, one whose decelerates — against a flat
// benchmark, and assert the ordering the model is supposed to produce.
func TestScoreSleevesRanksMomentum(t *testing.T) {
	const n = 140
	bench := make([]float64, n)
	for i := range bench {
		bench[i] = 400 // flat benchmark isolates the sleeve's own path
	}
	// Accelerating basket: quadratic ramp (momentum still building at the end).
	up := make([]float64, n)
	// Decelerating basket: fast early, plateauing late (momentum rolling over).
	down := make([]float64, n)
	for i := 0; i < n; i++ {
		f := float64(i)
		up[i] = 100 + f*f*0.01
		down[i] = 100 + math.Sqrt(f)*8
	}
	closes := map[string][]float64{rotationBenchmark: bench}
	for _, sym := range fundSleeves[0].members { // "ai" sleeve
		closes[sym] = up
	}
	for _, sym := range fundSleeves[3].members { // "gold" sleeve
		closes[sym] = down
	}
	scores := scoreSleeves(closes)
	conv := map[string]float64{}
	for _, s := range scores {
		conv[s.key] = s.conviction
	}
	if conv["ai"] <= conv["gold"] {
		t.Fatalf("accelerating sleeve conviction %.3f must exceed decelerating %.3f",
			conv["ai"], conv["gold"])
	}
}

func TestScoreSleevesThinBenchmark(t *testing.T) {
	// A benchmark too short to score → no book at all.
	closes := map[string][]float64{rotationBenchmark: {100, 101, 102}}
	if s := scoreSleeves(closes); s != nil {
		t.Fatalf("thin benchmark must yield nil, got %d sleeves", len(s))
	}
}

func TestOverallStance(t *testing.T) {
	// Two risk sleeves (improving/leading) at 0.4 each, one defensive at 0.2 →
	// risk fraction 0.8 → risk-on.
	scores := []sleeveScore{
		{key: "a", quadrant: "improving", weight: 0.4},
		{key: "b", quadrant: "leading", weight: 0.4},
		{key: "c", quadrant: "weakening", weight: 0.2},
	}
	if st, frac := overallStance(scores); st != "risk-on" || math.Abs(frac-0.8) > 1e-9 {
		t.Fatalf("overallStance = %q %.2f, want risk-on 0.80", st, frac)
	}
	// All defensive → risk-off.
	off := []sleeveScore{
		{key: "a", quadrant: "weakening", weight: 0.6},
		{key: "b", quadrant: "lagging", weight: 0.4},
	}
	if st, _ := overallStance(off); st != "risk-off" {
		t.Fatalf("all-defensive stance = %q, want risk-off", st)
	}
	// Empty → neutral.
	if st, frac := overallStance(nil); st != "neutral" || frac != 0 {
		t.Fatalf("empty stance = %q %.2f, want neutral 0", st, frac)
	}
}

func TestFundUniverseDedup(t *testing.T) {
	u := fundUniverse()
	seen := map[string]bool{}
	for _, s := range u {
		if seen[s] {
			t.Fatalf("duplicate symbol in universe: %s", s)
		}
		seen[s] = true
	}
	if u[0] != rotationBenchmark {
		t.Fatalf("benchmark %s must be first, got %s", rotationBenchmark, u[0])
	}
	// Every sleeve member appears exactly once.
	for _, sl := range fundSleeves {
		for _, m := range sl.members {
			if !seen[m] {
				t.Fatalf("sleeve %s member %s missing from universe", sl.key, m)
			}
		}
	}
}

// syntheticUniverse builds a deterministic close book: SPY flat-ish, one clearly
// rising basket (ai) and one clearly falling basket (gold), enough history to
// score. Every fund sleeve gets a series so none is dropped for lack of data.
func syntheticUniverse(t *testing.T) map[string][]float64 {
	t.Helper()
	const n = 140
	closes := map[string][]float64{}
	// SPY: mild uptrend.
	spy := make([]float64, n)
	for i := range spy {
		spy[i] = 400 + float64(i)*0.2
	}
	closes[rotationBenchmark] = spy
	// Assign each sleeve a slope: ai/defi rising fast, gold/silver falling, rest flat.
	slope := map[string]float64{
		"ai": 1.4, "defi": 1.2, "bitcoin": 0.9,
		"gold": -0.8, "silver": -0.6, "realestate": -0.2,
		"uranium": 0.3, "energy": 0.1, "natgas": 0.0, "nuclear": 0.2,
	}
	for _, sl := range fundSleeves {
		s := slope[sl.key]
		for _, sym := range sl.members {
			series := make([]float64, n)
			for i := range series {
				series[i] = 100 + float64(i)*s
			}
			closes[sym] = series
		}
	}
	return closes
}
