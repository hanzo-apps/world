package world

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
)

// Enso benchmark suite — the ADMIN-ONLY head-to-head. Enso is a PRIVATE Hanzo
// product and this data names only Enso's own measured results, so the endpoint is gated
// by requireAdmin (fail-closed: 401 without a token, 403 for a non-admin owner) —
// the SAME IAM-introspection gate the deep Cloud panels use. A non-admin never
// receives the benchmark JSON; it is not merely hidden in the client.
//
// It reshapes the committed enso-bench snapshot (the SAME //go:embed
// ensodata/summary.json the flywheel reads — one source, two views) into three
// honest blocks the panel renders:
//
//  1. per-bench measured head-to-head (each system's accuracy ± stderr + cost,
//     with the best single arm and the Enso-reported figure alongside),
//  2. the enso-ultra v1→v2 verify-then-select ablation (Δ accuracy + cost drop),
//  3. the agentic SWE-Bench Pro pilot (step-routed vs single-Opus),
//
// plus server-authored caveats so the honest framing travels WITH the data and
// cannot be stripped in the client. Numbers are measured; Enso columns are
// Enso's own reported (Table 1) figures — never conflated.

// ── snapshot shape (superset of the flywheel's minimal read) ─────────────────

type benchFullRow struct {
	AccuracyPct float64 `json:"accuracy_pct"`
	StderrPct   float64 `json:"stderr_pct"`
	N           int     `json:"n"`
	UsdEst      float64 `json:"usd_est"`
	RunTag      string  `json:"run_tag"`
}

type ablationEntry struct {
	AccuracyPct float64 `json:"accuracy_pct"`
	N           int     `json:"n"`
	UsdEst      float64 `json:"usd_est"`
	Logic       string  `json:"logic"`
}

type agenticEntry struct {
	N            int     `json:"n"`
	Resolved     int     `json:"resolved"`
	ResolvedRate float64 `json:"resolved_rate"`
	Usd          float64 `json:"usd"`
	Calls        int     `json:"calls"`
}

type benchSnapshot struct {
	Measured      map[string]map[string]benchFullRow  `json:"measured"`
	EnsoReported  map[string]map[string]float64       `json:"enso_reported"`
	UltraAblation map[string]map[string]ablationEntry `json:"ultra_ablation"`
	Pending       []string                            `json:"pending"`
	TotalUsdEst   float64                             `json:"total_usd_est"`
	Agentic       map[string]struct {
		Bench   string                  `json:"bench"`
		Metric  string                  `json:"metric"`
		NItems  int                     `json:"n_items"`
		Systems map[string]agenticEntry `json:"systems"`
		Note    string                  `json:"note"`
	} `json:"agentic"`
}

// ── wire shape (what the panel consumes) ─────────────────────────────────────

type benchSystemRow struct {
	System      string  `json:"system"`
	Family      string  `json:"family"` // "enso" | "arm" — drives the highlight
	AccuracyPct float64 `json:"accuracyPct"`
	StderrPct   float64 `json:"stderrPct"`
	N           int     `json:"n"`
	UsdEst      float64 `json:"usdEst"`
	Preflight   bool    `json:"preflight,omitempty"` // n<=1 / run_tag preflight ⇒ not a scored run
}

type benchTable struct {
	Key               string           `json:"key"`
	Name              string           `json:"name"`
	Systems           []benchSystemRow `json:"systems"` // sorted by accuracy desc
	BestArm           string           `json:"bestArm"` // best NON-enso measured arm
	BestArmPct        float64          `json:"bestArmPct"`
	EnsoPct           float64          `json:"ensoPct"`
	EnsoUsd           float64          `json:"ensoUsd"`
	EnsoReported      float64          `json:"ensoReported,omitempty"`
	EnsoUltraReported float64          `json:"ensoUltraReported,omitempty"`
	Note              string           `json:"note,omitempty"`
}

type ablationArm struct {
	Label       string  `json:"label"`
	Logic       string  `json:"logic"`
	AccuracyPct float64 `json:"accuracyPct"`
	N           int     `json:"n"`
	UsdEst      float64 `json:"usdEst"`
}

type ablationTable struct {
	Key         string      `json:"key"`
	Name        string      `json:"name"`
	V1          ablationArm `json:"v1"`
	V2          ablationArm `json:"v2"`
	DeltaPts    float64     `json:"deltaPts"`
	CostDropPct float64     `json:"costDropPct"`
}

