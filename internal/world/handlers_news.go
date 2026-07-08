package world

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

// ── GDELT ────────────────────────────────────────────────────────────────────

// handleGDELTDoc queries the GDELT DOC 2.0 article list and maps it to the
// compact {articles,query} shape. Ported from api/gdelt-doc.js.
func (s *Server) handleGDELTDoc(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") {
		return
	}
	q := r.URL.Query()
	query := trimSpace(q.Get("query"))
	if len(query) < 2 {
		writeError(w, http.StatusBadRequest, "Query parameter required")
		return
	}
	maxrecords := clampInt(q.Get("maxrecords"), 10, 1, 20)
	timespan := q.Get("timespan")
	if timespan == "" {
		timespan = "72h"
	}
	key := "gdelt-doc:" + query + ":" + itoa(maxrecords) + ":" + timespan
	s.cachedJSON(w, key, "public, max-age=300, s-maxage=300, stale-while-revalidate=60",
		5*time.Minute, 15*time.Minute,
		func(ctx context.Context) (any, error) {
			u := "https://api.gdeltproject.org/v1/world/v2/doc/doc?query=" + urlQueryEscape(query) +
				"&mode=artlist&maxrecords=" + itoa(maxrecords) + "&format=json&sort=date&timespan=" + urlQueryEscape(timespan)
			var raw struct {
				Articles []struct {
					Title       string  `json:"title"`
					URL         string  `json:"url"`
					Domain      string  `json:"domain"`
					SeenDate    string  `json:"seendate"`
					SocialImage string  `json:"socialimage"`
					Language    string  `json:"language"`
					Tone        float64 `json:"tone"`
				} `json:"articles"`
			}
			if err := s.getJSON(ctx, u, nil, &raw); err != nil {
				return nil, err
			}
			articles := make([]map[string]any, 0, len(raw.Articles))
			for _, a := range raw.Articles {
				articles = append(articles, map[string]any{
					"title": a.Title, "url": a.URL, "source": a.Domain,
					"date": a.SeenDate, "image": a.SocialImage, "language": a.Language, "tone": a.Tone,
				})
			}
			return map[string]any{"articles": articles, "query": query}, nil
		},
		func(w http.ResponseWriter, err error) {
			writeJSON(w, http.StatusOK, "", map[string]any{"error": err.Error(), "articles": []any{}})
		})
}

var gdeltGeoFormats = []string{"geojson", "json", "csv"}
var gdeltGeoTimespans = []string{"1d", "7d", "14d", "30d", "60d", "90d"}

// handleGDELTGeo proxies the GDELT GEO 2.0 endpoint (verbatim body). Ported from
// api/gdelt-geo.js.
func (s *Server) handleGDELTGeo(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") || methodNotGet(w, r) {
		return
	}
	q := r.URL.Query()
	query := sanitizeGDELTQuery(q.Get("query"))
	format := "geojson"
	if oneOf(q.Get("format"), gdeltGeoFormats...) {
		format = q.Get("format")
	}
	maxrecords := clampInt(q.Get("maxrecords"), 250, 1, 500)
	timespan := "7d"
	if oneOf(q.Get("timespan"), gdeltGeoTimespans...) {
		timespan = q.Get("timespan")
	}
	ct := "application/json"
	if format == "csv" {
		ct = "text/csv"
	}
	upstream := "https://api.gdeltproject.org/v1/world/v2/geo/geo?query=" + urlQueryEscape(query) +
		"&format=" + format + "&maxrecords=" + itoa(maxrecords) + "&timespan=" + timespan
	key := "gdelt-geo:" + query + ":" + format + ":" + itoa(maxrecords) + ":" + timespan
	s.passthrough(w, key, upstream, ct, "public, max-age=300, s-maxage=300, stale-while-revalidate=60",
		nil, 5*time.Minute, 15*time.Minute,
		func(w http.ResponseWriter, err error) {
			writeError(w, http.StatusBadGateway, "Upstream service unavailable")
		})
}

