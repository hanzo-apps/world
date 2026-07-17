package world

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// TestDefiCatalogEmbed proves the embedded bridge-supported catalog parses and is
// complete: the 184 chains each carry an identity + a Lux-CDN logo. This is the
// "200 blockchains" universe the board renders even with zero network.
func TestDefiCatalogEmbed(t *testing.T) {
	if len(bridgeCatalog) < 180 {
		t.Fatalf("bridge catalog too small: %d (want ~184)", len(bridgeCatalog))
	}
	for _, c := range bridgeCatalog {
		if c.Slug == "" || c.Name == "" {
			t.Fatalf("catalog row missing identity: %+v", c)
		}
		if !strings.HasPrefix(c.Logo, "https://assets.lux.network/blockchains/") {
			t.Fatalf("%s logo not a Lux-CDN URL: %q", c.Slug, c.Logo)
		}
	}
	// No overlap between our sovereign chains and the bridge universe.
	for _, c := range bridgeCatalog {
		if nativeSlugs[c.Slug] {
			t.Fatalf("native slug %q also in bridge catalog (double-listed)", c.Slug)
		}
	}
}

// TestBuildChainRows enforces the core honesty invariant: a row that is not live
// must carry NO fabricated metric (all pointers nil), and the 184 bridge chains
// are identity-only. Native chains lead, sorted by real transactions.
func TestBuildChainRows(t *testing.T) {
	m := map[string]chainMetric{
		"lux":  {Live: true, BlockHeight: 1096461, TotalTxns: 20618, Addresses: 67},
		"zoo":  {Live: true, BlockHeight: 13369, TotalTxns: 12323, Addresses: 53},
		"dex":  {}, // unreachable → not live
		"pars": {Live: true, BlockHeight: 63, TotalTxns: 58},
	}
	rows, live := buildChainRows(m)
	if len(rows) != len(nativeChains)+len(bridgeCatalog) {
		t.Fatalf("rows=%d want %d", len(rows), len(nativeChains)+len(bridgeCatalog))
	}
	if live != 3 {
		t.Fatalf("live=%d want 3", live)
	}
	// Natives lead and are txns-sorted: lux(20618) before zoo(12323) before pars(58).
	if rows[0].Slug != "lux" || rows[1].Slug != "zoo" {
		t.Fatalf("native order wrong: %s,%s", rows[0].Slug, rows[1].Slug)
	}
	for _, r := range rows {
		if r.Live {
			continue
		}
		// Not live → every metric MUST be nil (never a fabricated zero).
		if r.BlockHeight != nil || r.Txns != nil || r.TPS != nil || r.TvlUSD != nil || r.Addresses != nil {
			t.Fatalf("%s not live but carries a metric: %+v", r.Slug, r)
		}
	}
	// Every bridge (non-native) row is identity-only + bridge-badged + not live.
	for _, r := range rows {
		if r.Native {
			continue
		}
		if !r.Bridge || r.Live || r.Txns != nil {
			t.Fatalf("bridge row %s not identity-only: %+v", r.Slug, r)
		}
	}
}

// TestBuildDefiOverview checks aggregation + provenance honesty: totals sum only
// live chains; USD TVL is nil→"unavailable" and present→"explorer-amm"; topChains
// are txns-sorted.
func TestBuildDefiOverview(t *testing.T) {
	tvl := 12345.0
	m := map[string]chainMetric{
		"lux": {Live: true, TotalTxns: 20618, TotalBlocks: 1096462, Addresses: 67, TvlUSD: &tvl},
		"zoo": {Live: true, TotalTxns: 12323, TotalBlocks: 13369, Addresses: 53},
	}
	ov := (&Server{}).buildDefiOverview(m)
	if ov.TotalTxns != 32941 {
		t.Fatalf("totalTxns=%d want 32941", ov.TotalTxns)
	}
	if ov.LiveCount != 2 {
		t.Fatalf("liveCount=%d want 2", ov.LiveCount)
	}
	if ov.ChainCount != len(nativeChains)+len(bridgeCatalog) {
		t.Fatalf("chainCount=%d", ov.ChainCount)
	}
	if ov.TotalTvlUSD == nil || *ov.TotalTvlUSD != 12345 || ov.TvlProvenance != "explorer-amm" {
		t.Fatalf("tvl aggregation wrong: %v prov=%s", ov.TotalTvlUSD, ov.TvlProvenance)
	}
	if ov.Volume24hUSD != nil {
		t.Fatalf("24h USD volume must be nil (explorer does not expose it)")
	}
	if len(ov.TopChains) == 0 || ov.TopChains[0].Slug != "lux" {
		t.Fatalf("topChains not txns-sorted: %+v", ov.TopChains)
	}

	// No TVL anywhere → provenance must be honest "unavailable".
	ov2 := (&Server{}).buildDefiOverview(map[string]chainMetric{"lux": {Live: true, TotalTxns: 1}})
	if ov2.TotalTvlUSD != nil || ov2.TvlProvenance != "unavailable" {
		t.Fatalf("empty-TVL provenance wrong: %v %s", ov2.TotalTvlUSD, ov2.TvlProvenance)
	}
}

