package world

import (
	"context"
	_ "embed"
	"encoding/json"
	"math"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"
)

// Enso flywheel — the router's self-improvement loop, made visible for the AI
// variant. It folds THREE honest sources into one event-typed payload:
//
//  1. the routing-decision ledger tail (router/ledger ?since=, super-admin
//     JSONL): how many decisions, the engine-vs-heuristic mix, a confidence
//     histogram, and the task / routed-model distribution;
//  2. the reward tail (router/rewards ?since=, JSONL): how many decisions
//     have been scored and their mean reward — the per-request training labels;
//  3. the latest enso-bench eval scores (an embedded snapshot of the enso-bench
//     results summary, or a live ENSO_BENCH_URL when configured).
//
// The result is deliberately event-typed (Events[]) so future retrain / deploy
// milestones slot into the same timeline. Ledger + rewards need the super-admin
// service token; the eval scores are always available (embedded), so the panel
// is useful even signed-out — state says which sources are live.

// ensoBenchSummary is a committed snapshot of enso-bench results/summary.json
// (refresh it when enso-bench reruns; set ENSO_BENCH_URL to override it live). It
// is the "latest eval scores" source and needs no network or token.
//
//go:embed ensodata/summary.json
var ensoBenchSummary []byte

const (
	ensoWindowLabel  = "24h"
	ensoLedgerWindow = 24 * time.Hour
)

// ── wire shapes ───────────────────────────────────────────────────────────────

type ensoBucket struct {
	Label string `json:"label"`
	Count int    `json:"count"`
}

type ensoCount struct {
	Name  string `json:"name"`
	Count int    `json:"count"`
}

type ensoLedgerStats struct {
	Available     bool         `json:"available"` // false ⇒ ledger upstream unreachable
	Total         int          `json:"total"`     // decisions in the window
	Engine        int          `json:"engine"`
	Heuristic     int          `json:"heuristic"`
	EnginePct     float64      `json:"enginePct"`
	Rewarded      int          `json:"rewarded"`
	AvgReward     float64      `json:"avgReward"`
	AvgConfidence float64      `json:"avgConfidence"`
	Confidence    []ensoBucket `json:"confidence"`
	Tasks         []ensoCount  `json:"tasks"`
	Models        []ensoCount  `json:"models"`
}

type ensoEvalRow struct {
	System      string  `json:"system"`
	AccuracyPct float64 `json:"accuracyPct"`
	StderrPct   float64 `json:"stderrPct"`
	N           int     `json:"n"`
	UsdEst      float64 `json:"usdEst"`
}

type ensoEvals struct {
	Bench   string        `json:"bench"`
	Source  string        `json:"source"` // "embedded" | "live"
	Systems []ensoEvalRow `json:"systems"`
}

// ensoEvent is one entry in the flywheel timeline. Type is "eval" | "ledger" |
// "reward" today; retrain / deploy events slot in unchanged.
type ensoEvent struct {
	Type  string  `json:"type"`
	At    string  `json:"at"`
	Label string  `json:"label"`
	Value float64 `json:"value,omitempty"`
}

type ensoTraining struct {
	State     string          `json:"state"` // "live" | "partial" | "demo"
	UpdatedAt string          `json:"updatedAt"`
	Window    string          `json:"window"`
	Since     string          `json:"since"` // RFC3339 ledger cursor
	Ledger    ensoLedgerStats `json:"ledger"`
	Evals     ensoEvals       `json:"evals"`
	Events    []ensoEvent     `json:"events"`
}

// ── handler ───────────────────────────────────────────────────────────────────

// handleEnsoTraining serves the flywheel fold. It never 5xxes: produce always
// yields at least the embedded eval scores, and onError degrades to those.
func (s *Server) handleEnsoTraining(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") || methodNotGet(w, r) {
		return
	}
	s.cachedJSON(w, "enso-training", "public, max-age=30, s-maxage=30, stale-while-revalidate=120",
		60*time.Second, 10*time.Minute,
		func(ctx context.Context) (any, error) { return s.produceEnsoTraining(ctx), nil },
		func(w http.ResponseWriter, _ error) { writeJSON(w, http.StatusOK, "", s.ensoEvalsOnly()) },
	)
}

