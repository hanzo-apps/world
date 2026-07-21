package world

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// Layoff notices from the Texas Workforce Commission WARN feed (Socrata open data,
// no key). The federal WARN Act requires employers to file advance notice of mass
// layoffs and plant closings; Texas publishes the largest stable machine-readable
// feed. This surfaces the recent stream of layoff filings and the headcount at risk
// — the "employers are cutting" macro signal, a leading indicator of labor slack.
// Single-state by construction; the field labels it as such.

const warnTexasURL = "https://data.texas.gov/resource/8w53-c4f6.json?$limit=200&$order=notice_date%20DESC"

// handleLayoffs serves /v1/world/layoffs.
func (s *Server) handleLayoffs(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") || methodNotGet(w, r) {
		return
	}
	s.cachedJSON(w, "layoffs:v1",
		"public, max-age=3600, s-maxage=3600, stale-while-revalidate=7200",
		time.Hour, 2*time.Hour,
		func(ctx context.Context) (any, error) { return s.computeLayoffs(ctx) },
		func(w http.ResponseWriter, err error) {
			writeJSON(w, http.StatusOK, "", map[string]any{
				"asOf": nowISO(), "unavailable": true, "count": 0,
				"workersAffected": 0, "recent": []any{},
			})
		})
}

func (s *Server) computeLayoffs(ctx context.Context) (any, error) {
	body, status, err := s.get(ctx, warnTexasURL,
		map[string]string{"Accept": "application/json", "User-Agent": browserUA})
	if err != nil {
		return nil, err
	}
	if status < 200 || status >= 300 {
		return nil, errUnavailable
	}
	notices := parseWarnNotices(body)
	total := 0
	recent := make([]map[string]any, 0, 40)
	for i, n := range notices {
		total += n.Workers
		if i < 40 {
			recent = append(recent, map[string]any{
				"employer": n.Employer, "workers": n.Workers,
				"city": n.City, "noticedAt": n.NoticeDate, "effectiveAt": n.LayoffDate,
			})
		}
	}
	return map[string]any{
		"asOf":            nowISO(),
		"source":          "Texas Workforce Commission · WARN",
		"region":          "Texas",
		"count":           len(notices),
		"workersAffected": total,
		"recent":          recent,
	}, nil
}

// ── pure parsing (unit-tested) ───────────────────────────────────────────────

type warnNotice struct {
	Employer   string
	Workers    int
	City       string
	NoticeDate string
	LayoffDate string
}

// parseWarnNotices pulls notices out of the Texas WARN Socrata JSON array. Malformed
// input yields an empty slice, never a panic. Rows are already newest-first from the
// query; each is trimmed and its worker count parsed defensively.
func parseWarnNotices(body []byte) []warnNotice {
	var raw []struct {
		NoticeDate  string `json:"notice_date"`
		JobSiteName string `json:"job_site_name"`
		City        string `json:"city_name"`
		LayoffDate  string `json:"layoff_date"`
		Total       string `json:"total_layoff_number"`
	}
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil
	}
	out := make([]warnNotice, 0, len(raw))
	for _, r := range raw {
		out = append(out, warnNotice{
			Employer:   strings.TrimSpace(r.JobSiteName),
			Workers:    parseWarnCount(r.Total),
			City:       strings.TrimSpace(r.City),
			NoticeDate: warnDate(r.NoticeDate),
			LayoffDate: warnDate(r.LayoffDate),
		})
	}
	return out
}

// parseWarnCount reads the total-layoff field, which Socrata serves as a string and
// occasionally leaves blank or comma-formatted. Non-numeric yields 0.
func parseWarnCount(s string) int {
	s = strings.ReplaceAll(strings.TrimSpace(s), ",", "")
	if s == "" {
		return 0
	}
	n, err := strconv.Atoi(s)
	if err != nil || n < 0 {
		return 0
	}
	return n
}

// warnDate drops the Socrata floating-timestamp time component ("2026-06-23T00:00:00.000")
// to a plain calendar date; passes through anything that doesn't match.
func warnDate(s string) string {
	s = strings.TrimSpace(s)
	if i := strings.IndexByte(s, 'T'); i == 10 {
		return s[:10]
	}
	return s
}