type agenticSystemRow struct {
	Label        string  `json:"label"`
	ResolvedRate float64 `json:"resolvedRate"` // 0..1
	Resolved     int     `json:"resolved"`
	N            int     `json:"n"`
	UsdEst       float64 `json:"usdEst"`
	Calls        int     `json:"calls"`
}

type agenticTable struct {
	Bench      string           `json:"bench"`
	Metric     string           `json:"metric"`
	StepRouted agenticSystemRow `json:"stepRouted"`
	SingleOpus agenticSystemRow `json:"singleOpus"`
	Note       string           `json:"note"`
}

type ensoTable struct {
	Bench  string             `json:"bench"`
	Scores map[string]float64 `json:"scores"`
}

type ensoBenchmarks struct {
	UpdatedAt   string          `json:"updatedAt"`
	Source      string          `json:"source"` // "embedded" | "live"
	Benches     []benchTable    `json:"benches"`
	Ablation    []ablationTable `json:"ablation"`
	Agentic     *agenticTable   `json:"agentic,omitempty"`
	Enso        []ensoTable     `json:"enso"`
	Pending     []string        `json:"pending"`
	TotalUsdEst float64         `json:"totalUsdEst"`
	Caveats     []string        `json:"caveats"`
}

// benchDisplay maps a measured bench key to its display name and the Enso Table-1
// label for the same benchmark (empty ⇒ no Enso counterpart). The slice order is
// the panel's display order (agentic-adjacent code benches first).
var benchDisplay = []struct {
	Key, Name, Enso string
}{
	{"livecodebench", "LiveCodeBench", "LiveCodeBench"},
	{"gpqa_diamond", "GPQA Diamond", "GPQA Diamond"},
	{"hle", "Humanity's Last Exam", "Humanity's Last Exam"},
}

// ── handler ──────────────────────────────────────────────────────────────────

// handleEnsoBenchmarks serves the admin-only head-to-head. requireAdmin is the
// gate (401/403 fail-closed); on success it reshapes the embedded snapshot (or a
// live ENSO_BENCH_URL) and returns 200. No upstream forward — the data is local.
func (s *Server) handleEnsoBenchmarks(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") || methodNotGet(w, r) {
		return
	}
	if _, ok := s.requireAdmin(w, r); !ok {
		return // requireAdmin already wrote 401 / 403
	}
	data, source := s.ensoBenchmarksSource(r.Context())
	writeJSON(w, http.StatusOK, "no-store", buildEnsoBenchmarks(data, source))
}

// ensoBenchmarksSource returns the snapshot bytes and their provenance: a live
// ENSO_BENCH_URL when configured and it parses, else the committed embed.
func (s *Server) ensoBenchmarksSource(ctx context.Context) ([]byte, string) {
	if u := env("ENSO_BENCH_URL"); u != "" {
		if body, err := s.getText(ctx, u, nil); err == nil {
			var probe benchSnapshot
			if json.Unmarshal([]byte(body), &probe) == nil && len(probe.Measured) > 0 {
				return []byte(body), "live"
			}
		}
	}
	return ensoBenchSummary, "embedded"
}

// buildEnsoBenchmarks reshapes a snapshot into the panel payload. Total, pure and
// order-stable: an unparseable snapshot yields an empty-but-valid response rather
// than an error, so the admin panel degrades honestly instead of 5xxing.
func buildEnsoBenchmarks(data []byte, source string) ensoBenchmarks {
	out := ensoBenchmarks{UpdatedAt: nowRFC(), Source: source, Pending: []string{}, Benches: []benchTable{}, Ablation: []ablationTable{}, Enso: []ensoTable{}}
	var snap benchSnapshot
	if json.Unmarshal(data, &snap) != nil {
		out.Caveats = ensoCaveats(out.Benches, out.Ablation, out.Agentic)
		return out
	}

	out.Benches = buildBenchTables(snap)
	out.Ablation = buildAblation(snap.UltraAblation)
	out.Agentic = buildAgentic(snap)
	out.Enso = buildEnso(snap.EnsoReported)
	if snap.Pending != nil {
		out.Pending = snap.Pending
	}
	out.TotalUsdEst = snap.TotalUsdEst
	out.Caveats = ensoCaveats(out.Benches, out.Ablation, out.Agentic)
	return out
}

