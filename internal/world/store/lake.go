package store

import (
	"context"
	"database/sql"
	"sort"
	"strings"
	"time"
)

// Item is one normalized, queryable record in the ingested-data lake. Every
// upstream — news/feed items, events, indicators, market snapshots, model
// observations — folds into this ONE shape so everything is searchable and
// countable together. ID is the stable dedupe key: re-ingesting the same item
// upserts (no duplicates), so the warmer re-touching a feed every few minutes
// keeps the lake fresh without growing it.
type Item struct {
	ID      string    `json:"id"`
	Kind    string    `json:"kind"`   // news | event | indicator | market | observation
	Source  string    `json:"source"` // feed host, provider, or model source
	TS      time.Time `json:"ts"`     // the item's own timestamp
	Title   string    `json:"title"`
	Text    string    `json:"text,omitempty"`
	Tickers []string  `json:"tickers,omitempty"`
	Country string    `json:"country,omitempty"` // ISO code or ""
	Lat     float64   `json:"lat,omitempty"`
	Lon     float64   `json:"lon,omitempty"`
	HasGeo  bool      `json:"-"`
	Payload string    `json:"payload,omitempty"` // compact original JSON
}

// Lake is the write-behind ingest sink and the query surface (search +
// analytics) over the items table. Writes are buffered and flushed in batched
// transactions by Run so the request path never blocks on disk; reads go
// straight to SQLite (single serialized connection, sub-ms).
type Lake struct {
	db        *sql.DB // nil in degraded mode
	ch        chan Item
	retention time.Duration
}

// lakeBuffer bounds the write-behind queue. Full → drop (the lake is a
// derived cache of the feeds/model, never the source of truth).
const lakeBuffer = 8192

func newLake(db *sql.DB, retention time.Duration) *Lake {
	return &Lake{db: db, ch: make(chan Item, lakeBuffer), retention: retention}
}

// Add enqueues an item for write-behind persistence. Non-blocking: if the
// buffer is full (writer stalled) the item is dropped rather than slowing the
// caller. No-op in degraded mode or without an ID.
func (l *Lake) Add(it Item) {
	if l == nil || l.db == nil || it.ID == "" {
		return
	}
	select {
	case l.ch <- it:
	default: // buffer full — drop; the source will re-emit on its next cycle
	}
}

// Run is the write-behind consumer + retention prune loop. It batches queued
// items into periodic transactions and prunes expired rows hourly, until ctx is
// cancelled (final flush on the way out). Start once from the server lifecycle.
func (l *Lake) Run(ctx context.Context) {
	if l == nil || l.db == nil {
		return
	}
	batch := make([]Item, 0, 256)
	flush := func() {
		if len(batch) == 0 {
			return
		}
		if err := l.insert(batch); err != nil {
			logStore("lake insert (%d items): %v", len(batch), err)
		}
		batch = batch[:0]
	}
	tick := time.NewTicker(time.Second)
	defer tick.Stop()
	prune := time.NewTicker(time.Hour)
	defer prune.Stop()
	// Prune once shortly after boot so a restart trims yesterday's backlog.
	l.Prune(l.retention)
	for {
		select {
		case <-ctx.Done():
			flush()
			return
		case it := <-l.ch:
			batch = append(batch, it)
			if len(batch) >= 256 {
				flush()
			}
		case <-tick.C:
			flush()
		case <-prune.C:
			l.Prune(l.retention)
		}
	}
}

// Flush drains everything queued by Add and writes it synchronously, reusing the
// same insert path Run uses. Run() is the steady-state consumer; Flush exists for
// the callers that need the write to be VISIBLE before they continue — tests, and
// a shutdown that wants the buffer on disk.
func (l *Lake) Flush() {
	if l == nil || l.db == nil {
		return
	}
	batch := make([]Item, 0, 256)
	for {
		select {
		case it := <-l.ch:
			batch = append(batch, it)
			continue
		default:
		}
		break
	}
	if len(batch) == 0 {
		return
	}
	if err := l.insert(batch); err != nil {
		logStore("lake flush (%d items): %v", len(batch), err)
	}
}

