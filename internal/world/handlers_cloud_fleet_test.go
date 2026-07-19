package world

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// doAPIStub serves the two DO REST endpoints fetchDOFleet reads, from canned
// fixtures. Droplets paginate: page 2 is served when ?page=2 is present, and the
// page-1 body advertises the next link pointing back at this same server (mirrors
// DO's absolute next-URL, exercising the SSRF same-host guard on the happy path).
func doAPIStub(t *testing.T, clusters string, dropletsP1, dropletsP2 func(self string) string) *httptest.Server {
	t.Helper()
	var srv *httptest.Server
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer test-token" {
			t.Errorf("missing/wrong auth header: %q", got)
		}
		switch {
		case strings.HasPrefix(r.URL.Path, "/v2/kubernetes/clusters"):
			_, _ = w.Write([]byte(clusters))
		case strings.HasPrefix(r.URL.Path, "/v2/droplets"):
			if r.URL.Query().Get("page") == "2" {
				_, _ = w.Write([]byte(dropletsP2(srv.URL)))
			} else {
				_, _ = w.Write([]byte(dropletsP1(srv.URL)))
			}
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)
	return srv
}

// Fixtures: 3 clusters (2× sfo3, 1× tor1) totalling 6 nodes, 5 running (one node in
// the second sfo3 cluster is still provisioning). Droplets: 2 k8s workers (MUST be
// excluded — they are already nodes) + 2 standalone (1 sfo3 active, 1 tor1 active),
// split across two pages to exercise pagination.
const fxClusters = `{"kubernetes_clusters":[
  {"name":"hanzo-k8s","region":"sfo3","version":"1.34.1-do.4","status":{"state":"running"},
   "node_pools":[{"count":2,"nodes":[{"status":{"state":"running"}},{"status":{"state":"running"}}]},
                 {"count":1,"nodes":[{"status":{"state":"running"}}]}]},
  {"name":"lux-k8s","region":"sfo3","version":"1.34.1-do.4","status":{"state":"running"},
   "node_pools":[{"count":2,"nodes":[{"status":{"state":"running"}},{"status":{"state":"provisioning"}}]}]},
  {"name":"edge-k8s","region":"tor1","version":"1.35.5-do.2","status":{"state":"running"},
   "node_pools":[{"count":1,"nodes":[{"status":{"state":"running"}}]}]}
]}`

func fxDropletsP1(self string) string {
	return `{"droplets":[
	  {"name":"worker-a","status":"active","region":{"slug":"sfo3"},"size_slug":"s-4vcpu-8gb","tags":["k8s","k8s:worker","k8s:uuid"]},
	  {"name":"worker-b","status":"active","region":{"slug":"sfo3"},"size_slug":"s-4vcpu-8gb","tags":["k8s:uuid"]},
	  {"name":"bastion","status":"active","region":{"slug":"sfo3"},"size_slug":"s-1vcpu-1gb","tags":["infra"]}
	],"links":{"pages":{"next":"` + self + `/v2/droplets?per_page=200&page=2"}}}`
}
func fxDropletsP2(self string) string {
	return `{"droplets":[
	  {"name":"relay","status":"active","region":{"slug":"tor1"},"size_slug":"s-1vcpu-1gb","tags":[]}
	],"links":{"pages":{}}}`
}

