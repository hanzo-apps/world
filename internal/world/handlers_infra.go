package world

import (
	"context"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"
)

// ── Cloudflare Radar outages ─────────────────────────────────────────────────

// handleCloudflareOutages proxies Cloudflare Radar outage annotations. Ported
// from api/cloudflare-outages.js. Requires CLOUDFLARE_API_TOKEN.
func (s *Server) handleCloudflareOutages(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") || methodNotGet(w, r) {
		return
	}
	token := env("CLOUDFLARE_API_TOKEN")
	if token == "" {
		writeJSON(w, http.StatusOK, "", map[string]any{"configured": false})
		return
	}
	q := r.URL.Query()
	dateRange := q.Get("dateRange")
	if dateRange == "" {
		dateRange = "7d"
	}
	limit := clampInt(q.Get("limit"), 50, 1, 100)
	upstream := "https://api.cloudflare.com/client/v4/radar/annotations/outages?dateRange=" + urlQueryEscape(dateRange) + "&limit=" + itoa(limit)
	s.passthrough(w, "cf-outages:"+dateRange+":"+itoa(limit), upstream, "application/json",
		"public, max-age=120, s-maxage=120, stale-while-revalidate=60",
		map[string]string{"Authorization": "Bearer " + token, "Accept": "application/json"},
		2*time.Minute, 10*time.Minute,
		func(w http.ResponseWriter, err error) {
			writeJSON(w, http.StatusOK, "", map[string]any{"success": true, "result": map[string]any{"annotations": []any{}}})
		})
}

// ── FAA airport status ───────────────────────────────────────────────────────

// handleFAAStatus proxies the FAA NAS status XML verbatim. Ported from
// api/faa-status.js.
func (s *Server) handleFAAStatus(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") {
		return
	}
	s.passthrough(w, "faa-status", "https://nasstatus.faa.gov/api/airport-status-information",
		"application/xml", "public, max-age=60, s-maxage=60, stale-while-revalidate=30",
		map[string]string{"Accept": "application/xml"}, time.Minute, 10*time.Minute,
		func(w http.ResponseWriter, err error) {
			writeBytes(w, http.StatusOK, "application/xml", "", []byte("<AIRPORT_STATUS_INFORMATION/>"))
		})
}

// ── NGA broadcast warnings ───────────────────────────────────────────────────

// handleNGAWarnings proxies the NGA maritime broadcast-warning JSON verbatim.
// Ported from api/nga-warnings.js.
func (s *Server) handleNGAWarnings(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") {
		return
	}
	s.passthrough(w, "nga-warnings", "https://msi.nga.mil/api/publications/broadcast-warn?output=json&status=A",
		"application/json", "public, max-age=300, s-maxage=300, stale-while-revalidate=60",
		map[string]string{"Accept": "application/json"}, 5*time.Minute, 30*time.Minute,
		func(w http.ResponseWriter, err error) {
			writeJSON(w, http.StatusOK, "", map[string]any{"error": err.Error(), "data": []any{}})
		})
}

// ── PizzINT (OSINT dashboard) ────────────────────────────────────────────────

// handlePizzintDashboard proxies the PizzINT dashboard JSON verbatim. Ported
// from api/pizzint/dashboard-data.js.
func (s *Server) handlePizzintDashboard(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") {
		return
	}
	s.passthrough(w, "pizzint:dashboard", "https://www.pizzint.watch/api/dashboard-data",
		"application/json", "public, max-age=60, s-maxage=60, stale-while-revalidate=30",
		map[string]string{"Accept": "application/json", "User-Agent": "Hanzo-World/1.0"},
		time.Minute, 10*time.Minute,
		func(w http.ResponseWriter, err error) {
			writeJSON(w, http.StatusOK, "", map[string]any{"error": "Failed to fetch PizzINT data", "details": err.Error()})
		})
}

