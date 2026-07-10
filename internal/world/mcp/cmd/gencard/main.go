// Command gencard writes the MCP discovery files from the in-code registries:
//   - public/.well-known/mcp/server-card.json (HTTP-discoverable tool + app card)
//   - server.json                             (MCP registry publish manifest)
//
// It is the SINGLE writer of both files: it emits exactly Marshal(Build…) and the
// drift test asserts the on-disk files equal that — so a tool/app/shell edit that
// isn't regenerated fails CI instead of shipping a stale card. Run via
// `go generate ./internal/world/mcp`.
package main

import (
	"log"
	"os"

	"github.com/hanzoai/world/internal/world/mcp"
)

func main() {
	card, err := mcp.BuildCard()
	if err != nil {
		log.Fatalf("gencard: build card: %v", err)
	}
	write(mcp.CardRelPath, card)
	write(mcp.ServerJSONRelPath, mcp.BuildServerJSON())
}

func write(path string, v any) {
	b, err := mcp.Marshal(v)
	if err != nil {
		log.Fatalf("gencard: marshal %s: %v", path, err)
	}
	if err := os.WriteFile(path, b, 0o644); err != nil {
		log.Fatalf("gencard: write %s: %v", path, err)
	}
	log.Printf("gencard: wrote %s (%d bytes)", path, len(b))
}