func sanitizeGDELTQuery(v string) string {
	if v == "" {
		return "protest"
	}
	if len(v) > 200 {
		v = v[:200]
	}
	return strings.Map(func(r rune) rune {
		switch r {
		case '<', '>', '"', '\'':
			return -1
		}
		return r
	}, v)
}

// ── RSS proxy (host-allowlisted, SSRF-safe) ──────────────────────────────────

var allowedRSSDomains = map[string]bool{}

func init() {
	for _, d := range strings.Fields(rssDomainList) {
		allowedRSSDomains[d] = true
	}
}

// handleRSSProxy fetches an allowlisted RSS/Atom feed and returns it verbatim.
// The host allowlist is the SSRF boundary; redirects are re-validated against
// it. Ported from api/rss-proxy.js.
func (s *Server) handleRSSProxy(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") {
		return
	}
	feedURL := r.URL.Query().Get("url")
	if feedURL == "" {
		writeError(w, http.StatusBadRequest, "Missing url parameter")
		return
	}
	parsed, err := url.Parse(feedURL)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		writeError(w, http.StatusBadRequest, "Invalid url parameter")
		return
	}
	if !allowedRSSDomains[parsed.Hostname()] {
		writeError(w, http.StatusForbidden, "Domain not allowed")
		return
	}
	key := "rss:" + feedURL
	if v, ok := s.cache.Get(key); ok {
		writeBytes(w, http.StatusOK, "application/xml", "public, max-age=300, s-maxage=300, stale-while-revalidate=60", v.([]byte))
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	body, status, err := s.getAllowlisted(ctx, feedURL, allowedRSSDomains, map[string]string{
		"User-Agent": browserUA,
		"Accept":     "application/rss+xml, application/xml, text/xml, */*",
	})
	if err != nil || status < 200 || status >= 300 {
		if v, ok := s.cache.GetStale(key); ok {
			writeBytes(w, http.StatusOK, "application/xml", "public, max-age=300, s-maxage=300, stale-while-revalidate=60", v.([]byte))
			return
		}
		writeError(w, http.StatusBadGateway, "Failed to fetch feed")
		return
	}
	s.cache.Set(key, body, 5*time.Minute, 15*time.Minute)
	writeBytes(w, http.StatusOK, "application/xml", "public, max-age=300, s-maxage=300, stale-while-revalidate=60", body)
}

// ── Hacker News ──────────────────────────────────────────────────────────────

var hnStoryTypes = map[string]bool{"top": true, "new": true, "best": true, "ask": true, "show": true, "job": true}

// handleHackerNews returns front-page story items. Ported from api/hackernews.js.
func (s *Server) handleHackerNews(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") {
		return
	}
	q := r.URL.Query()
	storyType := q.Get("type")
	if !hnStoryTypes[storyType] {
		storyType = "top"
	}
	limit := clampInt(q.Get("limit"), 30, 1, 60)
	key := "hackernews:" + storyType + ":" + itoa(limit)
	s.cachedJSON(w, key, "public, max-age=300, s-maxage=300, stale-while-revalidate=60",
		5*time.Minute, 15*time.Minute,
		func(ctx context.Context) (any, error) {
			var ids []int64
			if err := s.getJSON(ctx, "https://hacker-news.firebaseio.com/v0/"+storyType+"stories.json", nil, &ids); err != nil {
				return nil, err
			}
			if len(ids) > limit {
				ids = ids[:limit]
			}
			stories := make([]map[string]any, len(ids))
			const conc = 10
			sem := make(chan struct{}, conc)
			var wg sync.WaitGroup
			for i, id := range ids {
				wg.Add(1)
				sem <- struct{}{}
				go func(i int, id int64) {
					defer wg.Done()
					defer func() { <-sem }()
					var item map[string]any
					if err := s.getJSON(ctx, fmt.Sprintf("https://hacker-news.firebaseio.com/v0/item/%d.json", id), nil, &item); err == nil {
						stories[i] = item
					}
				}(i, id)
			}
			wg.Wait()
			out := make([]map[string]any, 0, len(stories))
			for _, st := range stories {
				if st != nil {
					out = append(out, st)
				}
			}
			return map[string]any{"type": storyType, "stories": out, "total": len(out), "timestamp": nowISO()}, nil
		},
		func(w http.ResponseWriter, err error) {
			writeJSON(w, http.StatusOK, "", map[string]any{"error": "Failed to fetch Hacker News data", "stories": []any{}, "total": 0})
		})
}

