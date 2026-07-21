package world

import (
	"errors"
	"sort"
	"sync"
	"time"
)

// fund_broker.go is the PAPER / LIVE boundary — the one seam the whole fund
// brain routes execution through.
//
// SAFETY INVARIANT (enforced by the type system and proven in fund_broker_test.go):
// the brain is fully autonomous for analysis and decision-making, but it can
// only ever reach a Broker whose sole real implementation is PaperBroker, which
// records simulated fills against an in-memory ledger and touches no external
// venue. LiveBroker is a compile-present stub that returns errLiveExecution on
// every call: no brokerage/exchange client, no order-router, no credential is
// wired anywhere in this package. Moving real funds requires a human to build
// and authorize a real implementation — it cannot happen by running this code.

// errLiveExecution is returned by every LiveBroker method. Live trading is a
// human-authorized action, never an autonomous one.
var errLiveExecution = errors.New("live execution requires human authorization")

// side is the direction of a paper order.
type side string

const (
	buy  side = "buy"
	sell side = "sell"
)

// order is one instruction the engine emits to rebalance toward the book. Notional
// is in the fund's simulated base currency (USD), always positive.
type order struct {
	Sleeve   string    `json:"sleeve"`
	Side     side      `json:"side"`
	Notional float64   `json:"notional"`
	Reason   string    `json:"reason"`
	At       time.Time `json:"at"`
}

// fill is the broker's response to an order: what actually "executed". For the
// paper broker a fill mirrors the order exactly (no slippage model — this is a
// weight-tracking simulation, not an execution simulator).
type fill struct {
	Order  order     `json:"order"`
	Filled float64   `json:"filled"` // notional filled (== order.Notional for paper)
	Paper  bool      `json:"paper"`  // always true; a real fill would be false
	At     time.Time `json:"at"`
}

// Broker is the execution seam. The engine holds a Broker, never a concrete type,
// so the only way to make it place a real order is to give it a real
// implementation — which this package deliberately does not provide.
type Broker interface {
	// Execute records (paper) or would place (live, refused) a batch of orders,
	// returning the resulting fills. It must be safe for concurrent use.
	Execute(orders []order) ([]fill, error)
	// Live reports whether this broker moves real funds. The engine asserts it is
	// false before it runs; a true here is a wiring bug that must fail loudly.
	Live() bool
}

// PaperBroker is the ONLY real Broker. It "fills" every order at its full
// notional and appends nothing external — the position/PnL accounting lives in
// the ledger the engine keeps. Stateless and trivially concurrency-safe.
type PaperBroker struct{}

// NewPaperBroker returns the paper broker. This is the only Broker constructor
// the engine ever calls.
func NewPaperBroker() *PaperBroker { return &PaperBroker{} }

// Execute fills every order at full notional as a paper fill.
func (PaperBroker) Execute(orders []order) ([]fill, error) {
	now := time.Now().UTC()
	fills := make([]fill, 0, len(orders))
	for _, o := range orders {
		fills = append(fills, fill{Order: o, Filled: o.Notional, Paper: true, At: now})
	}
	return fills, nil
}

// Live is always false: the paper broker never moves real funds.
func (PaperBroker) Live() bool { return false }

// LiveBroker is a stub. It implements Broker so the seam is visibly complete, but
// every method refuses: there is no venue client, and there never will be one in
// this package. It exists to make the boundary explicit and to prove in tests
// that no autonomous path can execute for real.
type LiveBroker struct{}

// Execute always refuses. Real execution is a human-authorized action.
func (LiveBroker) Execute([]order) ([]fill, error) { return nil, errLiveExecution }

// Live is true: this broker WOULD move real funds — which is exactly why the
// engine refuses to run with it (fund_engine.go asserts Broker.Live() == false).
func (LiveBroker) Live() bool { return true }

// ── the paper ledger ─────────────────────────────────────────────────────────

// position is the fund's simulated holding in one sleeve: the invested cost
// basis (net notional bought minus sold) and the sleeve's current model weight.
type position struct {
	Sleeve string  `json:"sleeve"`
	Cost   float64 `json:"cost"`   // net notional invested (paper), USD
	Weight float64 `json:"weight"` // latest target weight from the book, [0,1]
}

