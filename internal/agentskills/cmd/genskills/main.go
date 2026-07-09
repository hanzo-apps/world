// Command genskills regenerates the agent-skills index.json from the SKILL.md
// files beside it. Run via `go generate ./internal/agentskills` (or directly:
// `cd internal/agentskills && go run ./cmd/genskills`). It writes exactly
// agentskills.Marshal(agentskills.Build(dir)); the drift test guards the result.
package main

import (
	"log"
	"os"
	"path/filepath"

	"github.com/hanzoai/world/internal/agentskills"
)

func main() {
	dir := agentskills.RelDir
	if len(os.Args) > 1 {
		dir = os.Args[1] // allow an explicit dir override
	}
	cat, err := agentskills.Build(dir)
	if err != nil {
		log.Fatalf("genskills: build: %v", err)
	}
	b, err := agentskills.Marshal(cat)
	if err != nil {
		log.Fatalf("genskills: marshal: %v", err)
	}
	out := filepath.Join(dir, agentskills.IndexName)
	if err := os.WriteFile(out, b, 0o644); err != nil {
		log.Fatalf("genskills: write %s: %v", out, err)
	}
	log.Printf("genskills: wrote %s (%d skills)", out, len(cat.Skills))
}
