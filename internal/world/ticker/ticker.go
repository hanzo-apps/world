// Package ticker extracts stock and crypto tickers from a news headline at
// ingest. It is pure (no I/O, no state) and deliberately conservative: a
// headline is prose, so a false positive ("apple" → AAPL when the story is
// about fruit) is worse than a miss. Two sources feed it:
//
//   - Cashtags: an explicit "$AAPL" (uppercase, 1–5 chars, word-bounded) is
//     always trusted — the "$" is the author's unambiguous intent.
//   - A curated company-name dictionary (longest-match-first). Only DISTINCTIVE
//     names are listed; ambiguous ones (apple, meta, visa, oracle, intel,
//     amazon…) and bare English-word symbols (GM, IT, V, ALL) are excluded and
//     require a cashtag.
package ticker

import (
	"regexp"
	"strings"
)

// MaxPerHeadline caps how many tickers one headline yields (relevance guard).
const MaxPerHeadline = 8

// cashtagRe matches a "$AAA" cashtag: 1–5 uppercase letters ending at a word
// boundary. The left boundary is verified separately (Go RE2 has no lookbehind)
// so "R$AAPL" — a currency amount — is not mistaken for a cashtag.
var cashtagRe = regexp.MustCompile(`\$[A-Z]{1,5}\b`)

// Extract returns up to MaxPerHeadline unique tickers referenced by headline,
// cashtags first (in order of appearance) then dictionary hits. Order is stable;
// duplicates are removed.
func Extract(headline string) []string {
	if strings.TrimSpace(headline) == "" {
		return nil
	}
	out := make([]string, 0, MaxPerHeadline)
	seen := make(map[string]bool)
	// add reports whether there is room for more (false once full).
	add := func(sym string) bool {
		if sym != "" && !seen[sym] {
			seen[sym] = true
			out = append(out, sym)
		}
		return len(out) < MaxPerHeadline
	}

	// 1) Cashtags — explicit and always trusted.
	for _, loc := range cashtagRe.FindAllStringIndex(headline, -1) {
		if loc[0] > 0 && isWordByte(headline[loc[0]-1]) {
			continue // preceded by a letter/digit → not a cashtag (e.g. "R$AAPL")
		}
		if !add(headline[loc[0]+1 : loc[1]]) { // strip the '$'
			return out
		}
	}

	// 2) Company-name dictionary — longest name first so multi-word names win and
	// a shorter contained name cannot pre-empt them. Word-bounded and span-
	// consuming so "meta" never matches inside "metallica" and an already-claimed
	// span is not double-counted.
	lower := strings.ToLower(headline)
	consumed := make([]bool, len(lower))
	for _, e := range nameEntries { // pre-sorted longest-first at init
		if pos := findWordBounded(lower, e.name, consumed); pos >= 0 {
			for i := pos; i < pos+len(e.name); i++ {
				consumed[i] = true
			}
			if !add(e.ticker) {
				return out
			}
		}
	}
	return out
}

// findWordBounded returns the first index where sub occurs in s as a whole word
// (both edges at a non-alphanumeric boundary) and outside any already-consumed
// span, or -1.
func findWordBounded(s, sub string, consumed []bool) int {
	from := 0
	for from <= len(s)-len(sub) {
		i := strings.Index(s[from:], sub)
		if i < 0 {
			return -1
		}
		start := from + i
		end := start + len(sub)
		if boundaryOK(s, start, end) && !spanConsumed(consumed, start, end) {
			return start
		}
		from = start + 1
	}
	return -1
}

// boundaryOK reports whether [start,end) sits at word boundaries in s.
func boundaryOK(s string, start, end int) bool {
	if start > 0 && isWordByte(s[start-1]) {
		return false
	}
	if end < len(s) && isWordByte(s[end]) {
		return false
	}
	return true
}

func spanConsumed(consumed []bool, start, end int) bool {
	for i := start; i < end; i++ {
		if consumed[i] {
			return true
		}
	}
	return false
}

// isWordByte reports whether b is an ASCII letter or digit — the boundary alphabet.
func isWordByte(b byte) bool {
	return (b >= 'a' && b <= 'z') || (b >= 'A' && b <= 'Z') || (b >= '0' && b <= '9')
}
