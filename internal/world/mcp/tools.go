package mcp

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strconv"
	"strings"
)

// Tool is one MCP tool: its public descriptor (name/title/description/schema)
// plus how it maps IN-PROCESS onto an existing /v1/world route. build turns
// validated arguments into a (path, body) pair dispatched through the world mux;
// Route is the underlying route pattern (for the discovery card and the
// registration cross-check test); App links a ui:// resource when the tool feeds
// a card.
type Tool struct {
	Name        string
	Title       string
	Description string
	Method      string
	Route       string
	App         string
	InputSchema map[string]any
	build       func(args map[string]any) (path string, body []byte, err error)
}

// tools is the ordered registry — the single source of truth for both the live
// tools/list and the static server-card. Order is fixed (deterministic card).
var tools = []Tool{
	{
		Name:        "world_brief",
		Title:       "World Brief",
		Description: "Ranked snapshot of the highest-instability entities from the Hanzo World model — the fastest \"what is going on in the world right now\" brief.",
		Method:      "GET",
		Route:       "/v1/world/model/top",
		App:         "ui://world/world-brief",
		InputSchema: objectSchema(nil, map[string]any{
			"metric": enumString([]string{"instability", "velocity", "sentiment"}, "instability", "ranking signal"),
			"kind":   enumString([]string{"country", "theater", "market"}, "country", "entity kind to rank"),
			"n":      intField(1, 100, 10, "number of entities to return"),
		}),
		build: func(a map[string]any) (string, []byte, error) {
			q := url.Values{}
			if m := argString(a["metric"]); m != "" {
				q.Set("metric", m)
			}
			if k := argString(a["kind"]); k != "" {
				q.Set("kind", k)
			}
			if n, ok := argInt(a["n"]); ok {
				q.Set("n", strconv.Itoa(n))
			}
			return withQuery("/v1/world/model/top", q), nil, nil
		},
	},
	{
		Name:        "country_instability",
		Title:       "Country Instability",
		Description: "Instability, news-velocity and sentiment profile for one country by ISO code, from the Hanzo World model.",
		Method:      "GET",
		Route:       "/v1/world/model/country/",
		InputSchema: objectSchema([]string{"iso"}, map[string]any{
			"iso": map[string]any{"type": "string", "description": "ISO 3166 country code, e.g. US, RU, CN, UA"},
		}),
		build: func(a map[string]any) (string, []byte, error) {
			iso := strings.ToUpper(strings.TrimSpace(argString(a["iso"])))
			if iso == "" {
				return "", nil, errors.New("iso is required")
			}
			if len(iso) < 2 || len(iso) > 3 || !isAlpha(iso) {
				return "", nil, errors.New("iso must be a 2- or 3-letter country code")
			}
			return "/v1/world/model/country/" + iso, nil, nil
		},
	},
	{
		Name:        "model_history",
		Title:       "Model History",
		Description: "Downsampled time-series of composite world instability and top movers over the last N hours (max 168).",
		Method:      "GET",
		Route:       "/v1/world/model/history",
		InputSchema: objectSchema(nil, map[string]any{
			"hours": intField(1, 168, 24, "look-back window in hours"),
		}),
		build: func(a map[string]any) (string, []byte, error) {
			q := url.Values{}
			if h, ok := argInt(a["hours"]); ok {
				q.Set("hours", strconv.Itoa(h))
			}
			return withQuery("/v1/world/model/history", q), nil, nil
		},
	},
	{
		Name:        "market_quotes",
		Title:       "Market Quotes",
		Description: "Live quotes (price, change, %change, high/low/open/previous-close) for up to 20 symbols — stocks, indices, FX, commodities, crypto. Returns skipped:true when no quote provider is configured.",
		Method:      "GET",
		Route:       "/v1/world/finnhub",
		App:         "ui://world/market-radar",
		InputSchema: objectSchema([]string{"symbols"}, map[string]any{
			"symbols": map[string]any{
				"type":        "array",
				"items":       map[string]any{"type": "string"},
				"minItems":    1,
				"maxItems":    20,
				"description": "ticker symbols, e.g. [\"AAPL\",\"^GSPC\",\"BTC-USD\"]",
			},
		}),
		build: func(a map[string]any) (string, []byte, error) {
			syms := argStringSlice(a["symbols"])
			clean := make([]string, 0, len(syms))
			for _, sym := range syms {
				sym = strings.ToUpper(strings.TrimSpace(sym))
				if sym == "" {
					continue
				}
				clean = append(clean, sym)
				if len(clean) >= 20 {
					break
				}
			}
			if len(clean) == 0 {
				return "", nil, errors.New("symbols is required (1–20 ticker strings)")
			}
			q := url.Values{}
			q.Set("symbols", strings.Join(clean, ","))
			return withQuery("/v1/world/finnhub", q), nil, nil
		},
	},
	{
		Name:        "chain_status",
		Title:       "Chain Status",
		Description: "Public chain-node telemetry for the Hanzo Cloud map: node locations, health and per-region counts.",
		Method:      "GET",
		Route:       "/v1/world/cloud/chain-nodes",
		InputSchema: objectSchema(nil, map[string]any{}),
		build: func(map[string]any) (string, []byte, error) {
			return "/v1/world/cloud/chain-nodes", nil, nil
		},
	},
	{
		Name:        "traffic_map",
		Title:       "Traffic Map",
		Description: "Public request-traffic snapshot for the Hanzo Cloud map: origin→edge flows and regional volume.",
		Method:      "GET",
		Route:       "/v1/world/cloud/traffic",
		InputSchema: objectSchema(nil, map[string]any{}),
		build: func(map[string]any) (string, []byte, error) {
			return "/v1/world/cloud/traffic", nil, nil
		},
	},
	{
		Name:        "feeds",
		Title:       "News Feeds",
		Description: "Latest headlines for one news category, fetched server-side from a curated set of reputable RSS feeds. Categories: world, tech, markets, security, ai.",
		Method:      "POST",
		Route:       "/v1/world/feeds-batch",
		InputSchema: objectSchema(nil, map[string]any{
			"category": enumString(feedCategoryNames, "world", "news category"),
		}),
		build: func(a map[string]any) (string, []byte, error) {
			cat := strings.ToLower(strings.TrimSpace(argString(a["category"])))
			if cat == "" {
				cat = "world"
			}
			urls, ok := feedCategories[cat]
			if !ok {
				return "", nil, fmt.Errorf("unknown category %q; allowed: %s", cat, strings.Join(feedCategoryNames, ", "))
			}
			body, err := json.Marshal(map[string]any{"urls": urls})
			if err != nil {
				return "", nil, err
			}
			return "/v1/world/feeds-batch", body, nil
		},
	},
}

