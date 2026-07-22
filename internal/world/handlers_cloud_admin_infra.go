package world

import (
	"context"
	"encoding/json"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"
)

// Admin-only Cloud infrastructure aggregates — the SuperAdmin fleet view's two
// panels that the fleet + services handlers (handlers_cloud_admin.go) did not yet
// cover: DOKS cluster NODES grouped by cluster, and the GPU JOB QUEUE (what is
// running, from which service). Both are gated by requireAdmin (fail-closed 403)
// and forward the caller's own IAM bearer to the cloud subsystems on api.hanzo.ai,
// which independently re-verify. Each degrades honestly to {available:false} on any
// upstream failure — never a 5xx or an invented number.

// ── clusters: DOKS cluster nodes grouped by cluster ──────────────────────────
//
// Real source: the unified k8s noun on api.hanzo.ai — /v1/k8s/clusters (the org's
// managed DOKS + BYO clusters) then, per cluster, /v1/k8s/clusters/{id} (node pools
// + worker nodes as machines). The fleet handler groups the SAME nodes by
// provider/region; this handler keeps them under their CLUSTER (hanzo-k8s, …) with
// per-cluster status and capacity, which the provider view flattens away.

type clusterNode struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Status string `json:"status"`
	Type   string `json:"type"`
	Region string `json:"region"`
	GPU    string `json:"gpu"`
}

type clusterPool struct {
	Name      string `json:"name"`
	Size      string `json:"size"`
	Count     int    `json:"count"`
	AutoScale bool   `json:"autoScale"`
	MinNodes  int    `json:"minNodes"`
	MaxNodes  int    `json:"maxNodes"`
}

type clusterGroup struct {
	ID         string        `json:"id"`
	Name       string        `json:"name"`
	Region     string        `json:"region"`
	Status     string        `json:"status"`
	Kind       string        `json:"kind"` // managed (DOKS) | byo (attached kubeconfig)
	Nodes      int           `json:"nodes"`
	NodesReady int           `json:"nodesReady"`
	GPUs       int           `json:"gpus"`
	Pools      []clusterPool `json:"pools"`
	NodeList   []clusterNode `json:"nodeList"`
}

type clustersTotals struct {
	Clusters   int `json:"clusters"`
	Nodes      int `json:"nodes"`
	NodesReady int `json:"nodesReady"`
	GPUs       int `json:"gpus"`
}

type cloudClusters struct {
	Available bool           `json:"available"`
	UpdatedAt string         `json:"updatedAt"`
	Note      string         `json:"note"`
	Totals    clustersTotals `json:"totals"`
	Clusters  []clusterGroup `json:"clusters"`
}

// wireCluster mirrors cloud's clusterView (clients/visor/types.go): the list row.
type wireCluster struct {
	DoksClusterID string `json:"doksClusterId"`
	DoClusterID   string `json:"doClusterId"`
	Name          string `json:"name"`
	Region        string `json:"region"`
	Status        string `json:"status"`
	Kind          string `json:"kind"`
	NodeCount     int    `json:"nodeCount"`
	NvidiaGPU     int    `json:"nvidiaGpu"`
	AmdGPU        int    `json:"amdGpu"`
	NodePools     []struct {
		Name      string `json:"name"`
		Size      string `json:"size"`
		Count     int    `json:"count"`
		MinNodes  int    `json:"minNodes"`
		MaxNodes  int    `json:"maxNodes"`
		AutoScale bool   `json:"autoScale"`
	} `json:"nodePools"`
}

// wireClusterDetail mirrors cloud's clusterDetailView: the list row + worker nodes.
type wireClusterDetail struct {
	wireCluster
	Nodes []struct {
		ID     string `json:"id"`
		Name   string `json:"name"`
		Region string `json:"region"`
		Type   string `json:"type"`
		Status string `json:"status"`
		GPU    string `json:"gpu"`
	} `json:"nodes"`
}

func (s *Server) handleCloudClusters(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") || methodNotGet(w, r) {
		return
	}
	bearer, ok := s.requireAdmin(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 22*time.Second)
	defer cancel()
	hdr := map[string]string{"Authorization": bearer}
	base := apiHost()

	var list struct {
		Clusters []wireCluster `json:"clusters"`
	}
	if err := s.getJSON(ctx, base+"/v1/k8s/clusters", hdr, &list); err != nil {
		writeJSON(w, http.StatusOK, "private, no-store", cloudClusters{Available: false, UpdatedAt: nowRFC(),
			Note: "Kubernetes cluster inventory (visor) is unavailable right now."})
		return
	}

	out := cloudClusters{Available: true, UpdatedAt: nowRFC()}
	groups := make([]clusterGroup, len(list.Clusters))
	var wg sync.WaitGroup
	sem := make(chan struct{}, 6)
	for i, kc := range list.Clusters {
		wg.Add(1)
		go func(i int, kc wireCluster) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			groups[i] = s.clusterGroup(ctx, base, hdr, kc)
		}(i, kc)
	}
	wg.Wait()

	for _, g := range groups {
		out.Clusters = append(out.Clusters, g)
		out.Totals.Clusters++
		out.Totals.Nodes += g.Nodes
		out.Totals.NodesReady += g.NodesReady
		out.Totals.GPUs += g.GPUs
	}
	sort.Slice(out.Clusters, func(i, j int) bool {
		if out.Clusters[i].Nodes == out.Clusters[j].Nodes {
			return out.Clusters[i].Name < out.Clusters[j].Name
		}
		return out.Clusters[i].Nodes > out.Clusters[j].Nodes
	})
	out.Note = "Live DOKS + BYO clusters from visor, grouped by cluster with node pools and worker-node status."
	writeJSON(w, http.StatusOK, "private, no-store", out)
}

