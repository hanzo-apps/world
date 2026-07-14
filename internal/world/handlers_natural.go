package world

import (
	"net/http"
	"time"
)

// ── HKO tropical-cyclone warnings ────────────────────────────────────────────

// handleHKOWarnings proxies the Hong Kong Observatory weather-warning summary
// (verbatim JSON). Browsers can't reach data.weather.gov.hk directly (no CORS),
// so the Western-Pacific cyclone attribution stream folds it in through here as
// an HKO agency observation. Degrades to {} so the client parser simply yields
// no warnings. Follows handleGDELTGeo's passthrough shape.
func (s *Server) handleHKOWarnings(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") || methodNotGet(w, r) {
		return
	}
	const upstream = "https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=warnsum&lang=en"
	s.passthrough(w, "hko-warnings", upstream, "application/json",
		"public, max-age=300, s-maxage=300, stale-while-revalidate=60",
		nil, 5*time.Minute, 15*time.Minute,
		func(w http.ResponseWriter, err error) {
			writeJSON(w, http.StatusOK, "", map[string]any{})
		})
}
