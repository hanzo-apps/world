package world

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// The Enso benchmark suite is PRIVATE, competitive data. These tests prove the
// server gate — not the client — keeps it admin-only: a non-admin/anonymous
// caller NEVER receives the benchmark JSON (401/403), while an admin owner gets
// the real reshaped numbers from the embedded snapshot.

func getEnsoBenchmarks(t *testing.T, iamStatus int, iamBody, bearer string) (*http.Response, []byte) {
	t.Helper()
	iam := iamStub(t, iamStatus, iamBody)
	t.Setenv("HANZO_IAM_ISSUER", iam.URL)
	t.Setenv("WORLD_ADMIN_ORGS", "hanzo") // operator org resolves via deploy env, not code
	t.Setenv("ENSO_BENCH_URL", "")        // force the embedded snapshot

	s := NewServer()
	mux := http.NewServeMux()
	s.Mount(mux)
	ts := httptest.NewServer(mux)
	t.Cleanup(ts.Close)

	req, _ := http.NewRequest(http.MethodGet, ts.URL+"/v1/world/enso-benchmarks", nil)
	if bearer != "" {
		req.Header.Set("Authorization", bearer)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	t.Cleanup(func() { resp.Body.Close() })
	buf := make([]byte, 0)
	dec := json.NewDecoder(resp.Body)
	var raw json.RawMessage
	if err := dec.Decode(&raw); err == nil {
		buf = raw
	}
	return resp, buf
}

// TestEnsoBenchmarksGate: the private head-to-head is server-gated, fail-closed.
func TestEnsoBenchmarksGate(t *testing.T) {
	cases := []struct {
		name       string
		iamStatus  int
		iamBody    string
		bearer     string
		wantStatus int
	}{
		{"anonymous → 401", 0, "", "", http.StatusUnauthorized},
		{"non-admin owner → 403", 200, `{"owner":"acme","sub":"u1"}`, "Bearer good", http.StatusForbidden},
		{"empty owner → 403", 200, `{"owner":"","sub":"u1"}`, "Bearer good", http.StatusForbidden},
		{"IAM 401 → 403", 401, `{"error":"invalid_token"}`, "Bearer bad", http.StatusForbidden},
		{"admin owner → 200", 200, `{"owner":"admin","sub":"z"}`, "Bearer good", http.StatusOK},
		{"operator org hanzo → 200", 200, `{"owner":"hanzo","sub":"z"}`, "Bearer good", http.StatusOK},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			resp, body := getEnsoBenchmarks(t, tc.iamStatus, tc.iamBody, tc.bearer)
			if resp.StatusCode != tc.wantStatus {
				t.Fatalf("got %d, want %d (body=%s)", resp.StatusCode, tc.wantStatus, body)
			}
			// A rejected caller must NOT receive any benchmark data.
			if tc.wantStatus != http.StatusOK {
				var probe ensoBenchmarks
				if json.Unmarshal(body, &probe) == nil && len(probe.Benches) > 0 {
					t.Fatalf("leak: rejected caller received %d benches", len(probe.Benches))
				}
			}
		})
	}
}

