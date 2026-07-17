package world

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Public Cloud MAP data — the three globe layers the signed-out world.hanzo.ai
// map renders: public-chain nodes, the BYO-GPU fleet, and request-traffic arcs.
// Same contracts as the rest of the Cloud excitement layer (handlers_cloud.go /
// handlers_cloud_public.go):
//   - never 5xx: any upstream failure degrades to a clean 200 body,
//   - honesty: real telemetry when reachable; anything modeled/demo carries an
//     explicit flag (demo:true / positionsModeled:true) — never silently faked,
//   - short-TTL in-memory cache via cachedJSON, CORS preflight + methodNotGet.

// ── SSRF boundary + JSON-RPC POST helper ─────────────────────────────────────
//
// getJSON only does GET. The public-chain layer POSTs JSON-RPC to the L1 nodes,
// so postJSON is the GET-twin for POST. Every destination host is re-validated
// against an exact-host allowlist before dialing — the SSRF guard for the one
// fetch path that reaches hosts outside the hanzo.ai family. The allowlist is
// derived from the chain catalog so registering a network auto-allows its host
// (one source of truth).
var chainRPCHosts = func() map[string]bool {
	m := map[string]bool{}
	add := func(raw string) {
		if raw == "" {
			return
		}
		if u, err := url.Parse(raw); err == nil && u.Hostname() != "" {
			m[u.Hostname()] = true
		}
	}
	for _, cn := range chainNetworks {
		add(cn.host)    // primary RPC / API host (and Bitcoin's height host)
		add(cn.altHost) // failover host (e.g. rpc.hanzo.network)
	}
	return m
}()

// postJSON POSTs a JSON body to rawURL and decodes the 2xx JSON response into v.
// rawURL's host MUST be in allowed (SSRF boundary). A non-2xx status is an error,
// mirroring getJSON's "success or fail" contract.
func (s *Server) postJSON(ctx context.Context, rawURL string, allowed map[string]bool, body, v any) error {
	u, err := url.Parse(rawURL)
	if err != nil {
		return err
	}
	if !allowed[u.Hostname()] {
		return fmt.Errorf("host not allowed: %s", u.Hostname())
	}
	buf, err := json.Marshal(body)
	if err != nil {
		return err
	}
	b, status, err := s.do(ctx, http.MethodPost, rawURL, map[string]string{"Content-Type": "application/json"}, buf)
	if err != nil {
		return err
	}
	if status < 200 || status >= 300 {
		return fmt.Errorf("upstream status %d", status)
	}
	return json.Unmarshal(b, v)
}

// jsonRPCReq is the request envelope for both the info API (info.peers, params {})
// and the C-Chain EVM (eth_*, params []). Params is `any` so each caller supplies
// the shape the method expects.
type jsonRPCReq struct {
	JSONRPC string `json:"jsonrpc"`
	ID      int    `json:"id"`
	Method  string `json:"method"`
	Params  any    `json:"params"`
}

// ── 1) chain-nodes: public L1 telemetry + modeled node positions ─────────────
//
// Real telemetry (per network, from its public API, luxfi/node):
//   - peers:       POST /ext/info  info.peers  → result.numPeers / len(result.peers)
//   - blockHeight: POST /ext/bc/C/rpc  eth_blockNumber (hex)
//   - chainId:     POST /ext/bc/C/rpc  eth_chainId (hex) — verifies the catalog default
// live:true only when eth_blockNumber actually returned a height. An unreachable
// network keeps its catalog identity but reports zero counts + live:false — never
// an invented height.
//
// nodes[] positions are MODELED: real per-node IP geolocation needs an IP-geo
// dependency we don't carry, so the real peer COUNT is spread deterministically
// across the regionCatalog() catalog coords. positionsModeled:true says so plainly.

const maxModeledNodes = 250

// perChainTimeout bounds each network's telemetry fetch so one unreachable chain
// (e.g. an L1 whose public RPC is down) can't stall the whole chain-nodes
// response. Live chains answer in well under a second; a dead host is dialed for
// at most this long, then honestly reported live:false. Without it, an
// unreachable host hangs until the request-wide deadline (~24s) and the Chains /
// Cloud-Overview widgets sit on a loading spinner for that whole time.
const perChainTimeout = 4 * time.Second

// chainKind selects how a network's live head is read. Each kind is a distinct,
// self-contained fetch strategy so adding a network is a data change (one catalog
// row), never new branching at the call site.
type chainKind int

const (
	// chainLuxNode: luxfi/node — POST /ext/info (info.peers) + /ext/bc/C/rpc
	// (eth_blockNumber / eth_chainId). Lux, Zoo, Hanzo.
	chainLuxNode chainKind = iota
	// chainEVM: a public EVM JSON-RPC endpoint — POST eth_blockNumber /
	// eth_chainId directly at host (no /ext/* path, no peer visibility). Ethereum.
	chainEVM
	// chainBitcoin: GET a plain-integer block-height URL (host+heightPath). Bitcoin.
	chainBitcoin
)

