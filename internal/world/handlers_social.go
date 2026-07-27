package world

import (
	"bytes"
	"context"
	"encoding/json"
	"encoding/xml"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// Social platforms whose posts are NOT already a feed.
//
// Reddit and YouTube publish real RSS/Atom, so they are ordinary Feed entries
// through the rss-proxy (their hosts are on the allowlist in rss_domains.go) and
// need no code here. X, TikTok and LinkedIn expose posts only behind a
// credentialed JSON API, so world speaks that API and re-emits the result as RSS
// 2.0 on its own origin — the handleFwdstart shape — which keeps ONE client
// fetch path (fetchCategoryFeeds over a plain Feed) and ONE lake entry
// (ingestFeedItems).
//
//	GET /v1/world/social/{x|tiktok|linkedin}?q=<topic>
//
// No credential configured → an empty <channel> plus a skip line in the log.
// Never a 5xx: a dark platform must not take the monitors panel down with it.

// rssOutItem is one entry of a feed world emits itself.
type rssOutItem struct{ title, link, date string }

// socialSource is one platform: where its credential lives, and how to turn a
// topic into items. fetch returns nil on any upstream failure (already logged).
type socialSource struct {
	title string   // channel title
	home  string   // channel link, and the lake's source label for its items
	creds []string // credential env aliases; first non-empty wins
	fetch func(s *Server, ctx context.Context, cred, q string) []rssOutItem
}

var socialSources = map[string]socialSource{
	"x": {
		title: "X", home: "https://x.com",
		creds: []string{"X_BEARER_TOKEN", "TWITTER_BEARER_TOKEN"},
		fetch: fetchXPosts,
	},
	"tiktok": {
		title: "TikTok", home: "https://www.tiktok.com",
		creds: []string{"TIKTOK_ACCESS_TOKEN"},
		fetch: fetchTikTokPosts,
	},
	"linkedin": {
		title: "LinkedIn", home: "https://www.linkedin.com",
		creds: []string{"LINKEDIN_ACCESS_TOKEN"},
		fetch: fetchLinkedInPosts,
	},
}

const socialCC = "public, max-age=600, s-maxage=600, stale-while-revalidate=120"

func (s *Server) handleSocial(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") {
		return
	}
	name := strings.Trim(strings.TrimPrefix(r.URL.Path, "/v1/world/social/"), "/")
	src, known := socialSources[name]
	if !known {
		writeError(w, http.StatusNotFound, "Unknown social platform")
		return
	}
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if q == "" {
		writeError(w, http.StatusBadRequest, "Missing q parameter")
		return
	}
	key := "social:" + name + ":" + strings.ToLower(q)
	if v, hit := s.cache.Get(key); hit {
		writeBytes(w, http.StatusOK, "application/xml; charset=utf-8", socialCC, v.([]byte))
		return
	}
	var items []rssOutItem
	if cred := env(src.creds...); cred == "" {
		logf("world-social: %s skipped — no credential (%s)", name, strings.Join(src.creds, " or "))
	} else {
		ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
		defer cancel()
		items = src.fetch(s, ctx, cred, q)
	}
	body := buildRSS(src.title+" · "+q, src.home, src.title+" posts matching "+q,
		"https://world.hanzo.ai/v1/world/social/"+name, items)
	if len(items) > 0 {
		s.cache.Set(key, body, 10*time.Minute, time.Hour)
		// A same-origin emitter never passes through rss-proxy, so THIS is where its
		// items reach the lake — without it a monitor could never match them.
		s.ingestFeedItems(src.home, body)
	}
	writeBytes(w, http.StatusOK, "application/xml; charset=utf-8", socialCC, body)
}

// ── X ────────────────────────────────────────────────────────────────────────

// fetchXPosts queries the v2 recent-search endpoint — the only way to read posts
// by topic since the public RSS was withdrawn (paid bearer token).
func fetchXPosts(s *Server, ctx context.Context, cred, q string) []rssOutItem {
	var resp struct {
		Data []struct {
			ID        string `json:"id"`
			Text      string `json:"text"`
			CreatedAt string `json:"created_at"`
			AuthorID  string `json:"author_id"`
		} `json:"data"`
		Includes struct {
			Users []struct {
				ID       string `json:"id"`
				Username string `json:"username"`
			} `json:"users"`
		} `json:"includes"`
	}
	u := "https://api.x.com/2/tweets/search/recent?max_results=25&tweet.fields=created_at" +
		"&expansions=author_id&user.fields=username&query=" + urlQueryEscape(q+" -is:retweet")
	if err := s.getJSON(ctx, u, map[string]string{"Authorization": "Bearer " + cred}, &resp); err != nil {
		logf("world-social: x search %q failed: %v", q, err)
		return nil
	}
	handles := make(map[string]string, len(resp.Includes.Users))
	for _, u := range resp.Includes.Users {
		handles[u.ID] = u.Username
	}
	out := make([]rssOutItem, 0, len(resp.Data))
	for _, p := range resp.Data {
		handle := handles[p.AuthorID]
		if handle == "" {
			handle = "i" // /i/status/<id> resolves without knowing the handle
		}
		out = append(out, rssOutItem{truncate(p.Text, 200), "https://x.com/" + handle + "/status/" + p.ID, rssDate(p.CreatedAt)})
	}
	return out
}

// ── TikTok ───────────────────────────────────────────────────────────────────

