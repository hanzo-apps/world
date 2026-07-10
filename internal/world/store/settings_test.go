package store

import (
	"encoding/json"
	"testing"
)

func TestSettingsUpsertAndIdentityIsolation(t *testing.T) {
	db := openTestDB(t)
	alice := Identity{Org: "acme", UserSub: "alice", Project: "default"}
	bob := Identity{Org: "acme", UserSub: "bob", Project: "default"}

	if !db.Settings.Put(alice, json.RawMessage(`{"layout":"grid"}`)) {
		t.Fatal("put alice failed")
	}
	if !db.Settings.Put(bob, json.RawMessage(`{"layout":"list"}`)) {
		t.Fatal("put bob failed")
	}

	// Each identity reads back its OWN blob — no cross-talk.
	if got, ok := db.Settings.Get(alice); !ok || string(got) != `{"layout":"grid"}` {
		t.Fatalf("get alice = %q ok=%v", got, ok)
	}
	if got, ok := db.Settings.Get(bob); !ok || string(got) != `{"layout":"list"}` {
		t.Fatalf("get bob = %q ok=%v", got, ok)
	}

	// Upsert replaces alice's blob and leaves bob untouched.
	if !db.Settings.Put(alice, json.RawMessage(`{"layout":"masonry","cell":42}`)) {
		t.Fatal("upsert alice failed")
	}
	if got, _ := db.Settings.Get(alice); string(got) != `{"layout":"masonry","cell":42}` {
		t.Fatalf("upsert alice = %q", got)
	}
	if got, _ := db.Settings.Get(bob); string(got) != `{"layout":"list"}` {
		t.Fatalf("bob mutated by alice upsert: %q", got)
	}
}

func TestSettingsProjectIsolationAndDefault(t *testing.T) {
	db := openTestDB(t)
	base := Identity{Org: "acme", UserSub: "alice"} // Project "" → "default"
	proj := Identity{Org: "acme", UserSub: "alice", Project: "trading"}

	if !db.Settings.Put(base, json.RawMessage(`{"p":"default"}`)) {
		t.Fatal("put default failed")
	}
	if !db.Settings.Put(proj, json.RawMessage(`{"p":"trading"}`)) {
		t.Fatal("put trading failed")
	}
	// Same user, different project → different blobs.
	if got, _ := db.Settings.Get(Identity{Org: "acme", UserSub: "alice", Project: "default"}); string(got) != `{"p":"default"}` {
		t.Fatalf("default project = %q", got)
	}
	if got, _ := db.Settings.Get(proj); string(got) != `{"p":"trading"}` {
		t.Fatalf("trading project = %q", got)
	}
	// Empty project normalizes to "default".
	if got, _ := db.Settings.Get(base); string(got) != `{"p":"default"}` {
		t.Fatalf("empty project did not normalize to default: %q", got)
	}
}

func TestSettingsMissingAndNoSub(t *testing.T) {
	db := openTestDB(t)
	if _, ok := db.Settings.Get(Identity{Org: "acme", UserSub: "ghost"}); ok {
		t.Fatal("get for absent identity reported ok")
	}
	// A missing subject is not a valid identity — never store or read.
	if db.Settings.Put(Identity{Org: "acme", UserSub: ""}, json.RawMessage(`{}`)) {
		t.Fatal("put with empty sub reported stored")
	}
}