type chainNet struct {
	id, name, host string
	chainID        int64     // catalog default; overridden by a live eth_chainId
	kind           chainKind // how the live head is read (default chainLuxNode)
	altHost        string    // failover host tried when host yields no height (luxnode)
	heightPath     string    // path appended to host for a plain-integer height (bitcoin)
}

// chainNetworks is the public-chain catalog. Adding a row here also registers its
// host(s) in chainRPCHosts (the SSRF allowlist). The first three run luxfi/node
// (our own L1s); Ethereum and Bitcoin are public reference chains read live from
// an exact-host-allowlisted public endpoint. An unreachable network keeps its
// catalog identity and honestly reports live:false with zero counts — never an
// invented height.
var chainNetworks = []chainNet{
	{id: "lux", name: "Lux Network", host: "https://api.lux.network", chainID: 96369, kind: chainLuxNode},
	{id: "zoo", name: "Zoo Network", host: "https://api.zoo.network", chainID: 0, kind: chainLuxNode},
	{id: "hanzo", name: "Hanzo Network", host: "https://api.hanzo.network", altHost: "https://rpc.hanzo.network", chainID: 0, kind: chainLuxNode},
	{id: "ethereum", name: "Ethereum", host: "https://ethereum-rpc.publicnode.com", chainID: 1, kind: chainEVM},
	{id: "bitcoin", name: "Bitcoin", host: "https://blockchain.info", heightPath: "/q/getblockcount", chainID: 0, kind: chainBitcoin},
}

type chainNode struct {
	Lat  float64 `json:"lat"`
	Lon  float64 `json:"lon"`
	City string  `json:"city"`
	Kind string  `json:"kind"`
}

type chainNetwork struct {
	ID          string      `json:"id"`
	Name        string      `json:"name"`
	ChainID     int64       `json:"chainId"`
	BlockHeight int64       `json:"blockHeight"`
	Peers       int         `json:"peers"`
	Live        bool        `json:"live"`
	Nodes       []chainNode `json:"nodes"`
}

type chainNodes struct {
	UpdatedAt        string         `json:"updatedAt"`
	PositionsModeled bool           `json:"positionsModeled"`
	Networks         []chainNetwork `json:"networks"`
}

func (s *Server) handleCloudChainNodes(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") || methodNotGet(w, r) {
		return
	}
	s.cachedJSON(w, "cloud-chain-nodes", "public, max-age=15, s-maxage=15, stale-while-revalidate=60",
		15*time.Second, 5*time.Minute,
		func(ctx context.Context) (any, error) {
			nets := make([]chainNetwork, len(chainNetworks))
			var wg sync.WaitGroup
			for i, cn := range chainNetworks {
				wg.Add(1)
				go func(i int, cn chainNet) {
					defer wg.Done()
					cctx, cancel := context.WithTimeout(ctx, perChainTimeout)
					defer cancel()
					nets[i] = s.fetchChainNetwork(cctx, cn)
				}(i, cn)
			}
			wg.Wait()
			return chainNodes{UpdatedAt: nowRFC(), PositionsModeled: true, Networks: nets}, nil
		},
		func(w http.ResponseWriter, _ error) {
			// produce never errors; keep the never-5xx guarantee explicit.
			writeJSON(w, http.StatusOK, "", chainNodes{UpdatedAt: nowRFC(), PositionsModeled: true, Networks: []chainNetwork{}})
		},
	)
}

// fetchChainNetwork gathers real telemetry for one network by its kind, degrading
// each field independently: any failed call leaves its field at zero (and
// live:false when the block height is unavailable). It never returns an error.
func (s *Server) fetchChainNetwork(ctx context.Context, cn chainNet) chainNetwork {
	switch cn.kind {
	case chainEVM:
		return s.fetchEVMChain(ctx, cn)
	case chainBitcoin:
		return s.fetchBitcoinChain(ctx, cn)
	default:
		return s.fetchLuxNodeChain(ctx, cn)
	}
}

// fetchLuxNodeChain reads a luxfi/node L1 (peers + block height + chainId). It
// tries host, then altHost if the primary yields no height, so a failover RPC
// keeps the network live. peers feed the modeled globe layer.
func (s *Server) fetchLuxNodeChain(ctx context.Context, cn chainNet) chainNetwork {
	out := chainNetwork{ID: cn.id, Name: cn.name, ChainID: cn.chainID}
	hosts := []string{cn.host}
	if cn.altHost != "" {
		hosts = append(hosts, cn.altHost)
	}
	for _, host := range hosts {
		s.fillLuxNode(ctx, host, &out)
		if out.Live {
			break // got a head block from this host; no need to try the failover
		}
	}
	out.Nodes = modeledNodes(out.Peers)
	return out
}

