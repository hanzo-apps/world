package world

import (
	"math"
	"testing"
)

// ramp builds an n-bar series rising (or falling) at a constant per-bar rate from
// a base — a clean synthetic where relative strength is known by construction.
func ramp(base, perBar float64, n int) []float64 {
	out := make([]float64, n)
	for i := 0; i < n; i++ {
		out[i] = base + perBar*float64(i)
	}
	return out
}

// accelerate builds a series that is flat/soft early then curls up hard late —
// the shape of an Improving theme (relative momentum turning up from a base).
func accelerate(base float64, n int) []float64 {
	out := make([]float64, n)
	for i := 0; i < n; i++ {
		t := float64(i) / float64(n-1)
		out[i] = base * (1 + 0.05*t*t) // quadratic curl-up
	}
	return out
}

// decelerate builds a series that rose hard early then flattens/rolls over late —
// the shape of a Weakening leader (relative momentum rolling over at the top).
func decelerate(base float64, n int) []float64 {
	out := make([]float64, n)
	for i := 0; i < n; i++ {
		t := float64(i) / float64(n-1)
		out[i] = base * (1 + 0.25*math.Sqrt(t)) // fast then flat
	}
	return out
}

func TestPctReturn(t *testing.T) {
	s := ramp(100, 1, 30) // 100..129
	got := pctReturn(s, 5)
	want := (129.0 - 124.0) / 124.0 * 100
	if math.Abs(got-want) > 1e-9 {
		t.Fatalf("pctReturn(5) = %v, want %v", got, want)
	}
	if pctReturn([]float64{100}, 5) != 0 {
		t.Fatalf("single-point series must return 0")
	}
}

func TestBasketSyntheticEqualWeightsScale(t *testing.T) {
	// A cheap fund and an expensive stock, both up the SAME 10% over the window,
	// must contribute equally — the synthetic ends at 110 (indexed to 100 base).
	cheap := ramp(2, 0.2/29, 30)     // 2.0 → 2.2  (+10%)
	dear := ramp(900, 90.0/29, 30)   // 900 → 990 (+10%)
	synth := basketSynthetic([][]float64{cheap, dear})
	if len(synth) != 30 {
		t.Fatalf("len = %d, want 30", len(synth))
	}
	if math.Abs(synth[0]-100) > 1e-6 {
		t.Fatalf("indexed base = %v, want 100", synth[0])
	}
	if math.Abs(synth[len(synth)-1]-110) > 1e-3 {
		t.Fatalf("equal-weight end = %v, want ~110 (both +10%%)", synth[len(synth)-1])
	}
}

func TestRelSeriesAlignsFromRight(t *testing.T) {
	a := ramp(100, 1, 40)
	b := ramp(50, 0.5, 30) // shorter
	rel := relSeries(a, b)
	if len(rel) != 30 {
		t.Fatalf("rel len = %d, want 30 (min)", len(rel))
	}
	// last point uses the last of each: a[39]/b[29]
	if math.Abs(rel[len(rel)-1]-(a[39]/b[29])) > 1e-9 {
		t.Fatalf("rel aligned wrong at tail")
	}
}

func TestQuadrantClassification(t *testing.T) {
	cases := []struct {
		ratio, mom float64
		want       string
	}{
		{102, 102, "leading"},
		{102, 98, "weakening"},
		{98, 98, "lagging"},
		{98, 102, "improving"},
		{100, 100, "leading"}, // boundary is inclusive on the leading corner
	}
	for _, c := range cases {
		if got := (rrgPoint{c.ratio, c.mom}).quadrant(); got != c.want {
			t.Fatalf("quadrant(%.0f,%.0f) = %q, want %q", c.ratio, c.mom, got, c.want)
		}
	}
}

// A theme outperforming the benchmark but with momentum rolling over must land in
// Weakening and score as distribution. This is the AI/semis "top" leg.
func TestDistributionShapeIsWeakening(t *testing.T) {
	n := 140
	bench := ramp(100, 0.01, n)      // benchmark drifts up gently
	leader := decelerate(100, n)     // outperformed hard early, now flattening
	p, ok := rrgLatest(relSeries(leader, bench))
	if !ok {
		t.Fatal("expected a point")
	}
	if p.ratio < 100 {
		t.Fatalf("a persistent outperformer must have RS-Ratio >= 100, got %.2f", p.ratio)
	}
	if p.mom >= 100 {
		t.Fatalf("a rolling-over leader must have RS-Momentum < 100, got %.2f", p.mom)
	}
	if q := p.quadrant(); q != "weakening" {
		t.Fatalf("quadrant = %q, want weakening", q)
	}
	if s := distributionScore(&p); s < 0.33 {
		t.Fatalf("distribution score = %.2f, want >= 0.33 (watch)", s)
	}
}

