package world

import (
	"encoding/json"
	"io"
	"net/http"
)

// Per-identity DASHBOARD composition.
//
// The AI analyst and the toolbar compose the dashboard on the fly — add/remove
// widgets and data sources, rearrange panels, create custom feed panels. That
// composition used to live only in the browser's localStorage (per-device). Here
// it is server state, persisted per identity, so a signed-in user's dashboard —
// and every change the analyst makes — follows them across devices and survives a
// reload anywhere. Anonymous callers get 401 and keep the localStorage-only
// dashboard; nothing about the signed-out experience changes.
//
// ONE store, namespaced: this reuses the SAME per-identity settings store the
// dashboard-settings and monitors already use (store.Settings), under the
// 'dashboard' namespace — there is no second table. The blob is an OPAQUE JSON
// object (a verbatim mirror of the dashboard's localStorage keys). The backend
// validates it is a JSON object at the boundary and never interprets it. It holds
// layout only — NEVER secrets.
//
//	GET /v1/world/dashboard → { config: {...} }   (the stored blob, or {} when unset)
//	PUT /v1/world/dashboard → { ok: true }         (body: the config object)

const dashboardDoc = "dashboard" // per-identity store namespace

// dashboardMaxBytes bounds a stored dashboard config (layout only — small).
const dashboardMaxBytes = 256 << 10

func (s *Server) handleDashboard(w http.ResponseWriter, r *http.Request) {
	setCORS(w, "GET, PUT, OPTIONS")
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if r.Method != http.MethodGet && r.Method != http.MethodPut {
		writeError(w, http.StatusMethodNotAllowed, "GET or PUT")
		return
	}
	ident, ok := s.identityForDoc(w, r, dashboardDoc)
	if !ok {
		return
	}

	if r.Method == http.MethodGet {
		blob, ok := s.store.Settings.Get(ident)
		if !ok {
			blob = json.RawMessage(`{}`)
		}
		writeJSON(w, http.StatusOK, "private, no-store", map[string]any{"config": blob})
		return
	}

	// PUT: validate the body is a JSON object at the boundary, then upsert verbatim.
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, dashboardMaxBytes))
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