// fillLuxNode populates peers/blockHeight/chainId from one luxfi/node host,
// leaving any field that fails at its current value (additive across hosts).
func (s *Server) fillLuxNode(ctx context.Context, host string, out *chainNetwork) {
	info := host + "/ext/info"
	rpc := host + "/ext/bc/C/rpc"

	// peers (info.peers) — real count of connected peers, when the info API is exposed.
	var pr struct {
		Result struct {
			NumPeers string            `json:"numPeers"`
			Peers    []json.RawMessage `json:"peers"`
		} `json:"result"`
	}
	if err := s.postJSON(ctx, info, chainRPCHosts,
		jsonRPCReq{JSONRPC: "2.0", ID: 1, Method: "info.peers", Params: struct{}{}}, &pr); err == nil {
		if n, e := strconv.Atoi(strings.TrimSpace(pr.Result.NumPeers)); e == nil && n >= 0 {
			out.Peers = n
		} else {
			out.Peers = len(pr.Result.Peers)
		}
	}

	// blockHeight (eth_blockNumber) — the definitive liveness signal.
	if h, ok := s.ethBlockNumber(ctx, rpc); ok {
		out.BlockHeight = h
		out.Live = true
	}

	// chainId (eth_chainId) — verify / override the catalog default with the real value.
	if id, ok := s.ethChainID(ctx, rpc); ok {
		out.ChainID = id
	}
}

// fetchEVMChain reads a public EVM JSON-RPC endpoint (Ethereum): eth_blockNumber
// for the live head and eth_chainId to confirm identity. We do not peer with
// public chains, so peers stays 0 (and the globe layer places no modeled nodes).
func (s *Server) fetchEVMChain(ctx context.Context, cn chainNet) chainNetwork {
	out := chainNetwork{ID: cn.id, Name: cn.name, ChainID: cn.chainID}
	if h, ok := s.ethBlockNumber(ctx, cn.host); ok {
		out.BlockHeight = h
		out.Live = true
	}
	if id, ok := s.ethChainID(ctx, cn.host); ok {
		out.ChainID = id
	}
	out.Nodes = modeledNodes(out.Peers) // peers==0 → empty (no invented positions)
	return out
}

// fetchBitcoinChain reads Bitcoin's live block height from a plain-integer GET
// endpoint (host+heightPath), SSRF-guarded by the same exact-host allowlist. No
// EVM chainId and no peer visibility — height alone is the liveness signal.
func (s *Server) fetchBitcoinChain(ctx context.Context, cn chainNet) chainNetwork {
	out := chainNetwork{ID: cn.id, Name: cn.name, ChainID: cn.chainID}
	txt, err := s.getAllowedText(ctx, cn.host+cn.heightPath, chainRPCHosts)
	if err == nil {
		if h, e := strconv.ParseInt(strings.TrimSpace(txt), 10, 64); e == nil && h > 0 {
			out.BlockHeight = h
			out.Live = true
		}
	}
	out.Nodes = modeledNodes(out.Peers) // peers==0 → empty slice (never a null nodes array)
	return out
}

// ethBlockNumber POSTs eth_blockNumber to an EVM RPC endpoint (SSRF-allowlisted)
// and returns the decoded height. ok=false on any failure or a non-positive head.
func (s *Server) ethBlockNumber(ctx context.Context, rpc string) (int64, bool) {
	var br struct {
		Result string `json:"result"`
	}
	if err := s.postJSON(ctx, rpc, chainRPCHosts,
		jsonRPCReq{JSONRPC: "2.0", ID: 1, Method: "eth_blockNumber", Params: []any{}}, &br); err != nil {
		return 0, false
	}
	if h, ok := parseHexInt(br.Result); ok && h > 0 {
		return h, true
	}
	return 0, false
}

// ethChainID POSTs eth_chainId to an EVM RPC endpoint (SSRF-allowlisted) and
// returns the decoded chain id. ok=false on any failure or a non-positive id.
func (s *Server) ethChainID(ctx context.Context, rpc string) (int64, bool) {
	var cr struct {
		Result string `json:"result"`
	}
	if err := s.postJSON(ctx, rpc, chainRPCHosts,
		jsonRPCReq{JSONRPC: "2.0", ID: 1, Method: "eth_chainId", Params: []any{}}, &cr); err != nil {
		return 0, false
	}
	if id, ok := parseHexInt(cr.Result); ok && id > 0 {
		return id, true
	}
	return 0, false
}

