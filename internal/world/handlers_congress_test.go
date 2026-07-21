package world

import "testing"

func TestNormalizeTradeSide(t *testing.T) {
	cases := []struct{ in, want string }{
		{"Purchase", "buy"},
		{"Sale (Partial)", "sell"},
		{"Sale (Full)", "sell"},
		{"sale", "sell"},
		{"buy", "buy"},
		{"Exchange", ""},
		{"", ""},
	}
	for _, c := range cases {
		if got := normalizeTradeSide(c.in); got != c.want {
			t.Errorf("normalizeTradeSide(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestParseCongressTradesMalformed(t *testing.T) {
	if got := parseCongressTrades([]byte("not json <<<")); got != nil {
		t.Errorf("malformed: want nil, got %v", got)
	}
	if got := parseCongressTrades(nil); got != nil {
		t.Errorf("nil: want nil, got %v", got)
	}
	if got := parseCongressTrades([]byte("[]")); len(got) != 0 {
		t.Errorf("empty: want 0, got %d", len(got))
	}
}

func TestParseCongressTradesWellFormed(t *testing.T) {
	body := []byte(`[
	  {"Representative":"Nancy Pelosi","Ticker":"NVDA","Transaction":"Purchase","Range":"$1,000,001 - $5,000,000","House":"Representatives","TransactionDate":"2026-06-20T00:00:00.000","ReportDate":"2026-07-01T00:00:00.000"},
	  {"Representative":" Tommy Tuberville ","Ticker":"XOM","Transaction":"Sale (Full)","Range":"$15,001 - $50,000","House":"Senate","TransactionDate":"2026-06-18","ReportDate":"2026-06-28"}
	]`)
	got := parseCongressTrades(body)
	if len(got) != 2 {
		t.Fatalf("want 2 trades, got %d", len(got))
	}
	if got[0].Member != "Nancy Pelosi" || got[0].Ticker != "NVDA" || got[0].Side != "buy" {
		t.Errorf("trade[0] = %+v", got[0])
	}
	if got[0].Chamber != "Representatives" || got[0].TradedAt != "2026-06-20" || got[0].ReportedAt != "2026-07-01" {
		t.Errorf("trade[0] meta = %+v", got[0])
	}
	if got[1].Member != "Tommy Tuberville" || got[1].Side != "sell" { // trimmed + sell
		t.Errorf("trade[1] = %+v", got[1])
	}
}
