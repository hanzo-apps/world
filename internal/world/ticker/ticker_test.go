package ticker

import (
	"sort"
	"strings"
	"testing"
)

// asSet compares tickers ignoring order (dictionary hits come out in dict order,
// not text order — the SET is the contract, plus the cap and dedup).
func asSet(got []string) string {
	c := append([]string(nil), got...)
	sort.Strings(c)
	return strings.Join(c, ",")
}

func wantSet(syms ...string) string {
	c := append([]string(nil), syms...)
	sort.Strings(c)
	return strings.Join(c, ",")
}

func TestExtract(t *testing.T) {
	cases := []struct {
		name     string
		headline string
		want     string
	}{
		// Cashtags — explicit, always trusted.
		{"cashtag basic", "Why $AAPL is soaring today", wantSet("AAPL")},
		{"cashtag multiple", "$AAPL and $MSFT both up", wantSet("AAPL", "MSFT")},
		{"cashtag lowercase rejected", "buy $aapl now", wantSet()},
		{"cashtag too long rejected", "$ABCDEF is not a ticker", wantSet()},
		{"currency is not a cashtag", "priced at R$AAPL locally", wantSet()},
		{"single-letter cashtag", "$V hits record", wantSet("V")},

		// Ambiguous names REQUIRE a cashtag.
		{"apple bare rejected", "apple orchards had a great harvest", wantSet()},
		{"meta bare rejected", "meta description in html", wantSet()},
		{"visa bare rejected", "he needed a travel visa", wantSet()},
		{"oracle bare rejected", "the oracle at delphi spoke", wantSet()},
		{"intel bare rejected", "latest intel on the situation", wantSet()},
		{"amazon bare rejected", "the amazon rainforest burns", wantSet()},
		{"ambiguous with cashtag", "$AAPL and $META report earnings", wantSet("AAPL", "META")},

		// Distinctive names match bare.
		{"distinctive bare", "microsoft and tesla lead gains", wantSet("MSFT", "TSLA")},
		{"facebook maps to META", "facebook rebrands again", wantSet("META")},
		{"nvidia", "nvidia unveils new gpu", wantSet("NVDA")},

		// Word boundaries.
		{"no substring meta in metallica", "metallica announces tour", wantSet()},
		{"no substring microsoft in microsoftware", "microsoftware is not a word", wantSet()},

		// Bare English-word symbols rejected without a cashtag.
		{"GM bare rejected", "GM recalls trucks", wantSet()},
		{"IT bare rejected", "IT budgets are rising", wantSet()},
		{"ALL bare rejected", "ALL eyes on the fed", wantSet()},
		{"GM with cashtag", "$GM beats estimates", wantSet("GM")},

		// Longest-match-first for multi-word names.
		{"morgan stanley", "morgan stanley upgrades the stock", wantSet("MS")},
		{"goldman sachs", "goldman sachs cuts forecast", wantSet("GS")},
		{"two multiword names", "morgan stanley and jp morgan diverge", wantSet("MS", "JPM")},
		{"berkshire", "berkshire hathaway trims stake", wantSet("BRK.B")},

		// Crypto.
		{"crypto names", "bitcoin and ethereum surge overnight", wantSet("BTC", "ETH")},
		{"btc bare symbol", "BTC breaks above resistance", wantSet("BTC")},
		{"solana name", "solana network sees record volume", wantSet("SOL")},
		{"sol bare word rejected", "sol shines on the beach", wantSet()},

		// Punctuation / joined names.
		{"coca-cola", "coca-cola raises dividend", wantSet("KO")},
		{"at&t", "AT&T and Verizon compete", wantSet("T", "VZ")},
		{"johnson & johnson", "johnson & johnson faces suit", wantSet("JNJ")},

		// Dedup across sources.
		{"dedup cashtag+name", "$TSLA — tesla delivers more cars", wantSet("TSLA")},
		{"dedup repeated", "$AAPL $AAPL microsoft microsoft", wantSet("AAPL", "MSFT")},

		// Empty.
		{"empty", "", wantSet()},
		{"whitespace", "   \t ", wantSet()},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := asSet(Extract(c.headline)); got != c.want {
				t.Fatalf("Extract(%q) = %q, want %q", c.headline, got, c.want)
			}
		})
	}
}

func TestExtractCapAtEight(t *testing.T) {
	h := "$AA $BB $CC $DD $EE $FF $GG $HH $II $JJ"
	got := Extract(h)
	if len(got) != MaxPerHeadline {
		t.Fatalf("cap: got %d tickers, want %d", len(got), MaxPerHeadline)
	}
	// Cashtags are appended in order of appearance, so the first 8 win.
	want := []string{"AA", "BB", "CC", "DD", "EE", "FF", "GG", "HH"}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("cap order: got %v, want prefix %v", got, want)
		}
	}
}

// TestDictNoAmbiguousKeys guards the curation rule: names the spec calls out as
// requiring a cashtag must never leak into the bare-name dictionary.
func TestDictNoAmbiguousKeys(t *testing.T) {
	banned := []string{
		"apple", "amazon", "meta", "oracle", "visa", "intel", "target", "ford",
		"gap", "block", "zoom", "shell", "bp", "avalanche", "polygon",
		// bare English-word symbols must not be name keys either
		"gm", "it", "v", "all", "now", "net", "spot", "sol", "link", "dot",
	}
	for _, b := range banned {
		if _, ok := rawNames[strings.TrimSpace(b)]; ok {
			t.Errorf("ambiguous/common name %q must not be a bare dictionary key", b)
		}
	}
}
