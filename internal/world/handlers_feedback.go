package world

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"
)

// ── AI reward-signal BFF (/v1/feedback) ──────────────────────────────────────
//
// Same-origin proxy for CONTENT-FREE AI reward signals. The analyst chat calls
// the @hanzo/ai SDK's sendFeedback with baseUrl:'' → same-origin POST /v1/feedback
// (bare, matching the gateway path). This handler forwards to the ONE gateway
// (a.base+"/feedback") with the caller's IAM bearer — exactly the auth idiom
// handleAnalyst uses (userBearer + aiForwardHeaders) so a signal meters to the
// user's org.
//
// Content-free is a HARD invariant, enforced HERE independently of the SDK's
// type union (defense in depth): the body is parsed and WHITELISTED to exactly
// {request_id, signal, rating?}. No prompt/response/text can transit — anything
// but those three fields is dropped, and rating rides ONLY with signal "rating".
//
// Fire-and-forget: it answers 204 fast and swallows every upstream error, so a
// feedback failure never surfaces to the client. No bearer ⇒ 204 no-op, never 401.

// validFeedbackSignals is the closed reward-signal vocabulary (@hanzo/ai
// FeedbackSignal). Only these nine pass the whitelist.
var validFeedbackSignals = map[string]bool{
	"up": true, "down": true, "regenerate": true, "switch": true, "abandon": true,
	"accept": true, "revert": true, "rating": true, "dismiss": true,
}

func (s *Server) handleFeedback(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "POST, OPTIONS") {
		return
	}
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	// No bearer ⇒ quiet 204 no-op (never 401): a signed-out click is simply
	// dropped, keeping the SDK's silent-on-failure contract.
	bearer := userBearer(r)
	if bearer == "" {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	// Parse, then WHITELIST to exactly the content-free fields. A malformed body
	// is swallowed (fire-and-forget), never surfaced as an error.
	var in struct {
		RequestID string `json:"request_id"`
		Signal    string `json:"signal"`
		Rating    *int   `json:"rating"`
	}
	if err := decodeJSONBody(r, &in); err != nil {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	reqID := strings.TrimSpace(in.RequestID)
	signal := strings.TrimSpace(in.Signal)
	if reqID == "" || !validFeedbackSignals[signal] {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	// Re-encode from ONLY the whitelisted fields. rating rides ONLY with the
	// "rating" signal and only for 1..3 — never on dismiss or any other signal
	// (mirrors the SDK discriminated-union invariant, enforced server-side).
	out := map[string]any{"request_id": reqID, "signal": signal}
	if signal == "rating" && in.Rating != nil && *in.Rating >= 1 && *in.Rating <= 3 {
		out["rating"] = *in.Rating
	}
	whitelisted, err := json.Marshal(out)
	if err != nil {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	// Forward upstream with the caller's bearer + org/project selectors, then 204.
	// Any upstream error is swallowed — the client never sees a feedback failure.
	headers := map[string]string{"Authorization": bearer, "Content-Type": "application/json"}
	for k, v := range aiForwardHeaders(r) {
		headers[k] = v
	}
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	_, _, _ = s.do(ctx, "POST", s.ai.base+"/feedback", headers, whitelisted)
	w.WriteHeader(http.StatusNoContent)
}