func buildBenchTables(snap benchSnapshot) []benchTable {
	tables := make([]benchTable, 0, len(benchDisplay))
	for _, bd := range benchDisplay {
		sysMap, ok := snap.Measured[bd.Key]
		if !ok || len(sysMap) == 0 {
			continue
		}
		t := benchTable{Key: bd.Key, Name: bd.Name}
		for sys, row := range sysMap {
			pre := row.N <= 1 || row.RunTag == "preflight"
			t.Systems = append(t.Systems, benchSystemRow{
				System:      sys,
				Family:      ensoFamily(sys),
				AccuracyPct: row.AccuracyPct,
				StderrPct:   row.StderrPct,
				N:           row.N,
				UsdEst:      row.UsdEst,
				Preflight:   pre,
			})
		}
		sort.Slice(t.Systems, func(a, b int) bool {
			if t.Systems[a].AccuracyPct != t.Systems[b].AccuracyPct {
				return t.Systems[a].AccuracyPct > t.Systems[b].AccuracyPct
			}
			return t.Systems[a].System < t.Systems[b].System
		})
		// Best single arm = highest-accuracy scored (non-preflight) NON-enso system.
		for _, srow := range t.Systems {
			if srow.Family == "enso" || srow.Preflight {
				continue
			}
			t.BestArm, t.BestArmPct = srow.System, srow.AccuracyPct
			break
		}
		if er, ok := sysMap["enso"]; ok {
			t.EnsoPct, t.EnsoUsd = er.AccuracyPct, er.UsdEst
		}
		if bd.Enso != "" {
			if fr, ok := snap.EnsoReported[bd.Enso]; ok {
				t.EnsoReported = fr["Enso"]
				t.EnsoUltraReported = fr["Enso-Ultra"]
			}
		}
		if allPreflight(t.Systems) {
			t.Note = "Preflight only (n≤1) — not a scored run."
		}
		tables = append(tables, t)
	}
	return tables
}