// ── GitHub trending ──────────────────────────────────────────────────────────

// handleGitHubTrending proxies an unofficial trending-repos API. Ported from
// api/github-trending.js.
func (s *Server) handleGitHubTrending(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") {
		return
	}
	q := r.URL.Query()
	language := q.Get("language")
	if language == "" {
		language = "python"
	}
	since := q.Get("since")
	if since == "" {
		since = "daily"
	}
	params := "language=" + urlQueryEscape(language) + "&since=" + urlQueryEscape(since)
	if sl := q.Get("spoken_language"); sl != "" {
		params += "&spoken_language_code=" + urlQueryEscape(sl)
	}
	upstream := "https://api.gitterapp.com/repositories?" + params
	key := "github-trending:" + params
	s.passthrough(w, key, upstream, "application/json",
		"public, max-age=1800, s-maxage=1800, stale-while-revalidate=300",
		map[string]string{"Accept": "application/json", "User-Agent": "Hanzo-World/1.0"},
		30*time.Minute, time.Hour,
		func(w http.ResponseWriter, err error) {
			writeJSON(w, http.StatusOK, "", map[string]any{"error": "Failed to fetch GitHub trending data"})
		})
}

// ── arXiv ────────────────────────────────────────────────────────────────────

// handleArxiv proxies the arXiv Atom API (verbatim XML). Backs the AI-research,
// robotics (cs.RO) and quantum (quant-ph) feeds. Ported from api/arxiv.js.
func (s *Server) handleArxiv(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") {
		return
	}
	q := r.URL.Query()
	category := q.Get("category")
	if category == "" {
		category = "cs.AI"
	}
	maxResults := clampInt(q.Get("max_results"), 50, 1, 200)
	sortBy := q.Get("sortBy")
	if sortBy == "" {
		sortBy = "submittedDate"
	}
	upstream := "https://export.arxiv.org/v1/world/query?search_query=" + urlQueryEscape("cat:"+category) +
		"&start=0&max_results=" + itoa(maxResults) + "&sortBy=" + urlQueryEscape(sortBy) + "&sortOrder=descending"
	key := "arxiv:" + category + ":" + itoa(maxResults) + ":" + sortBy
	s.passthrough(w, key, upstream, "application/xml",
		"public, max-age=3600, s-maxage=3600, stale-while-revalidate=600",
		map[string]string{"User-Agent": "Hanzo-World/1.0 (research tracker)"},
		time.Hour, 3*time.Hour,
		func(w http.ResponseWriter, err error) {
			writeError(w, http.StatusBadGateway, "Failed to fetch ArXiv data")
		})
}

// ── YouTube live (THE video feed) ────────────────────────────────────────────

var ytVideoIDRe = regexp.MustCompile(`"videoId":"([a-zA-Z0-9_-]{11})"`)
var ytIsLiveRe = regexp.MustCompile(`"isLive":\s*true`)

// On a channel /live page the canonical link is the AUTHORITATIVE live video —
// the first "videoId":"…" in the HTML is often a recommended/sidebar clip
// (which is why several channels used to collapse onto one shared id). Prefer
// canonical; fall back to the first videoId only if it's absent.
var ytCanonicalRe = regexp.MustCompile(`<link rel="canonical" href="https://www\.youtube\.com/watch\?v=([a-zA-Z0-9_-]{11})"`)

