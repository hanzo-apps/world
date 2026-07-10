package store

import (
	"testing"
	"time"
)

func TestLakeIngestSearchRoundTrip(t *testing.T) {
	db := openTestDB(t)
	now := time.Now()
	items := []Item{
		{ID: "n1", Kind: "news", Source: "coindesk.com", TS: now, Title: "Bitcoin ETF approved by regulators", Tickers: []string{"BTC"}},
		{ID: "n2", Kind: "news", Source: "sec.gov", TS: now, Title: "SEC announces new disclosure rules"},
		{ID: "o1", Kind: "observation", Source: "gdelt", TS: now, Title: "Ukraine", Country: "UA"},
	}
	if err := db.Lake.insert(items); err != nil {
		t.Fatalf("insert: %v", err)
	}

	// Full-text: "regulators" hits only n1.
	if got := db.Lake.Search(SearchQuery{Q: "regulators"}); len(got) != 1 || got[0].ID != "n1" {
		t.Fatalf("search regulators = %+v, want [n1]", ids(got))
	}
	// Empty query browses by recency across ALL kinds.
	if got := db.Lake.Search(SearchQuery{}); len(got) != 3 {
		t.Fatalf("browse all = %v, want 3 rows", ids(got))
	}
	// Tickers survive the round-trip.
	got := db.Lake.Search(SearchQuery{Q: "bitcoin"})
	if len(got) != 1 || len(got[0].Tickers) != 1 || got[0].Tickers[0] != "btc" {
		t.Fatalf("tickers round-trip = %+v", got)
	}
}

func TestSearchFTSRanking(t *testing.T) {
	db := openTestDB(t)
	now := time.Now()
	// a mentions the term twice in the title, b once in the body → a ranks first.
	if err := db.Lake.insert([]Item{
		{ID: "a", Kind: "news", TS: now, Title: "Bitcoin Bitcoin rally continues"},
		{ID: "b", Kind: "news", TS: now, Title: "Markets update", Text: "a passing bitcoin mention"},
	}); err != nil {
		t.Fatalf("insert: %v", err)
	}
	got := db.Lake.Search(SearchQuery{Q: "bitcoin"})
	if len(got) != 2 {
		t.Fatalf("want 2 hits, got %v", ids(got))
	}
	if got[0].ID != "a" {
		t.Fatalf("bm25 ranking = %v, want a ranked first", ids(got))
	}
}

func TestSearchFilters(t *testing.T) {
	db := openTestDB(t)
	now := time.Now()
	old := now.Add(-48 * time.Hour)
	if err := db.Lake.insert([]Item{
		{ID: "fresh", Kind: "news", Source: "cnbc.com", TS: now, Title: "Fed rate decision", Country: "US", Tickers: []string{"SPY"}},
		{ID: "stale", Kind: "news", Source: "cnbc.com", TS: old, Title: "Fed rate decision old", Country: "US"},
		{ID: "obs", Kind: "observation", TS: now, Title: "Fed watch", Country: "US"},
	}); err != nil {
		t.Fatalf("insert: %v", err)
	}
	// kind filter
	if got := db.Lake.Search(SearchQuery{Q: "fed", Kind: "observation"}); len(got) != 1 || got[0].ID != "obs" {
		t.Fatalf("kind filter = %v", ids(got))
	}
	// since filter drops the 48h-old row
	if got := db.Lake.Search(SearchQuery{Q: "fed", Kind: "news", Since: now.Add(-24 * time.Hour)}); len(got) != 1 || got[0].ID != "fresh" {
		t.Fatalf("since filter = %v", ids(got))
	}
	// ticker filter (exact token, no substring false-hit)
	if got := db.Lake.Search(SearchQuery{Ticker: "SPY"}); len(got) != 1 || got[0].ID != "fresh" {
		t.Fatalf("ticker filter = %v", ids(got))
	}
	if got := db.Lake.Search(SearchQuery{Ticker: "SP"}); len(got) != 0 {
		t.Fatalf("ticker substring must not match, got %v", ids(got))
	}
	// country filter
	if got := db.Lake.Search(SearchQuery{Country: "US"}); len(got) != 3 {
		t.Fatalf("country filter = %v, want all 3 US rows", ids(got))
	}
}

func TestRetentionPrune(t *testing.T) {
	db := openTestDB(t)
	now := time.Now()
	// Insert one expired and one fresh row with explicit created_at (white-box).
	mustExec(t, db, `INSERT INTO items(id,kind,source,ts,title,text,tickers,country,lat,lon,payload,created_at)
		VALUES ('old','news','s',?, 'old title','','','',NULL,NULL,'', ?)`,
		now.Unix(), now.Add(-10*24*time.Hour).Unix())
	mustExec(t, db, `INSERT INTO items(id,kind,source,ts,title,text,tickers,country,lat,lon,payload,created_at)
		VALUES ('new','news','s',?, 'new title','','','',NULL,NULL,'', ?)`,
		now.Unix(), now.Unix())

	if n := db.Lake.Prune(7 * 24 * time.Hour); n != 1 {
		t.Fatalf("prune removed %d, want 1", n)
	}
	// The FTS index must follow the delete (trigger) — the pruned row is unsearchable.
	if got := db.Lake.Search(SearchQuery{Q: "old"}); len(got) != 0 {
		t.Fatalf("pruned row still searchable via FTS: %v", ids(got))
	}
	if got := db.Lake.Search(SearchQuery{Q: "new"}); len(got) != 1 {
		t.Fatalf("fresh row lost after prune: %v", ids(got))
	}
}

func TestAnalyticsSummary(t *testing.T) {
	db := openTestDB(t)
	now := time.Now()
	if err := db.Lake.insert([]Item{
		{ID: "1", Kind: "news", Source: "coindesk.com", TS: now, Title: "a", Tickers: []string{"BTC", "ETH"}},
		{ID: "2", Kind: "news", Source: "coindesk.com", TS: now, Title: "b", Tickers: []string{"BTC"}},
		{ID: "3", Kind: "observation", Source: "gdelt", TS: now, Title: "c"},
	}); err != nil {
		t.Fatalf("insert: %v", err)
	}
	a := db.Lake.Analytics(24)
	if a.Total != 3 {
		t.Fatalf("total = %d, want 3", a.Total)
	}
	if kind := countFor(a.ByKind, "news"); kind != 2 {
		t.Fatalf("byKind news = %d, want 2", kind)
	}
	if src := countFor(a.BySource, "coindesk.com"); src != 2 {
		t.Fatalf("bySource coindesk = %d, want 2", src)
	}
	if btc := countFor(a.TopTickers, "btc"); btc != 2 {
		t.Fatalf("topTickers btc = %d, want 2", btc)
	}
	if len(a.TopTickers) == 0 || a.TopTickers[0].Key != "btc" {
		t.Fatalf("top ticker = %+v, want btc first", a.TopTickers)
	}
}

// ── helpers ──────────────────────────────────────────────────────────────────

func ids(items []Item) []string {
	out := make([]string, len(items))
	for i, it := range items {
		out[i] = it.ID
	}
	return out
}

func countFor(cs []Count, key string) int {
	for _, c := range cs {
		if c.Key == key {
			return c.Count
		}
	}
	return -1
}

func mustExec(t *testing.T, db *DB, query string, args ...any) {
	t.Helper()
	if _, err := db.sql.Exec(query, args...); err != nil {
		t.Fatalf("exec %q: %v", query, err)
	}
}
