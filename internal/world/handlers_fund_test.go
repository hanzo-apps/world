package world

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// The public book view carries the paper flag and a disclaimer, and every sleeve
// row round-trips through JSON cleanly (no NaN/Inf leaking).
func TestFundBookView(t *testing.T) {
	scores := scoreSleeves(syntheticUniverse(t))
	view := fundBookView(scores)
	if view["paper"] != true {
		t.Fatal("book view must carry paper:true")
	}
	if _, ok := view["disclaimer"].(string); !ok {
		t.Fatal("book view must carry a disclaimer")
	}
	if _, err := json.Marshal(view); err != nil {
		t.Fatalf("book view must marshal: %v", err)
	}
}

// The ledger view before any cycle is well-formed: paper, non-live, full capital
// in cash, zero PnL, empty history.
func TestLedgerViewEmpty(t *testing.T) {
	e := newFundEngine(NewPaperBroker())
	v := e.ledgerView()
	if v["paper"] != true || v["live"] != false {
		t.Fatalf("empty ledger view paper/live = %v/%v, want true/false", v["paper"], v["live"])
	}
	if v["simPnl"].(float64) != 0 {
		t.Fatalf("empty ledger simPnl = %v, want 0", v["simPnl"])
	}
	if v["cash"].(float64) != round2s(fundCapital) {
		t.Fatalf("empty ledger cash = %v, want %v", v["cash"], round2s(fundCapital))
	}
	if orders := v["orders"].([]map[string]any); len(orders) != 0 {
		t.Fatalf("empty ledger has %d orders, want 0", len(orders))
	}
}

// After a rebalance the ledger view reflects paper positions and orders, and
// every order is flagged paper.
func TestLedgerViewAfterRebalance(t *testing.T) {
	e := newFundEngine(NewPaperBroker())
	if _, err := e.rebalance(syntheticUniverse(t)); err != nil {
		t.Fatalf("rebalance: %v", err)
	}
	v := e.ledgerView()
	if v["live"] != false {
		t.Fatal("ledger must stay non-live")
	}
	orders := v["orders"].([]map[string]any)
	if len(orders) == 0 {
		t.Fatal("expected orders after rebalance")
	}
	for _, o := range orders {
		if o["paper"] != true {
			t.Fatalf("order not flagged paper: %+v", o)
		}
	}
	if v["rebalanceCycles"].(int) != 1 {
		t.Fatalf("rebalanceCycles = %v, want 1", v["rebalanceCycles"])
	}
}

func TestFundBriefShape(t *testing.T) {
	b := fundBrief(scoreSleeves(syntheticUniverse(t)))
	if _, ok := b["headline"].(string); !ok {
		t.Fatal("brief must carry a headline")
	}
	if b["paper"] != true {
		t.Fatal("brief must carry paper:true")
	}
	sections := b["sections"].([]map[string]any)
	if len(sections) != 2 {
		t.Fatalf("brief sections = %d, want 2", len(sections))
	}
	if _, err := json.Marshal(b); err != nil {
		t.Fatalf("brief must marshal: %v", err)
	}
}

// The live /v1/world/fund/ledger endpoint returns JSON, never a 5xx, and never
// reports a live broker.
func TestFundLedgerEndpoint(t *testing.T) {
	s := NewServer()
	mux := http.NewServeMux()
	s.Mount(mux)
	ts := httptest.NewServer(mux)
	defer ts.Close()

	resp, err := http.Get(ts.URL + "/v1/world/fund/ledger")
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	var body map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body["live"] != false {
		t.Fatalf("ledger endpoint reports live=%v, want false", body["live"])
	}
	if body["paper"] != true {
		t.Fatalf("ledger endpoint reports paper=%v, want true", body["paper"])
	}
}
