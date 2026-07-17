package world

import (
	"context"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"sync"
	"time"
)

// DeFi dashboard BFF — the data plane behind world.hanzo.ai's crypto→DeFi variant
// (a DefiLlama-shaped board over Lux's OWN chains + the bridge-supported universe).
// Three public, unauthenticated, same-origin routes, all cached + never-5xx like
// the rest of /v1/world/*:
//
//	GET /v1/world/defi/overview   → totals + top chains + honest provenance
//	GET /v1/world/defi/chains     → the full merged catalog (native + 184 bridge)
//	GET /v1/world/defi/flows      → bridge-flow arcs for the globe (modeled)
//	GET /v1/world/defi/protocols  → top AMM pools where the explorer has them
//
// Sources (sovereign — no external DefiLlama dependency for our own chains):
//   - explorer.lux.network  /v1/indexer/{slug}/stats + /blocks (REAL: block
//     height, total txns, addresses) and /v1/graph/{slug}/amm (USD TVL IF the
//     subgraph populates it — today it does not, so TVL is honestly null).
//   - the embedded 184-chain bridge catalog (identity only; bridge-supported).
//
// Honesty contract: every USD figure the explorer hardcodes to null STAYS null
// here (tvlProvenance says so); TPS + block time are COMPUTED from real counter
// deltas (nil until a baseline exists) — never invented.

// defiChainTimeout bounds each chain's explorer fetch. Longer than the cloud-map
// perChainTimeout (4s) because Lux C-Chain's /stats over ~1.1M indexed blocks can
// take several seconds cold; still well inside cachedJSON's 24s request deadline.
const defiChainTimeout = 9 * time.Second

// defiExplorerBase is the explorer REST/GraphQL origin. Override with EXPLORER_BASE.
func defiExplorerBase() string {
	if b := env("EXPLORER_BASE", "LUX_EXPLORER_BASE"); b != "" {
		return trimSlash(b)
	}
	return "https://explorer.lux.network"
}

// defiGraphHosts is the exact-host allowlist for the amm GraphQL POST (postJSON's
// SSRF boundary) — derived from defiExplorerBase so there is one source of truth.
func defiGraphHosts() map[string]bool {
	m := map[string]bool{}
	if u, err := url.Parse(defiExplorerBase()); err == nil && u.Hostname() != "" {
		m[u.Hostname()] = true
	}
	return m
}

// ── live metrics (per native chain) ──────────────────────────────────────────

// chainMetric is the real, per-chain telemetry overlaid on a native catalog row.
// Pointer fields are null when we cannot honestly compute them (no baseline yet /
// upstream absent) so the wire carries null, never a fabricated zero.
type chainMetric struct {
	Live        bool
	BlockHeight int64
	TotalTxns   int64
	TotalBlocks int64
	Addresses   int64
	GasUsed     int64
	TPS         *float64
	BlockTime   *float64
	TvlUSD      *float64
}

// defiSample + defiRate: the TPS / block-time sampler. Real sustained rates come
// from the delta of the explorer's monotonic counters between two samples ≥ a real
// interval apart. The baseline only advances every ~20s so frequent collections
// (two endpoints on a cold cache) can't collapse dt into a noisy/zero rate.
type defiSample struct {
	txns, blocks int64
	at           time.Time
}

var (
	defiSampleMu sync.Mutex
	defiSamples  = map[string]defiSample{}
)

func defiRate(slug string, txns, blocks int64) (tps, blockTime *float64) {
	defiSampleMu.Lock()
	defer defiSampleMu.Unlock()
	now := time.Now()
	prev, ok := defiSamples[slug]
	if !ok {
		defiSamples[slug] = defiSample{txns, blocks, now}
		return nil, nil
	}
	dt := now.Sub(prev.at).Seconds()
	if dt >= 1 {
		if d := txns - prev.txns; d >= 0 {
			v := round2s(float64(d) / dt)
			tps = &v
		}
		if d := blocks - prev.blocks; d > 0 {
			v := round2s(dt / float64(d))
			blockTime = &v
		}
	}
	if dt >= 20 { // refresh the baseline only after a real interval
		defiSamples[slug] = defiSample{txns, blocks, now}
	}
	return
}