// handlePizzintGdeltBatch proxies the PizzINT GDELT batch endpoint verbatim.
// Ported from api/pizzint/gdelt/batch.js.
func (s *Server) handlePizzintGdeltBatch(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") {
		return
	}
	q := r.URL.Query()
	pairs := q.Get("pairs")
	if pairs == "" {
		pairs = "usa_russia,russia_ukraine,usa_china,china_taiwan,usa_iran,usa_venezuela"
	}
	method := q.Get("method")
	if method == "" {
		method = "gpr"
	}
	upstream := "https://www.pizzint.watch/api/gdelt/batch?pairs=" + urlQueryEscape(pairs) + "&method=" + method
	if v := q.Get("dateStart"); v != "" {
		upstream += "&dateStart=" + v
	}
	if v := q.Get("dateEnd"); v != "" {
		upstream += "&dateEnd=" + v
	}
	s.passthrough(w, "pizzint:gdelt:"+pairs+":"+method, upstream, "application/json",
		"public, max-age=300, s-maxage=300, stale-while-revalidate=60",
		map[string]string{"Accept": "application/json", "User-Agent": "Hanzo-World/1.0"},
		5*time.Minute, 30*time.Minute,
		func(w http.ResponseWriter, err error) {
			writeJSON(w, http.StatusOK, "", map[string]any{"error": "Failed to fetch GDELT data", "details": err.Error()})
		})
}

// ── Service status (provider health board) ───────────────────────────────────

type statusService struct{ id, name, page, parser, category string }

var statusServices = []statusService{
	{"aws", "AWS", "https://health.aws.amazon.com/health/status", "aws", "cloud"},
	{"azure", "Azure", "https://azure.status.microsoft/en-us/status/feed/", "rss", "cloud"},
	{"gcp", "Google Cloud", "https://status.cloud.google.com/incidents.json", "gcp", "cloud"},
	{"cloudflare", "Cloudflare", "https://www.cloudflarestatus.com/api/v2/status.json", "", "cloud"},
	{"vercel", "Vercel", "https://www.vercel-status.com/api/v2/status.json", "", "cloud"},
	{"netlify", "Netlify", "https://www.netlifystatus.com/api/v2/status.json", "", "cloud"},
	{"digitalocean", "DigitalOcean", "https://status.digitalocean.com/api/v2/status.json", "", "cloud"},
	{"render", "Render", "https://status.render.com/api/v2/status.json", "", "cloud"},
	{"railway", "Railway", "https://railway.instatus.com/summary.json", "instatus", "cloud"},
	{"github", "GitHub", "https://www.githubstatus.com/api/v2/status.json", "", "dev"},
	{"gitlab", "GitLab", "https://status.gitlab.com/1.0/status/5b36dc6502d06804c08349f7", "statusio", "dev"},
	{"npm", "npm", "https://status.npmjs.org/api/v2/status.json", "", "dev"},
	{"docker", "Docker Hub", "https://www.dockerstatus.com/1.0/status/533c6539221ae15e3f000031", "statusio", "dev"},
	{"bitbucket", "Bitbucket", "https://bitbucket.status.atlassian.com/api/v2/status.json", "", "dev"},
	{"circleci", "CircleCI", "https://status.circleci.com/api/v2/status.json", "", "dev"},
	{"jira", "Jira", "https://jira-software.status.atlassian.com/api/v2/status.json", "", "dev"},
	{"confluence", "Confluence", "https://confluence.status.atlassian.com/api/v2/status.json", "", "dev"},
	{"linear", "Linear", "https://linearstatus.com/api/v2/status.json", "incidentio", "dev"},
	{"slack", "Slack", "https://slack-status.com/api/v2.0.0/current", "slack", "comm"},
	{"discord", "Discord", "https://discordstatus.com/api/v2/status.json", "", "comm"},
	{"zoom", "Zoom", "https://www.zoomstatus.com/api/v2/status.json", "", "comm"},
	{"notion", "Notion", "https://www.notion-status.com/api/v2/status.json", "", "comm"},
	{"openai", "OpenAI", "https://status.openai.com/api/v2/status.json", "incidentio", "ai"},
	{"anthropic", "Anthropic", "https://status.claude.com/api/v2/status.json", "incidentio", "ai"},
	{"replicate", "Replicate", "https://www.replicatestatus.com/api/v2/status.json", "incidentio", "ai"},
	{"stripe", "Stripe", "https://status.stripe.com/current", "stripe", "saas"},
	{"twilio", "Twilio", "https://status.twilio.com/api/v2/status.json", "", "saas"},
	{"datadog", "Datadog", "https://status.datadoghq.com/api/v2/status.json", "", "saas"},
	{"sentry", "Sentry", "https://status.sentry.io/api/v2/status.json", "", "saas"},
	{"supabase", "Supabase", "https://status.supabase.com/api/v2/status.json", "", "saas"},
}

