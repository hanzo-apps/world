package world

import (
	"net/http/httptest"
	"testing"
)

func TestYahooChartQuery(t *testing.T) {
	cases := []struct{ q, want string }{
		{"?symbol=SMH&range=1y&interval=1d", "range=1y&interval=1d"},
		{"?symbol=SMH", ""},                                  // default preserved
		{"?symbol=SMH&range=bogus&interval=1d", "interval=1d"}, // bad range dropped
		{"?symbol=SMH&range=1Y&interval=1D", "range=1y&interval=1d"}, // case-normalized
		{"?symbol=SMH&range=5y", "range=5y"},
		{"?symbol=SMH&interval=evil", ""}, // bad interval dropped
	}
	for _, c := range cases {
		r := httptest.NewRequest("GET", "/v1/world/yahoo-finance"+c.q, nil)
		if got := yahooChartQuery(r); got != c.want {
			t.Errorf("yahooChartQuery(%q) = %q, want %q", c.q, got, c.want)
		}
	}
}
