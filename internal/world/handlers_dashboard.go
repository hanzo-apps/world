package world

import (
	"encoding/json"
	"io"
	"net/http"
)

// Per-identity opaque JSON blobs — the ONE mechanism behind both the composed
// DASHBOARD and the user's USAGE HISTORY.
//
// The AI analyst and the toolbar compose the dashboard on the fly (add/remove
// widgets and data sources, rearrange panels, create custom feed panels), and the
// app records real usage (recent searches, watch queue). Both used to live only in
// the browser's localStorage (per-device). Here each is server state, persisted per
// identity, so a signed-in user's dashboard AND history follow them across devices.
// Anonymous callers get 401 and keep their localStorage-only state; nothing about
// the signed-out experience changes.
//
// ONE store, namespaced: this reuses the SAME per-identity settings store that
// monitors already use (store.Settings), under a `project` namespace per concern —
// there is no second table. The blob is an OPAQUE JSON object (a verbatim mirror of
// the client's localStorage keys). The backend validates it is a JSON object at the
// boundary and never interprets it. It holds layout / usage state only — NEVER secrets.
//
//	GET /v1/world/dashboard → { config: {...} }   ·   PUT → { ok: true }   (body: the object)
//	GET /v1/world/history   → { config: {...} }   ·   PUT → { ok: true }   (body: the object)

const dashboardDoc = "dashboard" // per-identity store namespace: composed dashboard

// identityBlobMaxBytes bounds a stored per-identity blob (layout/usage — small).
const identityBlobMaxBytes = 256 << 10

func (s *Server) handleDashboard(w http.ResponseWriter, r *http.Request) {
	s.handleIdentityBlob(w, r, dashboardDoc)
}

// handleIdentityBlob serves GET (read this identity's blob under `doc`) and PUT
// (upsert it), both bearer-gated. Body + response are an opaque JSON object under
// "config". Never 5xx: a degraded store returns {} on GET and ok:false on PUT so the
// client falls back to localStorage.
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
