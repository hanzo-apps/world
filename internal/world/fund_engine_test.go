package world

import (
	"math"
	"testing"
	"time"
)

// diffOrders is the pure rebalancer. Pin the band, direction, notional sizing,
// sell-before-buy ordering, and the drop-out sell-down.
func TestDiffOrdersBasic(t *testing.T) {
	scores := []sleeveScore{
		{key: "ai", weight: 0.5},
		{key: "gold", weight: 0.1},
	}
	// Held: ai 20% (200/1000), gold 30% (300/1000). equity 1000.
	positions := map[string]position{
		"ai":   {Sleeve: "ai", Cost: 200},
		"gold": {Sleeve: "gold", Cost: 300},
	}
	orders := diffOrders(scores, positions, 1000, time.Now())
	if len(orders) != 2 {
		t.Fatalf("want 2 orders, got %d: %+v", len(orders), orders)
	}
	// Sell first (gold: 0.3→0.1, drift -0.2, notional 200), then buy (ai: 0.2→0.5,
	// drift +0.3, notional 300).
	if orders[0].Side != sell || orders[0].Sleeve != "gold" {
		t.Fatalf("first order = %+v, want sell gold", orders[0])
	}
	if math.Abs(orders[0].Notional-200) > 1e-9 {
		t.Fatalf("gold sell notional = %.2f, want 200", orders[0].Notional)
	}
	if orders[1].Side != buy || orders[1].Sleeve != "ai" {
		t.Fatalf("second order = %+v, want buy ai", orders[1])
	}
	if math.Abs(orders[1].Notional-300) > 1e-9 {
		t.Fatalf("ai buy notional = %.2f, want 300", orders[1].Notional)
	}
}

// Drift below the rebalance band produces no order (no churn).
func TestDiffOrdersRespectsBand(t *testing.T) {
	scores := []sleeveScore{{key: "ai", weight: 0.31}}
	positions := map[string]position{"ai": {Sleeve: "ai", Cost: 300}} // held 0.30
	// drift 0.01 < band 0.02 → skip.
	if orders := diffOrders(scores, positions, 1000, time.Now()); len(orders) != 0 {
		t.Fatalf("sub-band drift must produce no order, got %+v", orders)
	}
}

// A sleeve that dropped out of the book (weight 0) but is still held gets sold
// down.
func TestDiffOrdersSellsDroppedSleeve(t *testing.T) {
	scores := []sleeveScore{{key: "ai", weight: 1.0}}
	positions := map[string]position{
		"ai":   {Sleeve: "ai", Cost: 500},
		"gold": {Sleeve: "gold", Cost: 400}, // no longer in book
	}
	orders := diffOrders(scores, positions, 1000, time.Now())
	var soldGold bool
	for _, o := range orders {
		if o.Sleeve == "gold" && o.Side == sell {
			soldGold = true
			if math.Abs(o.Notional-400) > 1e-9 {
				t.Fatalf("gold sell-down notional = %.2f, want 400", o.Notional)
			}
		}
	}
	if !soldGold {
		t.Fatalf("dropped sleeve gold must be sold down, orders=%+v", orders)
	}
}

func TestDiffOrdersZeroEquity(t *testing.T) {
	if o := diffOrders([]sleeveScore{{key: "ai", weight: 1}}, nil, 0, time.Now()); o != nil {
		t.Fatalf("zero equity must yield no orders, got %+v", o)
	}
}

// diffOrders is deterministic: identical inputs → identical output (stable order).
func TestDiffOrdersDeterministic(t *testing.T) {
	scores := []sleeveScore{{key: "zed", weight: 0.3}, {key: "abc", weight: 0.3}, {key: "mid", weight: 0.3}}
	a := diffOrders(scores, nil, 1000, time.Time{})
	b := diffOrders(scores, nil, 1000, time.Time{})
	if len(a) != len(b) {
		t.Fatalf("nondeterministic length %d vs %d", len(a), len(b))
	}
	for i := range a {
		if a[i].Sleeve != b[i].Sleeve || a[i].Side != b[i].Side {
			t.Fatalf("order %d differs: %+v vs %+v", i, a[i], b[i])
		}
	}
	// Buys sorted by sleeve key.
	for i := 1; i < len(a); i++ {
		if a[i-1].Sleeve > a[i].Sleeve {
			t.Fatalf("orders not sorted by sleeve: %s > %s", a[i-1].Sleeve, a[i].Sleeve)
		}
	}
}

// A second rebalance with an unchanged book is a no-op: the paper book already
// matches its targets, so no new orders are cut (idempotent convergence).
func TestRebalanceConvergesThenIdle(t *testing.T) {
	e := newFundEngine(NewPaperBroker())
	uni := syntheticUniverse(t)
	if _, err := e.rebalance(uni); err != nil {
		t.Fatalf("first rebalance: %v", err)
	}
	first := len(e.led.history)
	if first == 0 {
		t.Fatal("first rebalance cut no orders")
	}
	if _, err := e.rebalance(uni); err != nil {
		t.Fatalf("second rebalance: %v", err)
	}
	if len(e.led.history) != first {
		t.Fatalf("second identical rebalance cut %d new orders, want 0 (converged)",
			len(e.led.history)-first)
	}
}

func TestRebalanceUnavailableOnThinData(t *testing.T) {
	e := newFundEngine(NewPaperBroker())
	if _, err := e.rebalance(map[string][]float64{rotationBenchmark: {1, 2, 3}}); err == nil {
		t.Fatal("thin data must return an error, not a book")
	}
}

// The book the engine acts on is retrievable and consistent with a fresh score.
func TestEngineBookRoundtrip(t *testing.T) {
	e := newFundEngine(NewPaperBroker())
	if e.book() != nil {
		t.Fatal("book must be nil before the first cycle")
	}
	if _, err := e.rebalance(syntheticUniverse(t)); err != nil {
		t.Fatalf("rebalance: %v", err)
	}
	b := e.book()
	if b == nil || len(b.scores) == 0 {
		t.Fatal("book must be populated after a cycle")
	}
	if b.stance == "" {
		t.Fatal("book stance must be set")
	}
}
