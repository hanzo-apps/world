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

	"github.com/hanzoai/world/internal/world/ticker"
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
	Title   string   `json:"title"`
	Link    string   `json:"link"`
	PubDate string   `json:"pubDate,omitempty"` // RFC3339 when parseable, else ""
	Tickers []string `json:"tickers,omitempty"` // stock/crypto tickers in the title
	// Enrichment computed HERE, once, instead of on every client on every
	// render (see enrich.go — proven identical to the old browser code).
	Threat *ThreatClassification `json:"threat,omitempty"`
	Geo    *feedItemGeo          `json:"geo,omitempty"`
}

// feedItemGeo is the top inferred hub, already resolved to coordinates so the
// client needs no hub table of its own.
type feedItemGeo struct {
	HubID      string  `json:"hubId"`
	Name       string  `json:"name"`
	Lat        float64 `json:"lat"`
	Lon        float64 `json:"lon"`
	Confidence float64 `json:"confidence"`
}

// enrichFeedItems classifies + geo-locates parsed items. Kept separate from
// parseFeedItems: parsing is about XML, enrichment is about meaning.
func enrichFeedItems(items []feedBatchItem, variant string) []feedBatchItem {
	for i := range items {
		c := ClassifyByKeyword(items[i].Title, variant)
		items[i].Threat = &c
		if m := InferGeoHubs(items[i].Title); len(m) > 0 {
			if hub := GeoHubByID(m[0].HubID); hub != nil {
				items[i].Geo = &feedItemGeo{
					HubID: hub.ID, Name: hub.Name, Lat: hub.Lat, Lon: hub.Lon,
					Confidence: m[0].Confidence,
				}
			}
		}
	}
	return items
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
		URLs    []string `json:"urls"`
		Variant string   `json:"variant,omitempty"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&req); err != nil || len(req.URLs) == 0 {
		writeError(w, http.StatusBadRequest, "Body must be {\"urls\":[...]}")
		return
	}
	if len(req.URLs) > feedsBatchMaxURLs {
		req.URLs = req.URLs[:feedsBatchMaxURLs]
	}
	// Only 'tech' unlocks the tech keyword tiers; every other variant classifies
	// against the base tables (same rule the frontend used).
	variant := req.Variant
	if variant == "" {
		variant = "full"
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
			if body, ok, fresh := s.feedXML(ctx, feedURL); ok {
				results[i].OK = true
				results[i].Items = enrichFeedItems(parseFeedItems(body, feedsBatchMaxItems), variant)
				if fresh {
					s.ingestFeedItems(feedURL, body) // fold a cold-miss fetch into the lake
				}
			}
		}()
	}
	wg.Wait()

	writeJSON(w, http.StatusOK, "public, max-age=60, s-maxage=60, stale-while-revalidate=300", map[string]any{
		"updatedAt": nowRFC(),
		"feeds":     results,
	})
}

// feedXML returns a feed body from the shared warm cache (instant, never blocks
// on upstream), falling through to a bounded live fetch only on a true cold miss
// and write-through-ing the result. fresh reports whether the body came from that
// live fetch (so the caller folds it into the lake exactly once). The warm cache
// is the same one handleRSSProxy reads, so either path warms the other.
func (s *Server) feedXML(ctx context.Context, feedURL string) (body []byte, ok, fresh bool) {
	if b, _, hit := s.feeds.Get(ctx, feedURL); hit {
		return b, true, false // any cached copy → serve instantly (stale-while-revalidate)
	}
	fctx, cancel := context.WithTimeout(ctx, feedsBatchFetchTimeout)
	defer cancel()
	if b, okk := s.fetchFeedBody(fctx, feedURL); okk {
		s.feeds.Put(feedURL, b)
		return b, true, true
	}
	return nil, false, false
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
		out = append(out, feedBatchItem{Title: title, Link: link, PubDate: normalizeFeedDate(firstNonEmpty(it.PubDate, it.DCDate)), Tickers: ticker.Extract(title)})
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
		out = append(out, feedBatchItem{Title: title, Link: strings.TrimSpace(link), PubDate: normalizeFeedDate(firstNonEmpty(e.Published, e.Updated)), Tickers: ticker.Extract(title)})
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
