package world

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// The social emitters ship dark until KMS carries their credentials, so the two
// things that MUST hold are:
//  1. a keyless platform degrades to an empty channel — 200, valid RSS, never a
//     5xx that would take the monitors panel down with it, and
//  2. what it DOES emit reaches the lake, because a same-origin emitter bypasses
//     rss-proxy and is therefore the only thing that can ingest its own items.

func socialGet(t *testing.T, s *Server, path string) *httptest.ResponseRecorder {
	t.Helper()
	w := httptest.NewRecorder()
	s.handleSocial(w, httptest.NewRequest(http.MethodGet, path, nil))
	return w
}

func TestSocialDegradesWithoutCredentials(t *testing.T) {
	for _, platform := range []string{"x", "tiktok", "linkedin"} {
		t.Run(platform, func(t *testing.T) {
			for _, k := range []string{"X_BEARER_TOKEN", "TWITTER_BEARER_TOKEN", "TIKTOK_ACCESS_TOKEN", "LINKEDIN_ACCESS_TOKEN"} {
				t.Setenv(k, "")
			}
			w := socialGet(t, NewServer(), "/v1/world/social/"+platform+"?q=ai")
			if w.Code != http.StatusOK {
				t.Fatalf("status %d, want 200", w.Code)
			}
			body := w.Body.String()
			if !strings.HasPrefix(body, `<?xml`) || !strings.Contains(body, "</channel></rss>") {
				t.Fatalf("not an RSS channel: %q", truncate(body, 120))
			}
			if n := len(parseFeedItems([]byte(body), 50)); n != 0 {
				t.Fatalf("keyless platform emitted %d items", n)
			}
		})
	}
}

func TestSocialRejectsUnknownAndEmptyQuery(t *testing.T) {
	s := NewServer()
	if w := socialGet(t, s, "/v1/world/social/myspace?q=ai"); w.Code != http.StatusNotFound {
		t.Fatalf("unknown platform: status %d, want 404", w.Code)
	}
	if w := socialGet(t, s, "/v1/world/social/x"); w.Code != http.StatusBadRequest {
		t.Fatalf("missing q: status %d, want 400", w.Code)
	}
}

func TestSocialItemsReachTheLake(t *testing.T) {
	s := testServer(t)
	src := socialSources["x"]
	body := buildRSS(src.title, src.home, "posts", "https://world.hanzo.ai/v1/world/social/x", []rssOutItem{
		{"nvidia ships a new gpu", "https://x.com/acme/status/1", time.Now().UTC().Format(time.RFC1123)},
	})
	s.ingestFeedItems(src.home, body)
	s.store.Lake.Flush()

	matches := s.matchMonitors([]Monitor{{ID: "m1", Keywords: []string{"nvidia"}}})
	if len(matches) != 1 {
		t.Fatalf("monitor matched %d social items, want 1", len(matches))
	}
	if matches[0].Source != "x.com" || matches[0].Link != "https://x.com/acme/status/1" {
		t.Fatalf("unexpected match: %+v", matches[0])
	}
}

// A post body carrying XML metacharacters must not be able to break the channel.
func TestBuildRSSEscapesUpstreamText(t *testing.T) {
	body := buildRSS("X", "https://x.com", "posts", "https://world.hanzo.ai/v1/world/social/x", []rssOutItem{
		{`a & b <script>alert(1)</script>`, "https://x.com/a/status/1", time.Now().UTC().Format(time.RFC1123)},
	})
	if strings.Contains(string(body), "<script>") {
		t.Fatal("raw markup survived into the channel")
	}
	items := parseFeedItems(body, 10)
	if len(items) != 1 || !strings.Contains(items[0].Title, "<script>") {
		t.Fatalf("escaped title did not round-trip: %+v", items)
	}
}