func TestFetchDOFleet_AggregatesDedupesPlaces(t *testing.T) {
	s := NewServer()
	stub := doAPIStub(t, fxClusters, fxDropletsP1, fxDropletsP2)

	f, err := s.fetchDOFleet(context.Background(), stub.URL, "test-token")
	if err != nil {
		t.Fatalf("fetchDOFleet: %v", err)
	}
	if f.Source != "digitalocean" || !f.Live {
		t.Fatalf("source/live = %q/%v, want digitalocean/true", f.Source, f.Live)
	}

	// Totals: 6 nodes (3+2+1), 5 running nodes + 2 active standalone droplets = 7
	// machines online; 2 standalone droplets (the 2 k8s-tagged are NOT droplets here);
	// 3 clusters; 2 regions.
	want := doFleetTotals{Clusters: 3, Nodes: 6, NodesOnline: 7, Droplets: 2, Regions: 2}
	if f.Totals != want {
		t.Fatalf("totals = %+v, want %+v", f.Totals, want)
	}

	byID := map[string]doRegion{}
	for _, r := range f.Regions {
		byID[r.Slug] = r
	}

	// sfo3 → catalog "sfo" coords (shared resolveRegion, so dots align with the map).
	sfo, ok := byID["sfo3"]
	if !ok {
		t.Fatal("missing sfo3 region")
	}
	if sfo.ID != "sfo" || sfo.City != "San Francisco" {
		t.Fatalf("sfo3 placed as id=%q city=%q, want sfo/San Francisco", sfo.ID, sfo.City)
	}
	if sfo.Lat < 37 || sfo.Lat > 38 || sfo.Lon > -122 || sfo.Lon < -123 {
		t.Fatalf("sfo3 coords (%.4f,%.4f) not near San Francisco", sfo.Lat, sfo.Lon)
	}
	// sfo3: 5 nodes (hanzo 3 + lux 2), 4 running (lux has one provisioning); 1
	// standalone active droplet → 4+1 = 5 machines online of 6, so degraded.
	if sfo.Nodes != 5 || sfo.Droplets != 1 || sfo.Clusters != 2 || sfo.Online != 5 {
		t.Fatalf("sfo3 rollup = nodes:%d droplets:%d clusters:%d online:%d, want 5/1/2/5", sfo.Nodes, sfo.Droplets, sfo.Clusters, sfo.Online)
	}
	if sfo.Status != "degraded" {
		t.Fatalf("sfo3 status = %q, want degraded (one node provisioning)", sfo.Status)
	}

	// tor1 → placed via the supplement (NOT in the 8-city catalog): all up ⇒ online.
	tor, ok := byID["tor1"]
	if !ok {
		t.Fatal("missing tor1 region — supplement placement failed")
	}
	if tor.City != "Toronto" || tor.Lat < 43 || tor.Lat > 44 {
		t.Fatalf("tor1 placed as city=%q lat=%.4f, want Toronto ~43.65", tor.City, tor.Lat)
	}
	if tor.Nodes != 1 || tor.Droplets != 1 || tor.Online != 2 || tor.Status != "online" {
		t.Fatalf("tor1 rollup = nodes:%d droplets:%d online:%d status:%q, want 1/1/2/online", tor.Nodes, tor.Droplets, tor.Online, tor.Status)
	}

	// Per-cluster detail carries real coords + version + online counts.
	var lux *doCluster
	for i := range f.Clusters {
		if f.Clusters[i].Name == "lux-k8s" {
			lux = &f.Clusters[i]
		}
	}
	if lux == nil {
		t.Fatal("missing lux-k8s cluster")
	}
	if lux.Nodes != 2 || lux.Online != 1 || lux.Version != "1.34.1-do.4" || lux.City != "San Francisco" {
		t.Fatalf("lux-k8s = nodes:%d online:%d ver:%q city:%q, want 2/1/1.34.1-do.4/San Francisco", lux.Nodes, lux.Online, lux.Version, lux.City)
	}
}

// The exact double-count trap: a DOKS worker droplet must never be added to the
// standalone droplet count. With ONLY k8s-tagged droplets, standalone droplets = 0.
func TestFetchDOFleet_ExcludesK8sWorkerDroplets(t *testing.T) {
	s := NewServer()
	onlyK8s := func(self string) string {
		return `{"droplets":[
		  {"name":"w1","status":"active","region":{"slug":"sfo3"},"tags":["k8s","k8s:worker"]},
		  {"name":"w2","status":"active","region":{"slug":"sfo3"},"tags":["k8s:abc"]}
		],"links":{"pages":{}}}`
	}
	stub := doAPIStub(t, fxClusters, onlyK8s, onlyK8s)
	f, err := s.fetchDOFleet(context.Background(), stub.URL, "test-token")
	if err != nil {
		t.Fatalf("fetchDOFleet: %v", err)
	}
	if f.Totals.Droplets != 0 {
		t.Fatalf("standalone droplets = %d, want 0 (all droplets are k8s workers)", f.Totals.Droplets)
	}
	if f.Totals.Nodes != 6 {
		t.Fatalf("nodes = %d, want 6 (unchanged — droplets are not double counted)", f.Totals.Nodes)
	}
}