// collectDefiMetrics fetches real telemetry for every native chain in parallel,
// each bounded by perChainTimeout so one unreachable chain can't stall the board.
// Never errors — an unreachable chain simply stays Live:false with zeroed counts.
func (s *Server) collectDefiMetrics(ctx context.Context) map[string]chainMetric {
	out := make([]chainMetric, len(nativeChains))
	var wg sync.WaitGroup
	for i, nc := range nativeChains {
		wg.Add(1)
		go func(i int, nc nativeChain) {
			defer wg.Done()
			cctx, cancel := context.WithTimeout(ctx, defiChainTimeout)
			defer cancel()
			out[i] = s.fetchDefiChain(cctx, nc)
		}(i, nc)
	}
	wg.Wait()
	m := make(map[string]chainMetric, len(nativeChains))
	for i, nc := range nativeChains {
		m[nc.Slug] = out[i]
	}
	return m
}

// fetchDefiChain reads one native chain's real metrics from the explorer, degrading
// each field independently. Stats (counts) + latest-block (height) are the liveness
// signal; TPS/block time come from the sampler; TVL is best-effort from the amm
// subgraph and stays nil unless it returns a real positive USD figure.
func (s *Server) fetchDefiChain(ctx context.Context, nc nativeChain) chainMetric {
	base := defiExplorerBase()
	var m chainMetric

	var stats struct {
		TotalBlocks       string `json:"total_blocks"`
		TotalTransactions string `json:"total_transactions"`
		TotalAddresses    string `json:"total_addresses"`
		TotalGasUsed      string `json:"total_gas_used"`
	}
	if err := s.getJSON(ctx, base+"/v1/indexer/"+nc.ExplorerSlug+"/stats", nil, &stats); err == nil {
		if stats.TotalBlocks != "" || stats.TotalTransactions != "" {
			m.Live = true
			m.TotalBlocks = atoi64(stats.TotalBlocks)
			m.TotalTxns = atoi64(stats.TotalTransactions)
			m.Addresses = atoi64(stats.TotalAddresses)
			m.GasUsed = atoi64(stats.TotalGasUsed)
			m.TPS, m.BlockTime = defiRate(nc.Slug, m.TotalTxns, m.TotalBlocks)
		}
	}

	// True head height (total_blocks is a row count, not guaranteed == height).
	var blocks struct {
		Items []struct {
			Height int64 `json:"height"`
		} `json:"items"`
	}
	if err := s.getJSON(ctx, base+"/v1/indexer/"+nc.ExplorerSlug+"/blocks?items_count=1", nil, &blocks); err == nil && len(blocks.Items) > 0 {
		m.BlockHeight = blocks.Items[0].Height
		if m.BlockHeight > 0 {
			m.Live = true
		}
	}

	// Real USD TVL, best-effort: the amm subgraph's factory aggregate. Today the
	// subgraph leaves totalValueLockedUSD empty, so this stays nil — honest, not 0.
	if nc.HasAMM {
		if tvl, ok := s.fetchAMMTvl(ctx, base, nc.ExplorerSlug); ok {
			m.TvlUSD = &tvl
		}
	}
	return m
}

// fetchAMMTvl POSTs the amm subgraph for the factory USD aggregate. ok=false on any
// error OR an empty/non-positive value (the current reality) — so USD TVL is never
// dressed up from an unpopulated column.
func (s *Server) fetchAMMTvl(ctx context.Context, base, slug string) (float64, bool) {
	var resp struct {
		Data struct {
			Factories []struct {
				TotalValueLockedUSD string `json:"totalValueLockedUSD"`
			} `json:"factories"`
		} `json:"data"`
	}
	body := map[string]string{"query": "{ factories(first:1){ totalValueLockedUSD } }"}
	if err := s.postJSON(ctx, base+"/v1/graph/"+slug+"/amm/graphql", defiGraphHosts(), body, &resp); err != nil {
		return 0, false
	}
	if len(resp.Data.Factories) == 0 {
		return 0, false
	}
	v, err := strconv.ParseFloat(resp.Data.Factories[0].TotalValueLockedUSD, 64)
	if err != nil || v <= 0 {
		return 0, false
	}
	return v, true
}

// atoi64 parses a decimal counter string ("20618") to int64; 0 on any failure.
func atoi64(s string) int64 {
	n, err := strconv.ParseInt(s, 10, 64)
	if err != nil {
		return 0
	}
	return n
}