// insert upserts a batch in one transaction. On conflict it refreshes the
// mutable fields but preserves created_at (first-seen) so retention measures
// true age. The FTS index follows via triggers.
func (l *Lake) insert(batch []Item) error {
	tx, err := l.db.Begin()
	if err != nil {
		return err
	}
	stmt, err := tx.Prepare(`INSERT INTO items
		(id, kind, source, ts, title, text, tickers, country, lat, lon, payload, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			kind=excluded.kind, source=excluded.source, ts=excluded.ts,
			title=excluded.title, text=excluded.text, tickers=excluded.tickers,
			country=excluded.country, lat=excluded.lat, lon=excluded.lon,
			payload=excluded.payload`)
	if err != nil {
		_ = tx.Rollback()
		return err
	}
	defer func() { _ = stmt.Close() }()
	now := time.Now().Unix()
	for _, it := range batch {
		var lat, lon any
		if it.HasGeo {
			lat, lon = it.Lat, it.Lon
		}
		if _, err := stmt.Exec(it.ID, it.Kind, it.Source, it.TS.Unix(), it.Title, it.Text,
			packTickers(it.Tickers), it.Country, lat, lon, it.Payload, now); err != nil {
			_ = tx.Rollback()
			return err
		}
	}
	return tx.Commit()
}

// SearchQuery is a query across the whole lake. Empty Q browses by recency;
// non-empty Q ranks by FTS bm25. All filters are optional and compose.
type SearchQuery struct {
	Q       string
	Kind    string
	Country string
	Ticker  string
	Since   time.Time
	Limit   int
}

// Search returns matching items, ranked by relevance (with Q) or recency
// (without). Never errors out: any failure yields an empty slice (never-5xx).
func (l *Lake) Search(q SearchQuery) []Item {
	if l == nil || l.db == nil {
		return []Item{}
	}
	limit := q.Limit
	if limit <= 0 || limit > 100 {
		limit = 30
	}
	// The items table is ALWAYS aliased `i` (bare browse or FTS join), so every
	// filter and the projection reference i.<col> uniformly — no per-branch column
	// rewriting. Free text goes through the FTS index (bm25 ranked); its absence
	// browses by recency. Both share the same filter + projection code below.
	const cols = "i.id,i.kind,i.source,i.ts,i.title,i.text,i.tickers,i.country,i.lat,i.lon,i.payload"
	var (
		sb   strings.Builder
		args []any
	)
	fts := ftsQuery(q.Q)
	if fts != "" {
		sb.WriteString("SELECT " + cols + " FROM items_fts f JOIN items i ON i.rowid=f.rowid WHERE items_fts MATCH ?")
		args = append(args, fts)
	} else {
		sb.WriteString("SELECT " + cols + " FROM items i WHERE 1=1")
	}
	if q.Kind != "" {
		sb.WriteString(" AND i.kind=?")
		args = append(args, q.Kind)
	}
	if q.Country != "" {
		sb.WriteString(" AND i.country=?")
		args = append(args, strings.ToUpper(q.Country))
	}
	if !q.Since.IsZero() {
		sb.WriteString(" AND i.ts>=?")
		args = append(args, q.Since.Unix())
	}
	if t := strings.ToLower(strings.TrimSpace(q.Ticker)); t != "" {
		sb.WriteString(" AND i.tickers LIKE ?")
		args = append(args, "% "+t+" %")
	}
	if fts != "" {
		sb.WriteString(" ORDER BY bm25(items_fts) LIMIT ?")
	} else {
		sb.WriteString(" ORDER BY i.ts DESC LIMIT ?")
	}
	args = append(args, limit)

	rows, err := l.db.Query(sb.String(), args...)
	if err != nil {
		logStore("search: %v", err)
		return []Item{}
	}
	defer func() { _ = rows.Close() }()
	return scanItems(rows)
}

// scanItems reads item rows into a slice.
func scanItems(rows *sql.Rows) []Item {
	out := []Item{}
	for rows.Next() {
		var (
			it       Item
			ts       int64
			tickers  string
			lat, lon sql.NullFloat64
		)
		if err := rows.Scan(&it.ID, &it.Kind, &it.Source, &ts, &it.Title, &it.Text,
			&tickers, &it.Country, &lat, &lon, &it.Payload); err != nil {
			logStore("scan: %v", err)
			continue
		}
		it.TS = time.Unix(ts, 0).UTC()
		it.Tickers = unpackTickers(tickers)
		if lat.Valid && lon.Valid {
			it.Lat, it.Lon, it.HasGeo = lat.Float64, lon.Float64, true
		}
		out = append(out, it)
	}
	return out
}

// Count is one bucket of the analytics summary.
type Count struct {
	Key   string `json:"key"`
	Count int    `json:"count"`
}

// AnalyticsSummary is the cross-cutting "what's in the lake" view over the last
// window: totals, breakdown by kind and source, and the top tickers seen.
type AnalyticsSummary struct {
	WindowHours int     `json:"windowHours"`
	Total       int     `json:"total"`
	ByKind      []Count `json:"byKind"`
	BySource    []Count `json:"bySource"`
	TopTickers  []Count `json:"topTickers"`
	Since       string  `json:"since"`
}

