package world

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/hanzoai/world/internal/world/store"
)

// The search + analytics endpoints over the ingested-data LAKE — the CTO's "one
// place to query everything". Every ingested item (news, model observations, …)
// is a row; search ranks them (FTS bm25 when q is present, recency otherwise),
// analytics summarizes them. Both degrade to empty results, never 5xx.

// handleSearch serves GET /v1/world/search?q=&kind=&since=&country=&ticker=&limit= .
func (s *Server) handleSearch(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") || methodNotGet(w, r) {
		return
	}
	q := r.URL.Query()
	results := s.store.Lake.Search(store.SearchQuery{
		Q:       q.Get("q"),
		Kind:    strings.TrimSpace(q.Get("kind")),
		Country: strings.TrimSpace(q.Get("country")),
		Ticker:  strings.TrimSpace(q.Get("ticker")),
		Since:   parseSince(q.Get("since")),
		Limit:   atoiDefault(q.Get("limit"), 30),
	})
	out := make([]map[string]any, 0, len(results))
	for _, it := range results {
		m := map[string]any{
			"id": it.ID, "kind": it.Kind, "source": it.Source,
			"ts": it.TS.Format(time.RFC3339), "title": it.Title,
		}
		if it.Text != "" {
			m["text"] = it.Text
		}
		if len(it.Tickers) > 0 {
			m["tickers"] = it.Tickers
		}
		if it.Country != "" {
			m["country"] = it.Country
		}
		if it.HasGeo {
			m["lat"], m["lon"] = it.Lat, it.Lon
		}
		if it.Payload != "" {
			m["payload"] = json.RawMessage(it.Payload)
		}
		out = append(out, m)
	}
	writeJSON(w, http.StatusOK, "public, max-age=15, s-maxage=15, stale-while-revalidate=60", map[string]any{
		"query": q.Get("q"), "count": len(out), "results": out, "updatedAt": nowRFC(),
	})
}

// handleAnalytics serves GET /v1/world/analytics?hours= — a cross-cutting
// summary of the lake: totals and breakdowns by kind, source, and top tickers.
func (s *Server) handleAnalytics(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") || methodNotGet(w, r) {
		return
	}
	hours := clampInt(r.URL.Query().Get("hours"), 24, 1, 720)
	writeJSON(w, http.StatusOK, "public, max-age=30, s-maxage=30, stale-while-revalidate=120",
		s.store.Lake.Analytics(hours))
}

// parseSince accepts an absolute RFC3339 timestamp, a "<n>d" day window, a Go
// duration ("24h","90m"), or a bare integer of hours. Unparseable/empty → no
// lower bound.
func parseSince(raw string) time.Time {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return time.Time{}
	}
	if t, err := time.Parse(time.RFC3339, raw); err == nil {
		return t
	}
	if strings.HasSuffix(raw, "d") {
		if n, err := strconv.Atoi(strings.TrimSuffix(raw, "d")); err == nil && n > 0 {
			return time.Now().Add(-time.Duration(n) * 24 * time.Hour)
		}
	}
	if d, err := time.ParseDuration(raw); err == nil && d > 0 {
		return time.Now().Add(-d)
	}
	if n, err := strconv.Atoi(raw); err == nil && n > 0 {
		return time.Now().Add(-time.Duration(n) * time.Hour)
	}
	return time.Time{}
}
