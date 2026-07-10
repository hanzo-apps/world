package world

import (
	"context"
	"net/http"
	"strings"
	"time"
)

// Admin gate for the sensitive half of the Cloud tab.
//
// world.hanzo.ai's SaaS/Cloud view is public by design (the "excitement layer":
// platform scale, global reach, public-chain activity — all non-sensitive). The
// DEEP, operator-only panels (cross-fleet utilization, per-service internals,
// exact web analytics, per-org LLM spend) are admin-only and MUST be enforced
// server-side, not merely hidden in the client.
//
// The rule mirrors the cloud gateway's SanitizeIdentity decision
// (~/work/hanzo/cloud/middleware_identity.go:194): a caller is a global admin iff
// their IAM `owner` claim is an admin org (globalAdminOrgs = admin,built-in). The
// world binary does not front the gateway, so we resolve the owner claim straight
// from IAM's userinfo (IAM-signed, authoritative) rather than trusting any
// client-supplied header. Fail-closed: no token → 401; any introspection failure
// or non-admin owner → 403. The caller's bearer is returned to forward upstream,
// where cloud independently re-verifies — defense in depth.

// isAdminOrg reports whether an owner claim is one of the admin orgs. Kept in
// sync with the cloud deploy's globalAdminOrgs (admin,built-in).
func isAdminOrg(owner string) bool {
	switch strings.TrimSpace(owner) {
	case "admin", "built-in":
		return true
	default:
		return false
	}
}

// apiHost returns the api.hanzo.ai origin (no /v1 suffix) that the cloud
// subsystems are served from. HANZO_AI_BASE may legitimately carry a /v1 suffix
// (it is the OpenAI-compatible base); strip it so subsystem paths like
// /v1/machines compose correctly.
func apiHost() string {
	b := env("HANZO_API_BASE", "HANZO_AI_BASE")
	if b == "" {
		b = "https://api.hanzo.ai"
	}
	b = trimSlash(b)
	return strings.TrimSuffix(b, "/v1")
}

// iamIssuer is the OIDC issuer used for userinfo introspection.
func iamIssuer() string {
	if v := env("HANZO_IAM_ISSUER"); v != "" {
		return trimSlash(v)
	}
	return "https://hanzo.id"
}

// requireAdmin gates an admin-only Cloud endpoint. It returns the caller's bearer
// (to forward upstream) and true only for a validated admin-org owner; otherwise
// it writes the fail-closed response (401 without a token, 403 otherwise) and
// returns false. Every admin handler calls this after preflight. Identity is
// resolved through the single IAM-userinfo path (introspectIdentity); the gate
// reads only the authoritative owner claim.
func (s *Server) requireAdmin(w http.ResponseWriter, r *http.Request) (string, bool) {
	bearer := userBearer(r)
	if bearer == "" {
		writeError(w, http.StatusUnauthorized, "Sign in required")
		return "", false
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	id, err := s.introspectIdentity(ctx, bearer)
	if err != nil || !isAdminOrg(id.Org) {
		writeError(w, http.StatusForbidden, "Admin only — sign in with the admin org")
		return "", false
	}
	return bearer, true
}