// Analytics summarizes the lake over the last `hours`. Degrades to zeros.
func (l *Lake) Analytics(hours int) AnalyticsSummary {
	if hours <= 0 {
		hours = 24
	}
	out := AnalyticsSummary{WindowHours: hours, ByKind: []Count{}, BySource: []Count{}, TopTickers: []Count{}}
	if l == nil || l.db == nil {
		return out
	}
	since := time.Now().Add(-time.Duration(hours) * time.Hour)
	out.Since = since.UTC().Format(time.RFC3339)
	sinceUnix := since.Unix()

	_ = l.db.QueryRow(`SELECT COUNT(*) FROM items WHERE ts>=?`, sinceUnix).Scan(&out.Total)
	out.ByKind = groupCount(l.db, `SELECT kind, COUNT(*) c FROM items WHERE ts>=? GROUP BY kind ORDER BY c DESC`, sinceUnix)
	out.BySource = groupCount(l.db, `SELECT source, COUNT(*) c FROM items WHERE ts>=? AND source!='' GROUP BY source ORDER BY c DESC LIMIT 15`, sinceUnix)
	out.TopTickers = topTickers(l.db, sinceUnix, 15)
	return out
}

func groupCount(db *sql.DB, query string, args ...any) []Count {
	out := []Count{}
	rows, err := db.Query(query, args...)
	if err != nil {
		return out
	}
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		var c Count
		if err := rows.Scan(&c.Key, &c.Count); err == nil {
			out = append(out, c)
		}
	}
	return out
}

// topTickers aggregates the packed tickers column in Go — cheap over a bounded
// recent window and avoids a second normalized table for a summary stat.
func topTickers(db *sql.DB, sinceUnix int64, n int) []Count {
	rows, err := db.Query(`SELECT tickers FROM items WHERE ts>=? AND tickers!='' LIMIT 20000`, sinceUnix)
	if err != nil {
		return []Count{}
	}
	defer func() { _ = rows.Close() }()
	freq := map[string]int{}
	for rows.Next() {
		var packed string
		if err := rows.Scan(&packed); err != nil {
			continue
		}
		for _, t := range unpackTickers(packed) {
			freq[t]++
		}
	}
	out := make([]Count, 0, len(freq))
	for k, v := range freq {
		out = append(out, Count{Key: k, Count: v})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Count != out[j].Count {
			return out[i].Count > out[j].Count
		}
		return out[i].Key < out[j].Key
	})
	if len(out) > n {
		out = out[:n]
	}
	return out
}

// Prune deletes items older than the retention window (by first-seen). The FTS
// index is cleaned by the delete trigger. Returns rows removed.
func (l *Lake) Prune(retention time.Duration) int64 {
	if l == nil || l.db == nil {
		return 0
	}
	if retention <= 0 {
		retention = DefaultRetention
	}
	cutoff := time.Now().Add(-retention).Unix()
	res, err := l.db.Exec(`DELETE FROM items WHERE created_at < ?`, cutoff)
	if err != nil {
		logStore("prune: %v", err)
		return 0
	}
	n, _ := res.RowsAffected()
	if n > 0 {
		logStore("pruned %d expired items", n)
	}
	return n
}

// ── ticker packing ───────────────────────────────────────────────────────────

// packTickers stores tickers as a lowercase, space-padded token string
// (" aapl btc ") so a token filter is an exact LIKE '% aapl %' — no false
// substring hits, no separate table.
func packTickers(tickers []string) string {
	if len(tickers) == 0 {
		return ""
	}
	seen := map[string]bool{}
	var b strings.Builder
	b.WriteByte(' ')
	for _, t := range tickers {
		t = strings.ToLower(strings.TrimSpace(t))
		if t == "" || seen[t] {
			continue
		}
		seen[t] = true
		b.WriteString(t)
		b.WriteByte(' ')
	}
	if b.Len() == 1 {
		return ""
	}
	return b.String()
}

func unpackTickers(packed string) []string {
	f := strings.Fields(packed)
	if len(f) == 0 {
		return nil
	}
	return f
}

// ftsQuery turns free user text into a SAFE FTS5 MATCH expression: alphanumeric
// tokens, each double-quoted (so FTS control chars can never cause a syntax
// error), AND-ed together. Empty when there are no usable tokens (caller then
// browses by recency). This is the SSRF-equivalent boundary for FTS — untrusted
// input can never reach the query grammar unescaped.
func ftsQuery(q string) string {
	var tokens []string
	for _, f := range strings.FieldsFunc(q, func(r rune) bool {
		return !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9')
	}) {
		if len(tokens) >= 12 {
			break
		}
		tokens = append(tokens, `"`+f+`"`)
	}
	return strings.Join(tokens, " ")
}