// TestBuildDefiFlows verifies the hub topology + honesty flag: Lux is the hub, one
// arc per non-hub native + one per external counterparty, native weights reflect
// real txns (realFlow), externals are modeled, and the envelope is modeled:true.
func TestBuildDefiFlows(t *testing.T) {
	m := map[string]chainMetric{"zoo": {TotalTxns: 12323}, "hanzo": {TotalTxns: 10}}
	fl := (&Server{}).buildDefiFlows(m)
	if !fl.Modeled || fl.HubSlug != "lux" {
		t.Fatalf("flows envelope wrong: modeled=%v hub=%s", fl.Modeled, fl.HubSlug)
	}
	wantFlows := (len(nativeChains) - 1) + len(bridgeCounterparties)
	if len(fl.Flows) != wantFlows {
		t.Fatalf("flows=%d want %d", len(fl.Flows), wantFlows)
	}
	// Sorted by weight desc.
	for i := 1; i < len(fl.Flows); i++ {
		if fl.Flows[i-1].Weight < fl.Flows[i].Weight {
			t.Fatalf("flows not weight-sorted at %d", i)
		}
	}
	// Every arc originates at the hub; native arcs with txns>0 are realFlow.
	for _, f := range fl.Flows {
		if f.FromSlug != "lux" {
			t.Fatalf("flow not from hub: %+v", f)
		}
		if f.ToSlug == "zoo" && !f.RealFlow {
			t.Fatalf("zoo arc has real txns but realFlow=false")
		}
	}
}

// TestDefiRate covers the sampler: no baseline → nil (honest "unknown"); a seeded
// older baseline → a real, positive rate from the counter delta.
func TestDefiRate(t *testing.T) {
	const slug = "test-rate-chain"
	defiSampleMu.Lock()
	delete(defiSamples, slug)
	defiSampleMu.Unlock()

	if tps, bt := defiRate(slug, 1000, 500); tps != nil || bt != nil {
		t.Fatalf("first sample must be nil,nil; got %v,%v", tps, bt)
	}
	// Seed a baseline 10s in the past, then a delta of +50 txns / +5 blocks.
	defiSampleMu.Lock()
	defiSamples[slug] = defiSample{txns: 1000, blocks: 500, at: time.Now().Add(-10 * time.Second)}
	defiSampleMu.Unlock()
	tps, bt := defiRate(slug, 1050, 505)
	if tps == nil || *tps <= 0 {
		t.Fatalf("expected positive tps, got %v", tps)
	}
	if bt == nil || *bt <= 0 {
		t.Fatalf("expected positive block time, got %v", bt)
	}
}

// TestDefiChainsMockExplorer exercises the FULL real fetch path (getJSON stats +
// blocks, postJSON amm TVL) against a deterministic mock explorer, proving the BFF
// surfaces real numbers where present and honest nulls where absent, and never 5xxes.
func TestDefiChainsMockExplorer(t *testing.T) {
	explorer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := r.URL.Path
		w.Header().Set("Content-Type", "application/json")
		switch {
		case strings.HasSuffix(p, "/stats") && strings.Contains(p, "/cchain/"):
			w.Write([]byte(`{"total_blocks":"1096462","total_transactions":"20618","total_addresses":"67","total_gas_used":"143453881629"}`))
		case strings.HasSuffix(p, "/blocks") && strings.Contains(p, "/cchain/"):
			w.Write([]byte(`{"items":[{"height":1096461}]}`))
		case strings.HasSuffix(p, "/graphql") && strings.Contains(p, "/cchain/"):
			// cchain returns a real positive TVL → provenance must flip to explorer-amm.
			w.Write([]byte(`{"data":{"factories":[{"totalValueLockedUSD":"42000.5"}]}}`))
		case strings.HasSuffix(p, "/stats"):
			w.Write([]byte(`{"total_blocks":"0","total_transactions":"0"}`)) // other chains: empty
		default:
			w.Write([]byte(`{}`))
		}
	}))
	t.Cleanup(explorer.Close)
	t.Setenv("EXPLORER_BASE", explorer.URL)

	s := NewServer()
	mux := http.NewServeMux()
	s.Mount(mux)
	ts := httptest.NewServer(mux)
	t.Cleanup(ts.Close)

	resp, err := http.Get(ts.URL + "/v1/world/defi/chains")
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("want 200 got %d", resp.StatusCode)
	}
	var out defiChainsResp
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if out.ChainCount != len(nativeChains)+len(bridgeCatalog) {
		t.Fatalf("chainCount=%d", out.ChainCount)
	}
	var lux *defiChainRow
	for i := range out.Chains {
		if out.Chains[i].Slug == "lux" {
			lux = &out.Chains[i]
			break
		}
	}
	if lux == nil || !lux.Live {
		t.Fatalf("lux row missing or not live: %+v", lux)
	}
	if lux.BlockHeight == nil || *lux.BlockHeight != 1096461 {
		t.Fatalf("lux blockHeight wrong: %v", lux.BlockHeight)
	}
	if lux.Txns == nil || *lux.Txns != 20618 {
		t.Fatalf("lux txns wrong: %v", lux.Txns)
	}
	if lux.TvlUSD == nil || *lux.TvlUSD != 42000.5 {
		t.Fatalf("lux tvl not surfaced from amm: %v", lux.TvlUSD)
	}
	if out.TvlProvenance != "explorer-amm" {
		t.Fatalf("provenance=%s want explorer-amm", out.TvlProvenance)
	}
}

// TestDefiRoutesRegistered asserts the four DeFi routes enumerate in Routes().
func TestDefiRoutesRegistered(t *testing.T) {
	want := map[string]bool{
		"/v1/world/defi/overview": false, "/v1/world/defi/chains": false,
		"/v1/world/defi/flows": false, "/v1/world/defi/protocols": false,
	}
	for _, p := range NewServer().Routes() {
		if _, ok := want[p]; ok {
			want[p] = true
		}
	}
	for p, seen := range want {
		if !seen {
			t.Fatalf("route %q not registered", p)
		}
	}
}
