package world

import (
	"encoding/json"
	"math"
	"reflect"
	"strings"
	"testing"
)

// Yahoo returns chart closes as float32 widened to float64, so JSON re-serializes
// the conversion noise verbatim — 17.209999084472656, 18 characters for 17.21.
// roundSig strips that to 7 significant digits (significant digits, NOT fixed
// decimals, so a sub-1.0 FX rate keeps its precision). Values verified against the
// upstream toPrecision(7) semantics in tests/sparkline-precision.test.mjs.
func TestRoundSig(t *testing.T) {
	cases := []struct {
		in, want float64
	}{
		{17.209999084472656, 17.21}, // the canonical float32 noise → clean
		{17.25, 17.25},              // already clean, unchanged
		{16.829999923706055, 16.83},
		{0.0071349999, 0.007135},        // sub-1.0: 7 SIG DIGITS kept, not flattened to 0.01
		{-0.0071349999, -0.007135},      // sign preserved
		{0.6917064189910889, 0.6917064}, // real FX rate — the reason it is sig digits
		{0.6908955574035645, 0.6908956}, // rounds up correctly at the 7th digit
		{123456.789, 123456.8},          // large: 7 sig < 2dp here — why we never round price scalars
		{8675309, 8675309},              // 7-digit integer is exact
		{42000, 42000},
		{-42.005, -42.005},
		{0, 0}, // zero passes through
	}
	for _, c := range cases {
		if got := roundSig(c.in); got != c.want {
			t.Errorf("roundSig(%v) = %v, want %v", c.in, got, c.want)
		}
	}

	// A fixed 2dp round would flatten the FX rate to 0.01 and destroy the chart;
	// significant digits keep the meaningful precision at any magnitude.
	if v := roundSig(0.0071349999); v <= 0.007 || v >= 0.008 {
		t.Errorf("FX precision lost: roundSig(0.0071349999) = %v, want ~0.007135", v)
	}

	// Non-finite values must survive rather than become null/0 and dent the curve.
	if v := roundSig(math.NaN()); !math.IsNaN(v) {
		t.Errorf("roundSig(NaN) = %v, want NaN", v)
	}
	if v := roundSig(math.Inf(1)); !math.IsInf(v, 1) {
		t.Errorf("roundSig(+Inf) = %v, want +Inf", v)
	}
	if v := roundSig(math.Inf(-1)); !math.IsInf(v, -1) {
		t.Errorf("roundSig(-Inf) = %v, want -Inf", v)
	}
}

// The real emit path a client sees: Yahoo Close ([]*float64, nulls and all) →
// compact() drops the nulls → sparkline() rounds the last n for the wire. This
// pins that the shipped array is rounded and noise-free, and — load-bearing —
// that the source closes are NOT mutated, so the price/change scalars derived
// from them upstream stay exact.
func TestSparklinePathRoundsAndPreservesSource(t *testing.T) {
	f := func(v float64) *float64 { return &v }
	// Real float64 noise copied from market:commodities-bootstrap:v1, with a null
	// spliced in (Yahoo emits nulls for missing sessions) that compact must drop.
	raw := []*float64{
		f(17.209999084472656), f(17.219999313354492), f(17.239999771118164),
		nil, f(17.190000534057617), f(17.170000076293945), f(17.25), f(16.829999923706055),
	}
	closes := compact(raw)
	got := sparkline(closes, 30)
	want := []float64{17.21, 17.22, 17.24, 17.19, 17.17, 17.25, 16.83}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("sparkline(compact(raw)) = %v, want %v", got, want)
	}

	// The serialized array must carry none of the float32 noise.
	b, err := json.Marshal(got)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if strings.Contains(string(b), "17.209999") {
		t.Errorf("noise reached the wire: %s", b)
	}

	// It must be materially smaller — this is the entire point (>50% on this series).
	before, _ := json.Marshal(closes)
	if len(b) >= len(before) {
		t.Errorf("no shrink: raw %d bytes, rounded %d bytes", len(before), len(b))
	}

	// The scalar path reads `closes` directly (price = round2s(last)); sparkline
	// must not have mutated it, or a 6-figure price would lose precision.
	if closes[0] != 17.209999084472656 {
		t.Errorf("source closes mutated: closes[0] = %v, want the raw noisy value", closes[0])
	}
}

// sparkline is the one way an emitted close array is built: last n only, nil in →
// nil out (so a failed fetch degrades to JSON null exactly as before, not []).
func TestSparklineTailAndNil(t *testing.T) {
	if got := sparkline(nil, 30); got != nil {
		t.Errorf("sparkline(nil) = %v, want nil (preserve null shape)", got)
	}
	long := make([]float64, 50)
	for i := range long {
		long[i] = float64(i)
	}
	got := sparkline(long, 30)
	if len(got) != 30 || got[0] != 20 || got[29] != 49 {
		t.Errorf("sparkline tail: got len=%d first=%v last=%v, want last 30 (20..49)", len(got), got[0], got[29])
	}
}
