package world

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// TestStatusPageNeverErrors hits the live status-page proxy. status.hanzo.ai may
// be up or down; either way the endpoint must return a clean 200 JSON with the
// honest available flag (false when the page is unreachable) — never a 5xx.
func TestStatusPageNeverErrors(t *testing.T) {
	s := NewServer()
	mux := http.NewServeMux()
	s.Mount(mux)
	ts := httptest.NewServer(mux)
	t.Cleanup(ts.Close)

	resp, err := http.Get(ts.URL + "/v1/world/cloud/status-page")
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("want 200, got %d", resp.StatusCode)
	}
	var sp statusPage
	if err := json.NewDecoder(resp.Body).Decode(&sp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if sp.UpdatedAt == "" {
		t.Fatalf("missing updatedAt")
	}
	// available:false must carry non-nil (empty) slices so the client never NPEs.
	if sp.Services == nil || sp.Incidents == nil {
		t.Fatalf("services/incidents must be non-nil slices")
	}
	if sp.Up > sp.Total {
		t.Fatalf("up(%d) > total(%d) is impossible", sp.Up, sp.Total)
	}
	pretty, _ := json.MarshalIndent(sp, "", "  ")
	t.Logf("status-page:\n%s", pretty)
}

// TestSummarizeStatusPage proves the Gatus→summary distillation: correct up/total
// counts, failing services floated to the top of the board, and one active
// incident dated from its most recent UNHEALTHY event with the first error.
func TestSummarizeStatusPage(t *testing.T) {
	raw := []gatusStatus{
		{
			Name: "gateway", Group: "core",
			Results: []gatusResult{
				{HTTPStatus: 200, Duration: 42_000_000, Success: true, Timestamp: "2026-07-09T10:00:00Z"},
				{HTTPStatus: 200, Duration: 51_000_000, Success: true, Timestamp: "2026-07-09T10:01:00Z"},
			},
		},
		{
			Name: "iam", Group: "core",
			// Newest result is failing and is deliberately NOT last, proving the
			// summary selects by timestamp, not array position.
			Results: []gatusResult{
				{HTTPStatus: 503, Duration: 1200_000_000, Errors: []string{"connection refused"}, Success: false, Timestamp: "2026-07-09T10:05:00Z"},
				{HTTPStatus: 200, Duration: 60_000_000, Success: true, Timestamp: "2026-07-09T10:03:00Z"},
			},
			Events: []gatusEvent{
				{Type: "HEALTHY", Timestamp: "2026-07-09T09:00:00Z"},
				{Type: "UNHEALTHY", Timestamp: "2026-07-09T10:04:30Z"},
			},
		},
	}

	sp := summarizeStatusPage("status.hanzo.ai", raw)
	if !sp.Available {
		t.Fatalf("available must be true with data")
	}
	if sp.Total != 2 || sp.Up != 1 {
		t.Fatalf("want total=2 up=1, got total=%d up=%d", sp.Total, sp.Up)
	}
	if sp.Services[0].Name != "iam" || sp.Services[0].Up {
		t.Fatalf("failing service must sort first, got %+v", sp.Services[0])
	}
	if sp.Services[0].LatencyMs != 1200 {
		t.Fatalf("want iam latency 1200ms, got %v", sp.Services[0].LatencyMs)
	}
	if len(sp.Incidents) != 1 {
		t.Fatalf("want 1 incident, got %d", len(sp.Incidents))
	}
	inc := sp.Incidents[0]
	if inc.Name != "iam" || inc.Since != "2026-07-09T10:04:30Z" || inc.Error != "connection refused" {
		t.Fatalf("incident wrong: %+v", inc)
	}
}
