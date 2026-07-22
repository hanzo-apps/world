package world

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"time"

	"github.com/hanzoai/world/internal/world/store"
)

// Per-identity opaque JSON blobs — the ONE mechanism behind the composed
// DASHBOARD, its ORG-SHARED default, and the user's USAGE HISTORY.
//
// The AI analyst and the toolbar compose the dashboard on the fly (add/remove
// widgets and data sources, rearrange panels, create custom feed panels), and the
// app records real usage (recent searches, watch queue). Both used to live only in
// the browser's localStorage (per-device). Here each is server state, persisted per
// identity, so a signed-in user's dashboard AND history follow them across devices.
// Anonymous callers get 401 and keep their localStorage-only state; nothing about
// the signed-out experience changes.
//
// A dashboard has TWO scopes over the SAME opaque-blob contract:
//   - PER-USER  (/v1/world/dashboard)         — the signed-in user's own layout.
//   - ORG-SHARED (/v1/world/dashboard/shared) — the default an org ADMIN publishes
//     for the whole org. Every member READS it; only an admin PUTs it. The frontend
//     hydrates the org default first, then overlays the user's own doc (user wins).
//
// ONE store, namespaced: this reuses the SAME per-identity settings store that
// monitors already use (store.Settings), under a `project` namespace per concern —
// there is no second table. The org-shared doc is the same 'dashboard' project keyed
// by the org (store.SharedSub) instead of a user. The blob is an OPAQUE JSON object
// (a verbatim mirror of the client's localStorage keys). The backend validates it is
// a JSON object at the boundary and never interprets it. It holds layout / usage
// state only — NEVER secrets.
//
//	GET /v1/world/dashboard        → { config: {...} }   ·   PUT → { ok: true }   (body: the object)
//	GET /v1/world/dashboard/shared → { config: {...} }   ·   PUT → { ok: true }   (admin-only; 403 otherwise)
//	GET /v1/world/history          → { config: {...} }   ·   PUT → { ok: true }   (body: the object)

const dashboardDoc = "dashboard" // per-identity store namespace: composed dashboard

// identityBlobMaxBytes bounds a stored per-identity blob (layout/usage — small).
const identityBlobMaxBytes = 256 << 10

func (s *Server) handleDashboard(w http.ResponseWriter, r *http.Request) {
	s.handleIdentityBlob(w, r, dashboardDoc)
}

// handleDashboardShared serves the ORG-SHARED dashboard default: the layout an org
// admin publishes for everyone in the org. GET returns the org's published blob to
// any signed-in member (empty until first publish); PUT publishes it and is
// ADMIN-ONLY (403 otherwise). It is the SAME opaque-blob contract as the per-user
// dashboard, keyed by the org (store.SharedSub) instead of the user. The server is
// the authority on who may publish — the client only hides the trigger.
func (s *Server) handleDashboardShared(w http.ResponseWriter, r *http.Request) {
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
	// Reading the org default is open to every signed-in member; PUBLISHING it is
	// admin-only.
	if r.Method == http.MethodPut && !s.isOrgAdmin(id) {
		writeError(w, http.StatusForbidden, "Admin only — publish the org default")
		return
	}
	s.serveIdentityBlob(w, r, store.Identity{Org: id.Org, UserSub: store.SharedSub, Project: dashboardDoc})
}

// handleIdentityBlob serves GET (read this identity's blob under `doc`) and PUT
// (upsert it), both bearer-gated. It resolves the PER-USER identity and delegates
// the read/write body to serveIdentityBlob.
func (s *Server) handleIdentityBlob(w http.ResponseWriter, r *http.Request, doc string) {
	setCORS(w, "GET, PUT, OPTIONS")
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if r.Method != http.MethodGet && r.Method != http.MethodPut {
		writeError(w, http.StatusMethodNotAllowed, "GET or PUT")
		return
	}
	ident, ok := s.identityForDoc(w, r, doc)
	if !ok {
		return
	}
	s.serveIdentityBlob(w, r, ident)
}

// serveIdentityBlob is the ONE GET/PUT body over an opaque JSON object under
// "config": GET returns the stored blob (or {}), PUT validates a JSON object at the
// boundary and upserts it verbatim. The caller resolves the identity (per-user or
// org-shared) and enforces any write gate FIRST — this function is scope-agnostic.
// Never 5xx: a degraded store returns {} on GET and ok:false on PUT so the client
// falls back to localStorage.
func (s *Server) serveIdentityBlob(w http.ResponseWriter, r *http.Request, ident store.Identity) {
	if r.Method == http.MethodGet {
		blob, ok := s.store.Settings.Get(ident)
		if !ok {
			blob = json.RawMessage(`{}`)
		}
		writeJSON(w, http.StatusOK, "private, no-store", map[string]any{"config": blob})
		return
	}

	// PUT: validate the body is a JSON object at the boundary, then upsert verbatim.
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, identityBlobMaxBytes))
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
