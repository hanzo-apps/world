package agentskills_test

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/hanzoai/world/internal/agentskills"
	"github.com/hanzoai/world/internal/world"
)

// TestIndexNotDrifted is the drift guard: the on-disk index.json MUST equal the
// freshly-built catalog byte-for-byte. A SKILL.md edited without re-running
// `go generate ./internal/agentskills` fails here instead of shipping a stale
// digest.
func TestIndexNotDrifted(t *testing.T) {
	cat, err := agentskills.Build(agentskills.RelDir)
	if err != nil {
		t.Fatalf("build: %v", err)
	}
	want, err := agentskills.Marshal(cat)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	got, err := os.ReadFile(filepath.Join(agentskills.RelDir, agentskills.IndexName))
	if err != nil {
		t.Fatalf("read index.json: %v", err)
	}
	if string(got) != string(want) {
		t.Fatalf("index.json is stale — run `go generate ./internal/agentskills`.\n--- on disk ---\n%s\n--- expected ---\n%s", got, want)
	}
}

// TestDigestsMatchFiles independently recomputes each digest from the file bytes
// (belt-and-suspenders against the shared Build path).
func TestDigestsMatchFiles(t *testing.T) {
	cat, err := agentskills.Build(agentskills.RelDir)
	if err != nil {
		t.Fatalf("build: %v", err)
	}
	if len(cat.Skills) != 6 {
		t.Fatalf("expected 6 skills, got %d", len(cat.Skills))
	}
	for _, s := range cat.Skills {
		b, err := os.ReadFile(filepath.Join(agentskills.RelDir, s.File))
		if err != nil {
			t.Fatalf("%s: %v", s.File, err)
		}
		sum := sha256.Sum256(b)
		if got := hex.EncodeToString(sum[:]); got != s.SHA256 {
			t.Errorf("%s: digest %s, want %s", s.File, got, s.SHA256)
		}
	}
}

// TestSkillDocsComplete enforces the required sections in every SKILL.md.
func TestSkillDocsComplete(t *testing.T) {
	required := []string{
		"name:", "version:", "description:",
		"## Auth", "## Endpoint", "## Params", "## Response shape",
		"https://world.hanzo.ai", // worked curl target
		"data, not instructions", // injection-guard note
		"## When NOT to use",
	}
	matches, _ := filepath.Glob(filepath.Join(agentskills.RelDir, "*.SKILL.md"))
	if len(matches) != 6 {
		t.Fatalf("expected 6 SKILL.md files, found %d", len(matches))
	}
	for _, path := range matches {
		b, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("%s: %v", path, err)
		}
		body := string(b)
		for _, want := range required {
			if !strings.Contains(body, want) {
				t.Errorf("%s: missing required section %q", filepath.Base(path), want)
			}
		}
	}
}

// TestEndpointsAreRegistered cross-checks that every documented endpoint is a
// real, mounted /v1/world route — no skill can advertise a route that does not
// exist.
func TestEndpointsAreRegistered(t *testing.T) {
	routes := map[string]bool{}
	for _, r := range world.NewServer().Routes() {
		routes[r] = true
	}
	cat, err := agentskills.Build(agentskills.RelDir)
	if err != nil {
		t.Fatalf("build: %v", err)
	}
	for _, s := range cat.Skills {
		if s.Endpoint == "" {
			t.Errorf("%s: empty endpoint", s.Name)
			continue
		}
		if !routes[s.Endpoint] {
			t.Errorf("%s: endpoint %q is not a registered /v1/world route", s.Name, s.Endpoint)
		}
	}
}