// videoDetails.videoId in ytInitialPlayerResponse is the video actually loaded
// in the player — the single most reliable per-channel signal.
var ytPlayerVideoRe = regexp.MustCompile(`"videoDetails":\{"videoId":"([a-zA-Z0-9_-]{11})"`)

// handleYouTubeLive resolves a channel handle to its current LIVE video id. It
// scrapes the channel /live page (no key required); when YOUTUBE_API_KEY is set
// it first tries the Data API for reliability. Degrades to {videoId:null} so the
// frontend uses its fallbackVideoId. Ported from api/youtube/live.js (accepts
// both ?channel= (frontend) and ?handle=).
func (s *Server) handleYouTubeLive(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") {
		return
	}
	channel := r.URL.Query().Get("channel")
	if channel == "" {
		channel = r.URL.Query().Get("handle")
	}
	if channel == "" {
		writeError(w, http.StatusBadRequest, "Missing channel parameter")
		return
	}
	handle := channel
	if !hasPrefix(handle, "@") {
		handle = "@" + handle
	}
	cacheKey := "youtube-live:" + handle
	if v, ok := s.cache.Get(cacheKey); ok {
		writeJSON(w, http.StatusOK, "public, max-age=300, s-maxage=300, stale-while-revalidate=60", v)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()

	// Preferred: YouTube Data API (when a key is configured).
	if key := env("YOUTUBE_API_KEY", "YT_API_KEY"); key != "" {
		if vid, ok := s.youtubeLiveViaAPI(ctx, handle, key); ok {
			res := map[string]any{"videoId": vid, "isLive": true}
			s.cache.Set(cacheKey, res, 5*time.Minute, 30*time.Minute)
			writeJSON(w, http.StatusOK, "public, max-age=300, s-maxage=300, stale-while-revalidate=60", res)
			return
		}
	}

	// Fallback: scrape the channel /live page. The SOCS/CONSENT cookies + hl/gl
	// bypass YouTube's consent interstitial (served to datacenter IPs) — without
	// them the cluster gets a consent page whose only videoId is a promo clip, so
	// unrelated channels collapse onto one shared id.
	html, err := s.getText(ctx, "https://www.youtube.com/"+handle+"/live?hl=en&gl=US", map[string]string{
		"User-Agent":      browserUA,
		"Accept-Language": "en-US,en;q=0.9",
		"Cookie":          "SOCS=CAISNQgDEitib3FfaWRlbnRpdHlfMjAyNDA4MjcuMDFfcDAaAmVuIAEaBgiA_LyxBg; CONSENT=YES+",
	})
	res := map[string]any{"videoId": nil, "isLive": false}
	if err == nil && ytIsLiveRe.MatchString(html) {
		vid := ""
		if m := ytPlayerVideoRe.FindStringSubmatch(html); m != nil {
			vid = m[1] // authoritative: the player's own videoDetails.videoId
		} else if m := ytCanonicalRe.FindStringSubmatch(html); m != nil {
			vid = m[1] // the canonical live watch URL
		} else if m := ytVideoIDRe.FindStringSubmatch(html); m != nil {
			vid = m[1] // last resort — first videoId (may be a recommendation)
		}
		if vid != "" {
			res = map[string]any{"videoId": vid, "isLive": true}
			s.cache.Set(cacheKey, res, 5*time.Minute, 30*time.Minute)
		}
	}
	writeJSON(w, http.StatusOK, "public, max-age=300, s-maxage=300, stale-while-revalidate=60", res)
}

