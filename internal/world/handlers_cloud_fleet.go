package world

import (
	"context"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// Real DigitalOcean fleet — the live infrastructure behind Hanzo Cloud, placed on
// the world map and summed into the platform overview. It enumerates the actual DO
// resources (DOKS clusters + their nodes, and any standalone droplets) via the DO
// REST API and geo-locates each by its region slug through the shared region
// catalog (resolveRegion). NOTHING here is fabricated: counts are whatever the DO
// API returns right now, or an honest empty when the token is unset / DO is
// unreachable.
//
// HONESTY / DE-DUP CONTRACT: every DOKS worker node IS a droplet (DO backs each
// node with a droplet tagged `k8s` / `k8s:<clusterID>`). Reporting nodes AND those
// same droplets would double-count the same machines, so droplets tagged as k8s
// workers are EXCLUDED from the standalone-droplet count — `droplets` means only
// droplets that are NOT part of a cluster. A DOKS node is counted once, as a node.
//
// FAIL-SOFT: the enumeration is cached (doFleetTTL) with last-known fallback. A DO
// API hiccup returns the previous good fleet (or an honest empty on a cold miss) —
// it never errors, never blocks the pulse, never blanks the map.

// ── DO API shapes (only the fields we read) ──────────────────────────────────

type doAPICluster struct {
	Name    string `json:"name"`
	Region  string `json:"region"`
	Version string `json:"version"`
	Status  struct {
		State string `json:"state"`
	} `json:"status"`
	NodePools []struct {
		Count int `json:"count"`
		Nodes []struct {
			Status struct {
				State string `json:"state"`
			} `json:"status"`
		} `json:"nodes"`
	} `json:"node_pools"`
}

type doAPIClustersResp struct {
	Clusters []doAPICluster `json:"kubernetes_clusters"`
}

type doAPIDroplet struct {
	Name   string   `json:"name"`
	Status string   `json:"status"`
	Tags   []string `json:"tags"`
	Region struct {
		Slug string `json:"slug"`
	} `json:"region"`
	SizeSlug string `json:"size_slug"`
}

type doAPIDropletsResp struct {
	Droplets []doAPIDroplet `json:"droplets"`
	Links    struct {
		Pages struct {
			Next string `json:"next"`
		} `json:"pages"`
	} `json:"links"`
}

// ── world-facing fleet shapes (the /v1/world/cloud/nodes contract) ────────────

// doCluster is one DOKS cluster placed on the globe: its region coords, node count
// and how many of those nodes report running.
type doCluster struct {
	Name    string  `json:"name"`
	Region  string  `json:"region"` // DO region slug (e.g. "sfo3")
	City    string  `json:"city"`
	Lat     float64 `json:"lat"`
	Lon     float64 `json:"lon"`
	Nodes   int     `json:"nodes"`
	Online  int     `json:"online"`
	Status  string  `json:"status"`  // cluster state (running/…)
	Version string  `json:"version"` // k8s version
}

// doRegion is the per-region rollup the map's cloud-region dots render: real coords
// (from the catalog) + node / droplet / cluster counts placed at that datacenter.
type doRegion struct {
	ID       string  `json:"id"`   // catalog id (e.g. "sfo") for map alignment
	Slug     string  `json:"slug"` // DO region slug (e.g. "sfo3")
	Name     string  `json:"name"`
	City     string  `json:"city"`
	Country  string  `json:"country"`
	Lat      float64 `json:"lat"`
	Lon      float64 `json:"lon"`
	Nodes    int     `json:"nodes"`    // DOKS worker nodes in this region
	Droplets int     `json:"droplets"` // STANDALONE droplets (never k8s workers)
	Clusters int     `json:"clusters"`
	Online   int     `json:"online"` // running nodes + active standalone droplets
	Status   string  `json:"status"`
}

type doFleetTotals struct {
	Clusters    int `json:"clusters"`
	Nodes       int `json:"nodes"`
	NodesOnline int `json:"nodesOnline"`
	Droplets    int `json:"droplets"` // standalone droplets only (de-duped from nodes)
	Regions     int `json:"regions"`
}

// doFleet is the whole real DO fleet: totals + per-region rollups (for map dots and
// the overview) + per-cluster detail. source is "digitalocean" when live, or
// "unconfigured"/"unavailable" for the two honest empty states.
type doFleet struct {
	UpdatedAt string        `json:"updatedAt"`
	Source    string        `json:"source"`
	Live      bool          `json:"live"`
	Totals    doFleetTotals `json:"totals"`
	Regions   []doRegion    `json:"regions"`
	Clusters  []doCluster   `json:"clusters"`
}

// ── config ───────────────────────────────────────────────────────────────────

const (
	doDefaultAPIBase = "https://api.digitalocean.com"
	doFleetTTL       = 60 * time.Second
	doFleetTimeout   = 10 * time.Second
	doMaxPages       = 20 // droplet pagination safety cap
)

// doAPIBase is the DO REST base (override with DIGITALOCEAN_API_BASE, e.g. in tests).
func doAPIBase() string {
	if v := strings.TrimRight(strings.TrimSpace(env("DIGITALOCEAN_API_BASE")), "/"); v != "" {
		return v
	}
	return doDefaultAPIBase
}

// doToken is the DO read token, injected at boot from KMS (org=hanzo, /world-secrets).
// Empty ⇒ the fleet enumeration is honestly "unconfigured" (no map dots, no fake).
func doToken() string { return strings.TrimSpace(env("DIGITALOCEAN_ACCESS_TOKEN")) }

// doRegionSupplement covers DO regions the 8-city regionCatalog() does not carry, so
// EVERY DO region still geo-locates (never dropped just because it's outside the
// catalog). resolveRegion (the shared placement) is tried first for catalog
// alignment; this is the fallback only.
var doRegionSupplement = map[string]cloudRegion{
	"tor1": {ID: "tor", Name: "Toronto", City: "Toronto", Country: "Canada", Lat: 43.6532, Lon: -79.3832, Status: "online"},
	"atl1": {ID: "atl", Name: "Atlanta", City: "Atlanta", Country: "USA", Lat: 33.7490, Lon: -84.3880, Status: "online"},
}

// doRegionGeo resolves a DO region slug to placement coords. It prefers the shared
// catalog (so DO dots sit exactly where the rest of the map places that region),
// then the supplement, and finally reports ok=false (counted in totals, but no dot)
// rather than inventing coordinates.
func doRegionGeo(slug string) (cloudRegion, bool) {
	if rg, ok := resolveRegion(slug); ok {
		return rg, true
	}
	if rg, ok := doRegionSupplement[strings.ToLower(strings.TrimSpace(slug))]; ok {
		return rg, true
	}
	return cloudRegion{}, false
}

// ── enumeration ──────────────────────────────────────────────────────────────

// dropletIsK8s reports whether a droplet is a DOKS worker (tagged `k8s` or
// `k8s:<clusterID>`) — those are counted as cluster NODES, never as standalone
// droplets, so the same machine is never counted twice.
func dropletIsK8s(d doAPIDroplet) bool {
	for _, t := range d.Tags {
		if t == "k8s" || strings.HasPrefix(t, "k8s:") {
			return true
		}
	}
	return false
}

// regionAcc accumulates one region's rollup during enumeration. Node liveness and
// droplet liveness are kept separate so a provisioning node is never masked by an
// active droplet (and vice-versa) when deriving the region's health.
type regionAcc struct {
	geo      cloudRegion
	slug     string
	placed   bool
	nodes    int // DOKS worker nodes
	nodeOn   int // running nodes
	droplets int // standalone droplets (never k8s workers)
	dropOn   int // active standalone droplets
	clusters int
}

// fetchDOFleet enumerates the real DO fleet from base with token. It is pure (no
// cache, no package state) so tests drive it against an httptest server. Returns an
// error only on a hard API failure; the caller (getDOFleet) turns that into the
// fail-soft last-known/empty response.
func (s *Server) fetchDOFleet(ctx context.Context, base, token string) (doFleet, error) {
	hdr := map[string]string{"Authorization": "Bearer " + token, "Accept": "application/json"}

	// 1) DOKS clusters + their nodes.
	var cr doAPIClustersResp
	if err := s.getJSON(ctx, base+"/v2/kubernetes/clusters?per_page=100", hdr, &cr); err != nil {
		return doFleet{}, err
	}

	acc := map[string]*regionAcc{}
	var order []string
	region := func(slug string) *regionAcc {
		slug = strings.TrimSpace(slug)
		key := strings.ToLower(slug)
		if a := acc[key]; a != nil {
			return a
		}
		a := &regionAcc{slug: slug}
		if geo, ok := doRegionGeo(slug); ok {
			a.geo, a.placed = geo, true
		} else {
			a.geo = cloudRegion{ID: key, Name: slug, City: slug, Status: "online"}
		}
		acc[key] = a
		order = append(order, key)
		return a
	}

	clusters := make([]doCluster, 0, len(cr.Clusters))
	for _, c := range cr.Clusters {
		nodes, online := 0, 0
		for _, p := range c.NodePools {
			// nodes[] is the authoritative per-node list; fall back to the pool count
			// when the provisioner has not yet populated nodes[] (freshly scaling pool).
			if len(p.Nodes) > 0 {
				for _, n := range p.Nodes {
					nodes++
					if n.Status.State == "running" {
						online++
					}
				}
			} else {
				nodes += p.Count
				online += p.Count
			}
		}
		ra := region(c.Region)
		ra.nodes += nodes
		ra.nodeOn += online
		ra.clusters++
		clusters = append(clusters, doCluster{
			Name: c.Name, Region: c.Region, City: ra.geo.City, Lat: ra.geo.Lat, Lon: ra.geo.Lon,
			Nodes: nodes, Online: online, Status: firstNonEmpty(c.Status.State, "unknown"), Version: c.Version,
		})
	}

	// 2) Droplets — paginated; exclude DOKS workers (counted above as nodes).
	next := base + "/v2/droplets?per_page=200"
	allowedHost := hostOf(base)
	for page := 0; next != "" && page < doMaxPages; page++ {
		var dr doAPIDropletsResp
		if err := s.getJSON(ctx, next, hdr, &dr); err != nil {
			return doFleet{}, err
		}
		for _, d := range dr.Droplets {
			if dropletIsK8s(d) {
				continue // a cluster node, already counted
			}
			ra := region(d.Region.Slug)
			ra.droplets++
			if d.Status == "active" {
				ra.dropOn++
			}
		}
		next = dr.Links.Pages.Next
		// SSRF guard: only follow a next-link on the SAME host we were pointed at.
		if next != "" && hostOf(next) != allowedHost {
			break
		}
	}

	// 3) Materialize regions + totals (stable order = discovery order). A region's
	//    status is derived from its machine online ratio: all up ⇒ online, some up ⇒
	//    degraded, none up ⇒ offline.
	f := doFleet{UpdatedAt: nowRFC(), Source: "digitalocean", Live: true, Clusters: clusters}
	for _, key := range order {
		a := acc[key]
		total := a.nodes + a.droplets
		online := a.nodeOn + a.dropOn
		status := "online"
		switch {
		case total > 0 && online == 0:
			status = "offline"
		case online < total:
			status = "degraded"
		}
		if a.placed {
			f.Regions = append(f.Regions, doRegion{
				ID: a.geo.ID, Slug: a.slug, Name: a.geo.Name, City: a.geo.City, Country: a.geo.Country,
				Lat: a.geo.Lat, Lon: a.geo.Lon, Nodes: a.nodes, Droplets: a.droplets, Clusters: a.clusters,
				Online: online, Status: status,
			})
			f.Totals.Regions++
		}
		f.Totals.Nodes += a.nodes
		f.Totals.NodesOnline += online
		f.Totals.Droplets += a.droplets
		f.Totals.Clusters += a.clusters
	}
	return f, nil
}

// ── cache (60s TTL + last-known, fail-soft) ──────────────────────────────────

var (
	doFleetMu  sync.Mutex
	doFleetVal *doFleet
	doFleetAt  time.Time
)

// getDOFleet returns the cached real fleet, refreshing past doFleetTTL. It never
// errors: a DO failure returns the last good fleet (or an honest empty on a cold
// miss), and a missing token returns the "unconfigured" empty. This is the ONE
// place both the /nodes endpoint and the cloud-pulse overview read, so a single DO
// round-trip feeds both surfaces (DRY).
func (s *Server) getDOFleet(ctx context.Context) doFleet {
	doFleetMu.Lock()
	fresh := doFleetVal != nil && time.Since(doFleetAt) < doFleetTTL
	last := doFleetVal
	doFleetMu.Unlock()
	if fresh {
		return *last
	}

	token := doToken()
	if token == "" {
		if last != nil {
			return *last
		}
		return doFleet{UpdatedAt: nowRFC(), Source: "unconfigured", Regions: []doRegion{}, Clusters: []doCluster{}}
	}

	cctx, cancel := context.WithTimeout(ctx, doFleetTimeout)
	defer cancel()
	f, err := s.fetchDOFleet(cctx, doAPIBase(), token)
	if err != nil {
		if last != nil {
			return *last // fail-soft: serve the previous good fleet
		}
		return doFleet{UpdatedAt: nowRFC(), Source: "unavailable", Regions: []doRegion{}, Clusters: []doCluster{}}
	}
	doFleetMu.Lock()
	doFleetVal = &f
	doFleetAt = time.Now()
	doFleetMu.Unlock()
	return f
}

// applyDOFleet folds the real DO fleet into the cloud-pulse overview + region
// breakdown (the source of the map's cloud-region dots and the overview's node
// counts). Called on the fallback rung of producePulse when the multi-cloud visor
// plane did not resolve — so the public dashboard shows the real infra either way.
// Returns false (leaving the pulse untouched) when no real fleet resolved. GPUs stay
// 0: DOKS carries no GPU pools, and inventing a GPU count would be a lie.
func (s *Server) applyDOFleet(ctx context.Context, p *cloudPulse) bool {
	f := s.getDOFleet(ctx)
	if !f.Live || (f.Totals.Nodes == 0 && f.Totals.Droplets == 0) {
		return false
	}
	regions := make([]cloudRegion, 0, len(f.Regions))
	for _, r := range f.Regions {
		regions = append(regions, cloudRegion{
			ID: r.ID, Name: r.Name, City: r.City, Country: r.Country, Lat: r.Lat, Lon: r.Lon,
			Nodes: r.Nodes + r.Droplets, Gpus: 0, Status: r.Status,
		})
	}
	p.Regions = regions
	p.Overview.NodesTotal = f.Totals.Nodes + f.Totals.Droplets
	p.Overview.NodesOnline = f.Totals.NodesOnline
	p.Overview.Regions = f.Totals.Regions
	return true
}

// handleCloudNodes serves the real DO fleet (DOKS clusters + nodes + standalone
// droplets) as the map's cloud-region / node feed. Public, cached, fail-soft: it
// never 5xxes — an unreachable DO or unset token degrades to an honest empty body.
func (s *Server) handleCloudNodes(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") || methodNotGet(w, r) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), doFleetTimeout+2*time.Second)
	defer cancel()
	f := s.getDOFleet(ctx) // already cached + fail-soft (never errors)
	if f.Regions == nil {
		f.Regions = []doRegion{}
	}
	if f.Clusters == nil {
		f.Clusters = []doCluster{}
	}
	writeJSON(w, http.StatusOK, "public, max-age=30, s-maxage=30, stale-while-revalidate=120", f)
}

// hostOf returns the lowercased host[:port] of rawURL, or "" if unparseable.
func hostOf(rawURL string) string {
	u, err := url.Parse(rawURL)
	if err != nil {
		return ""
	}
	return strings.ToLower(u.Host)
}