// produceEnsoTraining folds the ledger + rewards + evals. State reflects which
// live sources resolved: "live" (ledger folded), "partial" (token present but
// ledger unreachable), or "demo" (no token — evals only).
func (s *Server) produceEnsoTraining(ctx context.Context) ensoTraining {
	now := time.Now().UTC()
	since := now.Add(-ensoLedgerWindow).Format(time.RFC3339)

	evals := s.ensoEvals(ctx)
	ledger, ok := s.foldRoutingLedger(ctx, since)

	state := "demo"
	if serviceToken() != "" {
		if ok {
			state = "live"
		} else {
			state = "partial"
		}
	}

	return ensoTraining{
		State:     state,
		UpdatedAt: now.Format(time.RFC3339),
		Window:    ensoWindowLabel,
		Since:     since,
		Ledger:    ledger,
		Evals:     evals,
		Events:    ensoEventsFrom(evals, ledger, now),
	}
}

// ensoEvalsOnly is the degrade payload: embedded eval scores, no ledger.
func (s *Server) ensoEvalsOnly() ensoTraining {
	now := time.Now().UTC()
	evals := parseEnsoEvals(ensoBenchSummary, "embedded")
	return ensoTraining{
		State:     "demo",
		UpdatedAt: now.Format(time.RFC3339),
		Window:    ensoWindowLabel,
		Since:     now.Add(-ensoLedgerWindow).Format(time.RFC3339),
		Ledger:    ensoLedgerStats{Available: false},
		Evals:     evals,
		Events:    ensoEventsFrom(evals, ensoLedgerStats{}, now),
	}
}

// ── routing ledger + rewards fold ─────────────────────────────────────────────

type ledgerRow struct {
	Task        string  `json:"task"`
	RoutedModel string  `json:"routed_model"`
	Confidence  float64 `json:"confidence"`
	Source      string  `json:"source"`
}

type rewardRow struct {
	Reward float64 `json:"reward"`
}

// foldRoutingLedger streams the ledger (and, best-effort, rewards) JSONL and
// reduces it to the panel's aggregates. ok=false (no token / upstream down /
// non-admin) leaves an Available:false zero value so the panel degrades honestly.
func (s *Server) foldRoutingLedger(ctx context.Context, since string) (ensoLedgerStats, bool) {
	hdr := serviceAuth()
	if hdr == nil {
		return ensoLedgerStats{Available: false}, false
	}
	host := apiHost()
	body, err := s.getText(ctx, host+"/v1/router/ledger?since="+url.QueryEscape(since), hdr)
	if err != nil {
		return ensoLedgerStats{Available: false}, false
	}

	stats := ensoLedgerStats{Available: true}
	conf := make([]int, len(confLabels))
	tasks := map[string]int{}
	models := map[string]int{}
	var confSum float64
	for _, line := range strings.Split(body, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		var row ledgerRow
		if json.Unmarshal([]byte(line), &row) != nil {
			continue
		}
		stats.Total++
		switch row.Source {
		case "engine":
			stats.Engine++
		case "heuristic":
			stats.Heuristic++
		}
		confSum += row.Confidence
		conf[confBucketIdx(row.Confidence)]++
		if row.Task != "" {
			tasks[row.Task]++
		}
		if row.RoutedModel != "" {
			models[row.RoutedModel]++
		}
	}
	if stats.Total > 0 {
		stats.AvgConfidence = round2(confSum / float64(stats.Total))
		stats.EnginePct = round1(float64(stats.Engine) / float64(stats.Total) * 100)
	}
	stats.Confidence = bucketsToHistogram(conf)
	stats.Tasks = topCounts(tasks, 6)
	stats.Models = topCounts(models, 6)

	// Rewards are a bonus signal; their absence must not sink the ledger stats.
	if rbody, rerr := s.getText(ctx, host+"/v1/router/rewards?since="+url.QueryEscape(since), hdr); rerr == nil {
		var sum float64
		n := 0
		for _, line := range strings.Split(rbody, "\n") {
			line = strings.TrimSpace(line)
			if line == "" {
				continue
			}
			var rr rewardRow
			if json.Unmarshal([]byte(line), &rr) != nil {
				continue
			}
			n++
			sum += rr.Reward
		}
		stats.Rewarded = n
		if n > 0 {
			stats.AvgReward = round2(sum / float64(n))
		}
	}
	return stats, true
}

var confLabels = []string{"0–20%", "20–40%", "40–60%", "60–80%", "80–100%"}

// confBucketIdx maps a 0..1 confidence to one of five equal bins (clamped).
func confBucketIdx(c float64) int {
	switch {
	case c < 0.2:
		return 0
	case c < 0.4:
		return 1
	case c < 0.6:
		return 2
	case c < 0.8:
		return 3
	default:
		return 4
	}
}

func bucketsToHistogram(counts []int) []ensoBucket {
	out := make([]ensoBucket, len(counts))
	for i, c := range counts {
		out[i] = ensoBucket{Label: confLabels[i], Count: c}
	}
	return out
}