// youtubeLiveViaAPI resolves handle→channelId→live videoId via the Data API.
func (s *Server) youtubeLiveViaAPI(ctx context.Context, handle, key string) (string, bool) {
	var chResp struct {
		Items []struct {
			ID string `json:"id"`
		} `json:"items"`
	}
	h := strings.TrimPrefix(handle, "@")
	if err := s.getJSON(ctx, "https://www.googleapis.com/youtube/v3/channels?part=id&forHandle="+urlQueryEscape(h)+"&key="+key, nil, &chResp); err != nil || len(chResp.Items) == 0 {
		return "", false
	}
	var sResp struct {
		Items []struct {
			ID struct {
				VideoID string `json:"videoId"`
			} `json:"id"`
		} `json:"items"`
	}
	u := "https://www.googleapis.com/youtube/v3/search?part=id&channelId=" + chResp.Items[0].ID +
		"&eventType=live&type=video&key=" + key
	if err := s.getJSON(ctx, u, nil, &sResp); err != nil || len(sResp.Items) == 0 {
		return "", false
	}
	if sResp.Items[0].ID.VideoID == "" {
		return "", false
	}
	return sResp.Items[0].ID.VideoID, true
}

// ── YouTube embed (bridge player page) ───────────────────────────────────────

var ytEmbedIDRe = regexp.MustCompile(`^[A-Za-z0-9_-]{11}$`)

// handleYouTubeEmbed serves a self-contained IFrame-API player page for a
// video id, used by the desktop/cloud embed bridge. Ported from
// api/youtube/embed.js (origins retargeted to Hanzo).
func (s *Server) handleYouTubeEmbed(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	videoID := q.Get("videoId")
	if !ytEmbedIDRe.MatchString(videoID) {
		writeBytes(w, http.StatusBadRequest, "text/plain; charset=utf-8", "", []byte("Missing or invalid videoId"))
		return
	}
	autoplay := ytFlag(q.Get("autoplay"), "1")
	mute := ytFlag(q.Get("mute"), "1")
	origin := sanitizeEmbedOrigin(q.Get("origin"))
	html := ytEmbedHTML(videoID, autoplay, mute, origin)
	writeBytes(w, http.StatusOK, "text/html; charset=utf-8",
		"public, s-maxage=60, stale-while-revalidate=300", []byte(html))
}

func ytFlag(v, def string) string {
	if v == "0" || v == "1" {
		return v
	}
	return def
}

func sanitizeEmbedOrigin(raw string) string {
	const def = "https://world.hanzo.ai"
	if raw == "" {
		return def
	}
	u, err := url.Parse(raw)
	if err != nil {
		return def
	}
	if u.Scheme != "https" && u.Scheme != "http" && u.Scheme != "tauri" {
		return def
	}
	host := u.Hostname()
	switch {
	case host == "hanzo.ai" || hasSuffix(host, ".hanzo.ai"),
		hasSuffix(host, ".hanzo.app"),
		host == "localhost", host == "127.0.0.1",
		host == "tauri.localhost", hasSuffix(host, ".tauri.localhost"):
		return u.Scheme + "://" + u.Host
	case u.Scheme == "tauri" && host == "localhost":
		return "tauri://localhost"
	}
	return def
}

