package mcp

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
)

//go:generate go run ./cmd/gencard

// Server identity + protocol constants. One place; used by the live handlers,
// the discovery card, and the registry manifest.
const (
	ServerName        = "hanzo-world"
	ServerTitle       = "Hanzo World"
	ServerDescription = "Read-only Model Context Protocol server over Hanzo World's public " +
		"planetary-intelligence data: world-model instability rankings, per-country risk, " +
		"market quotes, cloud chain + traffic status, and curated news feeds. Ships two MCP " +
		"apps (world-brief, market-radar)."
	Version         = "1.0.0"
	ProtocolVersion = "2025-06-18"
	Endpoint        = "/v1/world/mcp"
	PublicBase      = "https://world.hanzo.ai"
	RegistryName    = "ai.hanzo/world"

	// AppMimeType marks a resource body as an MCP app shell (host-rendered HTML).
	AppMimeType = "text/html;profile=mcp-app"
	// MetaAppKey links a tool descriptor to the ui:// app it feeds.
	MetaAppKey = "ai.hanzo/app"
	// MetaToolKey links an app resource to the tool that supplies its data.
	MetaToolKey = "ai.hanzo/tool"

	// CardSchemaVersion tags the server-card envelope.
	CardSchemaVersion = 1

	// serverJSONSchema is the MCP registry schema the root server.json validates
	// against (current published version).
	serverJSONSchema = "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json"
)

// Paths (relative to THIS package dir — both the generator, run via `go generate`
// here, and the drift test resolve them the same way).
const (
	CardRelPath       = "../../../public/.well-known/mcp/server-card.json"
	ServerJSONRelPath = "../../../server.json"
)

// ── server-card (HTTP-discoverable tool + app inventory) ─────────────────────

// Card is the /.well-known/mcp/server-card.json envelope: everything a client
// needs to decide to connect, plus a digest per app shell for drift-guarding.
type Card struct {
	SchemaVersion   int        `json:"schemaVersion"`
	Name            string     `json:"name"`
	Title           string     `json:"title"`
	Description     string     `json:"description"`
	Version         string     `json:"version"`
	Endpoint        string     `json:"endpoint"`
	Transport       string     `json:"transport"`
	ProtocolVersion string     `json:"protocolVersion"`
	Tools           []CardTool `json:"tools"`
	Apps            []CardApp  `json:"apps"`
}

// CardTool is one tool's discovery entry, including the /v1/world route it wraps.
type CardTool struct {
	Name        string         `json:"name"`
	Title       string         `json:"title,omitempty"`
	Description string         `json:"description"`
	Method      string         `json:"method"`
	Endpoint    string         `json:"endpoint"`
	InputSchema map[string]any `json:"inputSchema"`
	App         string         `json:"app,omitempty"`
}

// CardApp is one app's discovery entry; SHA256 pins its shell HTML.
type CardApp struct {
	URI         string `json:"uri"`
	Name        string `json:"name"`
	Title       string `json:"title,omitempty"`
	Description string `json:"description"`
	Tool        string `json:"tool"`
	MimeType    string `json:"mimeType"`
	SHA256      string `json:"sha256"`
}

// BuildCard assembles the discovery card from the tool + app registries and the
// embedded shell digests. Deterministic: registry order is fixed and map keys
// (inputSchema) marshal sorted, so Marshal(BuildCard()) is byte-stable.
func BuildCard() (Card, error) {
	ct := make([]CardTool, 0, len(tools))
	for i := range tools {
		t := &tools[i]
		ct = append(ct, CardTool{
			Name:        t.Name,
			Title:       t.Title,
			Description: t.Description,
			Method:      t.Method,
			Endpoint:    t.Route,
			InputSchema: t.InputSchema,
			App:         t.App,
		})
	}
	ca := make([]CardApp, 0, len(apps))
	for i := range apps {
		a := &apps[i]
		b, err := shellFS.ReadFile("shells/" + a.file)
		if err != nil {
			return Card{}, err
		}
		sum := sha256.Sum256(b)
		ca = append(ca, CardApp{
			URI:         a.URI,
			Name:        a.Name,
			Title:       a.Title,
			Description: a.Description,
			Tool:        a.Tool,
			MimeType:    AppMimeType,
			SHA256:      hex.EncodeToString(sum[:]),
		})
	}
	return Card{
		SchemaVersion:   CardSchemaVersion,
		Name:            ServerName,
		Title:           ServerTitle,
		Description:     ServerDescription,
		Version:         Version,
		Endpoint:        Endpoint,
		Transport:       "streamable-http",
		ProtocolVersion: ProtocolVersion,
		Tools:           ct,
		Apps:            ca,
	}, nil
}

// ── registry manifest (root server.json) ─────────────────────────────────────

// ServerJSON is the MCP registry publish manifest for the remote server.
type ServerJSON struct {
	Schema      string   `json:"$schema"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Version     string   `json:"version"`
	Remotes     []Remote `json:"remotes"`
}

// Remote is a remote transport entry in server.json.
type Remote struct {
	Type string `json:"type"`
	URL  string `json:"url"`
}

// BuildServerJSON assembles the registry manifest (deterministic).
func BuildServerJSON() ServerJSON {
	return ServerJSON{
		Schema:      serverJSONSchema,
		Name:        RegistryName,
		Description: ServerDescription,
		Version:     Version,
		Remotes:     []Remote{{Type: "streamable-http", URL: PublicBase + Endpoint}},
	}
}

// Marshal renders the exact bytes written to disk: indented, trailing newline —
// so generator output and the on-disk files compare byte-for-byte (drift guard).
func Marshal(v any) ([]byte, error) {
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return nil, err
	}
	return append(b, '\n'), nil
}
