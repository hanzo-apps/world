//go:build ignore

// gen-defi-chains reads a local checkout of github.com/luxfi/assets and emits the
// bridge-supported chain catalog the DeFi variant renders. It is the ONE
// generator for internal/world/defi_chains.json — the world binary embeds that
// JSON (go:embed), so it carries no runtime dependency on the assets repo.
//
// Usage:
//
//	go run scripts/gen-defi-chains.go \
//	  --assets /home/z/work/lux/assets \
//	  --out internal/world/defi_chains.json
//
// Only identity is emitted (name/symbol/decimals/explorer/logo/type/tags/status):
// these are the bridge-supported asset universe. Live metrics (block height, TPS,
// TVL) are overlaid at request time by the BFF for the chains it can actually
// reach — never faked here. Logos resolve from Lux's own CDN (assets.lux.network),
// mirroring the assets repo layout, so the board stays a Lux surface end to end.
package main

import (
	"encoding/json"
	"flag"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

const logoBase = "https://assets.lux.network/blockchains/"

type info struct {
	Name     string   `json:"name"`
	Symbol   string   `json:"symbol"`
	Decimals int      `json:"decimals"`
	Explorer string   `json:"explorer"`
	Website  string   `json:"website"`
	Type     string   `json:"type"`
	Status   string   `json:"status"`
	Tags     []string `json:"tags"`
}

type chain struct {
	Slug     string   `json:"slug"`
	Name     string   `json:"name"`
	Symbol   string   `json:"symbol"`
	Decimals int      `json:"decimals"`
	Explorer string   `json:"explorer,omitempty"`
	Website  string   `json:"website,omitempty"`
	Logo     string   `json:"logo"`
	Type     string   `json:"type,omitempty"`
	Status   string   `json:"status,omitempty"`
	Tags     []string `json:"tags,omitempty"`
}

func main() {
	assets := flag.String("assets", "", "path to a luxfi/assets checkout")
	out := flag.String("out", "internal/world/defi_chains.json", "output JSON path")
	flag.Parse()
	if *assets == "" {
		log.Fatal("--assets is required (path to a luxfi/assets checkout)")
	}

	root := filepath.Join(*assets, "blockchains")
	entries, err := os.ReadDir(root)
	if err != nil {
		log.Fatalf("read %s: %v", root, err)
	}

	var chains []chain
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		slug := e.Name()
		raw, err := os.ReadFile(filepath.Join(root, slug, "info", "info.json"))
		if err != nil {
			continue // no info → not a catalog chain
		}
		var in info
		if err := json.Unmarshal(raw, &in); err != nil {
			log.Printf("skip %s: bad info.json: %v", slug, err)
			continue
		}
		if in.Name == "" {
			in.Name = slug
		}
		chains = append(chains, chain{
			Slug:     slug,
			Name:     in.Name,
			Symbol:   strings.ToUpper(in.Symbol),
			Decimals: in.Decimals,
			Explorer: strings.TrimSuffix(in.Explorer, "/"),
			Website:  strings.TrimSuffix(in.Website, "/"),
			Logo:     logoBase + slug + "/info/logo.png",
			Type:     in.Type,
			Status:   in.Status,
			Tags:     in.Tags,
		})
	}
	sort.Slice(chains, func(i, j int) bool { return chains[i].Slug < chains[j].Slug })

	buf, err := json.MarshalIndent(chains, "", "  ")
	if err != nil {
		log.Fatal(err)
	}
	buf = append(buf, '\n')
	if err := os.WriteFile(*out, buf, 0o644); err != nil {
		log.Fatal(err)
	}
	log.Printf("wrote %d chains → %s", len(chains), *out)
}