// ── wire types ───────────────────────────────────────────────────────────────

type defiChainRow struct {
	Slug        string   `json:"slug"`
	Name        string   `json:"name"`
	Symbol      string   `json:"symbol"`
	Logo        string   `json:"logo"`
	Explorer    string   `json:"explorer,omitempty"`
	ChainID     int64    `json:"chainId,omitempty"`
	Native      bool     `json:"native"`
	Bridge      bool     `json:"bridge"`
	Live        bool     `json:"live"`
	BlockHeight *int64   `json:"blockHeight"`
	Txns        *int64   `json:"txns"`
	Addresses   *int64   `json:"addresses"`
	TPS         *float64 `json:"tps"`
	BlockTime   *float64 `json:"blockTime"`
	TvlUSD      *float64 `json:"tvlUsd"`
	Status      string   `json:"status,omitempty"`
	Tags        []string `json:"tags,omitempty"`
}

type defiChainsResp struct {
	UpdatedAt     string         `json:"updatedAt"`
	ChainCount    int            `json:"chainCount"`
	NativeCount   int            `json:"nativeCount"`
	BridgeCount   int            `json:"bridgeCount"`
	LiveCount     int            `json:"liveCount"`
	MetricsSource string         `json:"metricsSource"`
	TvlProvenance string         `json:"tvlProvenance"`
	Chains        []defiChainRow `json:"chains"`
}

// buildChainRows merges the native set (with live metrics) and the 184 bridge
// catalog (identity only) into the ordered board rows. Native chains lead, sorted
// by real transactions desc; the bridge universe follows, alphabetical.
func buildChainRows(m map[string]chainMetric) (rows []defiChainRow, live int) {
	natives := make([]defiChainRow, 0, len(nativeChains))
	for _, nc := range nativeChains {
		cm := m[nc.Slug]
		row := defiChainRow{
			Slug: nc.Slug, Name: nc.Name, Symbol: nc.Symbol, Logo: "",
			Explorer: nc.ExplorerURL, ChainID: nc.ChainID, Native: true, Bridge: true,
			Live: cm.Live, Status: "active",
		}
		if cm.Live {
			live++
			row.BlockHeight = ptrIf(cm.BlockHeight, cm.BlockHeight > 0)
			row.Txns = ptr64(cm.TotalTxns)
			row.Addresses = ptr64(cm.Addresses)
			row.TPS = cm.TPS
			row.BlockTime = cm.BlockTime
			row.TvlUSD = cm.TvlUSD
		}
		natives = append(natives, row)
	}
	sort.SliceStable(natives, func(i, j int) bool {
		return deref64(natives[i].Txns) > deref64(natives[j].Txns)
	})

	bridge := make([]defiChainRow, 0, len(bridgeCatalog))
	for _, c := range bridgeCatalog {
		bridge = append(bridge, defiChainRow{
			Slug: c.Slug, Name: c.Name, Symbol: c.Symbol, Logo: c.Logo,
			Explorer: c.Explorer, Native: false, Bridge: true, Live: false,
			Status: c.Status, Tags: c.Tags,
		})
	}
	return append(natives, bridge...), live
}

func (s *Server) handleDefiChains(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") || methodNotGet(w, r) {
		return
	}
	s.cachedJSON(
		w, "defi-chains", "public, max-age=30, s-maxage=30, stale-while-revalidate=120",
		30*time.Second, 5*time.Minute,
		func(ctx context.Context) (any, error) {
			rows, live := buildChainRows(s.collectDefiMetrics(ctx))
			return defiChainsResp{
				UpdatedAt: nowRFC(), ChainCount: len(rows), NativeCount: len(nativeChains),
				BridgeCount: len(bridgeCatalog), LiveCount: live,
				MetricsSource: defiExplorerBase(), TvlProvenance: tvlProvenance(rows),
				Chains: rows,
			}, nil
		},
		func(w http.ResponseWriter, _ error) {
			rows, _ := buildChainRows(nil)
			writeJSON(w, http.StatusOK, "", defiChainsResp{
				UpdatedAt: nowRFC(), ChainCount: len(rows), NativeCount: len(nativeChains),
				BridgeCount: len(bridgeCatalog), MetricsSource: defiExplorerBase(),
				TvlProvenance: "unavailable", Chains: rows,
			})
		},
	)
}