// clusterGroup resolves one cluster to its group view. It fetches the cluster
// detail for node pools + worker nodes; a detail failure degrades to the list
// row's counts (never fabricated) so a single unreachable cluster never sinks the
// board.
func (s *Server) clusterGroup(ctx context.Context, base string, hdr map[string]string, kc wireCluster) clusterGroup {
	g := clusterGroup{
		ID:     firstNonBlank(kc.DoksClusterID, kc.DoClusterID),
		Name:   orDash(kc.Name),
		Region: kc.Region,
		Status: orDash(kc.Status),
		Kind:   orDash(kc.Kind),
		Nodes:  kc.NodeCount,
		GPUs:   kc.NvidiaGPU + kc.AmdGPU,
	}
	for _, p := range kc.NodePools {
		g.Pools = append(g.Pools, clusterPool{Name: p.Name, Size: p.Size, Count: p.Count,
			AutoScale: p.AutoScale, MinNodes: p.MinNodes, MaxNodes: p.MaxNodes})
	}

	if g.ID == "" {
		return g
	}
	var d wireClusterDetail
	if err := s.getJSON(ctx, base+"/v1/k8s/clusters/"+g.ID, hdr, &d); err != nil {
		return g
	}
	if len(d.NodePools) > 0 { // detail carries the authoritative pool set
		g.Pools = g.Pools[:0]
		for _, p := range d.NodePools {
			g.Pools = append(g.Pools, clusterPool{Name: p.Name, Size: p.Size, Count: p.Count,
				AutoScale: p.AutoScale, MinNodes: p.MinNodes, MaxNodes: p.MaxNodes})
		}
	}
	if len(d.Nodes) > 0 {
		g.Nodes = len(d.Nodes)
		g.NodesReady = 0
		for _, n := range d.Nodes {
			g.NodeList = append(g.NodeList, clusterNode{ID: n.ID, Name: orDash(n.Name),
				Status: n.Status, Type: n.Type, Region: n.Region, GPU: n.GPU})
			if machineOnline(n.Status) {
				g.NodesReady++
			}
		}
	} else if g.Nodes > 0 {
		g.NodesReady = g.Nodes // list row reports a count but no per-node status
	}
	return g
}

// ── queue: GPU job queue (gpu-jobs) — depth + what's running, from which service ─
//
// Real source: the tasks engine on api.hanzo.ai — GET
// /v1/tasks/namespaces/gpu-jobs/activities (the org's GPU work queue the
// `hanzo gpu connect` workers claim from) fused with /v1/fleet/workers (the online
// worker count). Job types are namespaced by service ("studio.render",
// "engine.serve"), so the dispatching service is the type's prefix. The queue is
// the caller's platform org — a SuperAdmin's bearer resolves to the admin org
// upstream, which owns the house-account + operator fleet.

const gpuJobsNamespace = "gpu-jobs"

type queueJob struct {
	ID        string `json:"id"`
	Type      string `json:"type"`
	Service   string `json:"service"`
	Status    string `json:"status"` // pending | running | done | failed | canceled
	Worker    string `json:"worker"`
	Model     string `json:"model"`
	Attempt   int    `json:"attempt"`
	StartedAt string `json:"startedAt"`
	ClosedAt  string `json:"closedAt"`
}

type queueService struct {
	Service string `json:"service"`
	Pending int    `json:"pending"`
	Running int    `json:"running"`
}

type queueDepth struct {
	Pending  int `json:"pending"`
	Running  int `json:"running"`
	Done     int `json:"done"`
	Failed   int `json:"failed"`
	Canceled int `json:"canceled"`
}

type cloudQueue struct {
	Available bool       `json:"available"`
	UpdatedAt string     `json:"updatedAt"`
	Note      string     `json:"note"`
	Namespace string     `json:"namespace"`
	Depth     queueDepth `json:"depth"`
	Workers   struct {
		Online int `json:"online"`
		Total  int `json:"total"`
	} `json:"workers"`
	Services []queueService `json:"services"`
	Running  []queueJob     `json:"running"`
	Pending  []queueJob     `json:"pending"`
	Recent   []queueJob     `json:"recent"`
}

