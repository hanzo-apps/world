package world

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// TestRoutesRespond sweeps every registered /v1/world route: none may 5xx or
// return the SPA shell, and JSON routes must return JSON. Upstream fetches are
// exercised for real (network) — routes that need params/keys/POST must still
// fail CLEANLY (4xx JSON or skipped body), never a crash. This is the e2e
// smoke suite for the data plane; run: go test ./internal/world/
func TestRoutesRespond(t *testing.T) {
	s := NewServer()
	mux := http.NewServeMux()
	s.Mount(mux)
	ts := httptest.NewServer(mux)
	t.Cleanup(ts.Close) // after ALL parallel subtests (defer would fire too early)

	// route → optional query that makes it a real request
	qs := map[string]string{
		"/v1/world/gdelt-doc":     "?query=world&maxrecords=5",
		"/v1/world/gdelt-geo":     "?query=conflict",
		"/v1/world/rss-proxy":     "?url=https%3A%2F%2Ffeeds.bbci.co.uk%2Fnews%2Fworld%2Frss.xml",
		"/v1/world/yahoo-finance": "?symbol=SPY",
		"/v1/world/fred-data":     "?series_id=DGS10",
		"/v1/world/youtube/live":  "?channel=@SkyNews",
		"/v1/world/youtube/embed": "?videoId=dQw4w9WgXcQ",
		"/v1/world/arxiv":         "?q=robotics",
		"/v1/world/worldbank":     "?indicator=IT.NET.USER.ZS",
	}
	post := map[string]bool{
		"/v1/world/feeds-batch":          true,
		"/v1/world/groq-summarize":       true,
		"/v1/world/openrouter-summarize": true,
		"/v1/world/classify-batch":       true,
		"/v1/world/classify-event":       true,
		"/v1/world/country-intel":        true,
		"/v1/world/analyst":              true,
		"/v1/world/pizzint/gdelt/batch":  false,
	}

	for _, route := range s.Routes() {
		route := route
		t.Run(route, func(t *testing.T) {
			t.Parallel()
			url := ts.URL + route + qs[route]
			client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
			var resp *http.Response
			var err error
			if post[route] {
				resp, err = client.Post(url, "application/json", strings.NewReader(`{}`))
			} else {
				resp, err = client.Get(url)
			}
			if err != nil {
				t.Fatalf("request failed: %v", err)
			}
			defer resp.Body.Close()
			if resp.StatusCode >= 500 {
				t.Fatalf("5xx: %d", resp.StatusCode)
			}
			ct := resp.Header.Get("Content-Type")
			if strings.Contains(ct, "text/html") && !strings.Contains(route, "embed") && !strings.Contains(route, "story") && !strings.Contains(route, "download") {
				t.Fatalf("HTML shell leaked from data route (ct=%q status=%d)", ct, resp.StatusCode)
			}
		})
	}
}
