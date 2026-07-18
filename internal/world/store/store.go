// Package store is world's embedded, CGO-free datastore: the queryable
// ingested-data LAKE (full-text searchable) and per-identity SETTINGS, both in
// ONE SQLite database (github.com/hanzoai/sqlite — pure Go, FTS5 built in).
//
// It is decomplected from HTTP and from the shared feed hot-cache: this package
// only holds durable, queryable rows and answers value queries. The instant
// feed body cache lives in package kv (hanzo-kv, shared across pods); SQLite is
// the "one place to query everything" — search, analytics, and signed-in
// settings. One driver, two logical stores.
//
// Never-5xx: if the database cannot be opened the returned *DB is still usable —
// every method degrades to an empty/no-op result rather than failing. A single
// serialized connection (SetMaxOpenConns(1)) makes all access deterministic and
// free of SQLITE_BUSY, which is correct for a per-pod cache/lake where every
// operation is sub-millisecond.
package store

import (
	"database/sql"
	"log"
	"os"
	"path/filepath"
	"time"

	_ "github.com/hanzoai/sqlite"
)

// DB owns the embedded SQLite handle and the two logical stores layered on it.
// sql is nil only when the database could not be opened (degraded mode).
type DB struct {
	sql      *sql.DB
	Lake     *Lake
	Settings *Settings
}

// dbFile is the single embedded database filename under the data dir.
const dbFile = "world.db"

// schema is the full DDL, applied idempotently on Open. The lake is an external
// content FTS5 index (title+text) kept in sync by triggers, so bm25 ranking and
// prune-driven deletes stay correct with no manual FTS bookkeeping.
var schema = []string{
	`CREATE TABLE IF NOT EXISTS items (
		id         TEXT PRIMARY KEY,
		kind       TEXT NOT NULL,
		source     TEXT NOT NULL DEFAULT '',
		ts         INTEGER NOT NULL,          -- item's own time (unix seconds)
		title      TEXT NOT NULL DEFAULT '',
		text       TEXT NOT NULL DEFAULT '',
		tickers    TEXT NOT NULL DEFAULT '',  -- space-delimited, lowercase, padded ' a b '
		country    TEXT NOT NULL DEFAULT '',
		lat        REAL,
		lon        REAL,
		payload    TEXT NOT NULL DEFAULT '',  -- compact original item JSON
		created_at INTEGER NOT NULL           -- first-seen (unix seconds); drives retention
	)`,
	`CREATE INDEX IF NOT EXISTS items_kind_ts ON items(kind, ts)`,
	`CREATE INDEX IF NOT EXISTS items_ts ON items(ts)`,
	`CREATE INDEX IF NOT EXISTS items_created ON items(created_at)`,
	`CREATE INDEX IF NOT EXISTS items_country ON items(country)`,
	`CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
		title, text, content='items', content_rowid='rowid'
	)`,
	`CREATE TRIGGER IF NOT EXISTS items_ai AFTER INSERT ON items BEGIN
		INSERT INTO items_fts(rowid, title, text) VALUES (new.rowid, new.title, new.text);
	END`,
	`CREATE TRIGGER IF NOT EXISTS items_ad AFTER DELETE ON items BEGIN
		INSERT INTO items_fts(items_fts, rowid, title, text) VALUES ('delete', old.rowid, old.title, old.text);
	END`,
	`CREATE TRIGGER IF NOT EXISTS items_au AFTER UPDATE ON items BEGIN
		INSERT INTO items_fts(items_fts, rowid, title, text) VALUES ('delete', old.rowid, old.title, old.text);
		INSERT INTO items_fts(rowid, title, text) VALUES (new.rowid, new.title, new.text);
	END`,
	`CREATE TABLE IF NOT EXISTS settings (
		org        TEXT NOT NULL,
		user_sub   TEXT NOT NULL,
		project    TEXT NOT NULL,
		blob       TEXT NOT NULL,
		updated_at INTEGER NOT NULL,
		PRIMARY KEY (org, user_sub, project)
	)`,
}

// DefaultRetention is how long ingested items are kept before the prune job
// deletes them (rolling window). Overridable via the caller.
const DefaultRetention = 7 * 24 * time.Hour

// Open opens (creating if needed) the embedded database under dir and applies
// the schema. It ALWAYS returns a usable *DB: on any failure it logs, returns a
// degraded DB (empty results, no-op writes) plus the error, so callers never
// have to nil-check and the service never 5xxes over storage.
func Open(dir string, retention time.Duration) (*DB, error) {
	if retention <= 0 {
		retention = DefaultRetention
	}
	degraded := &DB{Lake: newLake(nil, retention), Settings: &Settings{}}

	if err := os.MkdirAll(dir, 0o755); err != nil {
		return degraded, err
	}
	dsn := "file:" + filepath.Join(dir, dbFile) +
		"?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=synchronous(NORMAL)&_pragma=foreign_keys(ON)"
	sqldb, err := sql.Open("sqlite", dsn)
	if err != nil {
		return degraded, err
	}
	// One connection: all access serialized in-process — deterministic, no
	// SQLITE_BUSY. Every op is sub-ms so serialization costs nothing here.
	sqldb.SetMaxOpenConns(1)
	if err := sqldb.Ping(); err != nil {
		_ = sqldb.Close()
		return degraded, err
	}
	for _, ddl := range schema {
		if _, err := sqldb.Exec(ddl); err != nil {
			_ = sqldb.Close()
			return degraded, err
		}
	}
	return &DB{
		sql:      sqldb,
		Lake:     newLake(sqldb, retention),
		Settings: &Settings{db: sqldb},
	}, nil
}

// Enabled reports whether the database opened successfully (durable mode).
func (d *DB) Enabled() bool { return d != nil && d.sql != nil }

// Close flushes and closes the database. Safe on a degraded DB.
func (d *DB) Close() error {
	if d == nil || d.sql == nil {
		return nil
	}
	return d.sql.Close()
}

// logStore namespaces the store's best-effort warnings.
func logStore(format string, args ...any) { log.Printf("world-store: "+format, args...) }