// ── overview ─────────────────────────────────────────────────────────────────

type defiTopChain struct {
	Slug   string   `json:"slug"`
	Name   string   `json:"name"`
	Symbol string   `json:"symbol"`
	Txns   int64    `json:"txns"`
	TPS    *float64 `json:"tps"`
	TvlUSD *float64 `json:"tvlUsd"`
	Live   bool     `json:"live"`
}

type defiOverviewResp struct {
	UpdatedAt     string         `json:"updatedAt"`
	ChainCount    int            `json:"chainCount"`
	NativeCount   int            `json:"nativeCount"`
	BridgeCount   int            `json:"bridgeCount"`
	LiveCount     int            `json:"liveCount"`
	TotalTxns     int64          `json:"totalTxns"`
	TotalBlocks   int64          `json:"totalBlocks"`
	TotalAddrs    int64          `json:"totalAddresses"`
	AggregateTPS  *float64       `json:"aggregateTps"`
	TotalTvlUSD   *float64       `json:"totalTvlUsd"`
	Volume24hUSD  *float64       `json:"volume24hUsd"`
	MetricsSource string         `json:"metricsSource"`
	TvlProvenance string         `json:"tvlProvenance"`
	TopChains     []defiTopChain `json:"topChains"`
}

func (s *Server) handleDefiOverview(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") || methodNotGet(w, r) {
		return
	}
	s.cachedJSON(
		w, "defi-overview", "public, max-age=30, s-maxage=30, stale-while-revalidate=120",
		30*time.Second, 5*time.Minute,
		func(ctx context.Context) (any, error) {
			return s.buildDefiOverview(s.collectDefiMetrics(ctx)), nil
		},
		func(w http.ResponseWriter, _ error) {
			writeJSON(w, http.StatusOK, "", defiOverviewResp{
				UpdatedAt: nowRFC(), ChainCount: len(nativeChains) + len(bridgeCatalog),
				NativeCount: len(nativeChains), BridgeCount: len(bridgeCatalog),
				MetricsSource: defiExplorerBase(), TvlProvenance: "unavailable",
			})
		},
	)
}

func (s *Server) buildDefiOverview(m map[string]chainMetric) defiOverviewResp {
	out := defiOverviewResp{
		UpdatedAt: nowRFC(), ChainCount: len(nativeChains) + len(bridgeCatalog),
		NativeCount: len(nativeChains), BridgeCount: len(bridgeCatalog),
		MetricsSource: defiExplorerBase(),
	}
	var tpsSum, tvlSum float64
	var haveTPS, haveTVL bool
	tops := make([]defiTopChain, 0, len(nativeChains))
	for _, nc := range nativeChains {
		cm := m[nc.Slug]
		if cm.Live {
			out.LiveCount++
			out.TotalTxns += cm.TotalTxns
			out.TotalBlocks += cm.TotalBlocks
			out.TotalAddrs += cm.Addresses
		}
		if cm.TPS != nil {
			tpsSum += *cm.TPS
			haveTPS = true
		}
		if cm.TvlUSD != nil {
			tvlSum += *cm.TvlUSD
			haveTVL = true
		}
		tops = append(tops, defiTopChain{
			Slug: nc.Slug, Name: nc.Name, Symbol: nc.Symbol,
			Txns: cm.TotalTxns, TPS: cm.TPS, TvlUSD: cm.TvlUSD, Live: cm.Live,
		})
	}
	if haveTPS {
		v := round2s(tpsSum)
		out.AggregateTPS = &v
	}
	if haveTVL {
		v := round2s(tvlSum)
		out.TotalTvlUSD = &v
		out.TvlProvenance = "explorer-amm"
	} else {
		out.TvlProvenance = "unavailable" // explorer hardcodes USD TVL to null today
	}
	// 24h USD volume is not exposed by the explorer (transactions_today + market
	// fields are null) — honestly null rather than a fabricated figure.
	out.Volume24hUSD = nil

	sort.SliceStable(tops, func(i, j int) bool { return tops[i].Txns > tops[j].Txns })
	if len(tops) > 8 {
		tops = tops[:8]
	}
	out.TopChains = tops
	return out
}

