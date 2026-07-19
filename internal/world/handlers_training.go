package world

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"time"
)

// Model-improvement consent proxy — the ONE bridge between the account-settings
// opt-in toggle and where the flag actually lives: ai's
// OrgSettings.TrainingContribution, the single source of truth the automated judge
// and the router trainer read. World keeps NO copy of the flag; it forwards the
// signed-in caller's own IAM bearer (+ active-org selector) to api.hanzo.ai, which
// is the sole authority: it validates the bearer, self-scopes to the principal's
// OWN org (RequirePrincipal, spoofed X-Org-Id ignored for a non-super-admin) and
// rejects anonymous guests. Signed out → 401, mirroring the toggle's hidden state.
//
//	GET  /v1/world/training-contribution → { enabled: bool }
//	POST /v1/world/training-contribution → { enabled: bool }   (body: { enabled: bool })
func (s *Server) handleTrainingContribution(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, POST, OPTIONS") {
		return
	}
	if r.Method != http.MethodGet && r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "GET or POST")
		return
	}
	bearer := userBearer(r)
	if bearer == "" {
		writeError(w, http.StatusUnauthorized, "Sign in required")
		return
	}

	// Forward the caller's OWN credential + active-org selector. ai is the authority
	// (bearer validation, own-org self-scoping, guest rejection); world adds nothing.
	hdr := map[string]string{"Authorization": bearer}
	if org := r.Header.Get("X-Org-Id"); org != "" {
		hdr["X-Org-Id"] = org
	}

	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	base := apiHost()

	var upstream []byte
	var status int
	var err error
	if r.Method == http.MethodGet {
		upstream, status, err = s.get(ctx, base+"/v1/get-training-contribution", hdr)
	} else {
		raw, rerr := io.ReadAll(http.MaxBytesReader(w, r.Body, 4<<10))
		if rerr != nil {
			writeError(w, http.StatusBadRequest, "Body too large")
			return
		}
		hdr["Content-Type"] = "application/json"
		upstream, status, err = s.do(ctx, http.MethodPost, base+"/v1/update-training-contribution", hdr, raw)
	}
	if err != nil {
		writeError(w, http.StatusBadGateway, "Consent service unavailable")
		return
	}

	// Unwrap the ai (casibase) envelope { status, msg, data:{enabled} } to a clean
	// { enabled } for the SPA. On a non-2xx or an error envelope, mirror the upstream
	// status (>=400) so the client can tell 401 "sign in" from other failures.
	var env struct {
		Status string `json:"status"`
		Data   struct {
			Enabled bool `json:"enabled"`
		} `json:"data"`
	}
	if status < 200 || status >= 300 || json.Unmarshal(upstream, &env) != nil || env.Status == "error" {
		code := status
		if code < 400 {
			code = http.StatusBadGateway
		}
		writeError(w, code, "Consent request failed")
		return
	}
	writeJSON(w, http.StatusOK, "private, no-store", map[string]any{"enabled": env.Data.Enabled})
}