// handleServiceStatus aggregates provider status pages into one board. Ported
// from api/service-status.js.
func (s *Server) handleServiceStatus(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") {
		return
	}
	category := r.URL.Query().Get("category")
	s.cachedJSON(w, "service-status:"+category, "public, max-age=60, s-maxage=60, stale-while-revalidate=30",
		time.Minute, 10*time.Minute,
		func(ctx context.Context) (any, error) {
			var services []statusService
			for _, svc := range statusServices {
				if category == "" || category == "all" || svc.category == category {
					services = append(services, svc)
				}
			}
			results := make([]map[string]any, len(services))
			var wg sync.WaitGroup
			for i, svc := range services {
				wg.Add(1)
				go func(i int, svc statusService) {
					defer wg.Done()
					status, desc := s.checkStatusPage(ctx, svc)
					results[i] = map[string]any{"id": svc.id, "name": svc.name, "category": svc.category, "status": status, "description": desc}
				}(i, svc)
			}
			wg.Wait()
			order := map[string]int{"outage": 0, "degraded": 1, "unknown": 2, "operational": 3}
			sort.SliceStable(results, func(i, j int) bool { return order[asString(results[i]["status"])] < order[asString(results[j]["status"])] })
			summary := map[string]int{"operational": 0, "degraded": 0, "outage": 0, "unknown": 0}
			for _, r := range results {
				summary[asString(r["status"])]++
			}
			return map[string]any{"success": true, "timestamp": nowISO(), "summary": summary, "services": results}, nil
		},
		func(w http.ResponseWriter, err error) {
			writeJSON(w, http.StatusOK, "", map[string]any{"success": false, "services": []any{}, "error": err.Error()})
		})
}

