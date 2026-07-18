package world

import "testing"

// TestIntervalSeconds guards the "AI Compute usage is dead flat" regression: the
// upstream usage series reports its bucket width as a WORD enum ("hour"/"day"), not a
// Go duration, so time.ParseDuration failed and usageRate silently fell back to the
// flat 24h mean. intervalSeconds must resolve the enums (and still accept a real
// duration string).
func TestIntervalSeconds(t *testing.T) {
	cases := map[string]float64{
		"minute": 60,
		"hour":   3600,
		"day":    86400,
		"week":   604800,
		"1h":     3600, // real Go-duration string still works
		"30m":    1800,
		"":       0, // unresolvable → 0 (caller falls back to window average)
		"nope":   0,
	}
	for in, want := range cases {
		if got := intervalSeconds(in); got != want {
			t.Errorf("intervalSeconds(%q) = %v, want %v", in, got, want)
		}
	}
}

// TestUsageRate proves the freshest-bucket rate is used when the interval resolves
// (the fix), and the 24h average is used only when it can't.
func TestUsageRate(t *testing.T) {
	series := []cloudUsageSeriesPoint{{Requests: 100}, {Requests: 720}} // last bucket = 720
	// "hour" now resolves to 3600s → 720/3600 = 0.2 rps (fresh), NOT 999999/86400.
	if got := usageRate(999999, series, "hour", seriesRequests); got != 720.0/3600.0 {
		t.Errorf("usageRate(hour) = %v, want %v (fresh bucket, not 24h mean)", got, 720.0/3600.0)
	}
	// Unresolvable interval → 24h average.
	if got := usageRate(86400, series, "", seriesRequests); got != 1.0 {
		t.Errorf("usageRate(empty interval) = %v, want 1.0 (24h average)", got)
	}
}
