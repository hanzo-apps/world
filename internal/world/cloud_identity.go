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

// adminOrgs is the set of IAM owner claims world treats as a global admin: the
// base {admin, built-in} (in sync with the cloud deploy's globalAdminOrgs) plus the
// deployment's OPERATOR org, so the seeded superuser (z@hanzo.ai, owner "hanzo")
// sees the full internal dashboard. Override per deployment with WORLD_ADMIN_ORGS
// (comma-separated); unset defaults the operator org to "hanzo". The upstream cloud
// subsystems independently re-verify the bearer, so this gate only decides which
// callers world will ATTEMPT the full/admin reads for — never the final authz.
func adminOrgs() map[string]bool {
	m := map[string]bool{"admin": true, "built-in": true}
	extra := env("WORLD_ADMIN_ORGS")
	if extra == "" {
		extra = "hanzo" // operator org: z@hanzo.ai is the seeded superuser
	}
	for _, o := range strings.Split(extra, ",") {
		if o = strings.TrimSpace(o); o != "" {
			m[o] = true
		}
	}
	return m
}

// isAdminOrg reports whether an owner claim is one of the admin orgs.
func isAdminOrg(owner string) bool { return adminOrgs()[strings.TrimSpace(owner)] }

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

// adminIdentity is the NON-writing admin probe: it returns the caller's bearer and
// true iff a valid IAM identity resolves to an admin-org owner. It short-circuits
// (no IAM call) when the request carries no bearer, so anonymous requests stay cheap.
// Used by endpoints that have a public fallback (cloud-pulse): they upgrade to the
// full admin view when the caller is an admin, and otherwise serve the public path.
func (s *Server) adminIdentity(r *http.Request) (string, bool) {
	bearer := userBearer(r)
	if bearer == "" {
		return "", false
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	id, err := s.introspectIdentity(ctx, bearer)
	if err != nil || !isAdminOrg(id.Org) {
		return "", false
	}
	return bearer, true
}

// requireAdmin gates an admin-ONLY Cloud endpoint (no public fallback). It returns
// the caller's bearer (to forward upstream) and true only for a validated admin-org
// owner; otherwise it writes the fail-closed response (401 without a token, 403
// otherwise) and returns false. Every admin handler calls this after preflight.
func (s *Server) requireAdmin(w http.ResponseWriter, r *http.Request) (string, bool) {
	if userBearer(r) == "" {
		writeError(w, http.StatusUnauthorized, "Sign in required")
		return "", false
	}
	bearer, ok := s.adminIdentity(r)
	if !ok {
		writeError(w, http.StatusForbidden, "Admin only — sign in with the admin org")
		return "", false
	}
	return bearer, true
}
