package model

// Durable history: a bounded, on-disk ring of world-model snapshots.
//
// The live Store is in-memory; the Engine already persists ONE full warm-start
// snapshot (world-model.json) so a restart resumes current state. This file adds
// the orthogonal, queryable half: a compact TIME-SERIES of the global state,
// captured once per fold, retained for ~24h, so charts and the analyst can ask
// "what changed over the window" and a restart keeps the chart warm.
//
// One value (a Point) per fold, appended to a bounded ring (HistoryCap), written
// gzipped to a single file with atomic rename, loaded on boot. This is the honest
// answer to "is data going into a datastore": yes, pod-local with 24h retention,
// served at GET /v1/world/model/history. A long-horizon global datastore is a
// separate platform decision — not built here.

import (
	"compress/gzip"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// logHistory namespaces the ring's best-effort persistence warnings.
func logHistory(format string, args ...any) {
	log.Printf("world-model history: "+format, args...)
}

// HistoryCap bounds the retained series (~24h at a 5-min ingest cadence; ~48h at
// the 10-min default). Series(hours) windows by wall-clock, so retention degrades
// gracefully regardless of the actual cadence.
const HistoryCap = 288

// maxSeriesPoints caps a /history response so a chart payload stays small even if
// the cadence tightens; the ring itself never exceeds HistoryCap today.
const maxSeriesPoints = 288

// Mover is one entity's contribution to a history Point — enough to annotate a
// chart or ground the analyst, nothing more.
type Mover struct {
	ID           string  `json:"id"`
	Name         string  `json:"name"`
	Kind         string  `json:"kind"`
	Level        string  `json:"level"`
	Instability  float64 `json:"instability"`
	NewsVelocity float64 `json:"newsVelocity"`
}

// Point is one downsample-ready observation of GLOBAL world state at time T: the
// composite instability index plus the cycle's top news movers.
type Point struct {
	T         time.Time `json:"t"`
	Composite float64   `json:"compositeInstability"`
	Entities  int       `json:"entities"`
	TopMovers []Mover   `json:"topMovers"`
}

// History is the bounded on-disk ring behind GET /v1/world/model/history and the
// analyst's window digest. Concurrent-safe; one gzipped file, atomically rewritten.
type History struct {
	mu     sync.RWMutex
	path   string
	cap    int
	points []Point
}

// NewHistory builds the ring; the series persists in dataDir alongside the
// warm-start snapshot. capN<=0 uses HistoryCap.
func NewHistory(dataDir string, capN int) *History {
	if capN <= 0 {
		capN = HistoryCap
	}
	return &History{
		path: filepath.Join(dataDir, "world-model-history.json.gz"),
		cap:  capN,
	}
}

// Load reads the persisted series on boot (best effort — a missing/corrupt file
// is a cold start, never an error).
func (h *History) Load() {
	f, err := os.Open(h.path)
	if err != nil {
		return
	}
	defer func() { _ = f.Close() }()
	gz, err := gzip.NewReader(f)
	if err != nil {
		return
	}
	defer func() { _ = gz.Close() }()
	var pts []Point
	if err := json.NewDecoder(gz).Decode(&pts); err != nil {
		return
	}
	if len(pts) > h.cap {
		pts = pts[len(pts)-h.cap:]
	}
	h.mu.Lock()
	h.points = pts
	h.mu.Unlock()
}

// Record appends a Point, trims to cap, and persists atomically. A persistence
// failure is swallowed (logged by save): the in-memory series stays correct.
func (h *History) Record(p Point) {
	h.mu.Lock()
	h.points = append(h.points, p)
	if len(h.points) > h.cap {
		h.points = append(h.points[:0], h.points[len(h.points)-h.cap:]...)
	}
	snapshot := make([]Point, len(h.points))
	copy(snapshot, h.points)
	h.mu.Unlock()
	h.save(snapshot)
}

// save gzips the series to a temp file and renames it into place, so a crash
// mid-write never corrupts the ring.
func (h *History) save(points []Point) {
	if err := os.MkdirAll(filepath.Dir(h.path), 0o755); err != nil {
		logHistory("mkdir: %v", err)
		return
	}
	tmp := h.path + ".tmp"
	f, err := os.Create(tmp)
	if err != nil {
		logHistory("create: %v", err)
		return
	}
	gz := gzip.NewWriter(f)
	encErr := json.NewEncoder(gz).Encode(points)
	closeGzErr := gz.Close()
	closeErr := f.Close()
	if encErr != nil || closeGzErr != nil || closeErr != nil {
		logHistory("encode: enc=%v gz=%v file=%v", encErr, closeGzErr, closeErr)
		_ = os.Remove(tmp)
		return
	}
	if err := os.Rename(tmp, h.path); err != nil {
		logHistory("rename: %v", err)
		_ = os.Remove(tmp)
	}
}

// window returns every Point in the last `hours`, oldest first (no downsample).
func (h *History) window(hours int) []Point {
	if hours <= 0 {
		hours = 24
	}
	cutoff := time.Now().UTC().Add(-time.Duration(hours) * time.Hour)
	h.mu.RLock()
	defer h.mu.RUnlock()
	out := make([]Point, 0, len(h.points))
	for _, p := range h.points {
		if !p.T.Before(cutoff) {
			out = append(out, p)
		}
	}
	return out
}

// Series returns the windowed points downsampled to maxSeriesPoints for a chart.
func (h *History) Series(hours int) []Point {
	return downsample(h.window(hours), maxSeriesPoints)
}

// downsample strides a series down to at most max points, always keeping the
// last point so the chart ends at "now". Returns the input when already small.
func downsample(in []Point, max int) []Point {
	if max <= 0 || len(in) <= max {
		if in == nil {
			return []Point{}
		}
		return in
	}
	stride := (len(in) + max - 1) / max
	out := make([]Point, 0, max+1)
	for i := 0; i < len(in); i += stride {
		out = append(out, in[i])
	}
	if last := in[len(in)-1]; len(out) == 0 || out[len(out)-1].T != last.T {
		out = append(out, last)
	}
	return out
}

// pointFromStore computes the current global Point from a Store: the composite
// instability index (mean of the elevated country tail) and this cycle's top
// news movers. Store methods lock internally, so this needs no external lock.
func pointFromStore(st *Store, at time.Time) Point {
	countries := st.Top(KindCountry, MetricInstability, 25)
	var sum float64
	for _, e := range countries {
		sum += e.Metrics[MetricInstability]
	}
	composite := 0.0
	if len(countries) > 0 {
		composite = round2(sum / float64(len(countries)))
	}
	movers := st.Top("", "velocity", 8)
	out := make([]Mover, 0, 5)
	for _, e := range movers {
		v := e.Metrics[MetricNewsVelocity]
		if v == 0 {
			continue
		}
		out = append(out, Mover{
			ID: e.ID, Name: e.Name, Kind: e.Kind, Level: e.Level,
			Instability: round2(e.Metrics[MetricInstability]), NewsVelocity: round2(v),
		})
		if len(out) == 5 {
			break
		}
	}
	return Point{T: at, Composite: composite, Entities: st.Len(), TopMovers: out}
}

// HistoryDigest is the analyst's compact, ≤2KB "what changed over the window"
// briefing: the composite-index trend, the biggest news movers seen across the
// window, and the currently-highest-instability countries (live). Empty when the
// history is empty. It composes the ring (trajectory) with the live store (now),
// mirroring Context() — one place for AI grounding text.
func (e *Engine) HistoryDigest(hours int) string {
	pts := e.history.window(hours)
	if len(pts) == 0 {
		return ""
	}
	first, last := pts[0], pts[len(pts)-1]
	delta := round2(last.Composite - first.Composite)
	trend := "steady"
	if delta > 1 {
		trend = "rising"
	} else if delta < -1 {
		trend = "falling"
	}

	var b strings.Builder
	fmt.Fprintf(&b, "WORLD MODEL — last %dh (%d samples over %s):\n",
		hours, len(pts), last.T.Sub(first.T).Round(time.Minute))
	fmt.Fprintf(&b, "Global instability index %.1f → %.1f (%s, %+.1f).\n",
		first.Composite, last.Composite, trend, delta)

	// Biggest news movers across the window: keep each entity's peak |velocity|.
	type agg struct {
		name, level  string
		vel, inst    float64
	}
	best := map[string]*agg{}
	for _, p := range pts {
		for _, m := range p.TopMovers {
			if a := best[m.ID]; a == nil || math.Abs(m.NewsVelocity) > math.Abs(a.vel) {
				best[m.ID] = &agg{m.Name, m.Level, m.NewsVelocity, m.Instability}
			}
		}
	}
	if len(best) > 0 {
		type kv struct {
			id string
			a  *agg
		}
		list := make([]kv, 0, len(best))
		for id, a := range best {
			list = append(list, kv{id, a})
		}
		sort.Slice(list, func(i, j int) bool {
			return math.Abs(list[i].a.vel) > math.Abs(list[j].a.vel)
		})
		if len(list) > 6 {
			list = list[:6]
		}
		parts := make([]string, 0, len(list))
		for _, it := range list {
			parts = append(parts, fmt.Sprintf("%s (news %s, instability %.0f %s)",
				it.a.name, signed(it.a.vel), it.a.inst, it.a.level))
		}
		b.WriteString("Biggest news movers in window: " + strings.Join(parts, "; ") + ".\n")
	}

	if top := e.store.Top(KindCountry, MetricInstability, 5); len(top) > 0 {
		parts := make([]string, 0, len(top))
		for _, ent := range top {
			parts = append(parts, fmt.Sprintf("%s %.0f (%s)",
				ent.Name, ent.Metrics[MetricInstability], ent.Level))
		}
		b.WriteString("Currently highest instability: " + strings.Join(parts, ", ") + ".")
	}

	out := strings.TrimRight(b.String(), "\n")
	if len(out) > 2000 { // hard ≤2KB guard
		out = out[:2000]
	}
	return out
}