func ytEmbedHTML(videoID, autoplay, mute, origin string) string {
	originJSON := `"` + origin + `"`
	return fmt.Sprintf(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="referrer" content="strict-origin-when-cross-origin" />
  <style>
    html,body{margin:0;padding:0;width:100%%;height:100%%;background:#000;overflow:hidden}
    #player{width:100%%;height:100%%}
    #play-overlay{position:absolute;inset:0;z-index:10;display:flex;align-items:center;justify-content:center;cursor:pointer;background:rgba(0,0,0,0.4)}
    #play-overlay svg{width:72px;height:72px;opacity:0.9}
    #play-overlay.hidden{display:none}
  </style>
</head>
<body>
  <div id="player"></div>
  <div id="play-overlay"><svg viewBox="0 0 68 48"><path d="M66.52 7.74c-.78-2.93-2.49-5.41-5.42-6.19C55.79.13 34 0 34 0S12.21.13 6.9 1.55C3.97 2.33 2.27 4.81 1.48 7.74.06 13.05 0 24 0 24s.06 10.95 1.48 16.26c.78 2.93 2.49 5.41 5.42 6.19C12.21 47.87 34 48 34 48s21.79-.13 27.1-1.55c2.93-.78 4.64-3.26 5.42-6.19C67.94 34.95 68 24 68 24s-.06-10.95-1.48-16.26z" fill="red"/><path d="M45 24L27 14v20" fill="#fff"/></svg></div>
  <script>
    var tag=document.createElement('script');
    tag.src='https://www.youtube.com/iframe_api';
    document.head.appendChild(tag);
    var player,overlay=document.getElementById('play-overlay'),started=false;
    function hideOverlay(){overlay.classList.add('hidden')}
    function onYouTubeIframeAPIReady(){
      player=new YT.Player('player',{
        videoId:'%s',
        host:'https://www.youtube-nocookie.com',
        playerVars:{autoplay:%s,mute:%s,playsinline:1,rel:0,controls:1,modestbranding:1,enablejsapi:1,origin:%s,widget_referrer:%s},
        events:{
          onReady:function(){window.parent.postMessage({type:'yt-ready'},'*');if(%s===1){player.playVideo()}},
          onError:function(e){window.parent.postMessage({type:'yt-error',code:e.data},'*')},
          onStateChange:function(e){window.parent.postMessage({type:'yt-state',state:e.data},'*');if(e.data===1||e.data===3){hideOverlay();started=true}}
        }
      });
    }
    overlay.addEventListener('click',function(){if(player&&player.playVideo){player.playVideo();player.unMute();hideOverlay()}});
    setTimeout(function(){if(!started)overlay.classList.remove('hidden')},3000);
    window.addEventListener('message',function(e){
      if(!player||!player.getPlayerState)return;var m=e.data;if(!m||!m.type)return;
      switch(m.type){
        case'play':player.playVideo();break;
        case'pause':player.pauseVideo();break;
        case'mute':player.mute();break;
        case'unmute':player.unMute();break;
        case'loadVideo':if(m.videoId)player.loadVideoById(m.videoId);break;
      }
    });
  </script>
</body>
</html>`, videoID, autoplay, mute, originJSON, originJSON, autoplay)
}

// ── FwdStart newsletter (scrape → RSS) ───────────────────────────────────────

var fwdLinkRe = regexp.MustCompile(`href="(/p/[^"]+)"`)
var fwdAltRe = regexp.MustCompile(`alt="([^"]+)"`)
var fwdDateRe = regexp.MustCompile(`([A-Za-z]{3}) (\d{1,2}), (\d{4})`)

// handleFwdstart scrapes the FwdStart archive into an RSS 2.0 feed. Ported from
// api/fwdstart.js.
func (s *Server) handleFwdstart(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") {
		return
	}
	key := "fwdstart:rss"
	if v, ok := s.cache.Get(key); ok {
		writeBytes(w, http.StatusOK, "application/xml; charset=utf-8", "public, max-age=1800, s-maxage=1800, stale-while-revalidate=300", v.([]byte))
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	html, err := s.getText(ctx, "https://www.fwdstart.me/archive", map[string]string{
		"User-Agent": browserUA,
		"Accept":     "text/html,application/xhtml+xml",
	})
	if err != nil {
		if v, ok := s.cache.GetStale(key); ok {
			writeBytes(w, http.StatusOK, "application/xml; charset=utf-8", "public, max-age=1800", v.([]byte))
			return
		}
		writeJSON(w, http.StatusBadGateway, "", map[string]any{"error": "Failed to fetch FwdStart archive", "details": err.Error()})
		return
	}
	body := buildFwdstartRSS(html)
	s.cache.Set(key, body, 30*time.Minute, time.Hour)
	writeBytes(w, http.StatusOK, "application/xml; charset=utf-8", "public, max-age=1800, s-maxage=1800, stale-while-revalidate=300", body)
}

func buildFwdstartRSS(html string) []byte {
	type item struct{ url, title, date string }
	var items []item
	seen := map[string]bool{}
	for _, block := range strings.Split(html, "embla__slide")[1:] {
		lm := fwdLinkRe.FindStringSubmatch(block)
		if lm == nil {
			continue
		}
		link := "https://www.fwdstart.me" + lm[1]
		if seen[link] {
			continue
		}
		am := fwdAltRe.FindStringSubmatch(block)
		if am == nil || len(trimSpace(am[1])) < 5 {
			continue
		}
		date := time.Now().UTC().Format(time.RFC1123)
		if dm := fwdDateRe.FindStringSubmatch(block); dm != nil {
			if t, err := time.Parse("Jan 2 2006", dm[1]+" "+dm[2]+" "+dm[3]); err == nil {
				date = t.UTC().Format(time.RFC1123)
			}
		}
		seen[link] = true
		items = append(items, item{link, trimSpace(am[1]), date})
		if len(items) >= 30 {
			break
		}
	}
	var b strings.Builder
	b.WriteString(`<?xml version="1.0" encoding="UTF-8"?>` + "\n")
	b.WriteString(`<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>`)
	b.WriteString(`<title>FwdStart Newsletter</title>`)
	b.WriteString(`<link>https://www.fwdstart.me</link>`)
	b.WriteString(`<description>FwdStart newsletter archive</description>`)
	b.WriteString(`<atom:link href="https://world.hanzo.ai/v1/world/fwdstart" rel="self" type="application/rss+xml"/>`)
	for _, it := range items {
		b.WriteString(`<item>`)
		b.WriteString(`<title><![CDATA[` + it.title + `]]></title>`)
		b.WriteString(`<link>` + it.url + `</link>`)
		b.WriteString(`<guid>` + it.url + `</guid>`)
		b.WriteString(`<pubDate>` + it.date + `</pubDate>`)
		b.WriteString(`<source url="https://www.fwdstart.me">FwdStart</source>`)
		b.WriteString(`</item>`)
	}
	b.WriteString(`</channel></rss>`)
	return []byte(b.String())
}

// ── Tech events (Techmeme ICS + curated) ─────────────────────────────────────

var icsSummaryRe = regexp.MustCompile(`SUMMARY:(.+)`)
var icsLocationRe = regexp.MustCompile(`LOCATION:(.+)`)
var icsStartRe = regexp.MustCompile(`DTSTART;VALUE=DATE:(\d+)`)
var icsEndRe = regexp.MustCompile(`DTEND;VALUE=DATE:(\d+)`)
var icsURLRe = regexp.MustCompile(`URL:(.+)`)
var icsUIDRe = regexp.MustCompile(`UID:(.+)`)

// handleTechEvents parses the Techmeme events ICS (plus curated conferences)
// into structured, geocoded events. Ported from api/tech-events.js.
func (s *Server) handleTechEvents(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") {
		return
	}
	q := r.URL.Query()
	typeFilter := q.Get("type")
	mappable := q.Get("mappable") == "true"
	limit := atoiDefault(q.Get("limit"), 0)
	days := atoiDefault(q.Get("days"), 0)
	key := "tech-events:" + typeFilter + ":" + q.Get("mappable") + ":" + itoa(limit) + ":" + itoa(days)
	s.cachedJSON(w, key, "public, max-age=1800, s-maxage=1800, stale-while-revalidate=300",
		30*time.Minute, time.Hour,
		func(ctx context.Context) (any, error) {
			events := append([]map[string]any{}, curatedTechEvents...)
			if ics, err := s.getText(ctx, "https://www.techmeme.com/newsy_events.ics", map[string]string{"User-Agent": browserUA}); err == nil {
				events = append(events, parseICS(ics)...)
			}
			// dedupe by title+startDate
			seen := map[string]bool{}
			deduped := events[:0]
			for _, e := range events {
				k := asString(e["title"]) + "|" + asString(e["startDate"])
				if seen[k] {
					continue
				}
				seen[k] = true
				deduped = append(deduped, e)
			}
			events = deduped
			sort.SliceStable(events, func(i, j int) bool { return asString(events[i]["startDate"]) < asString(events[j]["startDate"]) })
			if typeFilter != "" {
				events = filterEvents(events, func(e map[string]any) bool { return asString(e["type"]) == typeFilter })
			}
			if mappable {
				events = filterEvents(events, func(e map[string]any) bool {
					c, ok := e["coords"].(map[string]any)
					return ok && c != nil && c["virtual"] != true
				})
			}
			if days > 0 {
				cutoff := dateOnly(time.Now().AddDate(0, 0, days))
				events = filterEvents(events, func(e map[string]any) bool { return asString(e["startDate"]) <= cutoff })
			}
			if limit > 0 && len(events) > limit {
				events = events[:limit]
			}
			confCount, mappableCount := 0, 0
			for _, e := range events {
				if asString(e["type"]) == "conference" {
					confCount++
					if c, ok := e["coords"].(map[string]any); ok && c != nil && c["virtual"] != true {
						mappableCount++
					}
				}
			}
			return map[string]any{
				"success": true, "count": len(events), "conferenceCount": confCount,
				"mappableCount": mappableCount, "lastUpdated": nowISO(), "events": events,
			}, nil
		},
		func(w http.ResponseWriter, err error) {
			writeJSON(w, http.StatusOK, "", map[string]any{"success": false, "count": 0, "events": []any{}, "error": err.Error()})
		})
}

