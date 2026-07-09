package world

import (
	"context"
	"encoding/json"
	"encoding/xml"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// feeds-batch: one POST per news category instead of 5-15 client-side
// rss-proxy GETs. The client sends its feed URLs; we fetch them in parallel
// (sharing the exact "rss:<url>" cache keys with handleRSSProxy, so either
// path warms the other), parse RSS/Atom/RDF server-side, and return compact
// items. Never-5xx: per-feed ok flags; an unreachable feed is ok:false, the
// endpoint itself always answers 200 to a valid request.

const (
	feedsBatchMaxURLs      = 30
	feedsBatchMaxItems     = 8
	feedsBatchParallel     = 12
	feedsBatchFetchTimeout = 8 * time.Second // one slow upstream must not hold a category hostage
)

type feedBatchItem struct {
	Title   string `json:"title"`
	Link    string `json:"link"`
	PubDate string `json:"pubDate,omitempty"` // RFC3339 when parseable, else ""
}

type feedBatchResult struct {
	URL   string          `json:"url"`
	OK    bool            `json:"ok"`
	Items []feedBatchItem `json:"items"`
}

func (s *Server) handleFeedsBatch(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "POST, OPTIONS") {
		return
	}
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "POST only")
		return
	}
	var req struct {
		URLs []string `json:"urls"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&req); err != nil || len(req.URLs) == 0 {
		writeError(w, http.StatusBadRequest, "Body must be {\"urls\":[...]}")
		return
	}
	if len(req.URLs) > feedsBatchMaxURLs {
		req.URLs = req.URLs[:feedsBatchMaxURLs]
	}

	ctx, cancel := context.WithTimeout(r.Context(), 25*time.Second)
	defer cancel()

	results := make([]feedBatchResult, len(req.URLs))
	sem := make(chan struct{}, feedsBatchParallel)
	var wg sync.WaitGroup
	for i, feedURL := range req.URLs {
		i, feedURL := i, feedURL
		results[i] = feedBatchResult{URL: feedURL, Items: []feedBatchItem{}}
		parsed, err := url.Parse(feedURL)
		if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || !allowedRSSDomains[parsed.Hostname()] {
			continue // ok:false — invalid or off-allowlist URL
		}
		wg.Add(1)
		sem <- struct{}{}
		go func() {
			defer wg.Done()
			defer func() { <-sem }()
			if body, ok := s.feedXML(ctx, feedURL); ok {
				results[i].OK = true
				results[i].Items = parseFeedItems(body, feedsBatchMaxItems)
			}
		}()
	}
	wg.Wait()

	writeJSON(w, http.StatusOK, "public, max-age=60, s-maxage=60, stale-while-revalidate=300", map[string]any{
		"updatedAt": nowRFC(),
		"feeds":     results,
	})
}

// feedXML returns the raw feed body, sharing handleRSSProxy's cache keys and
// stale-fallback behavior.
func (s *Server) feedXML(ctx context.Context, feedURL string) ([]byte, bool) {
	key := "rss:" + feedURL
	if v, ok := s.cache.Get(key); ok {
		return v.([]byte), true
	}
	ctx, cancel := context.WithTimeout(ctx, feedsBatchFetchTimeout)
	defer cancel()
	body, status, err := s.getAllowlisted(ctx, feedURL, allowedRSSDomains, map[string]string{
		"User-Agent": browserUA,
		"Accept":     "application/rss+xml, application/xml, text/xml, */*",
	})
	// A blank 200 is a failure, not content: never cache it (it would poison the
	// shared "rss:" key handleRSSProxy reads too). Fall back to last-good stale.
	if err != nil || status < 200 || status >= 300 || isBlankBody(body) {
		if v, ok := s.cache.GetStale(key); ok {
			return v.([]byte), true
		}
		return nil, false
	}
	s.cache.Set(key, body, 5*time.Minute, 15*time.Minute)
	return body, true
}

// parseFeedItems handles RSS 2.0 (channel>item), RDF/RSS 1.0 (root-level
// item, e.g. arXiv) and Atom (entry). Unparseable feeds return no items.
func parseFeedItems(body []byte, limit int) []feedBatchItem {
	var doc struct {
		Channel struct {
			Items []rssItem `xml:"item"`
		} `xml:"channel"`
		RDFItems []rssItem  `xml:"item"`  // RDF: items are root children
		Entries  []atomItem `xml:"entry"` // Atom
	}
	dec := xml.NewDecoder(strings.NewReader(string(body)))
	dec.Strict = false
	if err := dec.Decode(&doc); err != nil {
		return []feedBatchItem{}
	}
	items := doc.Channel.Items
	if len(items) == 0 {
		items = doc.RDFItems
	}
	out := make([]feedBatchItem, 0, limit)
	for _, it := range items {
		if len(out) >= limit {
			break
		}
		title := strings.TrimSpace(it.Title)
		if title == "" {
			continue
		}
		link := strings.TrimSpace(it.Link)
		if link == "" {
			link = strings.TrimSpace(it.GUID)
		}
		out = append(out, feedBatchItem{Title: title, Link: link, PubDate: normalizeFeedDate(firstNonEmpty(it.PubDate, it.DCDate))})
	}
	for _, e := range doc.Entries {
		if len(out) >= limit {
			break
		}
		title := strings.TrimSpace(e.Title)
		if title == "" {
			continue
		}
		link := ""
		for _, l := range e.Links {
			if l.Rel == "" || l.Rel == "alternate" {
				link = l.Href
				break
			}
		}
		if link == "" && len(e.Links) > 0 {
			link = e.Links[0].Href
		}
		out = append(out, feedBatchItem{Title: title, Link: strings.TrimSpace(link), PubDate: normalizeFeedDate(firstNonEmpty(e.Published, e.Updated))})
	}
	return out
}

type rssItem struct {
	Title   string `xml:"title"`
	Link    string `xml:"link"`
	GUID    string `xml:"guid"`
	PubDate string `xml:"pubDate"`
	DCDate  string `xml:"date"` // dc:date (RDF feeds like arXiv)
}

type atomItem struct {
	Title string `xml:"title"`
	Links []struct {
		Rel  string `xml:"rel,attr"`
		Href string `xml:"href,attr"`
	} `xml:"link"`
	Published string `xml:"published"`
	Updated   string `xml:"updated"`
}

var feedDateLayouts = []string{
	time.RFC1123Z, time.RFC1123, time.RFC822Z, time.RFC822, time.RFC3339,
	"Mon, 2 Jan 2006 15:04:05 -0700", "Mon, 2 Jan 2006 15:04:05 MST",
	"2006-01-02T15:04:05Z", "2006-01-02 15:04:05",
}

func normalizeFeedDate(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	for _, layout := range feedDateLayouts {
		if t, err := time.Parse(layout, raw); err == nil {
			return t.UTC().Format(time.RFC3339)
		}
	}
	return ""
}
