package world

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"
)

// Congressional trading — the disclosed stock transactions of U.S. House and
// Senate members (STOCK Act filings). The "smart money in Congress" macro signal:
// who is buying and selling, and the net direction. Every free public feed for
// this data is now gated behind a key (the house/senate-stock-watcher S3 buckets
// went private, Capitol Trades' BFF is unstable), so this endpoint reads Quiver
// Quant's live feed when QUIVER_API_KEY is configured and degrades to a clean
// unavailable payload otherwise — the same key-gated pattern as the finnhub, eia
// and acled endpoints. The parser is real and tested; only the fetch needs a key.

const quiverCongressURL = "https://api.quiverquant.com/beta/live/congresstrading"

// handleCongress serves /v1/world/congress.
func (s *Server) handleCongress(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") || methodNotGet(w, r) {
		return
	}
	s.cachedJSON(w, "congress:v1",
		"public, max-age=3600, s-maxage=3600, stale-while-revalidate=7200",
		time.Hour, 2*time.Hour,
		func(ctx context.Context) (any, error) { return s.computeCongress(ctx) },
		func(w http.ResponseWriter, err error) {
			reason := "temporarily unavailable"
			if err == errMissingKey {
				reason = "QUIVER_API_KEY not configured"
			}
			writeJSON(w, http.StatusOK, "", map[string]any{
				"asOf": nowISO(), "unavailable": true, "reason": reason,
				"count": 0, "buys": 0, "sells": 0, "recent": []any{},
			})
		})
}

func (s *Server) computeCongress(ctx context.Context) (any, error) {
	key := env("QUIVER_API_KEY", "QUIVERQUANT_API_KEY")
	if key == "" {
		return nil, errMissingKey
	}
	body, status, err := s.get(ctx, quiverCongressURL, map[string]string{
		"Accept": "application/json", "Authorization": "Bearer " + key,
	})
	if err != nil {
		return nil, err
	}
	if status < 200 || status >= 300 {
		return nil, errUnavailable
	}
	trades := parseCongressTrades(body)
	buys, sells := 0, 0
	recent := make([]map[string]any, 0, 40)
	for i, t := range trades {
		switch t.Side {
		case "buy":
			buys++
		case "sell":
			sells++
		}
		if i < 40 {
			recent = append(recent, map[string]any{
				"member": t.Member, "ticker": t.Ticker, "side": t.Side,
				"amount": t.Range, "chamber": t.Chamber,
				"tradedAt": t.TradedAt, "reportedAt": t.ReportedAt,
			})
		}
	}
	return map[string]any{
		"asOf":   nowISO(),
		"source": "Quiver Quant · Congressional trading",
		"count":  len(trades),
		"buys":   buys,
		"sells":  sells,
		"recent": recent,
	}, nil
}

// errMissingKey signals an absent API key so the handler can degrade with a
// precise reason rather than a generic "unavailable". Package-private, never
// serialized.
var errMissingKey = &rotationError{"api key not configured"}

// ── pure parsing (unit-tested) ───────────────────────────────────────────────

type congressTrade struct {
	Member     string
	Ticker     string
	Side       string // "buy" | "sell" | ""
	Range      string
	Chamber    string
	TradedAt   string
	ReportedAt string
}

// parseCongressTrades reads Quiver Quant's live congresstrading JSON array.
// Malformed input yields an empty slice, never a panic. Field names follow
// Quiver's schema; the transaction is normalized to buy/sell.
func parseCongressTrades(body []byte) []congressTrade {
	var raw []struct {
		Representative  string `json:"Representative"`
		Ticker          string `json:"Ticker"`
		Transaction     string `json:"Transaction"`
		Range           string `json:"Range"`
		House           string `json:"House"`
		TransactionDate string `json:"TransactionDate"`
		ReportDate      string `json:"ReportDate"`
	}
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil
	}
	out := make([]congressTrade, 0, len(raw))
	for _, r := range raw {
		out = append(out, congressTrade{
			Member:     strings.TrimSpace(r.Representative),
			Ticker:     strings.TrimSpace(r.Ticker),
			Side:       normalizeTradeSide(r.Transaction),
			Range:      strings.TrimSpace(r.Range),
			Chamber:    strings.TrimSpace(r.House),
			TradedAt:   warnDate(r.TransactionDate),
			ReportedAt: warnDate(r.ReportDate),
		})
	}
	return out
}

// normalizeTradeSide maps Quiver's transaction labels ("Purchase", "Sale",
// "Sale (Partial)", "Sale (Full)", "Exchange") to buy/sell. Unknown → "".
func normalizeTradeSide(t string) string {
	t = strings.ToLower(strings.TrimSpace(t))
	switch {
	case strings.Contains(t, "purchase"), strings.Contains(t, "buy"):
		return "buy"
	case strings.Contains(t, "sale"), strings.Contains(t, "sell"):
		return "sell"
	default:
		return ""
	}
}