// getAllowedText GETs a plain-text body from an exact-host-allowlisted URL — the
// GET twin of postJSON's SSRF boundary, for the one non-JSON public source
// (Bitcoin's integer height). rawURL's host MUST be in allowed before dialing.
func (s *Server) getAllowedText(ctx context.Context, rawURL string, allowed map[string]bool) (string, error) {
	u, err := url.Parse(rawURL)
	if err != nil {
		return "", err
	}
	if !allowed[u.Hostname()] {
		return "", fmt.Errorf("host not allowed: %s", u.Hostname())
	}
	return s.getText(ctx, rawURL, map[string]string{"Accept": "text/plain, */*"})
}

// getAllowedJSON GETs and decodes a JSON body from an exact-host-allowlisted URL
// — the GET-JSON twin of postJSON's SSRF boundary. Used by the status-page proxy,
// whose upstream host is operator-configured (env). rawURL's host MUST be in
// allowed before dialing.
func (s *Server) getAllowedJSON(ctx context.Context, rawURL string, allowed map[string]bool, v any) error {
	u, err := url.Parse(rawURL)
	if err != nil {
		return err
	}
	if !allowed[u.Hostname()] {
		return fmt.Errorf("host not allowed: %s", u.Hostname())
	}
	return s.getJSON(ctx, rawURL, nil, v)
}

// modeledNodes spreads a real peer COUNT across the region catalog deterministically
// (proportional to each region's relative capacity, remainder round-robin). Positions
// and kind are modeled — hence positionsModeled:true on the envelope; only the count
// is real. Bounded to maxModeledNodes so a pathological peer count can't bloat the payload.
func modeledNodes(peers int) []chainNode {
	regions := regionCatalog()
	nodes := make([]chainNode, 0)
	if peers <= 0 || len(regions) == 0 {
		return nodes
	}
	if peers > maxModeledNodes {
		peers = maxModeledNodes
	}
	total := 0
	for _, rg := range regions {
		total += rg.Nodes
	}
	if total <= 0 {
		total = len(regions)
	}
	for _, rg := range regions {
		for j := 0; j < peers*rg.Nodes/total; j++ {
			nodes = append(nodes, chainNode{Lat: rg.Lat, Lon: rg.Lon, City: rg.City, Kind: "validator"})
		}
	}
	for i := len(nodes); i < peers; i++ {
		rg := regions[i%len(regions)]
		nodes = append(nodes, chainNode{Lat: rg.Lat, Lon: rg.Lon, City: rg.City, Kind: "validator"})
	}
	return nodes
}

// parseHexInt parses a 0x-prefixed hex string (eth_* result) into an int64.
func parseHexInt(s string) (int64, bool) {
	s = strings.TrimSpace(s)
	s = strings.TrimPrefix(s, "0x")
	s = strings.TrimPrefix(s, "0X")
	if s == "" {
		return 0, false
	}
	n, err := strconv.ParseInt(s, 16, 64)
	if err != nil {
		return 0, false
	}
	return n, true
}

// ── 2) byo-gpu: the GPU fleet placed on the globe ────────────────────────────
//
// Real path (service token, mirroring tryServicePulse): read the non-sensitive GPU
// inventory from api /v1/gpus (+ /v1/machines fallback), aggregate by region+model+
// status, and place each cluster with the region catalog's coords → demo:false.
// Without a token we return a small, clearly-flagged demo set (demo:true) built
// from the same catalog.

type gpuCluster struct {
	Lat    float64 `json:"lat"`
	Lon    float64 `json:"lon"`
	City   string  `json:"city"`
	Region string  `json:"region"`
	Model  string  `json:"model"`
	Count  int     `json:"count"`
	Status string  `json:"status"`
}

type byoGPU struct {
	UpdatedAt string       `json:"updatedAt"`
	Demo      bool         `json:"demo"`
	GPUs      []gpuCluster `json:"gpus"`
}

func (s *Server) handleCloudBYOGPU(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") || methodNotGet(w, r) {
		return
	}
	w.Header().Set("Vary", "Authorization")
	// Signed-in admin (z@hanzo.ai / the operator org): the REAL GPU fleet placed on
	// the globe, read with the caller's OWN bearer, never edge-cached. No fabricated
	// demo clusters for a signed-in operator — an empty read shows an empty globe.
	if bearer, ok := s.adminIdentity(r); ok {
		ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
		defer cancel()
		clusters, _ := s.tryRealGPUs(ctx, map[string]string{"Authorization": bearer})
		if clusters == nil {
			clusters = []gpuCluster{}
		}
		writeJSON(w, http.StatusOK, "private, no-store", byoGPU{UpdatedAt: nowRFC(), Demo: false, GPUs: clusters})
		return
	}
	s.cachedJSON(w, "cloud-byo-gpu", "public, max-age=30, s-maxage=30, stale-while-revalidate=120",
		30*time.Second, 5*time.Minute,
		func(ctx context.Context) (any, error) {
			if clusters, ok := s.tryRealGPUs(ctx, serviceAuth()); ok {
				return byoGPU{UpdatedAt: nowRFC(), Demo: false, GPUs: clusters}, nil
			}
			return byoGPU{UpdatedAt: nowRFC(), Demo: true, GPUs: demoGPUs()}, nil
		},
		func(w http.ResponseWriter, _ error) {
			writeJSON(w, http.StatusOK, "", byoGPU{UpdatedAt: nowRFC(), Demo: true, GPUs: demoGPUs()})
		},
	)
}