// ledger is the append-only record of the paper fund: current positions, the
// full order/fill history, and the running simulated PnL. Guarded by its own
// mutex; the engine writes it, the /ledger handler reads a snapshot.
type ledger struct {
	mu        sync.Mutex
	cash      float64             // uninvested simulated capital, USD
	capital   float64             // starting capital, USD (for return %)
	positions map[string]position // sleeve → position
	history   []fill              // append-only fill log (most recent last)
	rebalance int                 // number of rebalance cycles applied
	lastAt    time.Time           // time of the last applied cycle
	markValue float64             // last marked portfolio value (positions marked to weight×equity)
}

// newLedger opens a paper ledger with the given starting capital, fully in cash.
func newLedger(capital float64) *ledger {
	return &ledger{
		cash:      capital,
		capital:   capital,
		positions: map[string]position{},
	}
}

// apply records a batch of paper fills into the ledger: a buy moves cash into a
// sleeve's cost basis, a sell moves it back. Cost basis is floored at zero (a
// sell never drives a paper position negative — the engine only sells what it
// holds). Append-only: every fill is kept in history.
func (l *ledger) apply(fills []fill) {
	l.mu.Lock()
	defer l.mu.Unlock()
	for _, f := range fills {
		p := l.positions[f.Order.Sleeve]
		p.Sleeve = f.Order.Sleeve
		switch f.Order.Side {
		case buy:
			p.Cost += f.Filled
			l.cash -= f.Filled
		case sell:
			cut := f.Filled
			if cut > p.Cost {
				cut = p.Cost
			}
			p.Cost -= cut
			l.cash += cut
		}
		l.positions[f.Order.Sleeve] = p
		l.history = append(l.history, f)
	}
	l.rebalance++
	l.lastAt = time.Now().UTC()
}

// setWeights records the latest target weights from the book onto positions so a
// ledger snapshot shows the model's intended allocation next to the paper cost.
func (l *ledger) setWeights(scores []sleeveScore) {
	l.mu.Lock()
	defer l.mu.Unlock()
	for _, s := range scores {
		p := l.positions[s.key]
		p.Sleeve = s.key
		p.Weight = s.weight
		l.positions[s.key] = p
	}
}

// investedCost is the total paper capital currently allocated across sleeves.
func (l *ledger) investedCost() float64 {
	var sum float64
	for _, p := range l.positions {
		sum += p.Cost
	}
	return sum
}

// snapshotPositions returns a copy of the current positions map so the pure
// diffOrders can read a consistent view without holding the ledger lock.
func (l *ledger) snapshotPositions() map[string]position {
	l.mu.Lock()
	defer l.mu.Unlock()
	out := make(map[string]position, len(l.positions))
	for k, v := range l.positions {
		out[k] = v
	}
	return out
}

// mark values the paper book: each held sleeve is marked by its latest model
// weight against the current equity, and the simulated PnL is the marked value
// plus cash minus starting capital. This is a weight-tracking mark — the sim
// measures whether the model's ALLOCATION tracks the sleeve reads, not tick PnL.
func (l *ledger) mark(scores []sleeveScore) {
	weight := make(map[string]float64, len(scores))
	for _, s := range scores {
		weight[s.key] = s.weight
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	equity := l.capital
	var marked float64
	for k, p := range l.positions {
		// A sleeve still in the book marks at target×equity; one that dropped out
		// marks at its remaining cost basis (it is being wound down).
		if w, ok := weight[k]; ok {
			marked += w * equity
		} else {
			marked += p.Cost
		}
	}
	l.markValue = marked
}

// pnl is the simulated profit/loss: marked positions + uninvested cash − start.
func (l *ledger) pnl() float64 {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.markValue + l.cash - l.capital
}

// sortOrders orders a batch deterministically by sleeve key so identical inputs
// yield identical ledger history.
func sortOrders(os []order) {
	sort.SliceStable(os, func(i, j int) bool { return os[i].Sleeve < os[j].Sleeve })
}
