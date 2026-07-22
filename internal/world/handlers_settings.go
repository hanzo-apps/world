package world

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"time"

	"github.com/hanzoai/world/internal/world/store"
)

// Per-identity settings: server-side dashboard sync for signed-in users.
//
// The frontend layout engine persists panel geometry / layout mode / preferences
// to localStorage today. These endpoints let a follow-up sync a SIGNED-IN user's
// dashboard across devices: the blob is keyed by (org, user_sub, project) from
// the IAM bearer, so it is isolated per identity. Anonymous callers get 401 and
// keep using localStorage — no server state for them.
//
// FRONTEND HOOK (another agent owns src/): after the layout store mutates, if the
// user is signed in, PUT the same JSON it writes to localStorage to
// /v1/world/settings (Authorization: Bearer <token>); on load, if signed in, GET
// /v1/world/settings and prefer a non-empty server blob over localStorage. One
// debounced PUT on change, one GET on boot — the endpoints below are the whole API.

// wIdentity is the caller's IAM identity resolved from userinfo.
type wIdentity struct {
	Org string `json:"owner"`
	Sub string `json:"sub"`
	// Admin is IAM's own owner/admin flag for the identity, honored when the
	// userinfo carries it — so an org's admin may publish that org's shared doc
	// even when the org is not a global-admin org. Absent claim → false (the
	// global-admin-org gate still applies). See isOrgAdmin.
	Admin bool `json:"isAdmin"`
}

// introspectIdentity resolves the caller's org (owner claim) + subject from IAM
// userinfo, memoized by token hash for a short TTL. It is world's ONE identity
// path — the admin gate (requireAdmin) and per-identity settings both resolve
// through here, so a token's userinfo is fetched and cached once. Authoritative,
// IAM-signed identity — never a client-supplied header.
func (s *Server) introspectIdentity(ctx context.Context, bearer string) (wIdentity, error) {
	sum := sha256.Sum256([]byte(bearer))
	key := "identity:" + hex.EncodeToString(sum[:12])
	if v, ok := s.cache.Get(key); ok {
		return v.(wIdentity), nil
	}
	var id wIdentity
	if err := s.getJSON(ctx, iamIssuer()+"/v1/iam/oauth/userinfo",
		map[string]string{"Authorization": bearer}, &id); err != nil {
		return wIdentity{}, err
	}
	s.cache.Set(key, id, 60*time.Second, 60*time.Second)
	return id, nil
}

// handleSettings serves GET (read this identity's blob) and PUT (upsert it),
// both bearer-gated. Never 5xx: a degraded store returns {} on GET and ok:false
// on PUT so the client falls back to localStorage.
func (s *Server) handleSettings(w http.ResponseWriter, r *http.Request) {
	setCORS(w, "GET, PUT, OPTIONS")
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if r.Method != http.MethodGet && r.Method != http.MethodPut {
		writeError(w, http.StatusMethodNotAllowed, "GET or PUT")
		return
	}
	bearer := userBearer(r)
	if bearer == "" {
		writeError(w, http.StatusUnauthorized, "Sign in required")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	id, err := s.introspectIdentity(ctx, bearer)
	if err != nil || id.Sub == "" {
		writeError(w, http.StatusUnauthorized, "Sign in required")
		return
	}
	ident := store.Identity{Org: id.Org, UserSub: id.Sub, Project: r.URL.Query().Get("project")}

	if r.Method == http.MethodGet {
		blob, ok := s.store.Settings.Get(ident)
		if !ok {
			blob = json.RawMessage(`{}`)
		}
		writeJSON(w, http.StatusOK, "private, no-store", map[string]any{"settings": blob})
		return
	}

	// PUT: validate the body is a JSON object at the boundary, then upsert.
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 256<<10))
	if err != nil {
		writeError(w, http.StatusBadRequest, "Body too large")
		return
	}
	if !json.Valid(raw) || !isJSONObject(raw) {
		writeError(w, http.StatusBadRequest, "Body must be a JSON object")
		return
	}
	writeJSON(w, http.StatusOK, "private, no-store", map[string]any{
		"ok": s.store.Settings.Put(ident, json.RawMessage(raw)),
	})
}

// isJSONObject reports whether raw is a JSON object ({...}), not an array or
// scalar — settings are always an object blob.
func isJSONObject(raw []byte) bool {
	raw = bytes.TrimSpace(raw)
	return len(raw) > 0 && raw[0] == '{'
}
