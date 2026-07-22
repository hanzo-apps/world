package world

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/hanzoai/world/internal/world/markethours"
)

// handlers_fund.go serves the autonomous multi-asset fund brain:
//
//	GET /v1/world/fund         the full book — sleeves, preferred portfolio,
//	                           overall stance (cached like the rotation scanner)
//	GET /v1/world/fund/ledger  the PAPER ledger — positions, order history,
//	                           simulated PnL (from the live autonomous engine)
//	GET /v1/world/fund/brief   a deterministic daily brief composed from the book
//
// The book is computed the same way the autonomous engine computes it
// (scoreSleeves), so the public read and the paper rebalancer never drift. All
// execution is paper-only through the Broker seam — see fund_broker.go.

// handleFund serves the full fund book. Computed server-side, one shared cache
// warms every viewer, degrades to a clean unavailable 200 — never a 5xx.
func (s *Server) handleFund(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") || methodNotGet(w, r) {
		return
	}
	s.cachedJSON(w, "fund:v1",
		"public, max-age=900, s-maxage=900, stale-while-revalidate=1800",
		15*time.Minute, 30*time.Minute,
		func(ctx context.Context) (any, error) {
			closes := s.fetchCloses(ctx, fundUniverse())
			scores := scoreSleeves(closes)
			if len(scores) == 0 {
				return nil, errUnavailable
			}
			return fundBookView(scores), nil
		},
		func(w http.ResponseWriter, err error) {
			writeJSON(w, http.StatusOK, "", map[string]any{
				"asOf": nowISO(), "benchmark": rotationBenchmark, "unavailable": true,
				"stance": "neutral", "sleeves": []any{},
				"narrative": "Fund model temporarily unavailable.",
			})
		})
}

// fundBookView renders scored sleeves as the public book: each sleeve's read plus
// its preferred-portfolio weight, ordered by conviction, with the overall stance.
func fundBookView(scores []sleeveScore) map[string]any {
	stance, frac := overallStance(scores)
	sleeves := make([]map[string]any, 0, len(scores))
	for _, s := range scores {
		sleeves = append(sleeves, map[string]any{
			"key": s.key, "label": s.label, "class": s.class,
			"quadrant": s.quadrant, "stance": s.stance,
			"rsRatio": round2s(s.ratio), "rsMomentum": round2s(s.mom),
			"ret21": round2s(s.ret21), "ret63": round2s(s.ret63),
			"conviction": round2s(s.conviction), "weight": round2s(s.weight * 100),
		})
	}
	return map[string]any{
		"asOf": nowISO(), "benchmark": rotationBenchmark, "window": "6mo",
		"marketSession": markethours.CurrentSession(time.Now()).String(),
		"stance":        stance, "riskFraction": round2s(frac),
		"sleeves":   sleeves,
		"narrative": fundNarrative(stance, scores),
		"paper":     true,
		"disclaimer": "Autonomous model output for a PAPER portfolio — not investment advice, " +
			"and no real orders are ever placed.",
	}
}

// handleFundLedger serves the paper ledger straight from the autonomous engine —
// positions, order history, and simulated PnL. No network, no cache (it is live
// in-process state); degrades to an empty-but-well-formed ledger before the first
// rebalance cycle.
func (s *Server) handleFundLedger(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") || methodNotGet(w, r) {
		return
	}
	writeJSON(w, http.StatusOK, "no-store", s.fund.ledgerView())
}

// handleFundBrief serves the deterministic daily brief composed from the latest
// book the autonomous engine acted on (falls back to a fresh compute if the
// engine has not cycled yet).
func (s *Server) handleFundBrief(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") || methodNotGet(w, r) {
		return
	}
	s.cachedJSON(w, "fund-brief:v1",
		"public, max-age=1800, s-maxage=1800, stale-while-revalidate=3600",
		30*time.Minute, 60*time.Minute,
		func(ctx context.Context) (any, error) {
			scores := s.fund.currentScores()
			if len(scores) == 0 {
				closes := s.fetchCloses(ctx, fundUniverse())
				scores = scoreSleeves(closes)
			}
			if len(scores) == 0 {
				return nil, errUnavailable
			}
			return fundBrief(scores), nil
		},
		func(w http.ResponseWriter, err error) {
			writeJSON(w, http.StatusOK, "", map[string]any{
				"asOf": nowISO(), "unavailable": true,
				"headline": "Fund brief temporarily unavailable.", "sections": []any{},
			})
		})
}

// ── engine accessors ─────────────────────────────────────────────────────────

