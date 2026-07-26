package world

import (
	"errors"
	"testing"
	"time"
)

// THE SAFETY INVARIANT. The whole point of the fund brain: it is autonomous for
// analysis + decisions but can NEVER place a real order. These tests prove it at
// the type/seam level, not by inspection.

// The engine's broker is a PaperBroker and reports non-live.
func TestEngineBrokerIsPaperOnly(t *testing.T) {
	e := newFundEngine(NewPaperBroker())
	if e.broker.Live() {
		t.Fatal("engine broker reports Live()==true — must be paper-only")
	}
	if _, ok := e.broker.(*PaperBroker); !ok {
		t.Fatalf("engine broker is %T, want *PaperBroker", e.broker)
	}
}

// A LiveBroker refuses every execution — there is no venue wiring behind it.
func TestLiveBrokerAlwaysRefuses(t *testing.T) {
	var b Broker = LiveBroker{}
	if !b.Live() {
		t.Fatal("LiveBroker.Live() must be true")
	}
	fills, err := b.Execute([]order{{Sleeve: "ai", Side: buy, Notional: 1000}})
	if !errors.Is(err, errLiveExecution) {
		t.Fatalf("LiveBroker.Execute must return errLiveExecution, got %v", err)
	}
	if fills != nil {
		t.Fatalf("LiveBroker must return no fills, got %d", len(fills))
	}
}

// Handing the engine a live broker must NOT produce a live engine: it fails
// closed to paper. This proves a wiring mistake cannot arm real execution.
func TestNewFundEngineRefusesLiveBroker(t *testing.T) {
	e := newFundEngine(LiveBroker{})
	if e.broker.Live() {
		t.Fatal("newFundEngine accepted a live broker — must fail closed to paper")
	}
	e = newFundEngine(nil)
	if e.broker == nil || e.broker.Live() {
		t.Fatal("newFundEngine(nil) must default to a non-live paper broker")
	}
}

// A full rebalance through the real engine executes only paper fills — every
// recorded fill is flagged paper, always.
func TestRebalanceRecordsOnlyPaperFills(t *testing.T) {
	e := newFundEngine(NewPaperBroker())
	if _, err := e.rebalance(fundTestUniverse(t)); err != nil {
		t.Fatalf("rebalance: %v", err)
	}
	e.led.mu.Lock()
	defer e.led.mu.Unlock()
	if len(e.led.history) == 0 {
		t.Fatal("expected paper fills after first rebalance")
	}
	for _, f := range e.led.history {
		if !f.Paper {
			t.Fatalf("non-paper fill recorded: %+v", f)
		}
	}
}

// PaperBroker fills every order at full notional, never errs.
func TestPaperBrokerFillsFull(t *testing.T) {
	b := NewPaperBroker()
	orders := []order{
		{Sleeve: "ai", Side: buy, Notional: 1000, At: time.Now()},
		{Sleeve: "gold", Side: sell, Notional: 500, At: time.Now()},
	}
	fills, err := b.Execute(orders)
	if err != nil {
		t.Fatalf("PaperBroker.Execute: %v", err)
	}
	if len(fills) != 2 {
		t.Fatalf("want 2 fills, got %d", len(fills))
	}
	for i, f := range fills {
		if !f.Paper || f.Filled != orders[i].Notional {
			t.Fatalf("fill %d = %+v, want paper full-notional", i, f)
		}
	}
}

// ── ledger accounting ────────────────────────────────────────────────────────

func TestLedgerApplyBuySell(t *testing.T) {
	l := newLedger(1000)
	// Buy 300 into ai: cash 700, cost 300.
	l.apply([]fill{{Order: order{Sleeve: "ai", Side: buy, Notional: 300}, Filled: 300, Paper: true}})
	if l.cash != 700 || l.positions["ai"].Cost != 300 {
		t.Fatalf("after buy: cash %.0f cost %.0f, want 700/300", l.cash, l.positions["ai"].Cost)
	}
	// Sell 100 of ai: cash 800, cost 200.
	l.apply([]fill{{Order: order{Sleeve: "ai", Side: sell, Notional: 100}, Filled: 100, Paper: true}})
	if l.cash != 800 || l.positions["ai"].Cost != 200 {
		t.Fatalf("after sell: cash %.0f cost %.0f, want 800/200", l.cash, l.positions["ai"].Cost)
	}
	if l.rebalance != 2 {
		t.Fatalf("rebalance count = %d, want 2", l.rebalance)
	}
	if len(l.history) != 2 {
		t.Fatalf("history len = %d, want 2 (append-only)", len(l.history))
	}
}

// A sell can never drive a paper position negative — it is floored at the cost
// basis (the engine only sells what it holds, but the ledger enforces it anyway).
func TestLedgerSellNeverGoesNegative(t *testing.T) {
	l := newLedger(1000)
	l.apply([]fill{{Order: order{Sleeve: "ai", Side: buy, Notional: 200}, Filled: 200, Paper: true}})
	l.apply([]fill{{Order: order{Sleeve: "ai", Side: sell, Notional: 999}, Filled: 999, Paper: true}})
	if l.positions["ai"].Cost != 0 {
		t.Fatalf("oversell cost = %.2f, want 0 (floored)", l.positions["ai"].Cost)
	}
	// Cash only recovers the actual basis (200), not the requested 999.
	if l.cash != 1000 {
		t.Fatalf("cash after oversell = %.2f, want 1000 (only basis returned)", l.cash)
	}
}

func TestLedgerMarkAndPnl(t *testing.T) {
	l := newLedger(1000)
	// Invest 400 into ai. Then mark ai at target weight 0.5 → marked 500.
	l.apply([]fill{{Order: order{Sleeve: "ai", Side: buy, Notional: 400}, Filled: 400, Paper: true}})
	l.mark([]sleeveScore{{key: "ai", weight: 0.5}})
	// markValue = 0.5*1000 = 500; cash = 600; pnl = 500 + 600 - 1000 = 100.
	if got := l.pnl(); got != 100 {
		t.Fatalf("pnl = %.2f, want 100", got)
	}
}

// A sleeve dropped from the book marks at remaining cost basis (winding down).
func TestLedgerMarkDroppedSleeveAtCost(t *testing.T) {
	l := newLedger(1000)
	l.apply([]fill{{Order: order{Sleeve: "gold", Side: buy, Notional: 300}, Filled: 300, Paper: true}})
	l.mark(nil) // gold no longer in book
	// markValue = 300 (cost); cash = 700; pnl = 300 + 700 - 1000 = 0.
	if got := l.pnl(); got != 0 {
		t.Fatalf("pnl for wound-down sleeve = %.2f, want 0", got)
	}
}

func TestSnapshotPositionsIsCopy(t *testing.T) {
	l := newLedger(1000)
	l.apply([]fill{{Order: order{Sleeve: "ai", Side: buy, Notional: 100}, Filled: 100, Paper: true}})
	snap := l.snapshotPositions()
	snap["ai"] = position{Sleeve: "ai", Cost: 999999}
	if l.positions["ai"].Cost != 100 {
		t.Fatal("snapshotPositions must return a copy — mutation leaked into ledger")
	}
}

// fundTestUniverse mirrors the model test's synthetic book (shared shape).
func fundTestUniverse(t *testing.T) map[string][]float64 {
	return syntheticUniverse(t)
}
