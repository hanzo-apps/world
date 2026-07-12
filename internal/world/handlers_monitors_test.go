package world

import (
	"testing"
	"time"

	"github.com/hanzoai/world/internal/world/store"
)

// Monitors are server state now, so the two things that MUST hold are:
//   1. a monitor list round-trips through the per-identity store, and
//   2. matching runs against the lake — the whole ingested corpus — while still
//      honouring the word-boundary rule the browser used ("ai" ≠ "train").
//
// The store is opened against a temp dir (WORLD_DATA_DIR), so this is the real
// SQLite lake + settings table, not a mock.

func testServer(t *testing.T) *Server {
	t.Helper()
	t.Setenv("WORLD_DATA_DIR", t.TempDir())
	s := NewServer()
	t.Cleanup(s.Close)
	if s.store == nil || !s.store.Enabled() {
		t.Skip("store unavailable in this environment")
	}
	return s
}

func seedNews(t *testing.T, s *Server, items ...store.Item) {
	t.Helper()
	for _, it := range items {
		if it.Kind == "" {
			it.Kind = "news"
		}
		if it.TS.IsZero() {
			it.TS = time.Now()
		}
		s.store.Lake.Add(it)
	}
	// Add() is write-behind; flush so the search sees the rows.
	s.store.Lake.Flush()
}

func TestMonitorsRoundTripPerIdentity(t *testing.T) {
	s := testServer(t)
	ident := store.Identity{Org: "acme", UserSub: "user-1", Project: monitorsDoc}
	other := store.Identity{Org: "acme", UserSub: "user-2", Project: monitorsDoc}

	blob := []byte(`{"monitors":[{"id":"m1","keywords":["nvidia","gpu"],"color":"#f00"}]}`)
	if !s.store.Settings.Put(ident, blob) {
		t.Fatal("put monitors failed")
	}

	got := s.loadMonitors(ident)
	if len(got) != 1 || got[0].ID != "m1" || len(got[0].Keywords) != 2 {
		t.Fatalf("round-trip mismatch: %+v", got)
	}
	// Isolation: another identity must not see them.
	if n := len(s.loadMonitors(other)); n != 0 {
		t.Fatalf("identity leak: user-2 sees %d monitors", n)
	}
}

func TestMonitorMatchesRunAgainstTheLake(t *testing.T) {
	s := testServer(t)
	seedNews(t, s,
		store.Item{ID: "https://x.test/a", Source: "BBC", Title: "Nvidia unveils a new GPU for data centres"},
		store.Item{ID: "https://x.test/b", Source: "FT", Title: "Markets rally on strong earnings"},
		store.Item{ID: "https://x.test/c", Source: "AP", Title: "Train derails outside the city"},
	)

	monitors := []Monitor{{ID: "m1", Keywords: []string{"nvidia"}, Color: "#f00"}}
	matches := s.matchMonitors(monitors)
	if len(matches) != 1 {
		t.Fatalf("want 1 match, got %d (%+v)", len(matches), matches)
	}
	m := matches[0]
	if m.MonitorID != "m1" || m.Keyword != "nvidia" || m.Source != "BBC" {
		t.Fatalf("unexpected match: %+v", m)
	}
	if m.Link != "https://x.test/a" {
		t.Errorf("link = %q, want the item's canonical link", m.Link)
	}
}

// The rule FTS alone would get wrong: a short keyword must not match inside a
// longer word. "ai" must never trip on "train".
func TestMonitorMatchesHonourWordBoundaries(t *testing.T) {
	s := testServer(t)
	seedNews(t, s,
		store.Item{ID: "https://x.test/train", Source: "AP", Title: "Train derails outside the city"},
		store.Item{ID: "https://x.test/ai", Source: "Wired", Title: "AI models get cheaper to run"},
	)

	matches := s.matchMonitors([]Monitor{{ID: "m1", Keywords: []string{"ai"}}})
	for _, m := range matches {
		if m.Link == "https://x.test/train" {
			t.Fatalf(`"ai" matched inside "Train" — word boundary not enforced`)
		}
	}
	if len(matches) != 1 || matches[0].Link != "https://x.test/ai" {
		t.Fatalf("want only the AI story, got %+v", matches)
	}
}

func TestSanitizeMonitorsBoundsInput(t *testing.T) {
	in := []Monitor{
		{ID: "ok", Keywords: []string{" Nvidia ", "", "GPU"}},
		{ID: "", Keywords: []string{"dropped: no id"}},
		{ID: "empty", Keywords: []string{"  "}},
	}
	out := sanitizeMonitors(in)
	if len(out) != 1 {
		t.Fatalf("want 1 surviving monitor, got %d (%+v)", len(out), out)
	}
	if out[0].Keywords[0] != "nvidia" || out[0].Keywords[1] != "gpu" {
		t.Fatalf("keywords not normalised: %+v", out[0].Keywords)
	}
}
