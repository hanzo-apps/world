package world

import "net/http"

// Per-identity USAGE HISTORY — the signed-in user's REAL actions (recent searches,
// watch queue, …) persisted server-side so they follow the user across devices.
// It shares the one opaque per-identity blob mechanism (handleIdentityBlob) with the
// dashboard, under the 'history' namespace of the same settings store — no new table,
// no fabricated data (only what the user actually did). Anonymous callers get 401 and
// keep their localStorage-only history.
//
//	GET /v1/world/history → { config: {...} }   ·   PUT → { ok: true }   (body: the object)

const historyDoc = "history" // per-identity store namespace: real usage history

func (s *Server) handleHistory(w http.ResponseWriter, r *http.Request) {
	s.handleIdentityBlob(w, r, historyDoc)
}
