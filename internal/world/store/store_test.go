package store

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

// openTestDB opens a fresh embedded datastore in a temp dir. The mere fact this
// succeeds under `CGO_ENABLED=0 go test` is the CGO-free assertion: modernc's
// pure-Go SQLite (with FTS5) links and runs without a C toolchain.
func openTestDB(t *testing.T) *DB {
	t.Helper()
	db, err := Open(t.TempDir(), time.Hour)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	if !db.Enabled() {
		t.Fatal("Open returned a disabled DB")
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

func TestOpenAppliesSchemaAndFTS5(t *testing.T) {
	db := openTestDB(t)
	// FTS5 must be compiled into modernc's SQLite — a MATCH query over the virtual
	// table would error otherwise. Ingest one row and match it.
	if err := db.Lake.insert([]Item{{ID: "x", Kind: "news", Title: "Bitcoin surges today"}}); err != nil {
		t.Fatalf("insert: %v", err)
	}
	got := db.Lake.Search(SearchQuery{Q: "bitcoin"})
	if len(got) != 1 || got[0].ID != "x" {
		t.Fatalf("FTS5 search = %+v, want the one bitcoin row", got)
	}
}

func TestOpenDegradedIsUsableNeverNil(t *testing.T) {
	// A path under a regular file cannot be a directory → Open fails, but must
	// still return a usable degraded DB (never-5xx contract at the storage layer).
	f := filepath.Join(t.TempDir(), "not-a-dir")
	if err := os.WriteFile(f, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	db, err := Open(filepath.Join(f, "sub"), time.Hour)
	if err == nil {
		t.Fatal("expected an error opening under a file")
	}
	if db == nil {
		t.Fatal("Open returned nil DB on error")
	}
	if db.Enabled() {
		t.Fatal("degraded DB reports Enabled")
	}
	// Every method must no-op / empty rather than panic.
	if got := db.Lake.Search(SearchQuery{Q: "x"}); len(got) != 0 {
		t.Fatalf("degraded Search = %v, want empty", got)
	}
	db.Lake.Add(Item{ID: "a", Kind: "news", Title: "t"})
	if n := db.Lake.Prune(time.Hour); n != 0 {
		t.Fatalf("degraded Prune = %d, want 0", n)
	}
	if _, ok := db.Settings.Get(Identity{UserSub: "u"}); ok {
		t.Fatal("degraded Settings.Get returned ok")
	}
	if db.Settings.Put(Identity{UserSub: "u"}, []byte(`{}`)) {
		t.Fatal("degraded Settings.Put reported stored")
	}
	if a := db.Lake.Analytics(24); a.Total != 0 {
		t.Fatalf("degraded Analytics total = %d, want 0", a.Total)
	}
}
