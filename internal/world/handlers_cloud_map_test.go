package world

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// TestChainNodesCatalog exercises /v1/world/cloud/chain-nodes against the real
// public sources (network). The honesty contract: every catalog network appears,
// a network is live:true only when a real head block was read, and the response
// never 5xxes. Ethereum + Bitcoin are public reference chains with real, large
// heights; the luxfi/node L1s (lux/zoo/hanzo) may be live:false in CI.
func TestChainNodesCatalog(t *testing.T) {
	s := NewServer()
	mux := http.NewServeMux()
	s.Mount(mux)
	ts := httptest.NewServer(mux)
	t.Cleanup(ts.Close)

	resp, err := http.Get(ts.URL + "/v1/world/cloud/chain-nodes")
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("want 200, got %d", resp.StatusCode)
	}

	var cn chainNodes
	if err := json.NewDecoder(resp.Body).Decode(&cn); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(cn.Networks) != len(chainNetworks) {
		t.Fatalf("want %d networks, got %d", len(chainNetworks), len(cn.Networks))
	}

	byID := map[string]chainNetwork{}
	for _, n := range cn.Networks {
		byID[n.ID] = n
		// A live network must carry a real, positive head block; a down one must
		// not invent a height. This is the core "never fake a number" invariant.
		if n.Live && n.BlockHeight <= 0 {
			t.Fatalf("%s live:true but blockHeight=%d", n.ID, n.BlockHeight)
		}
		if !n.Live && n.BlockHeight != 0 {
			t.Fatalf("%s live:false but blockHeight=%d (must be zero)", n.ID, n.BlockHeight)
		}
	}
	for _, want := range []string{"lux", "zoo", "hanzo", "ethereum", "bitcoin"} {
		if _, ok := byID[want]; !ok {
			t.Fatalf("catalog missing network %q", want)
		}
	}
	// Ethereum reports chainId 1 when live (catalog default, confirmed by eth_chainId).
	if eth := byID["ethereum"]; eth.Live && eth.ChainID != 1 {
		t.Fatalf("ethereum live but chainId=%d, want 1", eth.ChainID)
	}

	pretty, _ := json.MarshalIndent(cn, "", "  ")
	t.Logf("chain-nodes:\n%s", pretty)
}

// TestChainRPCAllowlist verifies the SSRF allowlist is derived from the catalog,
// including failover and non-JSON (Bitcoin) hosts — so a registered network is
// auto-allowed and nothing else is.
func TestChainRPCAllowlist(t *testing.T) {
	for _, host := range []string{
		"api.lux.network", "api.zoo.network", "api.hanzo.network", "rpc.hanzo.network",
		"ethereum-rpc.publicnode.com", "blockchain.info",
	} {
		if !chainRPCHosts[host] {
			t.Fatalf("expected %q in the RPC allowlist", host)
		}
	}
	if chainRPCHosts["evil.example.com"] {
		t.Fatalf("unexpected host allowed")
	}
}

// TestParseHexInt covers the eth_* hex decoder used by the EVM/luxnode paths.
func TestParseHexInt(t *testing.T) {
	cases := []struct {
		in   string
		want int64
		ok   bool
	}{
		{"0x18518fe", 25499902, true},
		{"0x1", 1, true},
		{"0X10", 16, true},
		{"", 0, false},
		{"0x", 0, false},
		{"nothex", 0, false},
	}
	for _, c := range cases {
		got, ok := parseHexInt(c.in)
		if ok != c.ok || (ok && got != c.want) {
			t.Fatalf("parseHexInt(%q)=(%d,%v) want (%d,%v)", c.in, got, ok, c.want, c.ok)
		}
	}
}

// TestBYOGPUAdminReal proves the globe's GPU layer is REAL (not demo) for a
// signed-in admin: the caller's own bearer reads /v1/gpus, clusters carry demo:false
// and the response is no-store (never the shared public/demo cache).
func TestBYOGPUAdminReal(t *testing.T) {
	iam := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/iam/oauth/userinfo" || r.Header.Get("Authorization") == "" {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write([]byte(`{"owner":"hanzo","sub":"z@hanzo.ai"}`))
	}))
	t.Cleanup(iam.Close)

	api := http.NewServeMux()
	api.HandleFunc("/v1/gpus", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer admin-token" {
			t.Errorf("GPU inventory must be read with the caller's bearer, got %q", r.Header.Get("Authorization"))
		}
		_, _ = w.Write([]byte(`{"gpus":[{"model":"GB10","region":"nyc","status":"online"},{"model":"H100","region":"sfo","status":"online"}]}`))
	})
	up := httptest.NewServer(api)
	t.Cleanup(up.Close)

	t.Setenv("HANZO_CLOUD_PULSE_TOKEN", "") // no service token — the admin's bearer drives it
	t.Setenv("HANZO_API_BASE", up.URL)
	t.Setenv("HANZO_IAM_ISSUER", iam.URL)
	t.Setenv("WORLD_ADMIN_ORGS", "hanzo") // operator org resolves via deploy env, not code

	req, _ := http.NewRequest(http.MethodGet, serveWorld(t)+"/v1/world/cloud/byo-gpu", nil)
	req.Header.Set("Authorization", "Bearer admin-token")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	defer resp.Body.Close()
	if cc := resp.Header.Get("Cache-Control"); cc != "private, no-store" {
		t.Fatalf("admin GPU layer must be no-store, got %q", cc)
	}
	var g byoGPU
	if err := json.NewDecoder(resp.Body).Decode(&g); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if g.Demo {
		t.Fatalf("signed-in admin must get real GPUs, not demo")
	}
	if len(g.GPUs) != 2 {
		t.Fatalf("want 2 real GPU clusters (nyc GB10 + sfo H100), got %d: %+v", len(g.GPUs), g.GPUs)
	}
}
