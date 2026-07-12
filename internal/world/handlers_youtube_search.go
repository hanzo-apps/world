package world

import (
	"context"
	"encoding/json"
	"html"
	"net/http"
	"regexp"
	"strings"
	"time"
)

// handleYouTubeSearch resolves a free-text query (e.g. "Milken Institute Jensen
// Huang 2025") to a ranked list of non-live YouTube videos, so the analyst — or
// the watch-queue search box — can turn "queue that talk" into a real video id.
// Uses the YouTube Data API (same key as youtube/live); degrades to an empty,
// honest result set when no key is configured rather than faking hits.
func (s *Server) handleYouTubeSearch(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") {
		return
	}
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if q == "" {
		writeError(w, http.StatusBadRequest, "Missing q parameter")
		return
	}
	cacheKey := "youtube-search:" + strings.ToLower(q)
	if v, ok := s.cache.Get(cacheKey); ok {
		writeJSON(w, http.StatusOK, "public, max-age=600, s-maxage=600", v)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()

	// No key required: scrape the results page, exactly as handleYouTubeLive
	// scrapes /live (same UA + consent cookies to dodge the interstitial served
	// to datacenter IPs). The Data API is only a faster path when a key exists.
	key := env("YOUTUBE_API_KEY", "YT_API_KEY")
	if key == "" {
		results := s.youtubeSearchScrape(ctx, q)
		out := map[string]any{"results": results}
		if len(results) > 0 {
			s.cache.Set(cacheKey, out, 10*time.Minute, 60*time.Minute)
		}
		writeJSON(w, http.StatusOK, "public, max-age=600, s-maxage=600", out)
		return
	}

	var resp struct {
		Items []struct {
			ID struct {
				VideoID string `json:"videoId"`
			} `json:"id"`
			Snippet struct {
				Title        string `json:"title"`
				ChannelTitle string `json:"channelTitle"`
				PublishedAt  string `json:"publishedAt"`
				Thumbnails   struct {
					Medium struct {
						URL string `json:"url"`
					} `json:"medium"`
				} `json:"thumbnails"`
			} `json:"snippet"`
		} `json:"items"`
	}
	u := "https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=12&q=" +
		urlQueryEscape(q) + "&key=" + key
	if err := s.getJSON(ctx, u, nil, &resp); err != nil {
		writeError(w, http.StatusBadGateway, "youtube search failed")
		return
	}

	results := make([]map[string]any, 0, len(resp.Items))
	for _, it := range resp.Items {
		if it.ID.VideoID == "" {
			continue
		}
		results = append(results, map[string]any{
			"id": it.ID.VideoID,
			// The Data API returns titles HTML-escaped (&amp;, &#39;) — unescape
			// so the client renders plain text and re-escapes once itself.
			"title":       html.UnescapeString(it.Snippet.Title),
			"channel":     html.UnescapeString(it.Snippet.ChannelTitle),
			"thumbnail":   it.Snippet.Thumbnails.Medium.URL,
			"publishedAt": it.Snippet.PublishedAt,
		})
	}
	out := map[string]any{"results": results}
	s.cache.Set(cacheKey, out, 10*time.Minute, 60*time.Minute)
	writeJSON(w, http.StatusOK, "public, max-age=600, s-maxage=600", out)
}

// ytRendererRe finds each video result block in the results-page ytInitialData.
var ytRendererRe = regexp.MustCompile(`"videoRenderer":\{"videoId":"([A-Za-z0-9_-]{11})"`)

// ytTitleRe / ytOwnerRe pull the title and channel out of one renderer block.
var ytTitleRe = regexp.MustCompile(`"title":\{"runs":\[\{"text":"((?:[^"\\]|\\.)*)"`)
var ytOwnerRe = regexp.MustCompile(`"ownerText":\{"runs":\[\{"text":"((?:[^"\\]|\\.)*)"`)

// youtubeSearchScrape resolves a query to videos WITHOUT an API key by reading
// the results page. Returns an empty slice (never an error) when YouTube shape-
// shifts — the caller then reports an honest empty result rather than a fake one.
func (s *Server) youtubeSearchScrape(ctx context.Context, q string) []map[string]any {
	// sp=EgIQAQ%3D%3D → filter to type:video (drops channels/playlists/shorts).
	u := "https://www.youtube.com/results?search_query=" + urlQueryEscape(q) +
		"&sp=EgIQAQ%3D%3D&hl=en&gl=US"
	page, err := s.getText(ctx, u, map[string]string{
		"User-Agent":      browserUA,
		"Accept-Language": "en-US,en;q=0.9",
		"Cookie":          "SOCS=CAISNQgDEitib3FfaWRlbnRpdHlfMjAyNDA4MjcuMDFfcDAaAmVuIAEaBgiA_LyxBg; CONSENT=YES+",
	})
	if err != nil {
		return []map[string]any{}
	}
	locs := ytRendererRe.FindAllStringSubmatchIndex(page, 20)
	results := make([]map[string]any, 0, len(locs))
	seen := map[string]bool{}
	for i, loc := range locs {
		id := page[loc[2]:loc[3]]
		if seen[id] {
			continue
		}
		seen[id] = true
		// Scope title/channel lookup to THIS renderer block, so a later result's
		// title can never be attributed to an earlier video.
		end := len(page)
		if i+1 < len(locs) {
			end = locs[i+1][0]
		}
		block := page[loc[1]:end]
		title := ytUnquote(ytTitleRe, block)
		if title == "" {
			continue
		}
		results = append(results, map[string]any{
			"id":          id,
			"title":       title,
			"channel":     ytUnquote(ytOwnerRe, block),
			"thumbnail":   "https://i.ytimg.com/vi/" + id + "/mqdefault.jpg",
			"publishedAt": "",
		})
	}
	return results
}

// ytUnquote applies re to block and JSON-unescapes the captured text (the page
// embeds &, \" etc.).
func ytUnquote(re *regexp.Regexp, block string) string {
	m := re.FindStringSubmatch(block)
	if m == nil {
		return ""
	}
	var out string
	if err := json.Unmarshal([]byte(`"`+m[1]+`"`), &out); err != nil {
		return html.UnescapeString(m[1])
	}
	return out
}