// wireActivity is the subset of the tasks engine's StandaloneActivity the queue
// view needs (pkg/tasks/types.go).
type wireActivity struct {
	Execution struct {
		WorkflowID string `json:"workflowId"`
	} `json:"execution"`
	Type struct {
		Name string `json:"name"`
	} `json:"type"`
	Status    string          `json:"status"` // ACTIVITY_TASK_STATE_*
	StartTime string          `json:"startTime"`
	CloseTime string          `json:"closeTime"`
	Identity  string          `json:"identity"`
	Attempt   int             `json:"attempt"`
	Input     json.RawMessage `json:"input"`
}

func (s *Server) handleCloudQueue(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") || methodNotGet(w, r) {
		return
	}
	bearer, ok := s.requireAdmin(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	hdr := map[string]string{"Authorization": bearer}
	base := apiHost()

	var acts struct {
		Activities []wireActivity `json:"activities"`
	}
	if err := s.getJSON(ctx, base+"/v1/tasks/namespaces/"+gpuJobsNamespace+"/activities", hdr, &acts); err != nil {
		writeJSON(w, http.StatusOK, "private, no-store", cloudQueue{Available: false, UpdatedAt: nowRFC(), Namespace: gpuJobsNamespace,
			Note: "GPU job queue (tasks) is unavailable right now."})
		return
	}

	out := cloudQueue{Available: true, UpdatedAt: nowRFC(), Namespace: gpuJobsNamespace}
	svc := map[string]*queueService{}
	var svcOrder []string
	for _, a := range acts.Activities {
		job := queueJob{
			ID:        a.Execution.WorkflowID,
			Type:      orDash(a.Type.Name),
			Service:   jobService(a.Type.Name),
			Worker:    a.Identity,
			Model:     jobModel(a.Input),
			Attempt:   a.Attempt,
			StartedAt: a.StartTime,
			ClosedAt:  a.CloseTime,
		}
		switch a.Status {
		case "ACTIVITY_TASK_STATE_SCHEDULED":
			job.Status = "pending"
			out.Depth.Pending++
			out.Pending = append(out.Pending, job)
			serviceBucket(svc, &svcOrder, job.Service).Pending++
		case "ACTIVITY_TASK_STATE_STARTED":
			job.Status = "running"
			out.Depth.Running++
			out.Running = append(out.Running, job)
			serviceBucket(svc, &svcOrder, job.Service).Running++
		case "ACTIVITY_TASK_STATE_COMPLETED":
			job.Status = "done"
			out.Depth.Done++
			out.Recent = append(out.Recent, job)
		case "ACTIVITY_TASK_STATE_FAILED":
			job.Status = "failed"
			out.Depth.Failed++
			out.Recent = append(out.Recent, job)
		case "ACTIVITY_TASK_STATE_CANCELED":
			job.Status = "canceled"
			out.Depth.Canceled++
			out.Recent = append(out.Recent, job)
		}
	}

	// Online worker count — the same BYO fleet the fleet panel lists. A read failure
	// here leaves the worker count at zero; it never sinks the queue.
	var workers struct {
		Workers []struct {
			Status string `json:"status"`
		} `json:"workers"`
	}
	if err := s.getJSON(ctx, base+"/v1/fleet/workers", hdr, &workers); err == nil {
		out.Workers.Total = len(workers.Workers)
		for _, wk := range workers.Workers {
			if wk.Status == "online" {
				out.Workers.Online++
			}
		}
	}

	for _, name := range svcOrder {
		out.Services = append(out.Services, *svc[name])
	}
	sort.Slice(out.Services, func(i, j int) bool {
		a, b := out.Services[i], out.Services[j]
		if a.Running+a.Pending == b.Running+b.Pending {
			return a.Service < b.Service
		}
		return a.Running+a.Pending > b.Running+b.Pending
	})
	// Newest terminal first; keep the tail bounded so the panel stays a snapshot.
	sort.Slice(out.Recent, func(i, j int) bool { return out.Recent[i].ClosedAt > out.Recent[j].ClosedAt })
	if len(out.Recent) > 12 {
		out.Recent = out.Recent[:12]
	}
	out.Note = "Live GPU job queue (gpu-jobs) — pending + running work by service, and what each worker is serving."
	writeJSON(w, http.StatusOK, "private, no-store", out)
}

// jobService is the dispatching service of a job type: the segment before the
// first "." ("studio.render" → "studio", "engine.serve" → "engine"). A type with
// no dot is its own service; an empty type is "—".
func jobService(typ string) string {
	typ = strings.TrimSpace(typ)
	if typ == "" {
		return "—"
	}
	if i := strings.IndexByte(typ, '.'); i > 0 {
		return typ[:i]
	}
	return typ
}

// jobModel best-effort reads the target model from a job's input ("model", else a
// nested "input.model"). An absent field yields "" — never a guess.
func jobModel(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		return ""
	}
	if v, ok := m["model"].(string); ok && v != "" {
		return v
	}
	if inner, ok := m["input"].(map[string]any); ok {
		if v, ok := inner["model"].(string); ok {
			return v
		}
	}
	return ""
}

func serviceBucket(m map[string]*queueService, order *[]string, name string) *queueService {
	if b := m[name]; b != nil {
		return b
	}
	b := &queueService{Service: name}
	m[name] = b
	*order = append(*order, name)
	return b
}

func firstNonBlank(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}