// toolByName indexes tools for O(1) dispatch. Pointers into the package slice.
var toolByName = func() map[string]*Tool {
	m := make(map[string]*Tool, len(tools))
	for i := range tools {
		m[tools[i].Name] = &tools[i]
	}
	return m
}()

// toolsList renders the live tools/list response from the registry.
func toolsList() map[string]any {
	out := make([]any, 0, len(tools))
	for i := range tools {
		t := &tools[i]
		d := map[string]any{
			"name":        t.Name,
			"description": t.Description,
			"inputSchema": t.InputSchema,
		}
		if t.Title != "" {
			d["title"] = t.Title
		}
		if t.App != "" {
			d["_meta"] = map[string]any{MetaAppKey: t.App}
		}
		out = append(out, d)
	}
	return map[string]any{"tools": out}
}

// ── curated feed categories (SSRF-safe) ──────────────────────────────────────
//
// The feeds tool exposes a CATEGORY, never raw URLs, so no caller-controlled URL
// ever reaches the fetcher. Every URL below is on an allowlisted host
// (rss_domains.go); handleFeedsBatch re-checks the allowlist as a second layer.

var feedCategories = map[string][]string{
	"world": {
		"https://feeds.bbci.co.uk/news/world/rss.xml",
		"https://www.theguardian.com/world/rss",
		"https://feeds.npr.org/1004/rss.xml",
		"https://www.aljazeera.com/xml/rss/all.xml",
	},
	"tech": {
		"https://feeds.arstechnica.com/arstechnica/index",
		"https://www.theverge.com/rss/index.xml",
		"https://techcrunch.com/feed/",
		"https://hnrss.org/frontpage",
	},
	"markets": {
		"https://feeds.marketwatch.com/marketwatch/topstories/",
		"https://www.cnbc.com/id/100003114/device/rss/rss.html",
		"https://finance.yahoo.com/news/rssindex",
		"https://www.coindesk.com/arc/outboundfeeds/rss/",
	},
	"security": {
		"https://krebsonsecurity.com/feed/",
		"https://www.darkreading.com/rss.xml",
		"https://www.schneier.com/feed/atom/",
		"https://www.cisa.gov/cybersecurity-advisories/all.xml",
	},
	"ai": {
		"https://huggingface.co/blog/feed.xml",
		"https://openai.com/blog/rss.xml",
		"https://www.technologyreview.com/feed/",
		"https://venturebeat.com/category/ai/feed/",
	},
}

// feedCategoryNames is the ordered enum for the feeds tool schema (deterministic).
var feedCategoryNames = []string{"world", "tech", "markets", "security", "ai"}

// ── schema + argument helpers ────────────────────────────────────────────────

func objectSchema(required []string, props map[string]any) map[string]any {
	s := map[string]any{
		"type":                 "object",
		"properties":           props,
		"additionalProperties": false,
	}
	if len(required) > 0 {
		s["required"] = required
	}
	return s
}

func enumString(values []string, def, desc string) map[string]any {
	return map[string]any{
		"type": "string", "enum": values, "default": def, "description": desc,
	}
}

func intField(min, max, def int, desc string) map[string]any {
	return map[string]any{
		"type": "integer", "minimum": min, "maximum": max, "default": def, "description": desc,
	}
}

func argString(v any) string { s, _ := v.(string); return s }

func argInt(v any) (int, bool) {
	switch n := v.(type) {
	case float64:
		return int(n), true
	case int:
		return n, true
	case json.Number:
		if i, err := n.Int64(); err == nil {
			return int(i), true
		}
	case string:
		if i, err := strconv.Atoi(strings.TrimSpace(n)); err == nil {
			return i, true
		}
	}
	return 0, false
}

func argStringSlice(v any) []string {
	arr, ok := v.([]any)
	if !ok {
		return nil
	}
	out := make([]string, 0, len(arr))
	for _, e := range arr {
		if s, ok := e.(string); ok {
			out = append(out, s)
		}
	}
	return out
}

func isAlpha(s string) bool {
	for _, c := range s {
		if !(c >= 'A' && c <= 'Z' || c >= 'a' && c <= 'z') {
			return false
		}
	}
	return true
}

func withQuery(path string, q url.Values) string {
	if e := q.Encode(); e != "" {
		return path + "?" + e
	}
	return path
}
