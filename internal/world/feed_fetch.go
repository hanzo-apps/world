package world

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"net/url"
	"time"

	"github.com/hanzoai/world/internal/world/store"
)

// rssFetchHeaders is the single header set used for every allowlisted feed
// fetch — by the on-demand fall-through (rss-proxy, feeds-batch) AND the
// background warmer. One place, one behavior.
var rssFetchHeaders = map[string]string{
	"User-Agent": browserUA,
	"Accept":     "application/rss+xml, application/xml, text/xml, */*",
}

// fetchFeedBody performs one bounded, allowlisted GET of a feed and returns the
// body only when it is a usable (non-blank) 2xx. This is the ONLY live-fetch
// path for feed bodies, shared by the request fall-through and the warmer. The
// caller owns the timeout via ctx.
func (s *Server) fetchFeedBody(ctx context.Context, feedURL string) ([]byte, bool) {
	body, status, err := s.getAllowlisted(ctx, feedURL, allowedRSSDomains, rssFetchHeaders)
	if err != nil || status < 200 || status >= 300 || isBlankBody(body) {
		return nil, false
	}
	return body, true
}

// ingestFeedItems parses a feed body and folds its items into the searchable
// data lake (kind=news). Cheap and write-behind (Lake.Add never blocks), so it
// runs off both the request fall-through and the warmer without touching latency.
func (s *Server) ingestFeedItems(feedURL string, body []byte) {
	if s.store == nil {
		return
	}
	host := feedHost(feedURL)
	for _, it := range parseFeedItems(body, feedsBatchMaxItems) {
		payload, _ := json.Marshal(map[string]any{
			"title": it.Title, "link": it.Link, "pubDate": it.PubDate,
			"source": host, "tickers": it.Tickers,
		})
		s.store.Lake.Add(store.Item{
			ID:      newsItemID(it.Link, it.Title),
			Kind:    "news",
			Source:  host,
			TS:      feedItemTime(it.PubDate),
			Title:   it.Title,
			Tickers: it.Tickers,
			Payload: string(payload),
		})
	}
}

// newsItemID is the stable dedupe key for a news item: its link when present,
// else its title. Re-ingesting the same story upserts instead of duplicating.
func newsItemID(link, title string) string {
	seed := link
	if seed == "" {
		seed = title
	}
	sum := sha1.Sum([]byte(seed))
	return "news:" + hex.EncodeToString(sum[:])
}

// feedItemTime parses a normalized RFC3339 pubDate back to a time, defaulting to
// now when the feed omitted or mangled the date.
func feedItemTime(pubDate string) time.Time {
	if pubDate != "" {
		if t, err := time.Parse(time.RFC3339, pubDate); err == nil {
			return t.UTC()
		}
	}
	return time.Now().UTC()
}

// feedHost returns the feed's host for use as the item's source label.
func feedHost(feedURL string) string {
	if u, err := url.Parse(feedURL); err == nil && u.Hostname() != "" {
		return u.Hostname()
	}
	return "feed"
}

// curatedFeedSeed is the bootstrap warm set: the highest-value feeds behind the
// crypto, financial-regulation, and crypto-news panels, so a brand-new pod warms
// THEM first (before any user request). Every URL is on the RSS allowlist. After
// the first real page load the warm set becomes demand-driven and fleet-wide; the
// seed only bridges the very first cold boot.
var curatedFeedSeed = []string{
	// crypto / crypto-news
	"https://www.coindesk.com/arc/outboundfeeds/rss/",
	"https://cointelegraph.com/rss",
	// financial regulation
	"https://www.sec.gov/news/pressreleases.rss",
	"https://www.federalreserve.gov/feeds/press_all.xml",
	// markets / financial
	"https://www.cnbc.com/id/100003114/device/rss/rss.html",
	"https://www.cnbc.com/id/19854910/device/rss/rss.html",
	"https://seekingalpha.com/market_currents.xml",
	"https://www.ft.com/rss/home",
}