// tryRealGPUs reads the real GPU inventory using the supplied auth header (the KMS
// service bearer on the public path, or the caller's own admin bearer). Returns
// ok=false when auth is absent, both sources fail, or no GPU maps to a known region.
// Only non-sensitive fields (region/model/status) are read.
func (s *Server) tryRealGPUs(ctx context.Context, hdr map[string]string) ([]gpuCluster, bool) {
	if hdr == nil {
		return nil, false
	}
	base := apiHost()

	agg := map[string]*gpuCluster{}
	var order []string
	add := func(region, model, status string) {
		rg, ok := resolveRegion(region)
		if !ok {
			return // don't fake coords for an unmappable region
		}
		if strings.TrimSpace(model) == "" {
			model = "GPU"
		}
		if machineOnline(status) {
			status = "online"
		} else if strings.TrimSpace(status) == "" {
			status = "offline"
		}
		key := rg.ID + "|" + model + "|" + status
		c := agg[key]
		if c == nil {
			c = &gpuCluster{Lat: rg.Lat, Lon: rg.Lon, City: rg.City, Region: rg.ID, Model: model, Status: status}
			agg[key] = c
			order = append(order, key)
		}
		c.Count++
	}

	// Primary: /v1/gpus — one row per GPU (region, model, status), as handleCloudFleet reads.
	var gpus struct {
		Gpus []struct {
			Model  string `json:"model"`
			Region string `json:"region"`
			Status string `json:"status"`
		} `json:"gpus"`
	}
	_ = s.getJSON(ctx, base+"/v1/gpus", hdr, &gpus)
	for _, g := range gpus.Gpus {
		add(g.Region, g.Model, g.Status)
	}

	// Fallback: /v1/machines — BYO machines that report a GPU model but aren't in the pool.
	if len(order) == 0 {
		var machines struct {
			Machines []struct {
				Region string `json:"region"`
				Status string `json:"status"`
				GPU    string `json:"gpu"`
			} `json:"machines"`
		}
		if err := s.getJSON(ctx, base+"/v1/machines", hdr, &machines); err == nil {
			for _, m := range machines.Machines {
				if strings.TrimSpace(m.GPU) != "" {
					add(m.Region, m.GPU, m.Status)
				}
			}
		}
	}

	if len(order) == 0 {
		return nil, false
	}
	out := make([]gpuCluster, 0, len(order))
	for _, k := range order {
		out = append(out, *agg[k])
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Count > out[j].Count })
	return out, true
}

// demoGPUs is the flagged illustrative fleet, placed from the region catalog. It
// carries no live-looking precision — it exists to make the globe legible until a
// service token is wired.
func demoGPUs() []gpuCluster {
	coords := regionCoords()
	rows := []struct {
		region, model, status string
		count                 int
	}{
		{"nyc", "GB10", "online", 4},
		{"sfo", "H100", "online", 8},
		{"ams", "GB10", "online", 2},
		{"fra", "H200", "online", 4},
		{"lon", "GB10", "online", 2},
		{"sgp", "GB10", "online", 2},
		{"blr", "A100", "degraded", 6},
		{"syd", "GB10", "online", 1},
	}
	out := make([]gpuCluster, 0, len(rows))
	for _, r := range rows {
		rg := coords[r.region]
		out = append(out, gpuCluster{
			Lat: rg.Lat, Lon: rg.Lon, City: rg.City,
			Region: r.region, Model: r.model, Count: r.count, Status: r.status,
		})
	}
	return out
}

// ── 3) traffic: request arcs from visitor countries to the nearest region ────
//
// Real path (service token): read the visitor-COUNTRY breakdown from the same
// analytics source handleCloudAnalytics uses (analytics.hanzo.ai), arc each country
// centroid to the nearest catalog region, weight normalized 0..1 → demo:false.
// Only country counts are read — non-sensitive. If the source is admin-gated,
// tokenless, or unreachable, we fall back to the diurnal demo arcs (demo:true).

