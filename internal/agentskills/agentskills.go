// Package agentskills builds and validates the /.well-known/agent-skills catalog
// index.json from the SKILL.md files beside it. It is the SINGLE source of truth
// for the index: the generator (cmd/genskills) writes exactly Marshal(Build(dir))
// and the drift test asserts the on-disk index.json equals it — so a SKILL.md
// edit that isn't regenerated fails CI instead of shipping a stale digest.
//
//go:generate go run ./cmd/genskills
package agentskills

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// IndexName is the catalog file that lists every skill with its digest.
const IndexName = "index.json"

// RelDir is the catalog directory relative to THIS package's directory. Both the
// generator (run via `go generate` here) and the drift test resolve it the same
// way, so there is one path in one place.
const RelDir = "../../public/.well-known/agent-skills"

// skillSuffix identifies a skill document.
const skillSuffix = ".SKILL.md"

// SchemaVersion tags the catalog envelope.
const SchemaVersion = 1

// Skill is one catalog entry: enough to discover and fetch a skill, plus the
// digest that pins its document.
type Skill struct {
	Name     string `json:"name"`
	Endpoint string `json:"endpoint"`
	File     string `json:"file"`
	SHA256   string `json:"sha256"`
}

// Catalog is the index.json envelope.
type Catalog struct {
	Version int     `json:"version"`
	Skills  []Skill `json:"skills"`
}

// Build scans dir for *.SKILL.md, reads name+endpoint from each file's YAML
// frontmatter, and pins each with its sha256. Order is deterministic (by name).
func Build(dir string) (Catalog, error) {
	matches, err := filepath.Glob(filepath.Join(dir, "*"+skillSuffix))
	if err != nil {
		return Catalog{}, err
	}
	skills := make([]Skill, 0, len(matches))
	for _, path := range matches {
		b, err := os.ReadFile(path)
		if err != nil {
			return Catalog{}, err
		}
		fm := frontmatter(b)
		name := fm["name"]
		if name == "" {
			return Catalog{}, fmt.Errorf("%s: missing frontmatter name", filepath.Base(path))
		}
		sum := sha256.Sum256(b)
		skills = append(skills, Skill{
			Name:     name,
			Endpoint: fm["endpoint"],
			File:     filepath.Base(path),
			SHA256:   hex.EncodeToString(sum[:]),
		})
	}
	sort.Slice(skills, func(i, j int) bool { return skills[i].Name < skills[j].Name })
	return Catalog{Version: SchemaVersion, Skills: skills}, nil
}

// Marshal renders the catalog as the exact bytes written to index.json: indented
// with a trailing newline, so generator output and the on-disk file compare
// byte-for-byte.
func Marshal(c Catalog) ([]byte, error) {
	b, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return nil, err
	}
	return append(b, '\n'), nil
}

// frontmatter parses the leading "--- ... ---" YAML block as flat key:value
// pairs. Deliberately minimal (no dependency): the frontmatter is flat scalars.
func frontmatter(b []byte) map[string]string {
	out := map[string]string{}
	s := string(b)
	if !strings.HasPrefix(s, "---") {
		return out
	}
	rest := s[len("---"):]
	end := strings.Index(rest, "\n---")
	if end < 0 {
		return out
	}
	for _, line := range strings.Split(rest[:end], "\n") {
		line = strings.TrimSpace(line)
		k, v, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		key := strings.TrimSpace(k)
		val := strings.TrimSpace(v)
		val = strings.Trim(val, `"'`)
		if key != "" {
			out[key] = val
		}
	}
	return out
}