// TestEnsoBenchmarksAdminPayload: the admin response carries the real reshaped
// snapshot — measured head-to-head, the verify-then-select ablation, the agentic
// pilot, Enso-reported columns, and server-authored caveats.
func TestEnsoBenchmarksAdminPayload(t *testing.T) {
	resp, body := getEnsoBenchmarks(t, 200, `{"owner":"admin","sub":"z"}`, "Bearer good")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("admin got %d, want 200", resp.StatusCode)
	}
	var eb ensoBenchmarks
	if err := json.Unmarshal(body, &eb); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if eb.Source != "embedded" {
		t.Fatalf("want embedded source, got %q", eb.Source)
	}

	// LiveCodeBench head-to-head: enso, sorted desc, best arm identified. The accuracy
	// is the blank-corrected figure (91.4 raw with one dropped response -> 92.0 over the
	// answered set), so this asserts a plausible band rather than a brittle literal that
	// re-pins on every corrected rebuild.
	lcb := findBench(eb.Benches, "livecodebench")
	if lcb == nil {
		t.Fatalf("livecodebench table missing; benches=%+v", eb.Benches)
	}
	if lcb.EnsoPct < 88 || lcb.EnsoPct > 95 {
		t.Fatalf("enso LiveCodeBench out of band: got %v, want ~92 (corrected)", lcb.EnsoPct)
	}
	if lcb.EnsoUsd <= 0 || lcb.EnsoUsd > 10 {
		t.Fatalf("enso LiveCodeBench cost implausible: %v", lcb.EnsoUsd)
	}
	if lcb.BestArm == "" || lcb.BestArm == "enso" || lcb.BestArm == "enso-ultra" {
		t.Fatalf("best arm must be a non-enso system, got %q", lcb.BestArm)
	}
	for i := 1; i < len(lcb.Systems); i++ {
		if lcb.Systems[i-1].AccuracyPct < lcb.Systems[i].AccuracyPct {
			t.Fatalf("systems not sorted desc: %+v", lcb.Systems)
		}
	}
	// No "reported" reference columns: the dashboard shows only our own corrected
	// MEASURED standing. The prior snapshot carried aspirational Enso figures that did not
	// match measurement (and named other vendors); those were removed, so a live table must
	// NOT surface a reported column.
	if lcb.EnsoReported != 0 || lcb.EnsoUltraReported != 0 {
		t.Fatalf("LiveCodeBench must not carry reported columns anymore, got %+v", lcb)
	}
	// enso row must be flagged family=enso for the highlight.
	var sawEnsoFamily bool
	for _, sr := range lcb.Systems {
		if sr.System == "enso" {
			sawEnsoFamily = sr.Family == "enso"
		}
	}
	if !sawEnsoFamily {
		t.Fatalf("enso row must be family=enso")
	}

	// HLE is now a real measured bench (n=500), not the earlier preflight stub: a
	// scored row must carry a real sample size rather than the n<=1 preflight flag.
	if hle := findBench(eb.Benches, "hle"); hle != nil {
		for _, sr := range hle.Systems {
			if sr.System == "enso" || sr.System == "enso-ultra" {
				if sr.Preflight || sr.N < 100 {
					t.Fatalf("HLE %s must be a real measurement now (n=%d, preflight=%v)", sr.System, sr.N, sr.Preflight)
				}
			}
		}
	}

	// Ablation: GPQA v1 blind-synthesis → v2 verify-then-select, better AND cheaper.
	abl := findAblation(eb.Ablation, "gpqa_diamond")
	if abl == nil {
		t.Fatalf("gpqa ablation missing; ablation=%+v", eb.Ablation)
	}
	if abl.DeltaPts <= 0 {
		t.Fatalf("verify-then-select must improve accuracy, ΔPts=%v", abl.DeltaPts)
	}
	if abl.CostDropPct <= 0 {
		t.Fatalf("verify-then-select must cut cost, drop=%v%%", abl.CostDropPct)
	}

	// Agentic pilot: step-routed beats single-opus and is cheaper.
	if eb.Agentic == nil {
		t.Fatalf("agentic SWE-Bench Pro pilot missing")
	}
	if eb.Agentic.StepRouted.ResolvedRate <= eb.Agentic.SingleOpus.ResolvedRate {
		t.Fatalf("step-routed must beat single-opus: %v vs %v", eb.Agentic.StepRouted.ResolvedRate, eb.Agentic.SingleOpus.ResolvedRate)
	}
	if eb.Agentic.StepRouted.UsdEst >= eb.Agentic.SingleOpus.UsdEst {
		t.Fatalf("step-routed must be cheaper: %v vs %v", eb.Agentic.StepRouted.UsdEst, eb.Agentic.SingleOpus.UsdEst)
	}

	// Honest framing must travel with the data.
	if len(eb.Caveats) < 3 {
		t.Fatalf("caveats must be present (honest framing), got %d", len(eb.Caveats))
	}
	// The aspirational "Enso-reported" reference table is gone: it carried figures that
	// did not match measurement and named other vendors. The dashboard stands on its own
	// corrected measured tables, so this must be empty.
	if len(eb.Enso) != 0 {
		t.Fatalf("reported reference table must be empty now, got %d entries", len(eb.Enso))
	}
	if eb.TotalUsdEst <= 0 {
		t.Fatalf("total spend must be reported, got %v", eb.TotalUsdEst)
	}
}