type trafficArc struct {
	FromLat float64 `json:"fromLat"`
	FromLon float64 `json:"fromLon"`
	ToLat   float64 `json:"toLat"`
	ToLon   float64 `json:"toLon"`
	Weight  float64 `json:"weight"`
	Label   string  `json:"label"`
}

type cloudTraffic struct {
	UpdatedAt string       `json:"updatedAt"`
	Demo      bool         `json:"demo"`
	Arcs      []trafficArc `json:"arcs"`
}

func (s *Server) handleCloudTraffic(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") || methodNotGet(w, r) {
		return
	}
	s.cachedJSON(w, "cloud-traffic", "public, max-age=20, s-maxage=20, stale-while-revalidate=90",
		20*time.Second, 5*time.Minute,
		func(ctx context.Context) (any, error) {
			if arcs, ok := s.tryRealTraffic(ctx); ok {
				return cloudTraffic{UpdatedAt: nowRFC(), Demo: false, Arcs: arcs}, nil
			}
			return demoTraffic(), nil
		},
		func(w http.ResponseWriter, _ error) {
			writeJSON(w, http.StatusOK, "", demoTraffic())
		},
	)
}

// ── native request-geo globe (points + throughput) ───────────────────────────
//
// The Hanzo-mode globe plots WHERE api.hanzo.ai traffic comes from, from the ai
// backend's OWN in-process aggregate (GET /v1/traffic/globe — public, aggregates
// only, no IPs). This same-origin proxy passes those points + totals through, and
// degrades to an HONEST EMPTY state (no points, zero rates) — never demo — because
// "no traffic recorded yet" is a real answer the UI should show truthfully.

type trafficGlobePoint struct {
	Country   string         `json:"country"`
	Region    string         `json:"region,omitempty"`
	Lat       float64        `json:"lat"`
	Lon       float64        `json:"lon"`
	Count     int            `json:"count"`
	ByService map[string]int `json:"byService"`
}

type trafficGlobeCountry struct {
	Country string `json:"country"`
	Count   int    `json:"count"`
}

type trafficGlobeTotals struct {
	RPS1m        float64               `json:"rps_1m"`
	RPM60m       float64               `json:"rpm_60m"`
	TopCountries []trafficGlobeCountry `json:"top_countries"`
}

type trafficGlobeWindow struct {
	Minutes int    `json:"minutes"`
	Since   string `json:"since"`
	Until   string `json:"until"`
}

type trafficGlobe struct {
	UpdatedAt string              `json:"updatedAt"`
	Live      bool                `json:"live"` // reached the native endpoint (even if 0 points)
	Window    trafficGlobeWindow  `json:"window"`
	Points    []trafficGlobePoint `json:"points"`
	Totals    trafficGlobeTotals  `json:"totals"`
}

// emptyGlobe is the honest zero payload: reachable-but-no-data and unreachable both
// render as an empty globe with zero throughput — we never fabricate traffic.
func emptyGlobe() trafficGlobe {
	return trafficGlobe{
		UpdatedAt: nowRFC(),
		Live:      false,
		Window:    trafficGlobeWindow{Minutes: 60},
		Points:    []trafficGlobePoint{},
		Totals:    trafficGlobeTotals{TopCountries: []trafficGlobeCountry{}},
	}
}

// fetchNativeGlobe reads the ai backend's public /v1/traffic/globe (no token) and
// unwraps the {status,data} envelope. ok=false when the endpoint is unreachable.
func (s *Server) fetchNativeGlobe(ctx context.Context, windowMin int) (trafficGlobe, bool) {
	url := apiHost() + "/v1/traffic/globe?window=" + strconv.Itoa(windowMin)
	var envlp struct {
		Data struct {
			Window trafficGlobeWindow  `json:"window"`
			Points []trafficGlobePoint `json:"points"`
			Totals trafficGlobeTotals  `json:"totals"`
		} `json:"data"`
	}
	if err := s.getJSON(ctx, url, nil, &envlp); err != nil {
		return trafficGlobe{}, false
	}
	g := trafficGlobe{
		UpdatedAt: nowRFC(),
		Live:      true,
		Window:    envlp.Data.Window,
		Points:    envlp.Data.Points,
		Totals:    envlp.Data.Totals,
	}
	if g.Points == nil {
		g.Points = []trafficGlobePoint{}
	}
	if g.Totals.TopCountries == nil {
		g.Totals.TopCountries = []trafficGlobeCountry{}
	}
	return g, true
}

// handleCloudTrafficGlobe serves the native request-geo aggregate. It never 5xxes:
// an unreachable backend degrades to the honest empty globe.
func (s *Server) handleCloudTrafficGlobe(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") || methodNotGet(w, r) {
		return
	}
	s.cachedJSON(w, "cloud-traffic-globe", "public, max-age=10, s-maxage=10, stale-while-revalidate=45",
		12*time.Second, 2*time.Minute,
		func(ctx context.Context) (any, error) {
			if g, ok := s.fetchNativeGlobe(ctx, 60); ok {
				return g, nil
			}
			return emptyGlobe(), nil
		},
		func(w http.ResponseWriter, _ error) {
			writeJSON(w, http.StatusOK, "", emptyGlobe())
		},
	)
}