// A theme underperforming but curling up must land in Improving and score as
// accumulation. This is the energy/uranium "base" leg.
func TestAccumulationShapeIsImproving(t *testing.T) {
	n := 140
	bench := ramp(100, 0.05, n)      // benchmark trends up
	laggard := accelerate(80, n)     // below benchmark but curling up late
	p, ok := rrgLatest(relSeries(laggard, bench))
	if !ok {
		t.Fatal("expected a point")
	}
	if p.mom < 100 {
		t.Fatalf("a curling-up laggard must have RS-Momentum >= 100, got %.2f", p.mom)
	}
	if s := accumulationScore(&p); s < 0.33 {
		t.Fatalf("accumulation score = %.2f, want >= 0.33 (watch)", s)
	}
}

// The headline Great Rotation trigger is the MIN of the two legs — it cannot be
// active unless BOTH distribution and accumulation are live.
func TestGreatRotationRequiresBothLegs(t *testing.T) {
	dist := &rrgPoint{ratio: 104, mom: 96} // deep weakening
	acc := &rrgPoint{ratio: 96, mom: 104}  // deep improving
	neutral := &rrgPoint{ratio: 100, mom: 100}

	both := rotationSignalScore(map[string]*rrgPoint{
		"ai_semis": dist, "hyperscalers": neutral,
		"energy": acc, "natgas": acc, "uranium": acc, "nuclear_power": acc,
	})
	if both < 0.66 {
		t.Fatalf("both legs deep → great_rotation should be active (>=0.66), got %.2f", both)
	}

	onlyDist := rotationSignalScore(map[string]*rrgPoint{
		"ai_semis": dist, "hyperscalers": neutral,
		"energy": neutral, "natgas": neutral, "uranium": neutral, "nuclear_power": neutral,
	})
	if onlyDist >= 0.66 {
		t.Fatalf("only the distribution leg live → great_rotation must NOT be active, got %.2f", onlyDist)
	}
}

func TestPositiveClosesDropsBadBars(t *testing.T) {
	got := positiveCloses([]float64{10, 0, 11, -3, 12})
	want := []float64{10, 11, 12}
	if len(got) != len(want) {
		t.Fatalf("len = %d, want %d (%v)", len(got), len(want), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("got %v, want %v", got, want)
		}
	}
}

// A single spurious 0 bar in the benchmark must not survive to the RRG math (it
// would otherwise corrupt the relative line and could flip a theme's quadrant).
// After sanitising, a series with a bad bar reads the SAME quadrant as the clean one.
func TestZeroBarDoesNotFlipQuadrant(t *testing.T) {
	n := 140
	clean := ramp(100, 0.4, n)   // steady outperformer
	bench := ramp(100, 0.05, n)
	pClean, ok := rrgLatest(relSeries(clean, bench))
	if !ok {
		t.Fatal("expected a clean point")
	}
	// inject a 0 three bars from the end of the benchmark, then sanitise as the
	// fetch path does
	bad := append([]float64(nil), bench...)
	bad[n-3] = 0
	pSan, ok := rrgLatest(relSeries(clean, positiveCloses(bad)))
	if !ok {
		t.Fatal("expected a sanitised point")
	}
	if pClean.quadrant() != pSan.quadrant() {
		t.Fatalf("sanitised quadrant %q != clean %q — a 0 bar still moved the read",
			pSan.quadrant(), pClean.quadrant())
	}
}

func TestMeanStd(t *testing.T) {
	m, sd := meanStd([]float64{2, 4, 4, 4, 5, 5, 7, 9})
	if math.Abs(m-5) > 1e-9 {
		t.Fatalf("mean = %v, want 5", m)
	}
	if math.Abs(sd-2) > 1e-9 {
		t.Fatalf("std = %v, want 2", sd)
	}
}
