package mcp

import (
	"embed"
	"encoding/json"
)

// App is one MCP app: a ui:// resource whose resources/read returns a DATA-FREE
// static HTML shell (shellFS), plus the tool whose output feeds it over the
// host's postMessage bridge. The shell is versioned in-tree and digest-pinned in
// the server-card, so a shell edit that isn't regenerated fails the drift test.
type App struct {
	URI         string
	Name        string
	Title       string
	Description string
	Tool        string // the tool that supplies this app's data (two-phase)
	file        string // shell filename under shells/
}

// apps is the ordered app registry — the single source of truth for resources/*
// and the card's apps manifest.
var apps = []App{
	{
		URI:         "ui://world/world-brief",
		Name:        "world-brief",
		Title:       "World Brief",
		Description: "Ranked list of the highest-instability entities from the Hanzo World model.",
		Tool:        "world_brief",
		file:        "world-brief.html",
	},
	{
		URI:         "ui://world/market-radar",
		Name:        "market-radar",
		Title:       "Market Radar",
		Description: "Compact quote board for a watchlist of market symbols.",
		Tool:        "market_quotes",
		file:        "market-radar.html",
	},
}

var appByURI = func() map[string]*App {
	m := make(map[string]*App, len(apps))
	for i := range apps {
		m[apps[i].URI] = &apps[i]
	}
	return m
}()

// shellFS holds the static, data-free app shells. Embedding keeps them versioned
// with the server and lets the card pin their digests.
//
//go:embed shells/*.html
var shellFS embed.FS

// resourcesList renders the live resources/list response (the ui:// apps).
func resourcesList() map[string]any {
	out := make([]any, 0, len(apps))
	for i := range apps {
		a := &apps[i]
		out = append(out, map[string]any{
			"uri":         a.URI,
			"name":        a.Name,
			"title":       a.Title,
			"description": a.Description,
			"mimeType":    AppMimeType,
			"_meta":       map[string]any{MetaToolKey: a.Tool},
		})
	}
	return map[string]any{"resources": out}
}

// resourcesRead returns a ui:// app's data-free shell HTML. The shell renders
// nothing until the host pushes tool output over the postMessage bridge.
func resourcesRead(params json.RawMessage) rpcResponse {
	var p struct {
		URI string `json:"uri"`
	}
	if err := json.Unmarshal(params, &p); err != nil {
		return fail(codeInvalidArgs, "invalid params")
	}
	a, ok := appByURI[p.URI]
	if !ok {
		return fail(codeInvalidArgs, "unknown resource: "+p.URI)
	}
	html, err := shellFS.ReadFile("shells/" + a.file)
	if err != nil {
		return fail(codeInternal, "shell unavailable")
	}
	return result(map[string]any{
		"contents": []any{map[string]any{
			"uri":      a.URI,
			"mimeType": AppMimeType,
			"text":     string(html),
			"_meta":    map[string]any{MetaToolKey: a.Tool},
		}},
	})
}