// arcsFromGlobe turns native request-geo points into origin→nearest-region arcs, so
// the animated arc layer and the points layer share ONE source (native LB geo).
func arcsFromGlobe(g trafficGlobe) []trafficArc {
	maxC := 1
	for _, p := range g.Points {
		if p.Count > maxC {
			maxC = p.Count
		}
	}
	arcs := make([]trafficArc, 0, len(g.Points))
	for _, p := range g.Points {
		rg := nearestRegion(p.Lat, p.Lon)
		label := p.Country
		if p.Region != "" {
			label += "-" + p.Region
		}
		arcs = append(arcs, trafficArc{
			FromLat: p.Lat, FromLon: p.Lon, ToLat: rg.Lat, ToLon: rg.Lon,
			Weight: round2s(clampF(float64(p.Count)/float64(maxC), 0.05, 1)),
			Label:  label + " → " + rg.ID,
		})
	}
	sort.SliceStable(arcs, func(i, j int) bool { return arcs[i].Weight > arcs[j].Weight })
	if len(arcs) > 20 {
		arcs = arcs[:20]
	}
	return arcs
}

// tryRealTraffic builds arcs from the real visitor-country breakdown. ok=false (→
// demo) when tokenless, unreachable, or no country data. Reuses mergeMetric so the
// analytics fan-out lives in exactly one place.
func (s *Server) tryRealTraffic(ctx context.Context) ([]trafficArc, bool) {
	// Native LB request-geo first (public, no token): arcs from the real
	// /v1/traffic/globe points → nearest region — one source of truth with the
	// traffic-globe layer. The analytics fallback below runs only when the native
	// aggregate is empty (e.g. no traffic yet, or the ai release hasn't landed).
	if g, ok := s.fetchNativeGlobe(ctx, 60); ok && len(g.Points) > 0 {
		return arcsFromGlobe(g), true
	}
	tok := serviceToken()
	if tok == "" {
		return nil, false
	}
	base := env("HANZO_ANALYTICS_BASE")
	if base == "" {
		base = "https://analytics.hanzo.ai"
	}
	base = trimSlash(base)
	hdr := map[string]string{"Authorization": "Bearer " + tok}

	var sites struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := s.getJSON(ctx, base+"/v1/analytics/websites", hdr, &sites); err != nil || len(sites.Data) == 0 {
		return nil, false
	}
	end := time.Now()
	start := end.Add(-24 * time.Hour)
	q := "startAt=" + strconv.FormatInt(start.UnixMilli(), 10) + "&endAt=" + strconv.FormatInt(end.UnixMilli(), 10)

	countries := map[string]int64{}
	var mu sync.Mutex
	limit := len(sites.Data)
	if limit > 8 {
		limit = 8
	}
	for _, ws := range sites.Data[:limit] {
		mergeMetric(ctx, s, base, ws.ID, "country", q, hdr, countries, &mu)
	}
	if len(countries) == 0 {
		return nil, false
	}

	var maxCount int64 = 1
	for _, v := range countries {
		if v > maxCount {
			maxCount = v
		}
	}
	arcs := make([]trafficArc, 0, len(countries))
	for code, v := range countries {
		lat, lon, ok := centroidFor(code)
		if !ok {
			continue
		}
		rg := nearestRegion(lat, lon)
		arcs = append(arcs, trafficArc{
			FromLat: lat, FromLon: lon, ToLat: rg.Lat, ToLon: rg.Lon,
			Weight: round2s(clampF(float64(v)/float64(maxCount), 0, 1)),
			Label:  strings.ToUpper(code) + " → " + rg.ID,
		})
	}
	if len(arcs) == 0 {
		return nil, false
	}
	sort.SliceStable(arcs, func(i, j int) bool { return arcs[i].Weight > arcs[j].Weight })
	if len(arcs) > 20 {
		arcs = arcs[:20]
	}
	return arcs, true
}