// topCounts returns the n most frequent entries, ties broken by name for a stable
// order.
func topCounts(m map[string]int, n int) []ensoCount {
	out := make([]ensoCount, 0, len(m))
	for k, v := range m {
		out = append(out, ensoCount{Name: k, Count: v})
	}
	sort.Slice(out, func(a, b int) bool {
		if out[a].Count != out[b].Count {
			return out[a].Count > out[b].Count
		}
		return out[a].Name < out[b].Name
	})
	if len(out) > n {
		out = out[:n]
	}
	return out
}

// ── enso-bench eval scores ────────────────────────────────────────────────────

type ensoBenchFile struct {
	Measured map[string]map[string]ensoBenchRow `json:"measured"`
}

type ensoBenchRow struct {
	AccuracyPct float64 `json:"accuracy_pct"`
	StderrPct   float64 `json:"stderr_pct"`
	N           int     `json:"n"`
	UsdEst      float64 `json:"usd_est"`
}

// ensoEvals returns the latest eval scores: a live ENSO_BENCH_URL when configured
// and reachable, else the embedded snapshot.
func (s *Server) ensoEvals(ctx context.Context) ensoEvals {
	if u := env("ENSO_BENCH_URL"); u != "" {
		if body, err := s.getText(ctx, u, nil); err == nil {
			if ev := parseEnsoEvals([]byte(body), "live"); len(ev.Systems) > 0 {
				return ev
			}
		}
	}
	return parseEnsoEvals(ensoBenchSummary, "embedded")
}

// parseEnsoEvals reduces an enso-bench summary to the ranked per-system scores of
// its primary benchmark (gpqa_diamond when present).
func parseEnsoEvals(data []byte, source string) ensoEvals {
	var f ensoBenchFile
	if json.Unmarshal(data, &f) != nil {
		return ensoEvals{Source: source}
	}
	bench := pickBench(f.Measured)
	out := ensoEvals{Bench: bench, Source: source}
	for sys, r := range f.Measured[bench] {
		out.Systems = append(out.Systems, ensoEvalRow{
			System:      sys,
			AccuracyPct: r.AccuracyPct,
			StderrPct:   r.StderrPct,
			N:           r.N,
			UsdEst:      r.UsdEst,
		})
	}
	sort.Slice(out.Systems, func(a, b int) bool {
		if out.Systems[a].AccuracyPct != out.Systems[b].AccuracyPct {
			return out.Systems[a].AccuracyPct > out.Systems[b].AccuracyPct
		}
		return out.Systems[a].System < out.Systems[b].System
	})
	return out
}

// pickBench prefers gpqa_diamond, else the lexicographically-first bench (stable).
func pickBench(m map[string]map[string]ensoBenchRow) string {
	if _, ok := m["gpqa_diamond"]; ok {
		return "gpqa_diamond"
	}
	best := ""
	for k := range m {
		if best == "" || k < best {
			best = k
		}
	}
	return best
}

// ── event timeline ────────────────────────────────────────────────────────────

// ensoEventsFrom builds the typed flywheel timeline. Today it surfaces the
// enso eval score and the ledger/reward counts; retrain / deploy events append
// with the same shape.
func ensoEventsFrom(evals ensoEvals, ledger ensoLedgerStats, now time.Time) []ensoEvent {
	ts := now.Format(time.RFC3339)
	events := make([]ensoEvent, 0, 4)

	// The enso system's headline score (or the top system when enso isn't present).
	if row, ok := ensoHeadlineRow(evals); ok {
		events = append(events, ensoEvent{
			Type:  "eval",
			At:    ts,
			Label: row.System + " · " + evals.Bench,
			Value: row.AccuracyPct,
		})
	}
	if ledger.Available {
		events = append(events, ensoEvent{Type: "ledger", At: ts, Label: "routing decisions folded", Value: float64(ledger.Total)})
		if ledger.Rewarded > 0 {
			events = append(events, ensoEvent{Type: "reward", At: ts, Label: "decisions rewarded", Value: float64(ledger.Rewarded)})
		}
	}
	return events
}

// ensoHeadlineRow picks the "enso" system if the eval carries it, else the top
// (already-sorted) system.
func ensoHeadlineRow(evals ensoEvals) (ensoEvalRow, bool) {
	for _, r := range evals.Systems {
		if r.System == "enso" {
			return r, true
		}
	}
	if len(evals.Systems) > 0 {
		return evals.Systems[0], true
	}
	return ensoEvalRow{}, false
}

func round2(f float64) float64 { return math.Round(f*100) / 100 }
