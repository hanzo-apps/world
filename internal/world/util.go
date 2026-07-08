package world

import (
	"strconv"
	"strings"
	"time"
)

// clampInt parses raw and clamps it to [lo, hi], falling back to def when
// unparseable.
func clampInt(raw string, def, lo, hi int) int {
	n, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil {
		return def
	}
	if n < lo {
		return lo
	}
	if n > hi {
		return hi
	}
	return n
}

// atoiDefault parses raw, returning def when unparseable.
func atoiDefault(raw string, def int) int {
	n, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil {
		return def
	}
	return n
}

// dateOnly formats t as YYYY-MM-DD (UTC).
func dateOnly(t time.Time) string { return t.UTC().Format("2006-01-02") }

// todayUTC and daysAgoUTC produce the ACLED/date-range bounds used throughout.
func todayUTC() string        { return dateOnly(time.Now()) }
func daysAgoUTC(n int) string { return dateOnly(time.Now().Add(-time.Duration(n) * 24 * time.Hour)) }

// oneOf reports whether v is in the allowed set.
func oneOf(v string, allowed ...string) bool {
	for _, a := range allowed {
		if v == a {
			return true
		}
	}
	return false
}

// round1 rounds to one decimal place.
func round1(f float64) float64 { return float64(int(f*10+sign(f)*0.5)) / 10 }

func sign(f float64) float64 {
	if f < 0 {
		return -1
	}
	return 1
}