// demoTraffic emits flagged arcs from major country centroids to their nearest
// region, weighted by a per-country base × the diurnal load curve (diurnalLoad) so
// the layer feels alive across refreshes without pretending to be live (demo:true).
func demoTraffic() cloudTraffic {
	now := time.Now().UTC()
	load := diurnalLoad(now)
	arcs := make([]trafficArc, 0, 16)
	for i, c := range countryCentroids {
		if i >= 16 { // 12–20 arcs; 16 keeps a lively-but-bounded set
			break
		}
		rg := nearestRegion(c.lat, c.lon)
		wobble := 1 + 0.06*math.Sin(float64(now.Unix()%600)/600*2*math.Pi+float64(i)*0.7)
		arcs = append(arcs, trafficArc{
			FromLat: c.lat, FromLon: c.lon, ToLat: rg.Lat, ToLon: rg.Lon,
			Weight: round2s(clampF(c.weight*load*wobble, 0.05, 1)),
			Label:  c.code + " → " + rg.ID,
		})
	}
	sort.SliceStable(arcs, func(i, j int) bool { return arcs[i].Weight > arcs[j].Weight })
	return cloudTraffic{UpdatedAt: now.Format(time.RFC3339), Demo: true, Arcs: arcs}
}

// countryCentroids is the small in-file centroid table (ISO 3166-1 alpha-2 → point)
// with a relative traffic base weight, used by both the real and demo traffic paths.
var countryCentroids = []struct {
	code     string
	lat, lon float64
	weight   float64
}{
	{"US", 39.50, -98.35, 0.95},
	{"IN", 22.00, 79.00, 0.70},
	{"JP", 36.20, 138.25, 0.60},
	{"DE", 51.16, 10.45, 0.62},
	{"GB", 54.00, -2.00, 0.58},
	{"SG", 1.35, 103.82, 0.55},
	{"CA", 56.13, -106.35, 0.50},
	{"FR", 46.60, 2.20, 0.50},
	{"KR", 36.50, 127.85, 0.48},
	{"BR", -10.00, -53.00, 0.45},
	{"NL", 52.13, 5.29, 0.42},
	{"MX", 23.63, -102.55, 0.40},
	{"AU", -25.00, 133.00, 0.40},
	{"ES", 40.00, -4.00, 0.40},
	{"AE", 23.42, 53.85, 0.38},
	{"IL", 31.05, 34.85, 0.34},
	{"SE", 62.20, 17.60, 0.32},
	{"ZA", -29.00, 24.00, 0.30},
	{"UA", 48.38, 31.17, 0.30},
	{"NG", 9.08, 8.68, 0.28},
}

func centroidFor(code string) (float64, float64, bool) {
	code = strings.ToUpper(strings.TrimSpace(code))
	for _, c := range countryCentroids {
		if c.code == code {
			return c.lat, c.lon, true
		}
	}
	return 0, 0, false
}

// ── shared geo / math helpers ────────────────────────────────────────────────

// regionCoords indexes the region catalog by its ID for O(1) coord lookup.
func regionCoords() map[string]cloudRegion {
	m := make(map[string]cloudRegion, 8)
	for _, rg := range regionCatalog() {
		m[rg.ID] = rg
	}
	return m
}

// resolveRegion maps an upstream region string ("nyc", "nyc3", "sfo1", …) to a
// catalog region by exact ID then prefix. Returns ok=false when it can't be placed
// (so we never invent coordinates).
func resolveRegion(region string) (cloudRegion, bool) {
	region = strings.ToLower(strings.TrimSpace(region))
	if region == "" {
		return cloudRegion{}, false
	}
	m := regionCoords()
	if rg, ok := m[region]; ok {
		return rg, true
	}
	for _, rg := range regionCatalog() { // ordered: match the highest-capacity region first
		if strings.HasPrefix(region, rg.ID) {
			return rg, true
		}
	}
	return cloudRegion{}, false
}

// nearestRegion returns the catalog region closest to (lat, lon) by great-circle
// distance. The catalog is non-empty (regionCatalog), so the first is a safe seed.
func nearestRegion(lat, lon float64) cloudRegion {
	regions := regionCatalog()
	best := regions[0]
	bestD := math.Inf(1)
	for _, rg := range regions {
		if d := haversineKm(lat, lon, rg.Lat, rg.Lon); d < bestD {
			bestD, best = d, rg
		}
	}
	return best
}

func haversineKm(lat1, lon1, lat2, lon2 float64) float64 {
	const r = 6371.0
	const rad = math.Pi / 180
	dLat := (lat2 - lat1) * rad
	dLon := (lon2 - lon1) * rad
	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(lat1*rad)*math.Cos(lat2*rad)*math.Sin(dLon/2)*math.Sin(dLon/2)
	return 2 * r * math.Asin(math.Min(1, math.Sqrt(a)))
}

// diurnalLoad is the [0.55, 1.0] diurnal load factor (peaks ~16:00 UTC) the demo
// traffic arcs use so the layer feels alive across refreshes without faking a rate.
func diurnalLoad(now time.Time) float64 {
	hourFrac := float64(now.Hour()) + float64(now.Minute())/60
	return 0.775 + 0.225*math.Sin((hourFrac-10)/24*2*math.Pi)
}