// applyDOFleet folds the real fleet into the cloud-pulse overview + region breakdown
// (what the overview panel counts and the map's cloud-region dots render).
func TestApplyDOFleet_FoldsIntoPulse(t *testing.T) {
	s := NewServer()
	stub := doAPIStub(t, fxClusters, fxDropletsP1, fxDropletsP2)
	t.Setenv("DIGITALOCEAN_API_BASE", stub.URL)
	t.Setenv("DIGITALOCEAN_ACCESS_TOKEN", "test-token")
	resetDOFleetCache()

	p := emptyPulse()
	if !s.applyDOFleet(context.Background(), &p) {
		t.Fatal("applyDOFleet returned false with a live fleet")
	}
	// NodesTotal = nodes + standalone droplets = 6 + 2 = 8; online machines = 7.
	if p.Overview.NodesTotal != 8 || p.Overview.NodesOnline != 7 {
		t.Fatalf("overview nodes = %d/%d, want 7/8", p.Overview.NodesOnline, p.Overview.NodesTotal)
	}
	if p.Overview.Regions != 2 || len(p.Regions) != 2 {
		t.Fatalf("regions = overview:%d list:%d, want 2/2", p.Overview.Regions, len(p.Regions))
	}
	if p.Overview.GpusOnline != 0 {
		t.Fatalf("gpusOnline = %d, want 0 (DOKS has no GPU pools — never invented)", p.Overview.GpusOnline)
	}
	// Region dots carry real coords for the map.
	for _, r := range p.Regions {
		if r.Lat == 0 && r.Lon == 0 {
			t.Fatalf("region %q has no coords — would not place on the map", r.ID)
		}
	}
}

// getDOFleet is fail-soft: an unset token is the honest "unconfigured" empty, and a
// DO failure with no last-known is the honest "unavailable" empty — never a panic,
// never a fabricated number, never an error to the caller.
func TestGetDOFleet_FailSoft(t *testing.T) {
	s := NewServer()

	// Unset token → unconfigured, empty (not nil) collections.
	t.Setenv("DIGITALOCEAN_ACCESS_TOKEN", "")
	resetDOFleetCache()
	f := s.getDOFleet(context.Background())
	if f.Source != "unconfigured" || f.Live {
		t.Fatalf("no-token fleet = %q/live=%v, want unconfigured/false", f.Source, f.Live)
	}
	if f.Regions == nil || f.Clusters == nil {
		t.Fatal("empty fleet must carry empty (non-nil) slices")
	}

	// Token set but DO unreachable (bad base) and no last-known → unavailable.
	t.Setenv("DIGITALOCEAN_ACCESS_TOKEN", "test-token")
	t.Setenv("DIGITALOCEAN_API_BASE", "http://127.0.0.1:1") // connection refused
	resetDOFleetCache()
	f = s.getDOFleet(context.Background())
	if f.Source != "unavailable" || f.Live {
		t.Fatalf("unreachable fleet = %q/live=%v, want unavailable/false", f.Source, f.Live)
	}
}

// getDOFleet serves the last-known good fleet when a later refresh fails (a DO API
// hiccup must never blank the map).
func TestGetDOFleet_LastKnownOnError(t *testing.T) {
	s := NewServer()
	stub := doAPIStub(t, fxClusters, fxDropletsP1, fxDropletsP2)
	t.Setenv("DIGITALOCEAN_ACCESS_TOKEN", "test-token")
	t.Setenv("DIGITALOCEAN_API_BASE", stub.URL)
	resetDOFleetCache()

	good := s.getDOFleet(context.Background())
	if !good.Live || good.Totals.Nodes != 6 {
		t.Fatalf("first fetch not live: %+v", good.Totals)
	}
	// Now point at a dead host and force past the TTL: the cache must return the
	// previous good fleet, not an empty.
	t.Setenv("DIGITALOCEAN_API_BASE", "http://127.0.0.1:1")
	doFleetMu.Lock()
	doFleetAt = doFleetAt.Add(-2 * doFleetTTL) // expire
	doFleetMu.Unlock()
	again := s.getDOFleet(context.Background())
	if again.Source != "digitalocean" || again.Totals.Nodes != 6 {
		t.Fatalf("last-known lost on error: source=%q nodes=%d", again.Source, again.Totals.Nodes)
	}
}

// The public endpoint never 5xxes and always emits non-nil arrays.
func TestHandleCloudNodes_NeverErrors(t *testing.T) {
	s := NewServer()
	t.Setenv("DIGITALOCEAN_ACCESS_TOKEN", "") // unconfigured path
	resetDOFleetCache()
	mux := http.NewServeMux()
	s.Mount(mux)
	ts := httptest.NewServer(mux)
	t.Cleanup(ts.Close)

	resp, err := http.Get(ts.URL + "/v1/world/cloud/nodes")
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	var f doFleet
	if err := json.NewDecoder(resp.Body).Decode(&f); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if f.Regions == nil || f.Clusters == nil {
		t.Fatal("endpoint must emit [] not null for regions/clusters")
	}
}

// resetDOFleetCache clears the package-level fleet cache between tests.
func resetDOFleetCache() {
	doFleetMu.Lock()
	doFleetVal = nil
	doFleetAt = doFleetAt.Add(0)
	doFleetMu.Unlock()
}