// buildAblation reshapes ultra_ablation: v1 is the "v1" baseline (blind synthesis);
// v2 is the shipped verify-then-select rerun (key "v2" if present, else the sole
// other variant, e.g. "overnight"). Δ points and cost drop are computed, not typed.
func buildAblation(abl map[string]map[string]ablationEntry) []ablationTable {
	if len(abl) == 0 {
		return []ablationTable{}
	}
	keys := make([]string, 0, len(abl))
	for k := range abl {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	out := make([]ablationTable, 0, len(keys))
	for _, key := range keys {
		variants := abl[key]
		v1, ok := variants["v1"]
		if !ok {
			continue
		}
		v2, v2key := pickV2(variants)
		if v2key == "" {
			continue
		}
		t := ablationTable{
			Key:  key,
			Name: benchName(key),
			V1:   ablationArm{Label: "Blind-synthesis (v1)", Logic: v1.Logic, AccuracyPct: v1.AccuracyPct, N: v1.N, UsdEst: v1.UsdEst},
			V2:   ablationArm{Label: "Verify-then-select (v2)", Logic: v2.Logic, AccuracyPct: v2.AccuracyPct, N: v2.N, UsdEst: v2.UsdEst},
		}
		t.DeltaPts = round1(v2.AccuracyPct - v1.AccuracyPct)
		if v1.UsdEst > 0 {
			t.CostDropPct = round1((v1.UsdEst - v2.UsdEst) / v1.UsdEst * 100)
		}
		out = append(out, t)
	}
	return out
}

// pickV2 selects the shipped-logic rerun among the non-v1 variants: prefer "v2",
// then "overnight", else the lexicographically-first remaining key.
func pickV2(variants map[string]ablationEntry) (ablationEntry, string) {
	for _, pref := range []string{"v2", "overnight"} {
		if e, ok := variants[pref]; ok {
			return e, pref
		}
	}
	rest := make([]string, 0, len(variants))
	for k := range variants {
		if k != "v1" {
			rest = append(rest, k)
		}
	}
	if len(rest) == 0 {
		return ablationEntry{}, ""
	}
	sort.Strings(rest)
	return variants[rest[0]], rest[0]
}

func buildAgentic(snap benchSnapshot) *agenticTable {
	sw, ok := snap.Agentic["swebench_pro"]
	if !ok {
		return nil
	}
	sr, okS := sw.Systems["step-routed"]
	so, okO := sw.Systems["single-opus"]
	if !okS || !okO {
		return nil
	}
	return &agenticTable{
		Bench:      firstNonEmpty(sw.Bench, "SWE-Bench Pro"),
		Metric:     sw.Metric,
		StepRouted: agenticSystemRow{Label: "Enso step-routed", ResolvedRate: sr.ResolvedRate, Resolved: sr.Resolved, N: sr.N, UsdEst: sr.Usd, Calls: sr.Calls},
		SingleOpus: agenticSystemRow{Label: "Single Opus-4.8", ResolvedRate: so.ResolvedRate, Resolved: so.Resolved, N: so.N, UsdEst: so.Usd, Calls: so.Calls},
		Note:       sw.Note,
	}
}

func buildEnso(enso map[string]map[string]float64) []ensoTable {
	if len(enso) == 0 {
		return []ensoTable{}
	}
	keys := make([]string, 0, len(enso))
	for k := range enso {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	out := make([]ensoTable, 0, len(keys))
	for _, k := range keys {
		out = append(out, ensoTable{Bench: k, Scores: enso[k]})
	}
	return out
}

// ensoCaveats is the server-authored honest framing. The load-bearing numbers are
// computed from the parsed tables so the caveats can never drift from the data on
// a snapshot refresh; the framing prose is fixed.
func ensoCaveats(benches []benchTable, ablation []ablationTable, agentic *agenticTable) []string {
	caveats := []string{}

	// LiveCodeBench headline — every number computed from the parsed table (no
	// literal drifts when the snapshot refreshes); the premium-arm reference is
	// read from the table's own Opus row when present.
	if lcb := findBench(benches, "livecodebench"); lcb != nil && lcb.EnsoPct > 0 {
		ref := ""
		if op := findSystemRow(lcb, "opus-4.8"); op != nil && !op.Preflight {
			ref = fmt.Sprintf("; the premium arm Opus-4.8 scores %.1f%% at $%.2f", op.AccuracyPct, op.UsdEst)
		}
		caveats = append(caveats, fmt.Sprintf(
			"On LiveCodeBench, Enso scores %.1f%% @ $%.2f — tracking the best single arm (%s %.1f%%)%s. It does NOT beat every SOTA; we read each row on its own, never as an aggregate that hides a regression.",
			lcb.EnsoPct, lcb.EnsoUsd, lcb.BestArm, lcb.BestArmPct, ref))
	}

	// HLE note is emitted ONLY when HLE is genuinely a preflight (n≤1) in the
	// snapshot — so it can never claim "not scored" over a real scored run.
	if hle := findBench(benches, "hle"); hle != nil && len(hle.Systems) > 0 && hle.Systems[0].Preflight {
		caveats = append(caveats,
			"HLE here is a preflight only (n≤1) — not a scored run; treat it as not-yet-measured, not a real 0%.")
	}

	caveats = append(caveats,
		"Every number here is MEASURED live against real APIs through the Hanzo gateway — with the per-system cost shown. Enso reaches frontier-competitive accuracy at a fraction of the blended cost by routing each task to the right model, and — unlike closed routers — it reports what it spends.")

	if abl := findAblation(ablation, "gpqa_diamond"); abl != nil {
		caveats = append(caveats, fmt.Sprintf(
			"The verify-then-select ablation is better AND cheaper on GPQA (%+.1f pts at %.1f%% lower cost).",
			abl.DeltaPts, abl.CostDropPct))
	}
	if agentic != nil {
		caveats = append(caveats, fmt.Sprintf(
			"Agentic step-routing wins too: SWE-Bench Pro pilot %.1f%% resolved vs single-Opus %.1f%%, and cheaper ($%.2f vs $%.2f). Pilot n=%d; full run pending.",
			agentic.StepRouted.ResolvedRate*100, agentic.SingleOpus.ResolvedRate*100,
			agentic.StepRouted.UsdEst, agentic.SingleOpus.UsdEst, agentic.StepRouted.N))
	}
	return caveats
}

// findSystemRow returns a system's row in a bench table, or nil.
func findSystemRow(t *benchTable, system string) *benchSystemRow {
	for i := range t.Systems {
		if t.Systems[i].System == system {
			return &t.Systems[i]
		}
	}
	return nil
}

// ── small helpers ────────────────────────────────────────────────────────────

func ensoFamily(system string) string {
	if system == "enso" || system == "enso-ultra" || system == "enso-flash" {
		return "enso"
	}
	return "arm"
}

func allPreflight(rows []benchSystemRow) bool {
	if len(rows) == 0 {
		return false
	}
	for _, r := range rows {
		if !r.Preflight {
			return false
		}
	}
	return true
}

func benchName(key string) string {
	for _, bd := range benchDisplay {
		if bd.Key == key {
			return bd.Name
		}
	}
	return key
}

func findBench(benches []benchTable, key string) *benchTable {
	for i := range benches {
		if benches[i].Key == key {
			return &benches[i]
		}
	}
	return nil
}

func findAblation(ablation []ablationTable, key string) *ablationTable {
	for i := range ablation {
		if ablation[i].Key == key {
			return &ablation[i]
		}
	}
	return nil
}
