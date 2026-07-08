package world

import (
	"context"
	"net/http"
	"time"
)

// releasesRepo is the GitHub repo whose latest release backs /api/version and
// /api/download. Defaults to the Hanzo world repo (the old upstream repo is
// never referenced). Override with WORLD_RELEASES_REPO=owner/name.
func releasesRepo() string {
	if v := env("WORLD_RELEASES_REPO"); v != "" {
		return v
	}
	return "hanzoai/world"
}

// handleHealth is a liveness/readiness probe.
func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") {
		return
	}
	writeJSON(w, http.StatusOK, "no-store", map[string]any{
		"status": "ok",
		"time":   time.Now().UTC().Format(time.RFC3339),
	})
}

// handleVersion returns the latest published release version, ported from
// api/version.js (retargeted to the Hanzo repo).
func (s *Server) handleVersion(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") {
		return
	}
	s.cachedJSON(w, "meta:version:v1",
		"public, s-maxage=300, stale-while-revalidate=60", 5*time.Minute, 30*time.Minute,
		func(ctx context.Context) (any, error) {
			var rel struct {
				TagName    string `json:"tag_name"`
				HTMLURL    string `json:"html_url"`
				Prerelease bool   `json:"prerelease"`
			}
			if err := s.getJSON(ctx, "https://api.github.com/repos/"+releasesRepo()+"/releases/latest", map[string]string{
				"Accept":     "application/vnd.github+json",
				"User-Agent": "Hanzo-World-Version-Check",
			}, &rel); err != nil {
				return nil, err
			}
			return map[string]any{
				"version":    trimPrefix(rel.TagName, "v"),
				"tag":        rel.TagName,
				"url":        rel.HTMLURL,
				"prerelease": rel.Prerelease,
			}, nil
		},
		func(w http.ResponseWriter, err error) {
			writeError(w, http.StatusBadGateway, "fetch_failed")
		})
}

// handleDownload 302-redirects to the platform-specific release asset (or the
// releases page as fallback). Ported from api/download.js.
func (s *Server) handleDownload(w http.ResponseWriter, r *http.Request) {
	setCORS(w, "GET, OPTIONS")
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	repo := releasesRepo()
	releasesPage := "https://github.com/" + repo + "/releases/latest"

	platform := r.URL.Query().Get("platform")
	suffix, ok := platformSuffix[platform]
	if !ok {
		http.Redirect(w, r, releasesPage, http.StatusFound)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	var rel struct {
		Assets []struct {
			Name string `json:"name"`
			URL  string `json:"browser_download_url"`
		} `json:"assets"`
	}
	if err := s.getJSON(ctx, "https://api.github.com/repos/"+repo+"/releases/latest", map[string]string{
		"Accept":     "application/vnd.github+json",
		"User-Agent": "Hanzo-World-Download-Redirect",
	}, &rel); err != nil {
		http.Redirect(w, r, releasesPage, http.StatusFound)
		return
	}
	for _, a := range rel.Assets {
		if suffix(a.Name) {
			w.Header().Set("Cache-Control", "public, s-maxage=300, stale-while-revalidate=60")
			http.Redirect(w, r, a.URL, http.StatusFound)
			return
		}
	}
	http.Redirect(w, r, releasesPage, http.StatusFound)
}

// platformSuffix maps a platform key to an asset-name matcher, ported from the
// PLATFORM_PATTERNS table in api/download.js.
var platformSuffix = map[string]func(string) bool{
	"windows-exe":    func(n string) bool { return hasSuffix(n, "_x64-setup.exe") },
	"windows-msi":    func(n string) bool { return hasSuffix(n, "_x64_en-US.msi") },
	"macos-arm64":    func(n string) bool { return hasSuffix(n, "_aarch64.dmg") },
	"macos-x64":      func(n string) bool { return hasSuffix(n, "_x64.dmg") && !contains(n, "setup") },
	"linux-appimage": func(n string) bool { return hasSuffix(n, "_amd64.AppImage") },
}
