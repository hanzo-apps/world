package world

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// gatusBoard3of4 is a Gatus statuses board with 3 of 4 endpoints healthy → the
// status-page proxy derives a real 75% uptime (up/total), never a constant.
const gatusBoard3of4 = `[
	{"name":"api","group":"core","results":[{"status":200,"success":true,"timestamp":"2026-07-16T00:00:00Z","duration":1000000}]},
	{"name":"iam","group":"core","results":[{"status":200,"success":true,"timestamp":"2026-07-16T00:00:00Z","duration":1200000}]},
	{"name":"kms","group":"core","results":[{"status":200,"success":true,"timestamp":"2026-07-16T00:00:00Z","duration":1500000}]},
	{"name":"llm","group":"ai","results":[{"status":503,"success":false,"timestamp":"2026-07-16T00:00:00Z","duration":2000000,"errors":["down"]}]}
]`

// TestCloudPulseHonestEmpty verifies the honesty contract when NOTHING is reachable
// (no service token, upstreams dead): /v1/world/cloud-pulse returns a clean 200 that
// is flagged demo:true + volumeModeled:true, carries a human note, and is HONESTLY
// EMPTY — zero volume, empty models/regions/series. It never fabricates a diurnal
// curve, a model mix, per-region rates, or a hardcoded uptime.
func TestCloudPulseHonestEmpty(t *testing.T) {
	// Dead api + status origins so every real source fails fast and deterministically.
	dead := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	deadURL := dead.URL
	dead.Close() // now refuses connections → fetches fail fast
	t.Setenv("HANZO_CLOUD_PULSE_TOKEN", "")
	t.Setenv("HANZO_API_BASE", deadURL)
	t.Setenv("HANZO_STATUS_BASE", deadURL)

	s := NewServer()
	mux := http.NewServeMux()
	s.Mount(mux)
	ts := httptest.NewServer(mux)
	t.Cleanup(ts.Close)

	resp, err := http.Get(ts.URL + "/v1/world/cloud-pulse")
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("want 200, got %d", resp.StatusCode)
	}

	var p cloudPulse
	if err := json.NewDecoder(resp.Body).Decode(&p); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !p.Demo || !p.VolumeModeled {
		t.Fatalf("empty path must flag demo:true & volumeModeled:true, got demo=%v volumeModeled=%v", p.Demo, p.VolumeModeled)
	}
	if p.Source != "empty" {
		t.Fatalf("want source=empty, got %q", p.Source)
	}
	if p.Note == "" {
		t.Fatalf("empty payload must carry a human note")
	}
	// Honest-empty: NOTHING fabricated. All volume zero, no invented mix/regions/series.
	if p.Overview.RequestsPerSec != 0 || p.Overview.Requests24h != 0 || p.Overview.Tokens24h != 0 {
		t.Fatalf("volume must be zero when unmeasured, got %+v", p.Overview)
	}
	if p.Overview.UptimePct != 0 {
		t.Fatalf("uptime must be zero (tile dropped) when the status page is unreachable, got %v", p.Overview.UptimePct)
	}
	if len(p.Models) != 0 || len(p.Regions) != 0 {
		t.Fatalf("must not fabricate models/regions, got models=%d regions=%d", len(p.Models), len(p.Regions))
	}
	if len(p.RequestSeries) != 0 || len(p.TokenSeries) != 0 {
		t.Fatalf("must not fabricate series, got req=%d tok=%d", len(p.RequestSeries), len(p.TokenSeries))
	}
}

