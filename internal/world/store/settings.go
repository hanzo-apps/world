package store

import (
	"database/sql"
	"encoding/json"
	"strings"
	"time"
)

// Settings persists a per-identity JSON blob (dashboard layout, panel geometry,
// preferences) SERVER-SIDE, keyed by (org, user_sub, project) from the IAM
// bearer, so a signed-in user's dashboard syncs across devices. It is the "one
// driver" companion to the lake — same SQLite DB, its own table, orthogonal
// concern. Anonymous callers never reach here (the handler gates on the bearer);
// they keep using localStorage.
type Settings struct {
	db *sql.DB // nil in degraded mode
}

// SharedSub is the reserved user_sub of an ORG-WIDE settings row — a doc owned by
// the org itself (its published default), independent of any user. No IAM subject
// equals it (subs are real IAM identifiers, never this sentinel), so a shared doc
// lives in the SAME table without ever colliding with a user's own row. Get/Put
// treat it like any identity — the org-scoped doc is just a row keyed by the org.
const SharedSub = "*org-shared*"

// Identity keys a settings row. Project defaults to "default" upstream so a
// user's single dashboard has a stable key.
type Identity struct {
	Org     string
	UserSub string
	Project string
}

func (id Identity) normalize() Identity {
	id.Org = strings.TrimSpace(id.Org)
	id.UserSub = strings.TrimSpace(id.UserSub)
	id.Project = strings.TrimSpace(id.Project)
	if id.Project == "" {
		id.Project = "default"
	}
	return id
}

// Get returns the stored settings blob for an identity, or (nil,false) when
// absent or degraded. The blob is returned verbatim (already valid JSON).
func (s *Settings) Get(id Identity) (json.RawMessage, bool) {
	if s == nil || s.db == nil {
		return nil, false
	}
	id = id.normalize()
	if id.UserSub == "" {
		return nil, false
	}
	var blob string
	err := s.db.QueryRow(
		`SELECT blob FROM settings WHERE org=? AND user_sub=? AND project=?`,
		id.Org, id.UserSub, id.Project).Scan(&blob)
	if err != nil {
		return nil, false
	}
	return json.RawMessage(blob), true
}

// Put upserts an identity's settings blob. blob must be valid JSON (validated by
// the caller at the boundary). Reports whether it was stored (false = degraded).
func (s *Settings) Put(id Identity, blob json.RawMessage) bool {
	if s == nil || s.db == nil {
		return false
	}
	id = id.normalize()
	if id.UserSub == "" {
		return false
	}
	_, err := s.db.Exec(`INSERT INTO settings (org, user_sub, project, blob, updated_at)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(org, user_sub, project) DO UPDATE SET blob=excluded.blob, updated_at=excluded.updated_at`,
		id.Org, id.UserSub, id.Project, string(blob), time.Now().Unix())
	if err != nil {
		logStore("settings put: %v", err)
		return false
	}
	return true
}
