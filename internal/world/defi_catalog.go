package world

import (
	_ "embed"
	"encoding/json"
	"sort"
	"strings"
)

// DeFi chain catalog — the bridge-supported universe (bridge.lux.network) plus
// Lux's own sovereign L1s. Two sources, one merged catalog:
//
//   - defiChainsJSON: the 184 bridge-supported asset chains, generated from
//     github.com/luxfi/assets by scripts/gen-defi-chains.go and embedded here so
//     the binary carries no runtime dependency on the assets repo. Identity only
//     (name/symbol/logo/explorer) — external chains we bridge to but do not index.
//   - nativeChains: Lux, Lux DEX, Zoo, Hanzo, Pars, SPC — our own chains, each
//     with a live RPC the BFF probes for real height/TPS and (via the explorer's
//     amm subgraph) real TVL. These lead the board.
//
// Honesty: the catalog is identity; every live number is overlaid at request time
// from a real upstream and is null when we can't reach it — never invented here.

//go:embed defi_chains.json
var defiChainsJSON []byte

// catalogChain is one embedded bridge-supported chain (identity only).
type catalogChain struct {
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

// bridgeCatalog is the parsed, slug-sorted embedded set (parsed once at init).
var bridgeCatalog = func() []catalogChain {
	var cs []catalogChain
	if err := json.Unmarshal(defiChainsJSON, &cs); err != nil {
		return nil
	}
	sort.SliceStable(cs, func(i, j int) bool { return cs[i].Slug < cs[j].Slug })
	return cs
}()

// nativeChain is one of our own L1s: catalog identity + the explorer slug the BFF
// reads real metrics from, and a modeled globe position for the bridge-flow arcs.
// ExplorerSlug maps to the explorer's chains.yaml slug (Lux C-Chain is "cchain")
// so the /v1/indexer/{slug}/* metrics + amm-TVL join cleanly. No RPC host is kept:
// the explorer (explorer.lux.network) is the single metrics source — one way.
// Logo is intentionally empty; our chains have no assets.lux.network entry, so the
// board renders a symbol initial-chip (frontend) rather than a broken image.
type nativeChain struct {
	Slug         string
	Name         string
	Symbol       string
	ChainID      int64
	ExplorerSlug string // slug on explorer.lux.network (Lux C-Chain → "cchain")
	ExplorerURL  string
	HasAMM       bool    // amm subgraph present → attempt real USD TVL (else nil)
	Lat, Lon     float64 // modeled globe position for bridge-flow arcs
	Hub          bool    // the bridge hub (Lux) — every flow is hub↔counterparty
}

// nativeChains is the sovereign set the board leads with. ExplorerSlug + HasAMM
// mirror the explorer's chains.yaml (cchain/zoo/hanzo/dex carry the amm subgraph).
// Coordinates are modeled (chains have no geography) — the flows envelope carries
// modeled:true so the globe layer never claims they're real.
var nativeChains = []nativeChain{
	{Slug: "lux", Name: "Lux Network", Symbol: "LUX", ChainID: 96369, ExplorerSlug: "cchain", ExplorerURL: "https://explore.lux.network", HasAMM: true, Lat: 37.77, Lon: -122.42, Hub: true},
	{Slug: "dex", Name: "Lux DEX", Symbol: "LUX", ChainID: 96370, ExplorerSlug: "dex", ExplorerURL: "https://explorer.dex.lux.network", HasAMM: true, Lat: 1.35, Lon: 103.82},
	{Slug: "zoo", Name: "Zoo Network", Symbol: "ZOO", ChainID: 200200, ExplorerSlug: "zoo", ExplorerURL: "https://explore.zoo.ngo", HasAMM: true, Lat: 40.71, Lon: -74.01},
	{Slug: "hanzo", Name: "Hanzo Network", Symbol: "AI", ChainID: 36963, ExplorerSlug: "hanzo", ExplorerURL: "https://explore.hanzo.ai", HasAMM: true, Lat: 35.68, Lon: 139.69},
	{Slug: "pars", Name: "Pars Network", Symbol: "PARS", ChainID: 494949, ExplorerSlug: "pars", ExplorerURL: "https://explore.pars.network", Lat: 35.70, Lon: 51.42},
	{Slug: "spc", Name: "Sparkle Pony", Symbol: "SPC", ChainID: 36911, ExplorerSlug: "spc", ExplorerURL: "https://explore.sparklepony.xyz", Lat: 48.85, Lon: 2.35},
}

// nativeSlugs is the set of our own slugs, for O(1) "is this ours" checks so the
// merged catalog never lists a native chain twice.
var nativeSlugs = func() map[string]bool {
	m := make(map[string]bool, len(nativeChains))
	for _, n := range nativeChains {
		m[n.Slug] = true
	}
	return m
}()

// luxHub returns the bridge hub (Lux) — the fixed endpoint every bridge-flow arc
// connects to. Falls back to the first native chain if the Hub flag is ever unset.
func luxHub() nativeChain {
	for _, n := range nativeChains {
		if n.Hub {
			return n
		}
	}
	return nativeChains[0]
}

// normSymbol upper-cases and trims a token symbol for stable display/join.
func normSymbol(s string) string { return strings.ToUpper(strings.TrimSpace(s)) }