func (s *Server) checkStatusPage(ctx context.Context, svc statusService) (string, string) {
	hdr := map[string]string{"Accept": "application/json, text/plain, */*", "Accept-Language": "en-US,en;q=0.9"}
	if svc.parser == "rss" {
		hdr["Accept"] = "application/xml, text/xml"
	}
	if svc.parser != "incidentio" {
		hdr["User-Agent"] = "Mozilla/5.0 (compatible; Hanzo-World/1.0)"
	}
	body, status, err := s.get(ctx, svc.page, hdr)
	if err != nil {
		return "unknown", "Request failed"
	}
	if status < 200 || status >= 300 {
		return "unknown", "HTTP " + itoa(status)
	}
	text := string(body)
	switch svc.parser {
	case "aws":
		return "operational", "Status page reachable"
	case "rss":
		if contains(text, "<item>") && (contains(text, "degradation") || contains(text, "outage") || contains(text, "incident")) {
			return "degraded", "Recent incidents reported"
		}
		return "operational", "No recent incidents"
	case "gcp":
		var incidents []map[string]any
		if decodeNumber(body, &incidents) != nil {
			return "unknown", "Invalid response"
		}
		active := 0
		high := false
		now := time.Now()
		for _, inc := range incidents {
			endStr := asString(mapGet(inc, "end"))
			if endStr == "" {
				active++
			} else if t, err := time.Parse(time.RFC3339, endStr); err == nil && t.After(now) {
				active++
			}
			if asString(mapGet(inc, "severity")) == "high" {
				high = true
			}
		}
		if active == 0 {
			return "operational", "All services operational"
		}
		if high {
			return "outage", itoa(active) + " active incident(s)"
		}
		return "degraded", itoa(active) + " active incident(s)"
	case "instatus":
		var d struct {
			Page struct{ Status string } `json:"page"`
		}
		_ = decodeNumber(body, &d)
		switch d.Page.Status {
		case "UP":
			return "operational", "All systems operational"
		case "HASISSUES":
			return "degraded", "Some issues reported"
		}
		return "unknown", firstNonEmpty(d.Page.Status, "Unknown")
	case "statusio":
		var d struct {
			Result struct {
				StatusOverall struct {
					StatusCode int    `json:"status_code"`
					Status     string `json:"status"`
				} `json:"status_overall"`
			} `json:"result"`
		}
		_ = decodeNumber(body, &d)
		code := d.Result.StatusOverall.StatusCode
		st := d.Result.StatusOverall.Status
		switch {
		case code == 100:
			return "operational", firstNonEmpty(st, "All systems operational")
		case code >= 300 && code < 500:
			return "degraded", firstNonEmpty(st, "Degraded performance")
		case code >= 500:
			return "outage", firstNonEmpty(st, "Service disruption")
		}
		return "unknown", firstNonEmpty(st, "Unknown status")
	case "slack":
		var d struct {
			Status          string           `json:"status"`
			ActiveIncidents []map[string]any `json:"active_incidents"`
		}
		_ = decodeNumber(body, &d)
		if d.Status == "ok" {
			return "operational", "All systems operational"
		}
		if d.Status == "active" || len(d.ActiveIncidents) > 0 {
			n := len(d.ActiveIncidents)
			if n == 0 {
				n = 1
			}
			return "degraded", itoa(n) + " active incident(s)"
		}
		return "unknown", firstNonEmpty(d.Status, "Unknown")
	case "stripe":
		var d struct {
			LargeStatus string `json:"largestatus"`
			Message     string `json:"message"`
		}
		_ = decodeNumber(body, &d)
		switch d.LargeStatus {
		case "up":
			return "operational", firstNonEmpty(d.Message, "All systems operational")
		case "degraded":
			return "degraded", firstNonEmpty(d.Message, "Degraded performance")
		case "down":
			return "outage", firstNonEmpty(d.Message, "Service disruption")
		}
		return "unknown", firstNonEmpty(d.Message, "Unknown")
	case "incidentio":
		if strings.HasPrefix(text, "<!") || strings.HasPrefix(text, "<html") {
			lc := lower(text)
			if contains(lc, "all systems operational") || contains(lc, "fully operational") || contains(lc, "no issues") {
				return "operational", "All systems operational"
			}
			if contains(lc, "degraded") || contains(lc, "partial outage") || contains(lc, "experiencing issues") {
				return "degraded", "Some issues reported"
			}
			return "unknown", "Could not parse status"
		}
		fallthrough
	default:
		if strings.HasPrefix(text, "<!") || strings.HasPrefix(text, "<html") {
			return "unknown", "Blocked by service"
		}
		var d struct {
			Status struct {
				Indicator   string `json:"indicator"`
				Description string `json:"description"`
			} `json:"status"`
		}
		if decodeNumber(body, &d) != nil {
			return "unknown", "Invalid JSON response"
		}
		return normalizeServiceStatus(d.Status.Indicator), d.Status.Description
	}
}

func normalizeServiceStatus(indicator string) string {
	v := lower(indicator)
	switch {
	case v == "none" || v == "operational" || contains(v, "all systems operational"):
		return "operational"
	case v == "minor" || v == "degraded_performance" || v == "partial_outage" || contains(v, "degraded"):
		return "degraded"
	case v == "major" || v == "major_outage" || v == "critical" || contains(v, "outage"):
		return "outage"
	}
	return "unknown"
}