// ── bridge flows (globe arcs) ────────────────────────────────────────────────

type defiFlow struct {
	FromSlug string  `json:"fromSlug"`
	ToSlug   string  `json:"toSlug"`
	FromLat  float64 `json:"fromLat"`
	FromLon  float64 `json:"fromLon"`
	ToLat    float64 `json:"toLat"`
	ToLon    float64 `json:"toLon"`
	Weight   float64 `json:"weight"`
	Label    string  `json:"label"`
	RealFlow bool    `json:"realFlow"` // weight is a real activity proxy vs a modeled base
}

type defiFlowsResp struct {
	UpdatedAt string     `json:"updatedAt"`
	Modeled   bool       `json:"modeled"`
	HubSlug   string     `json:"hubSlug"`
	Flows     []defiFlow `json:"flows"`
}

// bridgeCounterparty is a modeled globe position for a major external bridge
// endpoint. Chains have no geography, so these coordinates are illustrative — the
// envelope's modeled:true is the honest disclosure.
type bridgeCounterparty struct {
	slug, label string
	lat, lon    float64
	weight      float64 // modeled base weight for the arc
}

var bridgeCounterparties = []bridgeCounterparty{
	{"ethereum", "Ethereum", 41.0, -74.0, 0.85},
	{"bitcoin", "Bitcoin", 45.0, -100.0, 0.80},
	{"solana", "Solana", 37.5, -122.0, 0.55},
	{"binance", "BNB Chain", 22.3, 114.2, 0.55},
	{"polygon", "Polygon", 19.0, 73.0, 0.45},
	{"arbitrum", "Arbitrum", 51.5, -0.1, 0.45},
	{"base", "Base", 30.3, -97.7, 0.40},
	{"avalanchec", "Avalanche", 43.6, -79.4, 0.38},
	{"optimism", "Optimism", 52.4, 4.9, 0.35},
}

func (s *Server) handleDefiFlows(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") || methodNotGet(w, r) {
		return
	}
	s.cachedJSON(
		w, "defi-flows", "public, max-age=60, s-maxage=60, stale-while-revalidate=240",
		60*time.Second, 5*time.Minute,
		func(ctx context.Context) (any, error) {
			return s.buildDefiFlows(s.collectDefiMetrics(ctx)), nil
		},
		func(w http.ResponseWriter, _ error) {
			writeJSON(w, http.StatusOK, "", s.buildDefiFlows(nil))
		},
	)
}

// buildDefiFlows arcs the Lux hub to every counterparty. Native counterparties are
// weighted by REAL relative transactions (realFlow:true); external majors carry a
// modeled base weight. modeled:true covers the modeled positions + external weights.
func (s *Server) buildDefiFlows(m map[string]chainMetric) defiFlowsResp {
	hub := luxHub()
	flows := make([]defiFlow, 0, len(nativeChains)+len(bridgeCounterparties))

	var maxTxns int64 = 1
	for _, nc := range nativeChains {
		if nc.Hub {
			continue
		}
		if t := m[nc.Slug].TotalTxns; t > maxTxns {
			maxTxns = t
		}
	}
	for _, nc := range nativeChains {
		if nc.Hub {
			continue
		}
		txns := m[nc.Slug].TotalTxns
		w := 0.15 + 0.85*clampF(float64(txns)/float64(maxTxns), 0, 1)
		flows = append(flows, defiFlow{
			FromSlug: hub.Slug, ToSlug: nc.Slug,
			FromLat: hub.Lat, FromLon: hub.Lon, ToLat: nc.Lat, ToLon: nc.Lon,
			Weight: round2s(w), Label: hub.Symbol + " ⇄ " + nc.Symbol, RealFlow: txns > 0,
		})
	}
	for _, cp := range bridgeCounterparties {
		flows = append(flows, defiFlow{
			FromSlug: hub.Slug, ToSlug: cp.slug,
			FromLat: hub.Lat, FromLon: hub.Lon, ToLat: cp.lat, ToLon: cp.lon,
			Weight: round2s(cp.weight), Label: hub.Symbol + " ⇄ " + cp.label, RealFlow: false,
		})
	}
	sort.SliceStable(flows, func(i, j int) bool { return flows[i].Weight > flows[j].Weight })
	return defiFlowsResp{UpdatedAt: nowRFC(), Modeled: true, HubSlug: hub.Slug, Flows: flows}
}