// fetchTikTokPosts queries the Research API (POST, OAuth-only — there is no
// keyless path). Its window is bounded, so it asks for the last 30 days.
func fetchTikTokPosts(s *Server, ctx context.Context, cred, q string) []rssOutItem {
	now := time.Now().UTC()
	req, err := json.Marshal(map[string]any{
		"query": map[string]any{"and": []map[string]any{
			{"operation": "IN", "field_name": "keyword", "field_values": []string{q}},
		}},
		"start_date": now.AddDate(0, 0, -30).Format("20060102"),
		"end_date":   now.Format("20060102"),
		"max_count":  25,
	})
	if err != nil {
		return nil
	}
	b, status, err := s.do(ctx, http.MethodPost,
		"https://open.tiktokapis.com/v2/research/video/query/?fields=id,video_description,create_time,username",
		map[string]string{"Authorization": "Bearer " + cred, "Content-Type": "application/json"}, req)
	if err != nil || status < 200 || status >= 300 {
		logf("world-social: tiktok query %q failed: status=%d err=%v", q, status, err)
		return nil
	}
	var resp struct {
		Data struct {
			Videos []struct {
				ID          int64  `json:"id"`
				Description string `json:"video_description"`
				CreateTime  int64  `json:"create_time"`
				Username    string `json:"username"`
			} `json:"videos"`
		} `json:"data"`
	}
	if err := json.Unmarshal(b, &resp); err != nil {
		logf("world-social: tiktok decode failed: %v", err)
		return nil
	}
	out := make([]rssOutItem, 0, len(resp.Data.Videos))
	for _, v := range resp.Data.Videos {
		id := strconv.FormatInt(v.ID, 10)
		out = append(out, rssOutItem{
			truncate(v.Description, 200),
			"https://www.tiktok.com/@" + v.Username + "/video/" + id,
			time.Unix(v.CreateTime, 0).UTC().Format(time.RFC1123),
		})
	}
	return out
}

// ── LinkedIn ─────────────────────────────────────────────────────────────────

// linkedInVersion pins the dated REST surface; LinkedIn rejects an unversioned call.
const linkedInVersion = "202506"

// fetchLinkedInPosts reads an organization's posts through the partner-gated REST
// API. LinkedIn publishes no content SEARCH, so q labels the channel rather than
// filtering it, and the author is fixed by LINKEDIN_ORG_URN.
func fetchLinkedInPosts(s *Server, ctx context.Context, cred, _ string) []rssOutItem {
	author := env("LINKEDIN_ORG_URN")
	if author == "" {
		logf("world-social: linkedin skipped — no LINKEDIN_ORG_URN")
		return nil
	}
	var resp struct {
		Elements []struct {
			ID         string `json:"id"`
			Commentary string `json:"commentary"`
			CreatedAt  int64  `json:"createdAt"`
		} `json:"elements"`
	}
	u := "https://api.linkedin.com/rest/posts?q=author&count=25&author=" + urlQueryEscape(author)
	if err := s.getJSON(ctx, u, map[string]string{
		"Authorization":             "Bearer " + cred,
		"LinkedIn-Version":          linkedInVersion,
		"X-Restli-Protocol-Version": "2.0.0",
	}, &resp); err != nil {
		logf("world-social: linkedin posts failed: %v", err)
		return nil
	}
	out := make([]rssOutItem, 0, len(resp.Elements))
	for _, e := range resp.Elements {
		out = append(out, rssOutItem{
			truncate(e.Commentary, 200),
			"https://www.linkedin.com/feed/update/" + e.ID,
			time.UnixMilli(e.CreatedAt).UTC().Format(time.RFC1123),
		})
	}
	return out
}

// ── RSS emitter ──────────────────────────────────────────────────────────────

// buildRSS emits a minimal RSS 2.0 channel: the ONE way world publishes a feed
// of its own (the social platforms above and the FwdStart scrape).
func buildRSS(title, link, description, self string, items []rssOutItem) []byte {
	var b strings.Builder
	b.WriteString(`<?xml version="1.0" encoding="UTF-8"?>` + "\n")
	b.WriteString(`<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>`)
	b.WriteString(`<title>` + xmlText(title) + `</title>`)
	b.WriteString(`<link>` + xmlText(link) + `</link>`)
	b.WriteString(`<description>` + xmlText(description) + `</description>`)
	b.WriteString(`<atom:link href="` + xmlText(self) + `" rel="self" type="application/rss+xml"/>`)
	for _, it := range items {
		b.WriteString(`<item>`)
		b.WriteString(`<title>` + xmlText(it.title) + `</title>`)
		b.WriteString(`<link>` + xmlText(it.link) + `</link>`)
		b.WriteString(`<guid>` + xmlText(it.link) + `</guid>`)
		b.WriteString(`<pubDate>` + xmlText(it.date) + `</pubDate>`)
		b.WriteString(`<source url="` + xmlText(link) + `">` + xmlText(title) + `</source>`)
		b.WriteString(`</item>`)
	}
	b.WriteString(`</channel></rss>`)
	return []byte(b.String())
}

// xmlText escapes arbitrary upstream text (post bodies, handles) into XML content.
func xmlText(s string) string {
	var b bytes.Buffer
	_ = xml.EscapeText(&b, []byte(s))
	return b.String()
}

// rssDate normalizes an RFC3339 upstream timestamp to RFC1123, defaulting to now
// when the platform omitted or mangled it.
func rssDate(iso string) string {
	if t, err := time.Parse(time.RFC3339, iso); err == nil {
		return t.UTC().Format(time.RFC1123)
	}
	return time.Now().UTC().Format(time.RFC1123)
}