func filterEvents(in []map[string]any, keep func(map[string]any) bool) []map[string]any {
	out := in[:0]
	for _, e := range in {
		if keep(e) {
			out = append(out, e)
		}
	}
	return out
}

func parseICS(ics string) []map[string]any {
	var out []map[string]any
	blocks := strings.Split(ics, "BEGIN:VEVENT")
	for _, block := range blocks[1:] {
		sm := icsSummaryRe.FindStringSubmatch(block)
		dsm := icsStartRe.FindStringSubmatch(block)
		if sm == nil || dsm == nil {
			continue
		}
		summary := trimSpace(sm[1])
		var location string
		if lm := icsLocationRe.FindStringSubmatch(block); lm != nil {
			location = trimSpace(lm[1])
		}
		start := dsm[1]
		end := start
		if em := icsEndRe.FindStringSubmatch(block); em != nil {
			end = em[1]
		}
		var link, uid string
		if um := icsURLRe.FindStringSubmatch(block); um != nil {
			link = trimSpace(um[1])
		}
		if um := icsUIDRe.FindStringSubmatch(block); um != nil {
			uid = trimSpace(um[1])
		}
		etype := "other"
		switch {
		case hasPrefix(summary, "Earnings:"):
			etype = "earnings"
		case hasPrefix(summary, "IPO"):
			etype = "ipo"
		case location != "":
			etype = "conference"
		}
		ev := map[string]any{
			"id": uid, "title": summary, "type": etype, "location": location,
			"coords":    geocodeCity(location),
			"startDate": icsDate(start), "endDate": icsDate(end),
			"url": link, "source": "techmeme",
		}
		out = append(out, ev)
	}
	return out
}

func icsDate(d string) string {
	if len(d) < 8 {
		return d
	}
	return d[0:4] + "-" + d[4:6] + "-" + d[6:8]
}

func geocodeCity(location string) any {
	if location == "" {
		return nil
	}
	norm := lower(trimSpace(location))
	norm = strings.TrimPrefix(norm, "hybrid: ")
	if c, ok := techCityCoords[norm]; ok {
		return cloneCoord(c, location)
	}
	if parts := strings.SplitN(norm, ",", 2); len(parts) > 1 {
		if c, ok := techCityCoords[trimSpace(parts[0])]; ok {
			return cloneCoord(c, location)
		}
	}
	for k, c := range techCityCoords {
		if strings.Contains(norm, k) {
			return cloneCoord(c, location)
		}
	}
	return nil
}

func cloneCoord(c cityCoord, original string) map[string]any {
	m := map[string]any{"lat": c.lat, "lng": c.lng, "country": c.country, "original": original}
	if c.virtual {
		m["virtual"] = true
	}
	return m
}
