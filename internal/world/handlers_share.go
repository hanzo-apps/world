package world

import (
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
)

var botUARe = regexp.MustCompile(`(?i)twitterbot|facebookexternalhit|linkedinbot|slackbot|telegrambot|whatsapp|discordbot|redditbot|googlebot`)

// shareCountryNames maps common ISO-3166 alpha-2 codes to display names for
// share cards; unknown codes fall back to the raw code (or "Global").
var shareCountryNames = map[string]string{
	"US": "United States", "RU": "Russia", "CN": "China", "UA": "Ukraine", "IR": "Iran", "IL": "Israel",
	"TW": "Taiwan", "KP": "North Korea", "SA": "Saudi Arabia", "TR": "Turkey", "PL": "Poland", "DE": "Germany",
	"FR": "France", "GB": "United Kingdom", "IN": "India", "PK": "Pakistan", "SY": "Syria", "YE": "Yemen",
	"MM": "Myanmar", "VE": "Venezuela", "JP": "Japan", "KR": "South Korea", "EG": "Egypt", "LB": "Lebanon",
	"IQ": "Iraq", "AF": "Afghanistan", "SD": "Sudan", "ET": "Ethiopia", "NG": "Nigeria", "CO": "Colombia",
}

func shareCountryName(code string) string {
	if code == "" {
		return "Global"
	}
	if n, ok := shareCountryNames[upper(code)]; ok {
		return n
	}
	return code
}

// handleStory serves an OpenGraph share page: crawlers get meta HTML, humans get
// a 302 into the SPA. Ported from api/story.js.
func (s *Server) handleStory(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	code := upper(q.Get("c"))
	typ := q.Get("t")
	if typ == "" {
		typ = "ciianalysis"
	}
	ts := q.Get("ts")
	scoreP := q.Get("s")
	levelP := q.Get("l")
	name := shareCountryName(code)

	if !botUARe.MatchString(r.Header.Get("User-Agent")) {
		host := r.Host
		if host == "" {
			host = "world.hanzo.ai"
		}
		loc := "https://" + host + "/?c=" + urlQueryEscape(code) + "&t=" + urlQueryEscape(typ)
		if ts != "" {
			loc += "&ts=" + urlQueryEscape(ts)
		}
		http.Redirect(w, r, loc, http.StatusFound)
		return
	}

	base := "https://" + firstNonEmpty(r.Host, "world.hanzo.ai")
	ogImage := base + "/v1/world/og-story?c=" + urlQueryEscape(code) + "&t=" + urlQueryEscape(typ)
	if scoreP != "" {
		ogImage += "&s=" + urlQueryEscape(scoreP)
	}
	if levelP != "" {
		ogImage += "&l=" + urlQueryEscape(levelP)
	}
	title := name + " Intelligence Brief | Hanzo World"
	desc := "Live geopolitical intelligence and risk assessment for " + name + " — Hanzo World."
	canonical := base + r.URL.RequestURI()

	html := `<!doctype html><html lang="en"><head><meta charset="utf-8"/>` +
		`<meta name="viewport" content="width=device-width,initial-scale=1"/>` +
		`<title>` + esc(title) + `</title>` +
		`<meta name="description" content="` + esc(desc) + `"/>` +
		`<meta property="og:type" content="article"/>` +
		`<meta property="og:title" content="` + esc(title) + `"/>` +
		`<meta property="og:description" content="` + esc(desc) + `"/>` +
		`<meta property="og:image" content="` + esc(ogImage) + `"/>` +
		`<meta property="og:image:width" content="1200"/>` +
		`<meta property="og:image:height" content="630"/>` +
		`<meta property="og:url" content="` + esc(canonical) + `"/>` +
		`<meta name="twitter:card" content="summary_large_image"/>` +
		`<meta name="twitter:title" content="` + esc(title) + `"/>` +
		`<meta name="twitter:description" content="` + esc(desc) + `"/>` +
		`<meta name="twitter:image" content="` + esc(ogImage) + `"/>` +
		`<link rel="canonical" href="` + esc(canonical) + `"/>` +
		`</head><body><h1>` + esc(title) + `</h1><p>` + esc(desc) + `</p></body></html>`
	writeBytes(w, http.StatusOK, "text/html; charset=utf-8", "public, max-age=300, s-maxage=300, stale-while-revalidate=60", []byte(html))
}