// ── protocols (top AMM pools) ────────────────────────────────────────────────

type defiPool struct {
	Chain  string   `json:"chain"`
	Pair   string   `json:"pair"`
	Token0 string   `json:"token0"`
	Token1 string   `json:"token1"`
	TvlUSD *float64 `json:"tvlUsd"`
	VolUSD *float64 `json:"volUsd"`
}

type defiProtocolsResp struct {
	UpdatedAt     string     `json:"updatedAt"`
	MetricsSource string     `json:"metricsSource"`
	PoolCount     int        `json:"poolCount"`
	Pools         []defiPool `json:"pools"`
}

func (s *Server) handleDefiProtocols(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") || methodNotGet(w, r) {
		return
	}
	s.cachedJSON(
		w, "defi-protocols", "public, max-age=60, s-maxage=60, stale-while-revalidate=240",
		60*time.Second, 5*time.Minute,
		func(ctx context.Context) (any, error) {
			pools := s.collectDefiPools(ctx)
			return defiProtocolsResp{
				UpdatedAt: nowRFC(), MetricsSource: defiExplorerBase(),
				PoolCount: len(pools), Pools: pools,
			}, nil
		},
		func(w http.ResponseWriter, _ error) {
			writeJSON(w, http.StatusOK, "", defiProtocolsResp{
				UpdatedAt: nowRFC(), MetricsSource: defiExplorerBase(), Pools: []defiPool{},
			})
		},
	)
}

// collectDefiPools queries each amm chain for its top pools. USD fields stay null
// where the subgraph leaves them empty (today's reality) — the pair identity is
// real; the numbers are shown only when real.
func (s *Server) collectDefiPools(ctx context.Context) []defiPool {
	base := defiExplorerBase()
	out := make([]defiPool, 0, 24)
	for _, nc := range nativeChains {
		if !nc.HasAMM {
			continue
		}
		cctx, cancel := context.WithTimeout(ctx, defiChainTimeout)
		var resp struct {
			Data struct {
				Pools []struct {
					Token0 struct {
						Symbol string `json:"symbol"`
					} `json:"token0"`
					Token1 struct {
						Symbol string `json:"symbol"`
					} `json:"token1"`
					TotalValueLockedUSD string `json:"totalValueLockedUSD"`
					VolumeUSD           string `json:"volumeUSD"`
				} `json:"pools"`
			} `json:"data"`
		}
		body := map[string]string{"query": "{ pools(first:8, orderBy: totalValueLockedUSD, orderDirection: desc){ token0{ symbol } token1{ symbol } totalValueLockedUSD volumeUSD } }"}
		err := s.postJSON(cctx, base+"/v1/graph/"+nc.ExplorerSlug+"/amm/graphql", defiGraphHosts(), body, &resp)
		cancel()
		if err != nil {
			continue
		}
		for _, p := range resp.Data.Pools {
			t0, t1 := normSymbol(p.Token0.Symbol), normSymbol(p.Token1.Symbol)
			if t0 == "" && t1 == "" {
				continue
			}
			out = append(out, defiPool{
				Chain: nc.Name, Pair: t0 + "/" + t1, Token0: t0, Token1: t1,
				TvlUSD: parsePosUSD(p.TotalValueLockedUSD), VolUSD: parsePosUSD(p.VolumeUSD),
			})
		}
	}
	return out
}

// ── small helpers ────────────────────────────────────────────────────────────

func tvlProvenance(rows []defiChainRow) string {
	for _, r := range rows {
		if r.TvlUSD != nil {
			return "explorer-amm"
		}
	}
	return "unavailable"
}

func parsePosUSD(s string) *float64 {
	v, err := strconv.ParseFloat(s, 64)
	if err != nil || v <= 0 {
		return nil
	}
	r := round2s(v)
	return &r
}

func ptr64(v int64) *int64 { return &v }

func ptrIf(v int64, ok bool) *int64 {
	if !ok {
		return nil
	}
	return &v
}

func deref64(p *int64) int64 {
	if p == nil {
		return 0
	}
	return *p
}
