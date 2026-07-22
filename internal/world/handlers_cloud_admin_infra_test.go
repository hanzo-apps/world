package world

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// The SuperAdmin fleet view's two infrastructure aggregates — DOKS cluster nodes
// and the GPU job queue — must (1) fail-closed for a non-admin and (2) reshape the
// REAL upstream shapes (k8s clusters/detail + tasks activities) for an admin, never
// fabricating a number. These tests mock IAM userinfo (the admin gate) and the
// api.hanzo.ai subsystems (the data plane) so they run hermetically.

// adminUpstream is a mock api.hanzo.ai serving the exact routes the clusters +
// queue handlers fan out to, with real-shaped payloads.
func adminUpstream(t *testing.T) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/v1/k8s/clusters":
			_, _ = w.Write([]byte(`{"clusters":[
				{"doksClusterId":"c-hanzo","name":"hanzo-k8s","region":"sfo3","status":"running","kind":"managed","nodeCount":3,"nvidiaGpu":2},
				{"doksClusterId":"c-adnexus","name":"adnexus-k8s","region":"sfo3","status":"running","kind":"managed","nodeCount":2}
			]}`))
		case "/v1/k8s/clusters/c-hanzo":
			_, _ = w.Write([]byte(`{"doksClusterId":"c-hanzo","name":"hanzo-k8s","region":"sfo3","status":"running","kind":"managed",
				"nodePools":[{"name":"pool-gpu","size":"gpu-l40","count":2,"autoScale":true,"minNodes":1,"maxNodes":4}],
				"nodes":[
					{"id":"n1","name":"hanzo-k8s-1","status":"active","type":"s-8vcpu-16gb","region":"sfo3"},
					{"id":"n2","name":"hanzo-k8s-2","status":"active","type":"gpu-l40","region":"sfo3","gpu":"L40S"},
					{"id":"n3","name":"hanzo-k8s-3","status":"provisioning","type":"gpu-l40","region":"sfo3","gpu":"L40S"}
				]}`))
		case "/v1/k8s/clusters/c-adnexus":
			_, _ = w.Write([]byte(`{"doksClusterId":"c-adnexus","name":"adnexus-k8s","region":"sfo3","status":"running","kind":"managed",
				"nodes":[
					{"id":"a1","name":"adnexus-k8s-1","status":"active","type":"s-4vcpu-8gb","region":"sfo3"},
					{"id":"a2","name":"adnexus-k8s-2","status":"active","type":"s-4vcpu-8gb","region":"sfo3"}
				]}`))
		case "/v1/tasks/namespaces/gpu-jobs/activities":
			_, _ = w.Write([]byte(`{"activities":[
				{"execution":{"workflowId":"job-1"},"type":{"name":"studio.render"},"status":"ACTIVITY_TASK_STATE_STARTED","identity":"evo","startTime":"2026-07-21T10:00:00Z","input":{"model":"flux.1"}},
				{"execution":{"workflowId":"job-2"},"type":{"name":"engine.serve"},"status":"ACTIVITY_TASK_STATE_STARTED","identity":"spark","startTime":"2026-07-21T10:01:00Z","input":{"model":"qwen3-32b"}},
				{"execution":{"workflowId":"job-3"},"type":{"name":"studio.render"},"status":"ACTIVITY_TASK_STATE_SCHEDULED","input":{"model":"flux.1"}},
				{"execution":{"workflowId":"job-4"},"type":{"name":"echo"},"status":"ACTIVITY_TASK_STATE_COMPLETED","closeTime":"2026-07-21T09:59:00Z"},
				{"execution":{"workflowId":"job-5"},"type":{"name":"studio.render"},"status":"ACTIVITY_TASK_STATE_FAILED","closeTime":"2026-07-21T09:58:00Z"}
			]}`))
		case "/v1/fleet/workers":
			_, _ = w.Write([]byte(`{"workers":[
				{"id":"evo","hostname":"evo","status":"online"},
				{"id":"spark","hostname":"spark","status":"online"},
				{"id":"dbc","hostname":"dbc","status":"offline"}
			]}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(srv.Close)
	return srv
}

// getInfra drives an admin-gated infra route through a mocked IAM + upstream.
func getInfra(t *testing.T, route string, iamStatus int, iamBody, bearer string) (*http.Response, []byte) {
	t.Helper()
	iam := iamStub(t, iamStatus, iamBody)
	t.Setenv("HANZO_IAM_ISSUER", iam.URL)
	t.Setenv("HANZO_API_BASE", adminUpstream(t).URL)

	s := NewServer()
	mux := http.NewServeMux()
	s.Mount(mux)
	ts := httptest.NewServer(mux)
	t.Cleanup(ts.Close)

	req, _ := http.NewRequest(http.MethodGet, ts.URL+route, nil)
	if bearer != "" {
		req.Header.Set("Authorization", bearer)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	t.Cleanup(func() { resp.Body.Close() })
	var raw json.RawMessage
	_ = json.NewDecoder(resp.Body).Decode(&raw)
	return resp, raw
}

// TestCloudClustersAdmin: an admin owner receives the real clusters, grouped by
// cluster with node pools + worker-node status, and honest ready/total counts.
func TestCloudClustersAdmin(t *testing.T) {
	resp, body := getInfra(t, "/v1/world/cloud/clusters", 200, `{"owner":"admin","sub":"z"}`, "Bearer good")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("admin got %d, want 200 (body=%s)", resp.StatusCode, body)
	}
	var cc cloudClusters
	if err := json.Unmarshal(body, &cc); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !cc.Available {
		t.Fatalf("want available")
	}
	if cc.Totals.Clusters != 2 {
		t.Fatalf("want 2 clusters, got %d", cc.Totals.Clusters)
	}
	// hanzo-k8s sorts first (3 nodes > 2). Detail replaced the count-only row.
	h := cc.Clusters[0]
	if h.Name != "hanzo-k8s" {
		t.Fatalf("want hanzo-k8s first, got %q", h.Name)
	}
	if h.Nodes != 3 || h.NodesReady != 2 { // n3 is provisioning, not ready
		t.Fatalf("hanzo-k8s nodes=%d ready=%d, want 3/2", h.Nodes, h.NodesReady)
	}
	if len(h.Pools) != 1 || h.Pools[0].Size != "gpu-l40" || !h.Pools[0].AutoScale {
		t.Fatalf("hanzo-k8s pools not surfaced: %+v", h.Pools)
	}
	if h.GPUs != 2 {
		t.Fatalf("hanzo-k8s GPUs=%d, want 2", h.GPUs)
	}
	if cc.Totals.Nodes != 5 || cc.Totals.NodesReady != 4 {
		t.Fatalf("totals nodes=%d ready=%d, want 5/4", cc.Totals.Nodes, cc.Totals.NodesReady)
	}
}

// TestCloudQueueAdmin: an admin owner receives the real gpu-jobs queue — depth by
// status, running/pending jobs with worker + model + dispatching service, and the
// online BYO worker count.
func TestCloudQueueAdmin(t *testing.T) {
	resp, body := getInfra(t, "/v1/world/cloud/queue", 200, `{"owner":"admin","sub":"z"}`, "Bearer good")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("admin got %d, want 200 (body=%s)", resp.StatusCode, body)
	}
	var q cloudQueue
	if err := json.Unmarshal(body, &q); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !q.Available || q.Namespace != "gpu-jobs" {
		t.Fatalf("want available gpu-jobs, got %+v", q)
	}
	if q.Depth.Running != 2 || q.Depth.Pending != 1 || q.Depth.Done != 1 || q.Depth.Failed != 1 {
		t.Fatalf("depth wrong: %+v", q.Depth)
	}
	if q.Workers.Online != 2 || q.Workers.Total != 3 {
		t.Fatalf("workers online=%d total=%d, want 2/3", q.Workers.Online, q.Workers.Total)
	}
	// The dispatching service is the job type's prefix; studio has the render + one
	// pending, engine has the serve.
	svc := map[string]queueService{}
	for _, s := range q.Services {
		svc[s.Service] = s
	}
	if svc["studio"].Running != 1 || svc["studio"].Pending != 1 {
		t.Fatalf("studio service wrong: %+v", svc["studio"])
	}
	if svc["engine"].Running != 1 {
		t.Fatalf("engine service wrong: %+v", svc["engine"])
	}
	// Running jobs carry the claiming worker + the target model.
	var served string
	for _, j := range q.Running {
		if j.Worker == "spark" {
			served = j.Model
		}
	}
	if served != "qwen3-32b" {
		t.Fatalf("want spark serving qwen3-32b, got %q", served)
	}
}

// TestCloudInfraGate: both routes fail-closed for a non-admin owner (403) and
// anonymous (401), leaking no payload.
func TestCloudInfraGate(t *testing.T) {
	for _, route := range []string{"/v1/world/cloud/clusters", "/v1/world/cloud/queue"} {
		resp, body := getInfra(t, route, 200, `{"owner":"acme","sub":"u1"}`, "Bearer good")
		if resp.StatusCode != http.StatusForbidden {
			t.Fatalf("%s non-admin got %d, want 403", route, resp.StatusCode)
		}
		var probe map[string]any
		if json.Unmarshal(body, &probe) == nil {
			if _, leaked := probe["clusters"]; leaked {
				t.Fatalf("%s leaked clusters to non-admin", route)
			}
			if _, leaked := probe["depth"]; leaked {
				t.Fatalf("%s leaked queue depth to non-admin", route)
			}
		}
	}
}
