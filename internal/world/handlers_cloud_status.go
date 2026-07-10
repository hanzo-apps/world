package world

import (
	"context"
	"net/http"
	"net/url"
	"sort"
	"time"
)

// status.hanzo.ai integration — a PUBLIC, non-sensitive health summary of the
// Hanzo platform, proxied from the status page (Gatus, github.com/hanzoai/status).
//
// Gatus exposes the live board at GET /v1/status/endpoints/statuses: one object
// per monitored endpoint with its recent results and health-transition events. We
// distill that into a compact per-service up/down board + an active-incidents
// list. Same contracts as the rest of the Cloud layer:
//   - allowlisted: the upstream host (operator-configured) is validated before we
//     dial (getAllowedJSON SSRF boundary),
//   - cached briefly in-memory,
//   - never 5xx: an unreachable/empty status page degrades to a clean 200 with
//     available:false — the page being down is itself honest signal, not an error.

// statusBase returns the status-page origin (HANZO_STATUS_BASE override, else
// status.hanzo.ai). No /v1 suffix — the Gatus path is composed below.
func statusBase() string {
	if v := env("HANZO_STATUS_BASE"); v != "" {
		return trimSlash(v)
	}
	return "https://status.hanzo.ai"
}

// gatusStatus is the subset of Gatus's endpoint.Status DTO we read. Fields we do
// not surface (conditionResults, uptime, hostname, …) are ignored on decode.
type gatusStatus struct {
	Name    string        `json:"name"`
	Group   string        `json:"group"`
	Key     string        `json:"key"`
	Results []gatusResult `json:"results"`
	Events  []gatusEvent  `json:"events"`
}

// gatusResult is one health evaluation of an endpoint.
type gatusResult struct {
	HTTPStatus int      `json:"status"`
	Duration   int64    `json:"duration"` // time.Duration → nanoseconds
	Errors     []string `json:"errors"`
	Success    bool     `json:"success"`
	Timestamp  string   `json:"timestamp"`
}

// gatusEvent is a health-transition event (START | HEALTHY | UNHEALTHY).
type gatusEvent struct {
	Type      string `json:"type"`
	Timestamp string `json:"timestamp"`
}

type statusPageService struct {
	Name      string  `json:"name"`
	Group     string  `json:"group,omitempty"`
	Up        bool    `json:"up"`
	LatencyMs float64 `json:"latencyMs"`
	Checked   string  `json:"checked,omitempty"`
}

type statusIncident struct {
	Name  string `json:"name"`
	Group string `json:"group,omitempty"`
	Since string `json:"since,omitempty"`
	Error string `json:"error,omitempty"`
}

type statusPage struct {
	UpdatedAt string              `json:"updatedAt"`
	Available bool                `json:"available"`
	Source    string              `json:"source"`
	Total     int                 `json:"total"`
	Up        int                 `json:"up"`
	Services  []statusPageService `json:"services"`
	Incidents []statusIncident    `json:"incidents"`
}

func (s *Server) handleCloudStatusPage(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") || methodNotGet(w, r) {
		return
	}
	s.cachedJSON(w, "cloud-status-page", "public, max-age=30, s-maxage=30, stale-while-revalidate=120",
		30*time.Second, 5*time.Minute,
		func(ctx context.Context) (any, error) {
			base := statusBase()
			host := ""
			if u, err := url.Parse(base); err == nil {
				host = u.Hostname()
			}
			var raw []gatusStatus
			err := s.getAllowedJSON(ctx, base+"/v1/status/endpoints/statuses",
				map[string]bool{host: true}, &raw)
			if err != nil || len(raw) == 0 {
				// Page unreachable/empty: honest "available:false", never a 5xx.
				return statusPage{UpdatedAt: nowRFC(), Available: false, Source: host,
					Services: []statusPageService{}, Incidents: []statusIncident{}}, nil
			}
			return summarizeStatusPage(host, raw), nil
		},
		func(w http.ResponseWriter, _ error) {
			writeJSON(w, http.StatusOK, "", statusPage{UpdatedAt: nowRFC(), Available: false,
				Services: []statusPageService{}, Incidents: []statusIncident{}})
		},
	)
}

// summarizeStatusPage distills Gatus endpoint statuses into the per-service board
// + active incidents. Health/latency come from each endpoint's most-recent result
// (by timestamp, not array position — order-independent); an incident is any
// endpoint whose latest result is failing, dated from its last UNHEALTHY event.
func summarizeStatusPage(host string, raw []gatusStatus) statusPage {
	out := statusPage{
		UpdatedAt: nowRFC(),
		Available: true,
		Source:    host,
		Services:  make([]statusPageService, 0, len(raw)),
		Incidents: make([]statusIncident, 0),
	}
	for _, e := range raw {
		name := e.Name
		if name == "" {
			name = e.Key
		}
		latest := latestResult(e)
		if latest == nil {
			continue // no evaluations yet — nothing honest to report
		}
		out.Total++
		if latest.Success {
			out.Up++
		}
		out.Services = append(out.Services, statusPageService{
			Name:      name,
			Group:     e.Group,
			Up:        latest.Success,
			LatencyMs: round1(float64(latest.Duration) / 1e6),
			Checked:   latest.Timestamp,
		})
		if !latest.Success {
			inc := statusIncident{Name: name, Group: e.Group, Since: lastUnhealthySince(e, latest.Timestamp)}
			if len(latest.Errors) > 0 {
				inc.Error = latest.Errors[0]
			}
			out.Incidents = append(out.Incidents, inc)
		}
	}
	// Board: down first, then by group/name; incidents: most-recent onset first.
	sort.SliceStable(out.Services, func(i, j int) bool {
		if out.Services[i].Up != out.Services[j].Up {
			return !out.Services[i].Up // failing services float to the top
		}
		if out.Services[i].Group != out.Services[j].Group {
			return out.Services[i].Group < out.Services[j].Group
		}
		return out.Services[i].Name < out.Services[j].Name
	})
	sort.SliceStable(out.Incidents, func(i, j int) bool { return out.Incidents[i].Since > out.Incidents[j].Since })
	return out
}

// latestResult returns the result with the greatest timestamp (RFC3339 sorts
// lexically), independent of storage ordering. nil when there are no results.
func latestResult(e gatusStatus) *gatusResult {
	var best *gatusResult
	for i := range e.Results {
		r := e.Results[i]
		if best == nil || r.Timestamp > best.Timestamp {
			cp := r
			best = &cp
		}
	}
	return best
}

// lastUnhealthySince returns the timestamp of the most recent UNHEALTHY event,
// which marks when the current incident began; falls back to the latest result's
// timestamp when no such event is recorded.
func lastUnhealthySince(e gatusStatus, fallback string) string {
	since := ""
	for _, ev := range e.Events {
		if ev.Type == "UNHEALTHY" && ev.Timestamp > since {
			since = ev.Timestamp
		}
	}
	if since == "" {
		return fallback
	}
	return since
}
