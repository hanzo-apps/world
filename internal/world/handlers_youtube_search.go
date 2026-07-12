package world

import (
	"context"
	"html"
	"net/http"
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
	key := env("YOUTUBE_API_KEY", "YT_API_KEY")
	if key == "" {
		writeJSON(w, http.StatusOK, "no-store", map[string]any{
			"results": []any{},
			"note":    "youtube search unavailable (no API key configured)",
		})
		return
	}
	cacheKey := "youtube-search:" + strings.ToLower(q)
	if v, ok := s.cache.Get(cacheKey); ok {
		writeJSON(w, http.StatusOK, "public, max-age=600, s-maxage=600", v)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()

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
