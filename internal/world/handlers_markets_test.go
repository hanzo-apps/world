package world

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
)

// validateYahooSymbols must validate, upcase, de-duplicate and cap — so a panel
// that repeats a symbol (or two panels sharing one) costs a single upstream fetch.
func TestValidateYahooSymbols(t *testing.T) {
	cases := []struct {
		in   string
		want []string
	}{
		{"", nil},
		{"spy", []string{"SPY"}},
		{"SPY,spy,Spy", []string{"SPY"}},                       // dedup, case-insensitive
		{"EURUSD=X,GC=F,^GSPC", []string{"EURUSD=X", "GC=F", "^GSPC"}}, // FX / futures / index chars
		{"SPY,bad!sym,,DX-Y.NYB", []string{"SPY", "DX-Y.NYB"}}, // drop invalid + empty
	}
	for _, c := range cases {
		if got := validateYahooSymbols(c.in); !reflect.DeepEqual(got, c.want) {
			t.Errorf("validateYahooSymbols(%q) = %v, want %v", c.in, got, c.want)
		}
	}
	// cap enforced
	many := make([]byte, 0)
	for i := 0; i < yahooBatchMaxSymbols+10; i++ {
		if i > 0 {
			many = append(many, ',')
		}
		many = append(many, []byte(itoa(i)+"X")...)
	}
	if got := validateYahooSymbols(string(many)); len(got) > yahooBatchMaxSymbols {
		t.Errorf("validateYahooSymbols exceeded cap: got %d", len(got))
	}
}

// handleYahooBatch must never 5xx and must return one result per requested symbol,
// each carrying either a chart body or an error (never a partial/omitted row) — so
// a flaky Yahoo (e.g. a 429) degrades to quiet unavailable rows, not a broken panel.
func TestYahooBatchNever5xxShape(t *testing.T) {
	s := NewServer()
	mux := http.NewServeMux()
	s.Mount(mux)
	ts := httptest.NewServer(mux)
	t.Cleanup(ts.Close)

	// missing param → clean 4xx, never 5xx / crash
	resp, err := http.Get(ts.URL + "/v1/world/yahoo-batch")
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("missing symbols: got %d, want 400", resp.StatusCode)
	}

	// valid symbols (deduped SPY) → 200 with one result per unique symbol; each row
	// is complete regardless of whether Yahoo answered (network-tolerant).
	resp, err = http.Get(ts.URL + "/v1/world/yahoo-batch?symbols=SPY,SPY,%5EGSPC")
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("valid symbols: got %d, want 200", resp.StatusCode)
	}
	var body struct {
		Results []struct {
			Symbol string          `json:"symbol"`
			Chart  json.RawMessage `json:"chart"`
			Error  string          `json:"error"`
		} `json:"results"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(body.Results) != 2 { // SPY deduped, ^GSPC
		t.Fatalf("results: got %d, want 2 (deduped)", len(body.Results))
	}
	for _, r := range body.Results {
		if r.Symbol == "" {
			t.Errorf("result missing symbol")
		}
		if len(r.Chart) == 0 && r.Error == "" {
			t.Errorf("result %q has neither chart nor error", r.Symbol)
		}
	}
}