var levelColors = map[string]string{
	"critical": "#ef4444", "high": "#f97316", "elevated": "#eab308", "normal": "#22c55e", "low": "#3b82f6",
}
var levelLabels = map[string]string{
	"critical": "CRITICAL", "high": "HIGH", "elevated": "ELEVATED", "normal": "STABLE", "low": "LOW",
}

// handleOGStory renders a 1200×630 SVG intelligence card. Ported from
// api/og-story.js.
func (s *Server) handleOGStory(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	code := upper(q.Get("c"))
	name := shareCountryName(code)
	level := q.Get("l")
	if level == "" {
		level = "normal"
	}
	color, ok := levelColors[level]
	if !ok {
		color = "#eab308"
	}
	label, ok := levelLabels[level]
	if !ok {
		label = "MONITORING"
	}
	var score *int
	if v, err := strconv.Atoi(q.Get("s")); err == nil {
		if v < 0 {
			v = 0
		}
		if v > 100 {
			v = 100
		}
		score = &v
	}
	date := dateOnly(time.Now())
	svg := ogSVG(name, label, color, score, date)
	writeBytes(w, http.StatusOK, "image/svg+xml", "public, max-age=3600, s-maxage=3600, stale-while-revalidate=600", []byte(svg))
}

func ogSVG(name, label, color string, score *int, date string) string {
	var body strings.Builder
	body.WriteString(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">`)
	body.WriteString(`<rect width="1200" height="630" fill="#0a0a0a"/>`)
	body.WriteString(`<rect x="0" y="0" width="1200" height="8" fill="` + color + `"/>`)
	body.WriteString(`<text x="64" y="120" fill="#ffffff" font-family="system-ui,sans-serif" font-size="30" font-weight="600" letter-spacing="4">HANZO WORLD</text>`)
	body.WriteString(`<text x="64" y="240" fill="#ffffff" font-family="system-ui,sans-serif" font-size="84" font-weight="700">` + xesc(name) + `</text>`)
	body.WriteString(`<text x="64" y="300" fill="#a1a1aa" font-family="system-ui,sans-serif" font-size="34">Intelligence Brief</text>`)
	if score != nil {
		body.WriteString(`<text x="64" y="470" fill="` + color + `" font-family="system-ui,sans-serif" font-size="180" font-weight="800">` + itoa(*score) + `</text>`)
		body.WriteString(`<text x="64" y="530" fill="#a1a1aa" font-family="system-ui,sans-serif" font-size="28">Composite Instability Index</text>`)
		body.WriteString(`<rect x="700" y="360" width="436" height="64" rx="12" fill="` + color + `"/>`)
		body.WriteString(`<text x="918" y="402" fill="#0a0a0a" font-family="system-ui,sans-serif" font-size="34" font-weight="700" text-anchor="middle">` + xesc(label) + `</text>`)
	} else {
		labels := []string{"Conflict Signals", "Economic Pressure", "Military Posture", "Information Ops"}
		for i, l := range labels {
			x := 64 + (i%2)*560
			y := 380 + (i/2)*110
			body.WriteString(`<rect x="` + itoa(x) + `" y="` + itoa(y) + `" width="520" height="90" rx="12" fill="#18181b"/>`)
			body.WriteString(`<text x="` + itoa(x+28) + `" y="` + itoa(y+54) + `" fill="#e4e4e7" font-family="system-ui,sans-serif" font-size="30">` + xesc(l) + `</text>`)
		}
	}
	body.WriteString(`<text x="64" y="596" fill="#71717a" font-family="system-ui,sans-serif" font-size="24">` + xesc(date) + ` · world.hanzo.ai</text>`)
	body.WriteString(`</svg>`)
	return body.String()
}

// esc HTML-escapes attribute/text content.
func esc(s string) string {
	r := strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;", "'", "&#39;")
	return r.Replace(s)
}

// xesc XML-escapes SVG text content.
func xesc(s string) string {
	r := strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;")
	return r.Replace(s)
}
