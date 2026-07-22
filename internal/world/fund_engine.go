package world

import (
	"context"
	"fmt"
	"math"
	"sync"
	"time"
)

// fund_engine.go is the autonomous brain. On an interval it recomputes the book
// (scoreSleeves), diffs the preferred portfolio against the current paper
// positions, and routes rebalance orders through the Broker seam into the
// append-only paper ledger, tracking simulated PnL. It is analysis + decision
// only: the Broker it holds is a PaperBroker, asserted non-live before every run.

const (
	// fundCapital is the paper fund's starting simulated capital, USD.
	fundCapital = 1_000_000.0
	// fundInterval is the autonomous rebalance cadence.
	fundInterval = 6 * time.Hour
	// rebalanceBand is the minimum absolute weight drift (target − held) that
	// justifies an order, so tiny model wiggles don't churn the paper book.
	rebalanceBand = 0.02
	// fundRange is the price history window the book is scored over.
	fundRange = "range=6mo&interval=1d"
	// fundFetchTO bounds each per-symbol Yahoo fetch.
	fundFetchTO = 8 * time.Second
)

// fundEngine owns the paper fund: the execution seam (broker), the ledger, and
// the latest computed book. Safe for concurrent use — the ledger guards its own
// state and book is swapped under bookMu.
type fundEngine struct {
	broker Broker
	led    *ledger

	bookMu   sync.Mutex
	lastBook *fundBook
}

// fundBook is the computed preferred portfolio at a point in time.
type fundBook struct {
	asOf    time.Time
	scores  []sleeveScore
	stance  string
	riskFr  float64
}

// newFundEngine builds the paper fund. It refuses any live broker: the fund is
// paper-only by construction, and a live broker here is a wiring bug.
func newFundEngine(b Broker) *fundEngine {
	if b == nil || b.Live() {
		// Fail closed to the paper broker rather than ever run live autonomously.
		b = NewPaperBroker()
	}
	return &fundEngine{broker: b, led: newLedger(fundCapital)}
}

// diffOrders is the pure rebalancer: given the target weights (the book) and the
// current paper positions, emit the buy/sell orders that move each sleeve's held
// fraction toward its target, in notional against `equity`. A sleeve only trades
// when it drifts past rebalanceBand. Sells come before buys so freed cash funds
// the buys within one cycle. Pure and fully unit-tested.
func diffOrders(scores []sleeveScore, positions map[string]position, equity float64, at time.Time) []order {
	if equity <= 0 {
		return nil
	}
	target := make(map[string]float64, len(scores))
	for _, s := range scores {
		target[s.key] = s.weight
	}
	// Every sleeve that is either targeted now or held from before must be
	// considered, so a sleeve that dropped out of the book is sold down.
	keys := make(map[string]bool, len(scores)+len(positions))
	for k := range target {
		keys[k] = true
	}
	for k := range positions {
		keys[k] = true
	}

	var sells, buys []order
	for k := range keys {
		held := positions[k].Cost / equity
		want := target[k]
		drift := want - held
		if math.Abs(drift) < rebalanceBand {
			continue
		}
		notional := math.Abs(drift) * equity
		if drift < 0 {
			sells = append(sells, order{
				Sleeve: k, Side: sell, Notional: notional, At: at,
				Reason: fmt.Sprintf("trim to %.0f%% (held %.0f%%)", want*100, held*100),
			})
		} else {
			buys = append(buys, order{
				Sleeve: k, Side: buy, Notional: notional, At: at,
				Reason: fmt.Sprintf("add to %.0f%% (held %.0f%%)", want*100, held*100),
			})
		}
	}
	// Deterministic order (sleeve key) so identical inputs give identical output —
	// tests and the ledger history stay stable.
	sortOrders(sells)
	sortOrders(buys)
	return append(sells, buys...)
}

// rebalance applies one autonomous cycle: score the fresh closes into a book,
// record the target weights, diff against the paper positions, execute through
// the broker, and fold the fills into the ledger. Returns the book it acted on.
func (e *fundEngine) rebalance(closes map[string][]float64) (*fundBook, error) {
	scores := scoreSleeves(closes)
	if len(scores) == 0 {
		return nil, errUnavailable
	}
	stance, frac := overallStance(scores)
	book := &fundBook{asOf: time.Now().UTC(), scores: scores, stance: stance, riskFr: frac}

	e.led.setWeights(scores)
	equity := e.led.capital // rebalance against constant starting equity (paper, fully-invested target)
	orders := diffOrders(scores, e.led.snapshotPositions(), equity, book.asOf)
	if len(orders) > 0 {
		fills, err := e.broker.Execute(orders)
		if err != nil {
			return nil, err
		}
		e.led.apply(fills)
	}
	e.led.mark(scores)

	e.bookMu.Lock()
	e.lastBook = book
	e.bookMu.Unlock()
	return book, nil
}

// book returns the last computed book (nil until the first cycle).
func (e *fundEngine) book() *fundBook {
	e.bookMu.Lock()
	defer e.bookMu.Unlock()
	return e.lastBook
}

// start runs the autonomous loop: rebalance once shortly after boot, then every
// fundInterval, until ctx is cancelled. The fetch is bounded and single-sourced
// through the server's shared Yahoo client. Never live: broker is paper.
func (e *fundEngine) start(ctx context.Context, s *Server) {
	go func() {
		e.runOnce(ctx, s)
		for {
			select {
			case <-ctx.Done():
				return
			case <-time.After(jitter(fundInterval)):
				e.runOnce(ctx, s)
			}
		}
	}()
}

// runOnce fetches the universe and applies one rebalance cycle, logging (never
// crashing) on failure so a thin-data window just skips.
func (e *fundEngine) runOnce(ctx context.Context, s *Server) {
	fctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	closes := s.fetchCloses(fctx, fundUniverse())
	if _, err := e.rebalance(closes); err != nil {
		logf("fund-brain: rebalance skipped: %v", err)
	}
}
