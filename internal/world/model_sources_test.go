package world

import (
	"strings"
	"testing"
)

// The conflict source falls back to a GDELT proxy ONLY when no ACLED key is
// configured — never because a credentialed call returned empty. This is the
// selection rule that keeps the live model's conflict dimension non-zero when
// ACLED is unconfigured, decomplected from fetching so it is testable directly.
func TestConflictSourceMode(t *testing.T) {
	cases := []struct {
		name  string
		token string
		want  string
	}{
		{"absent", "", conflictModeGDELTProxy},
		{"whitespace only", "   \t ", conflictModeGDELTProxy},
		{"present", "real-acled-key", conflictModeACLED},
		{"present with surrounding space", "  key  ", conflictModeACLED},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := conflictSourceMode(c.token); got != c.want {
				t.Fatalf("conflictSourceMode(%q) = %q, want %q", c.token, got, c.want)
			}
		})
	}
}

func TestGDELTProxyConflictCount(t *testing.T) {
	cases := []struct {
		articles int
		want     float64
	}{
		{0, 0},
		{-5, 0},   // never negative
		{10, 4},   // 10 * 0.4
		{50, 20},  // 50 * 0.4
		{100, 40}, // saturates at the cap
		{250, 40}, // still capped, never runaway
	}
	for _, c := range cases {
		if got := gdeltProxyConflictCount(c.articles); got != c.want {
			t.Errorf("gdeltProxyConflictCount(%d) = %v, want %v", c.articles, got, c.want)
		}
	}
	// The proxy must never exceed ACLED's composite-saturation scale.
	if gdeltProxyMaxEvents > 43 {
		t.Fatalf("gdeltProxyMaxEvents=%v would over-saturate the conflict composite", gdeltProxyMaxEvents)
	}
}

func TestGDELTConflictQuery(t *testing.T) {
	q := gdeltConflictQuery("United States")
	if !strings.HasPrefix(q, `"United States" (`) {
		t.Fatalf("query must lead with the quoted country name: %q", q)
	}
	for _, kw := range conflictKeywords {
		if !strings.Contains(q, kw) {
			t.Errorf("query missing conflict keyword %q: %q", kw, q)
		}
	}
	if !strings.Contains(q, " OR ") {
		t.Errorf("keywords must be OR-joined: %q", q)
	}
	// Provenance label must be honest — never claim to be ACLED.
	if conflictProxySrc == conflictModeACLED || conflictProxySrc != "gdelt-proxy" {
		t.Fatalf("conflictProxySrc = %q, want an honest gdelt-proxy label", conflictProxySrc)
	}
}