// currentScores returns the sleeves from the engine's last acted-on book (nil
// before the first cycle).
func (e *fundEngine) currentScores() []sleeveScore {
	b := e.book()
	if b == nil {
		return nil
	}
	return b.scores
}

// ledgerView renders the paper ledger as the /ledger response.
func (e *fundEngine) ledgerView() map[string]any {
	l := e.led
	l.mu.Lock()
	positions := make([]map[string]any, 0, len(l.positions))
	for _, p := range l.positions {
		if p.Cost <= 0 && p.Weight <= 0 {
			continue
		}
		positions = append(positions, map[string]any{
			"sleeve": p.Sleeve, "cost": round2s(p.Cost),
			"targetWeight": round2s(p.Weight * 100),
		})
	}
	// Most-recent orders last; cap the exposed history so the response stays bounded.
	const maxHist = 200
	hist := l.history
	if len(hist) > maxHist {
		hist = hist[len(hist)-maxHist:]
	}
	orders := make([]map[string]any, 0, len(hist))
	for _, f := range hist {
		orders = append(orders, map[string]any{
			"sleeve": f.Order.Sleeve, "side": string(f.Order.Side),
			"notional": round2s(f.Filled), "reason": f.Order.Reason,
			"paper": f.Paper, "at": f.At.Format(time.RFC3339),
		})
	}
	cash, capital, invested := l.cash, l.capital, l.investedCost()
	marked, cycles, lastAt := l.markValue, l.rebalance, l.lastAt
	live := e.broker.Live()
	l.mu.Unlock()

	pnl := marked + cash - capital
	ret := 0.0
	if capital > 0 {
		ret = pnl / capital * 100
	}
	last := ""
	if !lastAt.IsZero() {
		last = lastAt.Format(time.RFC3339)
	}
	return map[string]any{
		"asOf": nowISO(), "paper": true, "live": live,
		"startingCapital": round2s(capital), "cash": round2s(cash),
		"investedCost": round2s(invested), "markValue": round2s(marked),
		"simPnl": round2s(pnl), "simReturnPct": round2s(ret),
		"rebalanceCycles": cycles, "lastRebalance": last,
		"positions": positions, "orders": orders,
		"disclaimer": "PAPER portfolio. Every fill is simulated; no real order is ever placed.",
	}
}

// ── narrative + brief (deterministic templates) ──────────────────────────────

// fundNarrative is a one-line read of the book's posture.
func fundNarrative(stance string, scores []sleeveScore) string {
	lead := "the book is broadly balanced"
	if len(scores) > 0 {
		top := scores[0]
		lead = fmt.Sprintf("%s leads the book at %.0f%% (%s)", top.label, top.weight*100, strings.ToLower(top.stance))
	}
	switch stance {
	case "risk-on":
		return "Risk-on: conviction concentrates in accumulating and leading sleeves — " + lead + "."
	case "risk-off":
		return "Risk-off: the book tilts to trimming and defensive sleeves — " + lead + "."
	default:
		return "Balanced: no decisive tilt across the sleeves — " + lead + "."
	}
}

// fundBrief composes the deterministic daily brief: a headline, the top
// conviction ideas with their stance, and the sleeves the model is trimming or
// avoiding — a plain-English projection of the book, never fabricated numbers.
func fundBrief(scores []sleeveScore) map[string]any {
	stance, frac := overallStance(scores)
	var accumulate, trim []map[string]any
	for _, s := range scores {
		row := map[string]any{
			"sleeve": s.label, "class": s.class, "stance": s.stance,
			"weight": round2s(s.weight * 100), "quadrant": s.quadrant,
			"note": fmt.Sprintf("%s · RS-mom %.1f · 3-mo %.1f%%", s.stance, s.mom-100, s.ret63),
		}
		switch s.quadrant {
		case "improving", "leading":
			accumulate = append(accumulate, row)
		case "weakening", "lagging":
			trim = append(trim, row)
		}
	}
	headline := fmt.Sprintf("Fund brain is %s (%.0f%% of conviction in risk sleeves).", stance, frac*100)
	sections := []map[string]any{
		{"title": "Accumulate / core", "ideas": accumulate},
		{"title": "Trim / avoid", "ideas": trim},
	}
	return map[string]any{
		"asOf": nowISO(), "date": dateOnly(time.Now()),
		"headline": headline, "stance": stance,
		"narrative": fundNarrative(stance, scores),
		"sections":  sections, "paper": true,
		"disclaimer": "Autonomous PAPER model output — not investment advice. No real orders are placed.",
	}
}
