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
	t.Setenv("ENSO_BENCH_URL", "") // force the embedded snapshot

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

	// LiveCodeBench head-to-head: enso 91.4%, sorted desc, best arm identified.
	lcb := findBench(eb.Benches, "livecodebench")
	if lcb == nil {
		t.Fatalf("livecodebench table missing; benches=%+v", eb.Benches)
	}
	if lcb.EnsoPct != 91.4 {
		t.Fatalf("enso LiveCodeBench want 91.4, got %v", lcb.EnsoPct)
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
	if lcb.EnsoReported == 0 || lcb.EnsoUltraReported == 0 {
		t.Fatalf("LiveCodeBench must carry Enso-reported columns, got %+v", lcb)
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

	// HLE is a preflight (n=1) — must be flagged, not presented as a real 0%.
	if hle := findBench(eb.Benches, "hle"); hle != nil {
		if len(hle.Systems) > 0 && !hle.Systems[0].Preflight {
			t.Fatalf("HLE enso row must be flagged preflight")
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
	if len(eb.Enso) == 0 {
		t.Fatalf("Enso-reported reference table must be present")
	}
	if eb.TotalUsdEst <= 0 {
		t.Fatalf("total spend must be reported, got %v", eb.TotalUsdEst)
	}
}