// TestCloudPulseServiceVolume proves the real path: with a service token and a
// reachable super-admin usage ledger, /v1/world/cloud-pulse folds MEASURED platform
// volume (get-cloud-usages ?org=all) + visor counts + a REAL uptime from the status
// page (up/total), drops demo:true AND volumeModeled:true, and surfaces the ledger's
// top models — never modeled.
func TestCloudPulseServiceVolume(t *testing.T) {
	upstream := http.NewServeMux()
	upstream.HandleFunc("/v1/models", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"data":[{"id":"zen-1"},{"id":"zen-omni-30b"},{"id":"qwen3-235b"}]}`))
	})
	upstream.HandleFunc("/v1/machines", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"machines":[{"region":"nyc","status":"active"},{"region":"sfo","status":"active"},{"region":"nyc","status":"stopped"}]}`))
	})
	upstream.HandleFunc("/v1/gpus", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"gpus":[{"region":"nyc"},{"region":"nyc"},{"region":"sfo"}]}`))
	})
	upstream.HandleFunc("/v1/get-cloud-usages", func(w http.ResponseWriter, r *http.Request) {
		if got := r.URL.Query().Get("org"); got != "all" {
			t.Errorf("want org=all (platform-wide), got %q", got)
		}
		_, _ = w.Write([]byte(`{
			"range":"24h","interval":"1h",
			"totals":{"tokens":1180000000,"requests":1000000,"spendCents":42000,"models":3},
			"series":[{"t":"2026-07-16T00:00:00Z","tokens":40000000,"requests":34000},
			          {"t":"2026-07-16T01:00:00Z","tokens":41000000,"requests":35000}],
			"byModel":{"items":[
				{"model":"zen-omni-30b","spendCents":24000,"tokens":600000000,"requests":520000,"pct":57.1},
				{"model":"zen-1","spendCents":12000,"tokens":300000000,"requests":300000,"pct":28.6}]}
		}`))
	})
	// Real uptime source (Gatus): 3 of 4 endpoints healthy → 75%.
	upstream.HandleFunc("/api/v1/endpoints/statuses", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(gatusBoard3of4))
	})
	up := httptest.NewServer(upstream)
	t.Cleanup(up.Close)

	t.Setenv("HANZO_CLOUD_PULSE_TOKEN", "svc-super-admin")
	t.Setenv("HANZO_API_BASE", up.URL)
	t.Setenv("HANZO_STATUS_BASE", up.URL)

	s := NewServer()
	mux := http.NewServeMux()
	s.Mount(mux)
	ts := httptest.NewServer(mux)
	t.Cleanup(ts.Close)

	resp, err := http.Get(ts.URL + "/v1/world/cloud-pulse")
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	defer resp.Body.Close()
	var p cloudPulse
	if err := json.NewDecoder(resp.Body).Decode(&p); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if p.Demo {
		t.Fatalf("service path must set demo:false")
	}
	if p.VolumeModeled {
		t.Fatalf("measured usage must clear volumeModeled")
	}
	if p.Source != "service" {
		t.Fatalf("want source=service, got %q", p.Source)
	}
	if p.Overview.Requests24h != 1_000_000 || p.Overview.Tokens24h != 1_180_000_000 {
		t.Fatalf("want measured 24h volume, got req=%d tok=%d", p.Overview.Requests24h, p.Overview.Tokens24h)
	}
	if p.Overview.ModelsServed != 3 {
		t.Fatalf("want modelsServed=3 (ai catalog), got %d", p.Overview.ModelsServed)
	}
	if p.Overview.NodesTotal != 3 || p.Overview.NodesOnline != 2 {
		t.Fatalf("want nodes 2/3 online, got %d/%d", p.Overview.NodesOnline, p.Overview.NodesTotal)
	}
	if p.Overview.GpusOnline != 3 {
		t.Fatalf("want gpusOnline=3, got %d", p.Overview.GpusOnline)
	}
	if p.Overview.UptimePct != 75 {
		t.Fatalf("want real uptime 75%% (3/4 up), got %v", p.Overview.UptimePct)
	}
	if len(p.Models) != 2 || p.Models[0].ID != "zen-omni-30b" {
		t.Fatalf("want ledger top models, got %+v", p.Models)
	}
	if len(p.RequestSeries) != 2 || p.RequestSeries[1] != 35000 {
		t.Fatalf("want measured series buckets, got %v", p.RequestSeries)
	}
}

// TestCloudPulseRouterFallback proves the honest fallback: with a service token but
// the super-admin usage ledger UNAVAILABLE (403), the pulse does NOT fabricate. It
// folds REAL public volume — requests/sec from the native request-geo globe
// (traffic-globe rps_1m) and total routed requests + hourly throughput + per-model
// mix from the learned-router stats — while leaving token volume blank (tokens 0)
// and volumeModeled:true. demo stays false; the numbers shown are all measured.
func TestCloudPulseRouterFallback(t *testing.T) {
	upstream := http.NewServeMux()
	upstream.HandleFunc("/v1/models", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"data":[{"id":"zen-1"},{"id":"zen-omni-30b"},{"id":"qwen3-235b"}]}`))
	})
	upstream.HandleFunc("/v1/machines", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"machines":[{"region":"nyc","status":"active"},{"region":"sfo","status":"active"}]}`))
	})
	upstream.HandleFunc("/v1/gpus", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"gpus":[{"region":"nyc"},{"region":"sfo"}]}`))
	})
	// Ledger unavailable (e.g. a non-super-admin token) → the fallback must engage.
	upstream.HandleFunc("/v1/get-cloud-usages", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusForbidden)
	})
	// Real routed volume + hourly series + per-model mix (scope MUST be platform).
	upstream.HandleFunc("/v1/router/stats", func(w http.ResponseWriter, r *http.Request) {
		if got := r.URL.Query().Get("scope"); got != "platform" {
			t.Errorf("router-stats scope must be pinned to platform, got %q", got)
		}
		_, _ = w.Write([]byte(`{"status":"ok","data":{
			"window":{"since":"2026-07-16T00:00:00Z","until":"2026-07-17T00:00:00Z","events":864000},
			"by_model":{"zen-omni-30b":520,"zen-1":300,"qwen3-235b":180},
			"throughput":{"per_hour":[35000,36000,34000],"total_window":864000}}}`))
	})
	// Real requests/sec from the native request-geo globe.
	upstream.HandleFunc("/v1/traffic/globe", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"status":"ok","data":{"window":{"minutes":60},
			"points":[{"country":"US","lat":36,"lon":-119,"count":5}],
			"totals":{"rps_1m":0.62,"rpm_60m":30,"top_countries":[{"country":"US","count":5}]}}}`))
	})
	up := httptest.NewServer(upstream)
	t.Cleanup(up.Close)

	t.Setenv("HANZO_CLOUD_PULSE_TOKEN", "svc-non-admin")
	t.Setenv("HANZO_API_BASE", up.URL)
	t.Setenv("HANZO_STATUS_BASE", up.URL) // no status board on this mux → uptime honestly 0

	s := NewServer()
	mux := http.NewServeMux()
	s.Mount(mux)
	ts := httptest.NewServer(mux)
	t.Cleanup(ts.Close)

	resp, err := http.Get(ts.URL + "/v1/world/cloud-pulse")
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	defer resp.Body.Close()
	var p cloudPulse
	if err := json.NewDecoder(resp.Body).Decode(&p); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if p.Demo {
		t.Fatalf("fallback path has real data → demo must be false")
	}
	if !p.VolumeModeled {
		t.Fatalf("non-ledger volume must keep volumeModeled:true (tokens unmeasured)")
	}
	if p.Source != "service" {
		t.Fatalf("want source=service (token plane resolved counts), got %q", p.Source)
	}
	if p.Overview.RequestsPerSec != 0.6 {
		t.Fatalf("want real rps 0.6 (globe rps_1m 0.62), got %v", p.Overview.RequestsPerSec)
	}
	if p.Overview.Requests24h != 864000 {
		t.Fatalf("want real routed requests 864000 (router window.events), got %d", p.Overview.Requests24h)
	}
	if p.Overview.Tokens24h != 0 {
		t.Fatalf("tokens are unmeasured on the fallback → must be 0, got %d", p.Overview.Tokens24h)
	}
	if len(p.RequestSeries) != 3 || p.RequestSeries[0] != 35000 {
		t.Fatalf("want real hourly throughput series, got %v", p.RequestSeries)
	}
	if len(p.TokenSeries) != 0 {
		t.Fatalf("token series is unmeasured → must be empty, got %v", p.TokenSeries)
	}
	// router by_model is opaque "arm-N" on platform scope, NOT real model names, so
	// the model mix must stay EMPTY on the public fallback (never "arm-8") — real
	// per-model usage comes only from the measured ledger (admin path).
	if len(p.Models) != 0 {
		t.Fatalf("router fallback must not surface opaque arm ids as models, got %+v", p.Models)
	}
	if p.Overview.Regions != 2 {
		t.Fatalf("want 2 real regions from the visor fleet, got %d", p.Overview.Regions)
	}
}

// TestCloudPulseAdminBearer proves the flagship admin path: a signed-in admin
// (z@hanzo.ai, owner "hanzo") gets the FULL measured aggregate fetched with their
// OWN bearer — the all-org usage ledger + visor — with NO server-side service token
// wired, served no-store (never the shared public cache) and Vary: Authorization.
func TestCloudPulseAdminBearer(t *testing.T) {
	// IAM: userinfo → the caller resolves to the operator org (admin); global-users →
	// the real platform user list (2 signups in the last 24h, 1 online, 1 old).
	now := time.Now().UTC()
	iamMux := http.NewServeMux()
	iamMux.HandleFunc("/v1/iam/oauth/userinfo", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") == "" {
			http.Error(w, "no auth", http.StatusUnauthorized)
			return
		}
		_, _ = w.Write([]byte(`{"owner":"hanzo","sub":"z@hanzo.ai"}`))
	})
	iamMux.HandleFunc("/v1/iam/global-users", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer admin-token" {
			t.Errorf("global-users must be read with the caller's bearer, got %q", r.Header.Get("Authorization"))
		}
		_, _ = w.Write([]byte(`[
			{"createdTime":"` + now.Add(-2*time.Hour).Format(time.RFC3339) + `","isOnline":true},
			{"createdTime":"` + now.Add(-20*time.Hour).Format(time.RFC3339) + `","isOnline":false},
			{"createdTime":"` + now.Add(-10*24*time.Hour).Format(time.RFC3339) + `","isOnline":false},
			{"createdTime":"` + now.Add(-40*24*time.Hour).Format(time.RFC3339) + `","isOnline":false,"isDeleted":true}]`))
	})
	iam := httptest.NewServer(iamMux)
	t.Cleanup(iam.Close)

	// api.hanzo.ai — the caller's bearer must reach the all-org ledger + visor.
	upstream := http.NewServeMux()
	upstream.HandleFunc("/v1/models", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer admin-token" {
			t.Errorf("caller bearer must be forwarded to /v1/models, got %q", r.Header.Get("Authorization"))
		}
		_, _ = w.Write([]byte(`{"data":[{"id":"zen-1"},{"id":"zen-omni-30b"}]}`))
	})
	upstream.HandleFunc("/v1/machines", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"machines":[{"region":"nyc","status":"active"}]}`))
	})
	upstream.HandleFunc("/v1/gpus", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"gpus":[{"region":"nyc"}]}`))
	})
	upstream.HandleFunc("/v1/get-cloud-usages", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer admin-token" {
			t.Errorf("all-org ledger must be read with the caller's bearer, got %q", r.Header.Get("Authorization"))
		}
		_, _ = w.Write([]byte(`{"range":"24h","interval":"1h",
			"totals":{"tokens":1180000000,"requests":1000000,"spendCents":42000,"models":2},
			"series":[{"t":"2026-07-16T00:00:00Z","tokens":40000000,"requests":34000}],
			"byModel":{"items":[{"model":"zen-omni-30b","tokens":600000000,"requests":520000,"pct":60}]}}`))
	})
	up := httptest.NewServer(upstream)
	t.Cleanup(up.Close)

	t.Setenv("HANZO_CLOUD_PULSE_TOKEN", "") // NO service token — the admin's own bearer drives it
	t.Setenv("HANZO_API_BASE", up.URL)
	t.Setenv("HANZO_STATUS_BASE", up.URL)
	t.Setenv("HANZO_IAM_ISSUER", iam.URL)
	t.Setenv("WORLD_ADMIN_ORGS", "hanzo") // operator org resolves via deploy env, not code

	s := NewServer()
	mux := http.NewServeMux()
	s.Mount(mux)
	ts := httptest.NewServer(mux)
	t.Cleanup(ts.Close)

	req, _ := http.NewRequest(http.MethodGet, ts.URL+"/v1/world/cloud-pulse", nil)
	req.Header.Set("Authorization", "Bearer admin-token")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	defer resp.Body.Close()
	if cc := resp.Header.Get("Cache-Control"); cc != "private, no-store" {
		t.Fatalf("admin pulse must be no-store/private, got Cache-Control %q", cc)
	}
	if v := resp.Header.Get("Vary"); v != "Authorization" {
		t.Fatalf("must Vary: Authorization to isolate the public cache, got %q", v)
	}
	var p cloudPulse
	if err := json.NewDecoder(resp.Body).Decode(&p); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if p.Demo || p.VolumeModeled {
		t.Fatalf("admin ledger path must be fully measured (demo=%v volumeModeled=%v)", p.Demo, p.VolumeModeled)
	}
	if p.Overview.Requests24h != 1_000_000 || p.Overview.Tokens24h != 1_180_000_000 {
		t.Fatalf("admin must see measured all-org volume, got req=%d tok=%d", p.Overview.Requests24h, p.Overview.Tokens24h)
	}
	if p.Overview.ModelsServed != 2 || len(p.Models) != 1 || p.Models[0].ID != "zen-omni-30b" {
		t.Fatalf("admin must see real catalog + ledger models, got served=%d models=%+v", p.Overview.ModelsServed, p.Models)
	}
	// Real platform user metrics from IAM global-users (admin path only).
	if p.Users == nil {
		t.Fatalf("admin must see real user metrics from IAM global-users")
	}
	if p.Users.Total != 3 { // 4 rows, 1 deleted → 3 live
		t.Fatalf("want 3 users (deleted excluded), got %d", p.Users.Total)
	}
	if p.Users.Signups24h != 2 {
		t.Fatalf("want 2 signups in 24h, got %d", p.Users.Signups24h)
	}
	if p.Users.ActiveNow != 1 {
		t.Fatalf("want 1 active-now (isOnline), got %d", p.Users.ActiveNow)
	}
	if len(p.Users.SignupSeries) != userSignupDays {
		t.Fatalf("want a %d-day signup series, got %d", userSignupDays, len(p.Users.SignupSeries))
	}
}

// TestCloudPulseAdminLLMObservability proves the fix for an empty "Model Usage":
// when the exact usage ledger is NOT available to a signed-in admin, cloud-pulse
// folds REAL platform usage + per-model mix (real names) from LLM observability
// (/v1/admin/o11y) — never the opaque router arms, never zeros.
func TestCloudPulseAdminLLMObservability(t *testing.T) {
	iam := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/iam/oauth/userinfo" || r.Header.Get("Authorization") == "" {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write([]byte(`{"owner":"hanzo","sub":"z@hanzo.ai"}`))
	}))
	t.Cleanup(iam.Close)

	api := http.NewServeMux()
	api.HandleFunc("/v1/models", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"data":[{"id":"zen-1"},{"id":"zen-omni-30b"}]}`))
	})
	api.HandleFunc("/v1/machines", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"machines":[{"region":"nyc","status":"active"}]}`))
	})
	api.HandleFunc("/v1/gpus", func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(`{"gpus":[]}`)) })
	api.HandleFunc("/v1/get-cloud-usages", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusForbidden) })
	// LLM observability: real platform usage + top models by REAL name.
	api.HandleFunc("/v1/admin/o11y", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer admin-token" {
			t.Errorf("o11y must be read with the caller's bearer, got %q", r.Header.Get("Authorization"))
		}
		_, _ = w.Write([]byte(`{"totals":{"requests":500000,"tokens":900000000},
			"topModels":[{"model":"zen-omni-30b","requests":300000,"tokens":600000000},
			             {"model":"zen-1","requests":200000,"tokens":300000000}]}`))
	})
	up := httptest.NewServer(api)
	t.Cleanup(up.Close)

	t.Setenv("HANZO_CLOUD_PULSE_TOKEN", "")
	t.Setenv("HANZO_API_BASE", up.URL)
	t.Setenv("HANZO_STATUS_BASE", up.URL)
	t.Setenv("HANZO_IAM_ISSUER", iam.URL)
	t.Setenv("WORLD_ADMIN_ORGS", "hanzo") // operator org resolves via deploy env, not code

	s := NewServer()
	mux := http.NewServeMux()
	s.Mount(mux)
	ts := httptest.NewServer(mux)
	t.Cleanup(ts.Close)

	req, _ := http.NewRequest(http.MethodGet, ts.URL+"/v1/world/cloud-pulse", nil)
	req.Header.Set("Authorization", "Bearer admin-token")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	defer resp.Body.Close()
	var p cloudPulse
	if err := json.NewDecoder(resp.Body).Decode(&p); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(p.Models) != 2 || p.Models[0].ID != "zen-omni-30b" || p.Models[0].Requests24h != 300000 {
		t.Fatalf("want real o11y top models (real names), got %+v", p.Models)
	}
	if p.Overview.Requests24h != 500000 || p.Overview.Tokens24h != 900000000 {
		t.Fatalf("want measured o11y usage, got req=%d tok=%d", p.Overview.Requests24h, p.Overview.Tokens24h)
	}
	if p.VolumeModeled {
		t.Fatalf("measured o11y usage must clear volumeModeled")
	}
}
